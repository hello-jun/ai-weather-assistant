# 天气预报 AI 助手 — 需求文档

## 1. 项目概述

基于 **Next.js + AG-UI Protocol + DeepSeek V4 API** 构建的天气预报 AI 助手 Web 应用。用户输入自然语言（如「今天北京天气怎么样？」），AI 助手**流式逐字输出**回复，并可通过 Function Calling 查询实时天气数据。

**核心体验**：打开浏览器 → 看到聊天界面 → 输入问题 → AI 逐字流式回复天气情况。

---

## 2. 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端框架** | Next.js 15 (App Router) | React 全栈框架 |
| **语言** | TypeScript | 全栈类型安全 |
| **AG-UI SDK** | `@ag-ui/core` v0.0.53 + `@ag-ui/client` v0.0.53 | AG-UI 协议的 TypeScript 官方 SDK |
| **A2UI 协议** | v0.9 | AG-UI 的扩展协议，支持 Surface/Component/DataModel 声明式 UI |
| **流式传输** | SSE (Server-Sent Events) | AG-UI/A2UI 事件通过 `data:` 行推送到前端 |
| **大模型 API** | DeepSeek V4 API (`deepseek-v4-pro`) | OpenAI 兼容接口，支持 Streaming + Function Calling |
| **天气数据** | Open-Meteo API（主）+ wttr.in（备） | 双 API 容灾，主 API 失败自动切换备用 |
| **样式** | Tailwind CSS v4 | 快速构建现代 UI |

---

## 3. DeepSeek V4 API 参考

> 官方文档：https://api-docs.deepseek.com/zh-cn/api/create-chat-completion

### 3.1 基本信息

| 项目 | 值 |
|------|-----|
| **Base URL** | `https://api.deepseek.com` |
| **Chat Completions 端点** | `POST /chat/completions` |
| **模型 ID** | `deepseek-v4-pro` |
| **上下文窗口** | 1M tokens |
| **Tool Calling** | 支持（OpenAI 兼容格式） |
| **Streaming** | 支持 SSE (`stream: true`) |
| **Thinking 模式** | 本项目禁用（`thinking: { type: "disabled" }`），避免多轮对话中 `reasoning_content` 回传要求 |

### 3.2 TypeScript 调用示例

```typescript
const stream = await deepseek.chat.completions.create({
  model: "deepseek-v4-pro",
  messages: apiMessages,
  tools: openaiTools,
  temperature: 1.0,
  top_p: 1.0,
  stream: true,
  thinking: { type: "disabled" },
});

for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta;
  if (delta?.content) { /* 文本 delta */ }
  if (delta?.tool_calls) { /* 工具调用 delta */ }
}
```

---

## 4. 架构设计

### 4.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    用户浏览器                              │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Chat UI (React 组件)                  │   │
│  │  - 消息列表（用户消息 + AI 助手消息）                │   │
│  │  - AI 消息逐字流式渲染                              │   │
│  └──────────────────┬───────────────────────────────┘   │
│                     │ AG-UI Events (via HttpAgent)       │
│  ┌──────────────────▼───────────────────────────────┐   │
│  │  @ag-ui/client (HttpAgent)                        │   │
│  │  - 订阅事件: TEXT_MESSAGE_CONTENT                  │   │
│  │  - 管理消息状态                                     │   │
│  └──────────────────┬───────────────────────────────┘   │
└─────────────────────┼────────────────────────────────────┘
                      │ HTTP POST (SSE 响应)
┌─────────────────────▼────────────────────────────────────┐
│               Next.js Server (API Route)                  │
│  ┌──────────────────────────────────────────────────┐   │
│  │  /api/agent (AG-UI HTTP Endpoint)                 │   │
│  │  - 接收 RunAgentInput (messages, tools)           │   │
│  │  - 调用 DeepSeek V4 API (stream: true)            │   │
│  │  - DeepSeek SSE delta → AG-UI Events              │   │
│  │  - 以 SSE 流式响应返回 AG-UI Events                │   │
│  └──────────────────┬───────────────────────────────┘   │
│                     │                                    │
│  ┌──────────────────▼───────────────────────────────┐   │
│  │  Weather Tool (get_weather)                       │   │
│  │  - Open-Meteo Geocoding API → 城市→经纬度          │   │
│  │  - Open-Meteo Forecast API → 天气数据              │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
                      │
                      ▼
         ┌────────────────────────────┐
         │   DeepSeek V4 API           │
         │   POST /chat/completions    │
         │   model: deepseek-v4-pro    │
         └────────────────────────────┘
```

### 4.2 AG-UI/A2UI 事件流（一次带 Function Calling 的对话）

```
时间 ──────────────────────────────────────────────────────►

服务端 → 前端 (SSE 事件流):
  RUN_STARTED                    ← 运行开始
  TEXT_MESSAGE_START             ← AI 开始回复（工具调用前的说明文本）
  TEXT_MESSAGE_CONTENT × N       ← 流式文本 "好的，我来帮你查一下..."
  TEXT_MESSAGE_END
  TOOL_CALL_START                ← 检测到工具调用
  TOOL_CALL_ARGS                 ← 工具参数 {"city":"北京"}
  TOOL_CALL_END
  TOOL_CALL_RESULT               ← 工具执行结果（天气数据）
  CUSTOM a2ui_create_surface     ← A2UI: 创建 Surface
  CUSTOM a2ui_update_components  ← A2UI: 定义组件树 (WeatherCard + TipsCard)
  CUSTOM a2ui_update_data_model  ← A2UI: 更新天气数据到 /weather
  TEXT_MESSAGE_START             ← AI 基于结果生成自然语言
  TEXT_MESSAGE_CONTENT × N       ← 流式输出 "北京今天天气晴朗..."
  TEXT_MESSAGE_END
  CUSTOM a2ui_update_data_model  ← A2UI: 更新出行建议到 /tips（如有）
  RUN_FINISHED                   ← 运行结束
```

### 4.3 AG-UI 中断流程（城市无效时）

当用户输入无效城市时，系统通过 AG-UI Interrupt 协议暂停运行，等待用户输入正确城市：

```
时间 ──────────────────────────────────────────────────────►

Run 1（中断）:
  RUN_STARTED
  TOOL_CALL_START                ← LLM 调用 get_weather("嘎嘎嘎")
  TOOL_CALL_ARGS
  TOOL_CALL_END
  TOOL_CALL_RESULT               ← 工具返回 { error: "..." }
  CUSTOM interrupt               ← 中断事件（含 threadId, runId）
  RUN_FINISHED { outcome: { type: "interrupt", interrupts: [...] } }
                                 ← 运行暂停，等待用户输入

用户在 CityInputCard 中输入 "北京" 并点击确认

Run 2（恢复）:
  POST /api/agent { resume: [{ interruptId, status: "resolved", payload: { city: "北京" } }] }
  RUN_STARTED
  TOOL_CALL_START                ← 用修正后的城市重新查询
  TOOL_CALL_ARGS
  TOOL_CALL_END
  TOOL_CALL_RESULT               ← 天气数据
  CUSTOM a2ui_create_surface
  CUSTOM a2ui_update_components
  CUSTOM a2ui_update_data_model
  TEXT_MESSAGE_START             ← AI 生成回复
  TEXT_MESSAGE_CONTENT × N
  TEXT_MESSAGE_END
  RUN_FINISHED { outcome: { type: "success" } }
```

---

## 5. 目录结构

```
ai-weather-assistant/
├── app/
│   ├── layout.tsx              # 根布局（Tailwind 全局样式）
│   ├── page.tsx                # 主页（聊天界面容器）
│   ├── globals.css             # Tailwind CSS 指令
│   └── api/
│       └── agent/
│           └── route.ts        # AG-UI HTTP Endpoint（核心后端）
├── lib/
│   ├── deepseek.ts             # DeepSeek V4 客户端封装
│   ├── tools.ts                # 天气工具定义 + 双 API 执行（Open-Meteo → wttr.in fallback）
│   ├── agent.ts                # AG-UI/A2UI Agent 核心逻辑（AsyncGenerator）
│   ├── a2ui-types.ts           # A2UI v0.9 协议类型定义
│   ├── a2ui-catalog.ts         # A2UI Catalog 注册（WeatherCard/TipsCard 渲染器）
│   └── a2ui-renderer.tsx       # A2UI Surface 渲染器
├── components/
│   ├── chat.tsx                # 聊天 UI 组件（含流式渲染、A2UI 集成、中断处理）
│   ├── weather-card.tsx        # 天气数据卡片（渐变背景，配色随天气变化）
│   ├── tips-card.tsx           # 出行建议卡片（琥珀色主题）
│   ├── city-input-card.tsx     # 城市输入卡片（AG-UI 中断时显示，输入框+确认按钮）
│   └── a2ui-components.tsx     # A2UI 组件实现（A2UIWeatherCard、A2UITipsCard、A2UICityInputCard）
├── .env.local                  # 环境变量（DeepSeek API Key）
├── package.json
├── tsconfig.json
├── next.config.ts
└── postcss.config.mjs
```

---

## 6. 详细模块设计

### 6.1 DeepSeek 客户端 (`lib/deepseek.ts`)

基于 OpenAI SDK v4，配置 DeepSeek base URL：

```typescript
import OpenAI from "openai";

export const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseURL: "https://api.deepseek.com",
});
```

注意：不要在 baseURL 后追加 `/v1`，SDK 会自动拼接端点路径。

### 6.2 天气工具 (`lib/tools.ts`)

**工具定义**（简化格式，route.ts 会自动转换为 OpenAI Function Schema）：
```typescript
export const weatherToolDefinition = {
  name: "get_weather",
  description: "获取指定城市今天的实时天气情况，包含当前温度、体感温度、湿度、风速、天气描述，以及今日最高/最低气温预报",
  parameters: {
    type: "object" as const,
    properties: {
      city: { type: "string", description: "城市中文名称，例如：北京、上海、深圳、杭州、成都" },
    },
    required: ["city"],
  },
};
```

**工具实现流程**（双 API 容灾）：

1. **主 API - Open-Meteo**：
   - 地理编码 → `GET https://geocoding-api.open-meteo.com/v1/search?name={city}&count=1&language=zh`
   - 获取天气 → `GET https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=...&daily=...&forecast_days=1&timezone=auto`
   - 自动重试 5xx 错误（最多 2 次）

2. **备用 API - wttr.in**（Open-Meteo 失败时自动切换）：
   - `GET https://wttr.in/{city}?format=j1`
   - 免费，无需 API Key，支持中文城市名

3. **WMO 天气代码映射** → 将数字 weather_code 转为中文描述（如 0→"晴朗"、61→"小到中雨"）

### 6.3 Agent 核心逻辑 (`lib/agent.ts`)

核心是一个 **AsyncGenerator 函数**，逐一产出 AG-UI Event：

```typescript
async function* runAgent(messages, tools, options?): AsyncGenerator<AguiEvent> {
  yield { type: "RUN_STARTED", runId, threadId };
  let interrupted = false;
  try {
    for await (const event of runConversation({ ..., resume: options?.resume })) {
      if (event.type === "RUN_FINISHED" && event.outcome?.type === "interrupt") {
        interrupted = true;
      }
      yield event;
    }
  } catch (err) {
    yield { type: "RUN_ERROR", message: err.message };
    return;
  }
  if (!interrupted) {
    yield { type: "RUN_FINISHED", runId, threadId };
  }
}
```

**Conversation 循环**（最多 3 轮 tool calling）：
1. 调用 DeepSeek API（流式）
2. `delta.content` → `TEXT_MESSAGE_CONTENT`
3. `delta.tool_calls` → 累积 `TOOL_CALL_ARGS`
4. `finish_reason === "tool_calls"` → 执行工具 → `TOOL_CALL_RESULT`
5. 将结果追加到消息列表，二次调用 LLM 生成最终回复
6. 无工具调用 → 结束

**AG-UI 中断机制**：
- 当 `get_weather` 返回错误或无效数据时，发出 `CUSTOM interrupt` + `RUN_FINISHED { outcome: { type: "interrupt" } }`
- 客户端收到中断后渲染 `CityInputCard`，用户输入正确城市
- 客户端发送 `resume` 数据，Agent 用修正后的城市重新查询

**Resume 处理**：
- `runAgent` 接收 `options.resume` 参数
- 检测到 resume 时，直接执行 `get_weather` 并生成工具事件
- 将工具结果追加到消息列表，继续正常 LLM 对话流程

**关键注意事项**：
- 工具消息包含 `id`（消息 UUID）和 `toolCallId`（LLM 工具调用 ID），发送给 API 时 `tool_call_id` 必须用 `toolCallId` 而不能用 `id`
- `RUN_ERROR` 之后不能再发送 `RUN_FINISHED`
- 中断时已发送 `RUN_FINISHED`，`runAgent` 结束时不再重复发送
- 系统消息只添加一次，避免多轮工具调用中重复

### 6.4 API Route (`app/api/agent/route.ts`)

```typescript
export async function POST(req: NextRequest) {
  const { messages, tools, threadId, resume } = await req.json();
  const mergedTools = [weatherToolDefinition, ...tools];
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      for await (const event of runAgent(messages, mergedTools, { threadId, resume })) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", ... },
  });
}
```

注意：
- 返回 `text/event-stream`，每个事件一行 `data: <JSON>\n\n`
- **不要**发送 `data: [DONE]`——这是 OpenAI 的 SSE 终止标记，AG-UI 客户端会用 `RUN_FINISHED` 事件 + 连接关闭来判断流结束
- `threadId` 和 `resume` 用于 AG-UI 中断恢复流程

### 6.5 前端聊天组件 (`components/chat.tsx`)

使用 `HttpAgent` 连接后端 API，通过 subscriber 模式处理 AG-UI 事件，并集成 A2UI 渲染：

```typescript
const agent = new HttpAgent({ url: "/api/agent" });

agent.subscribe({
  onTextMessageContentEvent({ textMessageBuffer }) {
    // 逐字追加到当前 AI 消息 → 流式显示效果
    setMessages(prev => prev.map(m =>
      m.id === currentMsgId ? { ...m, content: textMessageBuffer } : m
    ));
  },
  onToolCallStartEvent({ event }) {
    // 显示工具调用状态指示器
  },
  onCustomEvent({ event }) {
    // 处理 A2UI 事件: a2ui_create_surface, a2ui_update_components, a2ui_update_data_model
    // 处理中断事件: interrupt（存储中断数据，渲染 CityInputCard）
    a2uiRenderer.handleEvent(event);
  },
  onRunErrorEvent({ event }) {
    // 显示错误信息
    errorHandledRef.current = true;
  },
});

// 发送消息
agent.addMessage({ id: uuid(), role: "user", content: text });
await agent.runAgent();
```

**渲染顺序**（按事件流自然顺序）：
1. 用户消息
2. A2UI Surface（WeatherCard + TipsCard）
3. 工具状态指示器
4. CityInputCard（仅在中断时显示）
5. LLM 文本内容

**A2UI 集成**：
- `a2ui-renderer.tsx` 管理 Surface 状态和组件渲染
- `a2ui-catalog.ts` 注册组件渲染器（WeatherCard、TipsCard、CityInputCard）
- A2UI TipsCard 从 DataModel 的 `/tips` 路径读取数据
- 当 A2UI Surface 存在时，LLM 文本中的 `<tips>` 标签不再重复渲染

**AG-UI 中断处理**：
- 当收到 `CUSTOM interrupt` 事件时，存储中断数据到 `pendingInterrupt` 状态
- 在消息列表中渲染 `CityInputCard` 组件
- 用户输入城市并点击确认后，通过 `fetch` 发送 resume 请求到 `/api/agent`
- 处理 resume 响应的 SSE 事件，更新天气数据和 LLM 文本

---

## 7. DeepSeek SSE → AG-UI/A2UI 事件映射表

| DeepSeek SSE chunk | AG-UI/A2UI Event |
|---|---|
| 开始流式 | `RUN_STARTED` |
| `delta.content` 首次出现 | `TEXT_MESSAGE_START` |
| `delta.content` = "今" | `TEXT_MESSAGE_CONTENT { delta: "今" }` |
| `delta.tool_calls[0].id` | `TOOL_CALL_START` |
| `delta.tool_calls[0].function.arguments` | `TOOL_CALL_ARGS` (增量) |
| `finish_reason` = "tool_calls" | `TOOL_CALL_END` |
| 工具函数执行完毕 | `TOOL_CALL_RESULT` |
| 天气工具返回成功结果 | `CUSTOM a2ui_create_surface` + `a2ui_update_components` + `a2ui_update_data_model` |
| 天气工具返回错误/无效数据 | `CUSTOM interrupt` + `RUN_FINISHED { outcome: { type: "interrupt" } }` |
| 二次调用 LLM 流式输出 | `TEXT_MESSAGE_START` → `TEXT_MESSAGE_CONTENT` × N → `TEXT_MESSAGE_END` |
| LLM 文本包含 `<tips>` | `CUSTOM a2ui_update_data_model` (path: `/tips`) |
| `finish_reason` = "stop" | `TEXT_MESSAGE_END` |
| 流结束（无错误、无中断） | `RUN_FINISHED` |
| 异常 | `RUN_ERROR`（之后不发送 RUN_FINISHED） |

---

## 8. 完整数据流

```
步骤 1: 用户输入「今天北京天气怎么样？」，回车发送
         ↓
步骤 2: chat.tsx 创建用户消息，调用 agent.addMessage() + agent.runAgent()
        HttpAgent POST /api/agent  body: { messages: [...], tools: [weatherTool] }
         ↓
步骤 3: API Route 委托 runAgent() 建立 SSE 响应
         ↓ SSE → RUN_STARTED
         ↓
步骤 4: 调用 DeepSeek V4 API (stream: true, tools: [weatherToolDef])
         ↓
步骤 5: DeepSeek 识别需要工具调用 → 流式返回 tool_calls delta
         ↓ SSE → TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END
         ↓
步骤 6: 服务端执行 get_weather("北京")
         ↓ Open-Meteo Geocoding: 北京 → lat=39.9, lon=116.4
         ↓ Open-Meteo Forecast: 获取当前温度、湿度、风速、天气代码
         ↓ SSE → TOOL_CALL_RESULT
         ↓
步骤 7: 服务端创建 A2UI Surface 并更新组件和数据
         ↓ SSE → CUSTOM a2ui_create_surface
         ↓ SSE → CUSTOM a2ui_update_components (WeatherCard + TipsCard)
         ↓ SSE → CUSTOM a2ui_update_data_model (/weather)
         ↓
步骤 8: 将工具结果追加到 messages，二次调用 DeepSeek V4
         ↓ SSE → TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT × N → TEXT_MESSAGE_END
         ↓ 逐字流式输出 "今天北京天气晴朗，当前温度22.5°C..."
         ↓
步骤 9: 服务端提取 <tips> 标签内容，更新 A2UI DataModel
         ↓ SSE → CUSTOM a2ui_update_data_model (/tips)
         ↓
步骤 10: SSE → RUN_FINISHED
         ↓
步骤 11: 前端 chat.tsx 按事件流顺序渲染：
          - 用户消息
          - A2UI Surface (WeatherCard + TipsCard)
          - 工具状态指示器
          - LLM 文本内容
```

### 8.2 城市无效时的中断流程

```
步骤 1: 用户输入「今天嘎嘎嘎的天气怎么样？」，回车发送
         ↓
步骤 2: chat.tsx 创建用户消息，调用 agent.addMessage() + agent.runAgent()
         ↓
步骤 3: LLM 调用 get_weather("嘎嘎嘎")，工具返回 { error: "..." }
         ↓
步骤 4: Agent 检测到天气错误，发出中断事件
         ↓ SSE → CUSTOM interrupt { id, reason: "input_required", message, threadId, runId }
         ↓ SSE → RUN_FINISHED { outcome: { type: "interrupt", interrupts: [...] } }
         ↓
步骤 5: 前端 chat.tsx 检测到 interrupt 事件，设置 pendingInterrupt 状态
         ↓
步骤 6: 渲染 CityInputCard 组件（输入框 + 确认按钮）
         ↓
步骤 7: 用户输入「北京」，点击确认
         ↓
步骤 8: handleCitySubmit 发送 resume 请求
         ↓ POST /api/agent { messages, tools, threadId, resume: [{ interruptId, status: "resolved", payload: { city: "北京" } }] }
         ↓
步骤 9: Agent 检测到 resume，用修正后的城市重新执行 get_weather("北京")
         ↓ SSE → TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END / TOOL_CALL_RESULT
         ↓ SSE → CUSTOM a2ui_create_surface + a2ui_update_components + a2ui_update_data_model
         ↓
步骤 10: LLM 基于天气数据生成回复
          ↓ SSE → TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT × N → TEXT_MESSAGE_END
          ↓
步骤 11: SSE → RUN_FINISHED { outcome: { type: "success" } }
          ↓
步骤 12: 前端渲染天气卡片和 LLM 回复
```

---

## 9. 环境配置

### 9.1 `.env.local`

```bash
# DeepSeek API Key（必填）
# 从 https://platform.deepseek.com 获取
DEEPSEEK_API_KEY=sk-your-api-key-here
```

### 9.2 启动命令

```bash
npm install
npm run dev
# 浏览器打开 http://localhost:3000
```

---

## 10. 依赖

| 包 | 版本 | 用途 |
|---|---|---|
| `next` | ^15.1.0 | React 全栈框架 |
| `react` / `react-dom` | ^19.0.0 | UI 框架 |
| `@ag-ui/core` | latest | AG-UI 协议类型定义 |
| `@ag-ui/client` | latest | AG-UI HTTP 客户端（HttpAgent） |
| `openai` | ^4.70.0 | DeepSeek API 调用（OpenAI 兼容） |
| `tailwindcss` | ^4.0.0 | CSS 框架 |
| `typescript` | ^5.7.0 | 类型检查 |

---

## 11. 验收标准

| # | 条件 | 验证方式 |
|---|------|---------|
| 1 | `npm run dev` 后 `localhost:3000` 显示聊天界面 | 浏览器打开 |
| 2 | 输入任意问题，AI 逐字流式回复 | 手动观察 |
| 3 | 输入「今天北京天气怎么样？」→ 回复今日真实天气 | 手动验证 |
| 4 | 输入「上海天气如何？」→ 回复对应城市天气 | 手动验证 |
| 5 | 多轮对话中继续询问其他城市天气，上下文保持正确 | 手动验证 |
| 6 | 天气查询后显示 WeatherCard 渐变卡片（配色随天气变化） | 手动验证 |
| 7 | 出行建议显示在 TipsCard 琥珀色卡片中 | 手动验证 |
| 8 | Open-Meteo 不可用时自动切换 wttr.in 备用 API | 断开 Open-Meteo 测试 |
| 9 | API 异常时显示错误提示，不崩溃 | 断网测试 |

---

## 12. 关键参考

| 资源 | URL |
|------|-----|
| AG-UI 协议文档 | https://docs.ag-ui.com/introduction |
| AG-UI TypeScript SDK | https://docs.ag-ui.com/sdk/js/core/overview |
| AG-UI GitHub | https://github.com/ag-ui-protocol/ag-ui |
| DeepSeek API 官方文档 | https://api-docs.deepseek.com/zh-cn/api/create-chat-completion |
| DeepSeek Tool Calls | https://api-docs.deepseek.com/guides/tool_calls |
| DeepSeek 平台 (获取 Key) | https://platform.deepseek.com |
| Open-Meteo API (免费天气) | https://open-meteo.com/en/docs |
