# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server (http://localhost:3000)
npm run build     # Production build
npm start         # Start production server
npx tsc --noEmit # Type-check without emitting files
```

## Architecture

This is a **Next.js 15 App Router** weather AI assistant that streams responses via the **AG-UI Protocol** over SSE, backed by DeepSeek V4 API with function calling.

### Request flow

1. `components/chat.tsx` — Client component using `HttpAgent` from `@ag-ui/client`. Subscribes to AG-UI events (`onTextMessageContentEvent`, `onToolCallStartEvent`, etc.) and renders streaming text updates. Sends user messages via `agent.addMessage()` + `agent.runAgent()`, which POSTs to `/api/agent`.

2. `app/api/agent/route.ts` — Edge-adjacent Node.js API route. Receives `{ messages, tools }`, merges the built-in `weatherToolDefinition` with any client-provided tools, and streams AG-UI events as SSE (`text/event-stream`). Each event is emitted as `data: <JSON>\n\n`. Never sends `data: [DONE]` — the AG-UI client uses `RUN_FINISHED` + connection close to detect completion.

3. `lib/agent.ts` — Core agent logic as an `AsyncGenerator<AguiEvent>`. Calls DeepSeek V4 with `stream: true`, maps SSE deltas to AG-UI events (`TEXT_MESSAGE_CONTENT` for text, `TOOL_CALL_START/ARGS/END` for tool calls). Runs a tool calling loop (max 3 rounds): executes tools locally, appends results to messages, and re-invokes the LLM. On error, emits `RUN_ERROR` and stops (no `RUN_FINISHED` after error).

4. `lib/deepseek.ts` — Minimal DeepSeek API client using the OpenAI SDK v4 with `baseURL: "https://api.deepseek.com"`. Do NOT append `/v1` to the base URL; the SDK handles path construction.

5. `lib/tools.ts` — Weather tool definition (OpenAI function schema) + execution via free Open-Meteo APIs: geocoding (`geocoding-api.open-meteo.com/v1/search`) then forecast (`api.open-meteo.com/v1/forecast`). Includes WMO weather code → Chinese description mapping.

### Key implementation details

- **Thinking mode is disabled** (`thinking: { type: "disabled" }`) to avoid `reasoning_content` round-trip requirements in multi-turn conversations.
- **Tool messages**: When sending tool results back to the LLM, `tool_call_id` must use the LLM's tool call ID (from `tool_calls[].id`), not the message's own UUID.
- **Weather tool is always auto-merged** into the tools array on the server side — the client doesn't need to pass it explicitly, passing `tools: []` still gets weather support.
- **Environment**: Requires `DEEPSEEK_API_KEY` in `.env.local` (acquired from https://platform.deepseek.com).
