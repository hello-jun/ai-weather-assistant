# ai-weather-assistant

基于 **Next.js 15 + DeepSeek V4 + AG-UI Protocol** 的智能天气预报助手。支持自然语言查询天气、自动定位用户城市、流式实时回复，并以可视化卡片展示天气数据和出行建议。

## 功能特性

- **自然语言交互** — 输入「今天天气怎么样？」即可查询，无需指定城市时自动获取定位
- **流式实时回复** — 基于 AG-UI Protocol + SSE，逐字流式输出，体验流畅
- **可视化天气卡片** — 温度、湿度、风速、天气状况以渐变卡片呈现，配色随天气变化
- **出行建议卡片** — AI 生成的穿衣/带伞/防晒等建议以独立卡片展示
- **双 API 容灾** — Open-Meteo 不可用时自动切换 wttr.in 备用 API

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 15 (App Router) + React 19 |
| LLM | DeepSeek V4 API（OpenAI 兼容） |
| 流式协议 | AG-UI Protocol over SSE |
| 天气数据 | Open-Meteo（主）+ wttr.in（备） |
| 定位 | Browser Geolocation + Nominatim 逆地理编码 |
| 样式 | Tailwind CSS v4 |
| 语言 | TypeScript |

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
echo 'DEEPSEEK_API_KEY=sk-your-key' > .env.local
# API Key 获取：https://platform.deepseek.com

# 3. 启动开发服务器
npm run dev
# 打开 http://localhost:3000
```

## 项目结构

```
app/
  api/agent/route.ts    # AG-UI HTTP Endpoint — 接收消息，流式返回 AG-UI 事件
  page.tsx              # 主页
  layout.tsx            # 根布局
components/
  chat.tsx              # 聊天 UI — AG-UI 事件订阅、流式渲染、tips 解析
  weather-card.tsx      # 天气数据卡片（渐变背景，配色随天气变化）
  tips-card.tsx         # 出行建议卡片（琥珀色主题）
lib/
  agent.ts              # Agent 核心逻辑 — DeepSeek 流式调用 + 工具循环（最多 3 轮）
  deepseek.ts           # DeepSeek API 客户端（基于 OpenAI SDK）
  tools.ts              # 天气工具定义 + 双 API 执行（Open-Meteo → wttr.in fallback）
```

## 架构概览

```
用户浏览器                                Next.js Server
┌──────────────────────────┐              ┌──────────────────┐
│  Chat UI                 │  SSE 请求    │  Agent (AsyncGen) │
│  ├─ HttpAgent            │ ──────────►  │  DeepSeek V4 API  │
│  ├─ WeatherCard          │ ◄─────────── │  Weather Tool     │
│  └─ TipsCard             │  AG-UI 事件  └──────────────────┘
│                          │                      │
│  客户端工具执行：          │                      ▼
│  get_user_location       │            Open-Meteo / wttr.in
│  ├─ Browser Geolocation  │
│  └─ Nominatim 逆地理编码  │
└──────────────────────────┘
```

**请求流程（未指定城市时）**：用户输入 → `HttpAgent` POST 到 `/api/agent` → LLM 调用 `get_user_location`（客户端工具）→ 服务端中断流，前端执行浏览器定位 + Nominatim 逆地理编码获取城市名 → 前端携带定位结果再次请求 `/api/agent` → LLM 调用 `get_weather` → 服务端查询天气 API → 结果回传 LLM → 生成自然语言回复（含天气卡片 + 出行建议卡片）→ AG-UI 事件流式返回前端 → 逐字渲染。

**请求流程（已指定城市时）**：跳过定位环节，LLM 直接调用 `get_weather` 查询天气。

详细设计文档见 [REQUIREMENTS.md](./REQUIREMENTS.md)。

## 需求设计

[REQUIREMENTS](./REQUIREMENTS.md)

## TODO

- [ ] A2UI 接入，动态切换卡片
