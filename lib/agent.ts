import { deepseek } from "./deepseek";
import { getWeather } from "./tools";
import type OpenAI from "openai";
import type { A2UIMessage } from "./a2ui-types";

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
  CUSTOM: "CUSTOM",
} as const;

const WEATHER_CATALOG_ID = "https://weather-assistant.local/a2ui/catalogs/weather/v1";

function a2uiEvent(message: A2UIMessage): AguiEvent {
  if ("createSurface" in message) {
    return { type: E.CUSTOM, name: "a2ui_create_surface", value: message.createSurface };
  }
  if ("updateComponents" in message) {
    return { type: E.CUSTOM, name: "a2ui_update_components", value: message.updateComponents };
  }
  if ("updateDataModel" in message) {
    return { type: E.CUSTOM, name: "a2ui_update_data_model", value: message.updateDataModel };
  }
  if ("deleteSurface" in message) {
    return { type: E.CUSTOM, name: "a2ui_delete_surface", value: message.deleteSurface };
  }
  throw new Error("Unknown A2UI message type");
}

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
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface AguiEvent {
  type: string;
  [key: string]: unknown;
}

// AG-UI Interrupt types
interface Interrupt {
  id: string;
  reason: string;
  message?: string;
  toolCallId?: string;
  responseSchema?: Record<string, unknown>;
}

interface ResumeData {
  interruptId: string;
  status: "resolved" | "cancelled";
  payload?: { city?: string };
}

// Client-side tool names — server emits TOOL_CALL events but does not execute them
const CLIENT_TOOLS = new Set(["get_user_location"]);

const SYSTEM_MESSAGE: OpenAI.Chat.Completions.ChatCompletionSystemMessageParam = {
  role: "system",
  content:
    "你是一个专业的天气预报助手。你能用 get_weather 工具查询指定城市的实时天气，用 get_user_location 工具获取用户当前所在城市。请用中文回复，语气友好亲切。\n\n调用规则：\n1. 当用户询问天气且提到了城市名（无论是否是真实城市），必须直接调用 get_weather 工具查询。不要自行判断城市是否有效，让工具来处理。\n2. 如果用户没有指定城市，先调用 get_user_location 获取城市，再调用 get_weather 查询天气。\n3. 注意：get_user_location 由客户端执行，调用后会中断当前对话，客户端会在执行完成后重新发起请求。\n\n重要格式规则：在回复天气信息的末尾，如果需要给出出行建议（如穿衣、带伞、防晒、补水等），请将建议内容用 <tips> 和 </tips> 标签包裹，每个建议用换行分隔。不要在 tips 外重复建议内容。示例：<tips>\n出门记得带伞\n注意防晒补水\n</tips>",
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
          tool_calls: m.toolCalls
            .filter((tc) => tc?.function?.name)
            .map((tc) => ({
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
  return tools
    .filter((t) => t?.name)
    .map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
}

/** Execute a tool call locally */
async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  if (name === "get_weather") {
    const result = await getWeather({ city: args.city as string });
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
  options?: { threadId?: string; resume?: ResumeData }
): AsyncGenerator<AguiEvent> {
  const runId = crypto.randomUUID();
  const threadId = options?.threadId || crypto.randomUUID();

  yield { type: E.RUN_STARTED, runId, threadId };

  let errored = false;
  let interrupted = false;
  try {
    const result = await runConversation({ runId, threadId, messages, tools, resume: options?.resume });
    for await (const event of result) {
      // Check if this is an interrupt RunFinished
      if (event.type === E.RUN_FINISHED && 'outcome' in event && (event as { outcome?: { type?: string } }).outcome?.type === "interrupt") {
        interrupted = true;
      }
      yield event;
    }
  } catch (err) {
    errored = true;
    yield {
      type: E.RUN_ERROR,
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }

  // Only emit RUN_FINISHED if not already interrupted or errored
  if (!errored && !interrupted) {
    yield { type: E.RUN_FINISHED, runId, threadId };
  }
}

/** Core conversation logic with tool calling loop (max 3 rounds) */
async function* runConversation(params: {
  runId: string;
  threadId: string;
  messages: AguiMessage[];
  tools: AguiToolDef[];
  resume?: ResumeData;
}): AsyncGenerator<AguiEvent> {
  const { runId, threadId, tools, resume } = params;
  let currentMessages = [...params.messages];
  const openaiTools = toOpenAITools(tools);
  let currentWeatherSurfaceId: string | null = null;

  // Handle resume: if resuming from a city input interrupt, execute get_weather with the new city
  if (resume?.status === "resolved" && resume.payload?.city) {
    const city = resume.payload.city;
    const toolCallId = `resume-${crypto.randomUUID().slice(0, 8)}`;

    // Emit tool call events for the resume weather query
    yield { type: E.TOOL_CALL_START, toolCallId, toolCallName: "get_weather" };
    yield { type: E.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify({ city }) };
    yield { type: E.TOOL_CALL_END, toolCallId };

    const result = await executeTool("get_weather", { city });

    yield {
      type: E.TOOL_CALL_RESULT,
      messageId: crypto.randomUUID(),
      toolCallId,
      content: result,
      role: "tool",
    };

    // Try to emit A2UI events for successful weather result
    try {
      const parsed = JSON.parse(result);
      if (parsed && parsed.city && parsed.current) {
        const surfaceId = `weather-${runId}`;
        currentWeatherSurfaceId = surfaceId;
        yield a2uiEvent({ version: "v0.9", createSurface: { surfaceId, catalogId: WEATHER_CATALOG_ID } });
        yield a2uiEvent({
          version: "v0.9",
          updateComponents: {
            surfaceId,
            components: [
              { id: "root", component: "Column", children: ["weather_card", "tips_card"] },
              { id: "weather_card", component: "WeatherCard" },
              { id: "tips_card", component: "TipsCard" },
            ],
          },
        });
        yield a2uiEvent({
          version: "v0.9",
          updateDataModel: { surfaceId, path: "/weather", value: parsed },
        });
      }
    } catch {
      // Not valid weather data — skip A2UI
    }

    // Add tool result to messages so LLM can generate a response
    currentMessages = [
      ...currentMessages,
      {
        id: crypto.randomUUID(),
        role: "assistant" as const,
        content: undefined,
        toolCalls: [{ id: toolCallId, type: "function" as const, function: { name: "get_weather", arguments: JSON.stringify({ city }) } }],
      },
      { id: crypto.randomUUID(), role: "tool" as const, toolCallId, content: result },
    ];
  }

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
      // No tool calls — check for tips in the text and emit A2UI data model update
      if (fullContent) {
        const tips = extractTips(fullContent);
        if (tips) {
          // Attach tips to the existing weather surface, or create a standalone tips surface
          const surfaceId = currentWeatherSurfaceId || `tips-${msgId}`;
          if (!currentWeatherSurfaceId) {
            yield a2uiEvent({ version: "v0.9", createSurface: { surfaceId, catalogId: WEATHER_CATALOG_ID } });
            yield a2uiEvent({
              version: "v0.9",
              updateComponents: {
                surfaceId,
                components: [{ id: "root", component: "TipsCard" }],
              },
            });
          }
          yield a2uiEvent({
            version: "v0.9",
            updateDataModel: { surfaceId, path: "/tips", value: tips },
          });
        }
      }
      break;
    }

    // Emit tool call events + execute
    const toolResultMessages: AguiMessage[] = [];
    let hasClientTool = false;

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

      // Parse tool arguments
      let parsedArgs: Record<string, unknown>;
      try {
        parsedArgs = JSON.parse(tc.arguments);
      } catch {
        parsedArgs = {};
      }

      // Client-side tools: emit a tagged result and skip execution
      if (CLIENT_TOOLS.has(tc.name)) {
        yield {
          type: E.TOOL_CALL_RESULT,
          messageId: crypto.randomUUID(),
          toolCallId: tc.id,
          content: "",
          role: "tool",
          metadata: { clientTool: true },
        };
        hasClientTool = true;
        continue;
      }

      const result = await executeTool(tc.name, parsedArgs);

      yield {
        type: E.TOOL_CALL_RESULT,
        messageId: crypto.randomUUID(),
        toolCallId: tc.id,
        content: result,
        role: "tool",
      };

      // Emit A2UI events for weather tool results
      if (tc.name === "get_weather") {
        try {
          const parsed = JSON.parse(result);
          if (parsed && parsed.city && parsed.current) {
            const surfaceId = `weather-${msgId}`;
            currentWeatherSurfaceId = surfaceId;
            yield a2uiEvent({ version: "v0.9", createSurface: { surfaceId, catalogId: WEATHER_CATALOG_ID } });
            yield a2uiEvent({
              version: "v0.9",
              updateComponents: {
                surfaceId,
                components: [
                  { id: "root", component: "Column", children: ["weather_card", "tips_card"] },
                  { id: "weather_card", component: "WeatherCard" },
                  { id: "tips_card", component: "TipsCard" },
                ],
              },
            });
            yield a2uiEvent({
              version: "v0.9",
              updateDataModel: { surfaceId, path: "/weather", value: parsed },
            });
          } else {
            // Weather query failed or returned invalid data — emit interrupt for city input
            const cityName = parsedArgs.city as string || "未知";
            const interruptId = crypto.randomUUID();
            const interruptData: Interrupt = {
              id: interruptId,
              reason: "input_required",
              message: parsed?.error
                ? `无法找到城市"${cityName}"，请输入正确的城市名称`
                : `查询"${cityName}"的天气失败，请输入正确的城市名称`,
              toolCallId: tc.id,
              responseSchema: {
                type: "object",
                properties: {
                  city: { type: "string", description: "正确的城市名称，例如：北京、上海、深圳" },
                },
                required: ["city"],
              },
            };
            // Emit custom event for client-side interrupt detection (includes threadId/runId for resume)
            yield {
              type: E.CUSTOM,
              name: "interrupt",
              value: { ...interruptData, threadId, runId },
            };
            // Emit RunFinished with interrupt outcome (AG-UI protocol)
            yield {
              type: E.RUN_FINISHED,
              runId,
              threadId,
              outcome: {
                type: "interrupt",
                interrupts: [interruptData],
              },
            };
            return; // End the run — client will resume with correct city
          }
        } catch {
          // Not valid weather data — skip A2UI
        }
      }

      // Add to messages for next LLM call
      toolResultMessages.push({
        id: crypto.randomUUID(),
        role: "tool",
        toolCallId: tc.id,
        content: result,
      });
    }

    // Client tool detected — end the run so the client can execute it and continue
    if (hasClientTool) break;

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

/** Server-side tips extraction from <tips> tags */
function extractTips(text: string): string[] | null {
  const openIdx = text.indexOf("<tips>");
  if (openIdx === -1) return null;

  const afterOpen = text.slice(openIdx + 6);
  const closeIdx = afterOpen.search(/<\/tips/);
  const tipsText = closeIdx !== -1 ? afterOpen.slice(0, closeIdx) : afterOpen;

  const tips = tipsText
    .split("\n")
    .map((s) => s.replace(/^[-•*\s]+/, "").trim())
    .filter(Boolean);

  return tips.length > 0 ? tips : null;
}
