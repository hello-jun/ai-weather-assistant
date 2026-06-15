import { NextRequest } from "next/server";
import { runAgent } from "@/lib/agent";
import { weatherToolDefinition } from "@/lib/tools";
import { getMessages, saveMessages } from "@/lib/message-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();

  const newMessages = body.messages || [];
  const clientTools = body.tools || [];
  const threadId = body.threadId || crypto.randomUUID();
  const resume = body.resume || undefined;

  // 从存储读取历史
  const history = getMessages(threadId);

  // 持久化前端传来的新增消息（如 user 消息、tool 结果）
  if (newMessages.length > 0) {
    saveMessages(threadId, newMessages);
  }

  // 合并：历史 + 新增
  const allMessages = [...history, ...newMessages];

  // Merge built-in tools with any client tools
  const tools = [weatherToolDefinition, ...clientTools];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runAgent(allMessages, tools, { threadId, resume })) {
          const line = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      } catch (err) {
        const errorEvent = {
          type: "RUN_ERROR",
          message: err instanceof Error ? err.message : "Unknown error",
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
