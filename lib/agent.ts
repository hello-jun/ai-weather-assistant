import { deepseek } from "./deepseek";
import { getWeather, getUserLocation } from "./tools";
import type { ClientLocation } from "./tools";
import type OpenAI from "openai";

// AG-UI event types (matching @ag-ui/core EventType enum values)
const E = {
  RUN_STARTED: "RUN_STARTED",
  RUN_FINISHED: "RUN_FINISHED",
  RUN_ERROR: "RUN_ERROR",
  TEXT_MESSAGE_START: "TEXT_MESSAGE_START",
  TEXT_MESSAGE_CONTENT: "TEXT_MESSAGE_CONTENT",
  TEXT_MESSAGE_END: "TEXT_MESSAGE_END",
  TOOL_CALL_START: "TOOL_CALL_START",
  TOOL_CALL_ARGS: "TOOL_CALL_ARGS",
  TOOL_CALL_END: "TOOL_CALL_END",
  TOOL_CALL_RESULT: "TOOL_CALL_RESULT",
} as const;

interface AguiMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content?: string;
  toolCallId?: string; // for tool messages: the LLM tool call ID this responds to
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

interface AguiToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface AguiEvent {
  type: string;
  [key: string]: unknown;
}

export interface ClientContext {
  location?: ClientLocation;
}

const SYSTEM_MESSAGE: OpenAI.Chat.Completions.ChatCompletionSystemMessageParam = {
  role: "system",
  content:
    "你是一个专业的天气预报助手。你能用 get_weather 工具查询指定城市的实时天气，用 get_user_location 工具获取用户当前所在城市。请用中文回复，语气友好亲切。当用户询问天气时，如果用户没有指定城市，先调用 get_user_location 获取城市，再调用 get_weather 查询天气；如果用户已经指定了城市，直接调用 get_weather。",
};

/** Convert AG-UI messages to DeepSeek/OpenAI format (system message already included) */
function toOpenAIMessages(messages: AguiMessage[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const openaiMsgs: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  for (const m of messages) {
    if (m.role === "user") {
      openaiMsgs.push({ role: "user", content: m.content || "" });
    } else if (m.role === "assistant") {
      openaiMsgs.push({
        role: "assistant",
        content: m.content || "",
        ...(m.toolCalls?.length && {
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        }),
      });
    } else if (m.role === "tool") {
      // toolCallId links back to the assistant's tool_calls[].id — NOT the message's own id
      openaiMsgs.push({ role: "tool", content: m.content || "", tool_call_id: m.toolCallId || m.id });
    }
  }

  return openaiMsgs;
}

/** Convert AG-UI tool definitions to OpenAI tool format */
function toOpenAITools(tools?: AguiToolDef[]): OpenAI.Chat.Completions.ChatCompletionTool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: t.type,
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    },
  }));
}

/** Execute a tool call locally */
async function executeTool(
  name: string,
  args: Record<string, unknown>,
  clientContext: ClientContext
): Promise<string> {
  if (name === "get_weather") {
    const result = await getWeather({ city: args.city as string });
    return JSON.stringify(result, null, 2);
  }
  if (name === "get_user_location") {
    const result = await getUserLocation(clientContext.location ?? null);
    return JSON.stringify(result, null, 2);
  }
  return JSON.stringify({ error: `未知工具: ${name}` });
}

/**
 * Main agent runner — AsyncGenerator that yields AG-UI protocol events.
 * Consumed by the API route and streamed to the client via SSE.
 */
export async function* runAgent(
  messages: AguiMessage[],
  tools: AguiToolDef[],
  clientContext: ClientContext
): AsyncGenerator<AguiEvent> {
  const runId = crypto.randomUUID();
  const threadId = crypto.randomUUID();

  yield { type: E.RUN_STARTED, runId, threadId };

  let errored = false;
  try {
    const result = await runConversation({ runId, messages, tools, clientContext });
    for await (const event of result) {
      yield event;
    }
  } catch (err) {
    errored = true;
    yield {
      type: E.RUN_ERROR,
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }

  if (!errored) {
    yield { type: E.RUN_FINISHED, runId, threadId };
  }
}

/** Core conversation logic with tool calling loop (max 3 rounds) */
async function* runConversation(params: {
  runId: string;
  messages: AguiMessage[];
  tools: AguiToolDef[];
  clientContext: ClientContext;
}): AsyncGenerator<AguiEvent> {
  const { messages, tools, clientContext } = params;
  let currentMessages = [...messages];
  const openaiTools = toOpenAITools(tools);

  for (let round = 0; round < 3; round++) {
    // Build the full message list with system prompt first (only round 0 includes it implicitly via prepend)
    const apiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      SYSTEM_MESSAGE,
      ...toOpenAIMessages(currentMessages),
    ];

    const completionParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model: "deepseek-v4-pro",
      messages: apiMessages,
      tools: openaiTools,
      temperature: 1.0,
      top_p: 1.0,
      stream: true,
    };
    const stream = await deepseek.chat.completions.create({
      ...completionParams,
      // DeepSeek-specific: disable thinking to avoid reasoning_content round-trip requirement
      thinking: { type: "disabled" },
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);

    const msgId = crypto.randomUUID();
    yield { type: E.TEXT_MESSAGE_START, messageId: msgId, role: "assistant" };

    let fullContent = "";
    const toolCallsMap = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      // Text content streaming
      if (delta?.content) {
        fullContent += delta.content;
        yield {
          type: E.TEXT_MESSAGE_CONTENT,
          messageId: msgId,
          delta: delta.content,
        };
      }

      // Tool call accumulation
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCallsMap.get(tc.index) || {
            id: "",
            name: "",
            arguments: "",
          };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          toolCallsMap.set(tc.index, existing);
        }
      }
    }

    yield { type: E.TEXT_MESSAGE_END, messageId: msgId };

    // Check if there are tool calls
    const toolCalls = Array.from(toolCallsMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([, v]) => v);

    if (toolCalls.length === 0) {
      // No tool calls, conversation done
      break;
    }

    // Emit tool call events + execute
    const toolResultMessages: AguiMessage[] = [];

    for (const tc of toolCalls) {
      yield {
        type: E.TOOL_CALL_START,
        toolCallId: tc.id,
        toolCallName: tc.name,
      };

      yield {
        type: E.TOOL_CALL_ARGS,
        toolCallId: tc.id,
        delta: tc.arguments,
      };

      yield {
        type: E.TOOL_CALL_END,
        toolCallId: tc.id,
      };

      // Execute the tool
      let parsedArgs: Record<string, unknown>;
      try {
        parsedArgs = JSON.parse(tc.arguments);
      } catch {
        parsedArgs = {};
      }

      const result = await executeTool(tc.name, parsedArgs, clientContext);

      yield {
        type: E.TOOL_CALL_RESULT,
        messageId: crypto.randomUUID(),
        toolCallId: tc.id,
        content: result,
        role: "tool",
      };

      // Add to messages for next LLM call
      toolResultMessages.push({
        id: crypto.randomUUID(),
        role: "tool",
        toolCallId: tc.id,
        content: result,
      });
    }

    // Append assistant message (with tool_calls) + tool results to messages
    const assistantMsg: AguiMessage = {
      id: msgId,
      role: "assistant",
      content: fullContent || undefined,
      toolCalls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    };

    currentMessages = [...currentMessages, assistantMsg, ...toolResultMessages];
  }

  // If the model didn't produce tool calls, we're done in the first round
}
