import { NextRequest } from "next/server";
import { runAgent } from "@/lib/agent";
import { weatherToolDefinition } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();

  const messages = body.messages || [];
  const clientTools = body.tools || [];

  // Merge built-in tools with any client tools
  const tools = [weatherToolDefinition, ...clientTools];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runAgent(messages, tools)) {
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
