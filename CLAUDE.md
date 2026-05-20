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

---

## Karpathy Coding Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Source: [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills)

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
