# AG-UI State Management 分析报告

## 一、AG-UI State Management 文档摘要

### 核心概念

State management 让 **agent（后端）和 frontend（前端）共享一个实时同步的结构化状态对象**，实现双向协作：

- **Agent → Frontend**：agent 通过 `STATE_SNAPSHOT` / `STATE_DELTA` 事件推送状态变更
- **Frontend → Agent**：前端可以通过 `setState()` 修改状态，下次请求时传回给 agent

共享状态是一个结构化数据对象，具备以下特性：

- 跨交互持久化（同一对话内）
- 双方均可访问和修改
- 实时同步更新
- 为双方的决策提供上下文

### 两个关键事件

| 事件 | EventType 值 | 用途 |
|---|---|---|
| `STATE_SNAPSHOT` | `6` | 完整状态快照，替换前端当前所有状态 |
| `STATE_DELTA` | `7` | 增量更新，使用 JSON Patch (RFC 6902) 格式 |

**使用时机**：

- `STATE_SNAPSHOT`：对话开始、连接中断恢复、重大状态变化时发送完整快照
- `STATE_DELTA`：高频小更新、大状态对象中只有部分变化时

### JSON Patch 格式 (RFC 6902)

```typescript
// 示例操作
{ "op": "replace", "path": "/weather/temperature", "value": 28 }
{ "op": "add", "path": "/preferences", "value": { "theme": "dark" } }
{ "op": "remove", "path": "/temporary_data" }
{ "op": "move", "path": "/completed_items", "from": "/pending_items/0" }
```

支持的操作：`add`、`remove`、`replace`、`move`、`copy`、`test`

### 客户端 SDK 支持情况

当前项目使用的 `@ag-ui/client` (HttpAgent) **已内置完整的 state 支持**：

```typescript
// 创建 agent 时传入 initialState
const agent = new HttpAgent({
  url: "/api/agent",
  initialState: { weather: null, preferences: {} }
})

// 通过 subscriber 监听 state 事件
agent.subscribe({
  onStateSnapshotEvent: ({ event }) => { /* 完整快照 */ },
  onStateDeltaEvent: ({ event }) => { /* 增量更新 */ },
  onStateChanged: ({ state }) => { /* 任何 state 变化后触发 */ },
})

// 前端主动修改状态
agent.setState(state)

// 读取当前状态（只读）
agent.state
```

内部自动使用 `fast-json-patch` 应用 `STATE_DELTA`，失败时 warn 并丢弃该 patch。

---

## 二、A2UI 与 AG-UI State 并存方案

### 定位对比

| | A2UI | AG-UI State |
|---|---|---|
| **职责** | 声明式 UI（定义"渲染什么"） | 共享数据层（定义"数据是什么"） |
| **数据粒度** | DataModel 绑定到具体组件路径 `/weather`, `/tips` | 全局共享状态，agent 和前端都能读写 |
| **方向** | Agent → Frontend 单向（推 UI） | Agent ↔ Frontend 双向 |
| **适合场景** | 天气卡片、Tips 卡片这类结构化 UI | 对话级上下文、用户偏好、多轮状态 |

### 并存架构

```
Agent
  ├── A2UI CREATE_SURFACE → UPDATE_DATA_MODEL(/weather) → 渲染 WeatherCard（不变）
  └── STATE_SNAPSHOT { weather, city, queryCount, ... } → 前端全局状态（新增）
```

- **A2UI 继续负责 UI 结构**：WeatherCard、TipsCard 的组件树、data binding、渲染都不变
- **AG-UI State 负责跨轮次的共享数据**：当前城市、查询历史、用户偏好、agent 工作流阶段等

两者互不干扰，各自负责不同层面。

---

## 三、可改造的业务场景

### 1. 多轮对话上下文感知

**现状**：agent 每轮独立调用，不知道上一轮查了什么城市。用户说"那上海呢"，agent 需要靠 LLM 推断是指天气。

**改造后**：State 里维护 `currentCity` 和 `lastQueryResult`，agent 工具调用时可直接读取上下文：

```json
{
  "currentCity": "北京",
  "lastQueryResult": { "temp": 28, "condition": "晴" },
  "queryCount": 3
}
```

用户说"那明天呢"，agent 知道是问北京明天的天气，无需反问。

**效果**：多轮对话更自然，减少不必要的确认交互。

### 2. 前端可写 → 用户偏好实时生效

**现状**：温度单位写死摄氏度，用户无法切换。

**改造后**：前端用 `agent.setState({ unit: "fahrenheit" })` 修改 state，agent 下次查天气时自动读取偏好，返回华氏度结果。**不需要重新发消息，不需要 LLM 参与**。

```
用户点击 °F 按钮
  → agent.setState({ unit: "fahrenheit" })
  → agent 下次工具调用时读 state.unit
  → 结果自动用华氏度
```

**效果**：即时生效的用户偏好，无额外 API 调用开销。

### 3. 人机协作流程（Human-in-the-Loop）

**现状**：interrupt 机制只处理"城市输入"场景，用的是 AG-UI interrupt 协议。

**改造后**：用 State 实现更丰富的协作场景。例如 agent 规划行程建议，通过 state 推给前端：

```json
[{ "op": "add", "path": "/plan", "value": {
    "title": "周末北京出行建议",
    "days": [
      { "day": "周六", "activity": "故宫", "weather": "晴 28°C" },
      { "day": "周日", "activity": "颐和园", "weather": "多云 25°C" }
    ]
}}]
```

前端渲染可编辑的行程卡片，用户修改后 `setState` 回传，agent 读取用户调整后继续。

**效果**：中断协议处理异常，State 处理正常协作，各司其职。

### 4. 查询历史 & 智能推荐

**现状**：刷新页面后历史全丢（SQLite 存了消息，但 agent 没有结构化的查询记录）。

**改造后**：State 维护结构化查询历史：

```json
{
  "history": [
    { "city": "北京", "time": "2026-06-17T10:00:00Z" },
    { "city": "上海", "time": "2026-06-17T10:05:00Z" }
  ],
  "frequentCities": ["北京", "上海"]
}
```

前端可根据 `frequentCities` 渲染快捷按钮，agent 可主动建议"要不要再看看北京的天气？上次查是 2 小时前了"。

**效果**：更智能的推荐体验，减少重复输入。

### 5. 页面刷新后状态恢复

**现状**：刷新页面，A2UI Surface 和所有临时状态都丢失。

**改造后**：页面加载时 agent 先发一个 `STATE_SNAPSHOT`，前端拿到完整状态立即恢复 UI（当前城市、最近天气数据、偏好设置），无需重新查一次 API。

**效果**：无缝的页面刷新体验，减少等待和重复请求。

---

## 四、机制选型总结

| 场景 | 推荐机制 | 说明 |
|---|---|---|
| 天气卡片渲染、Tips 渲染 | A2UI | 不变，声明式 UI 继续用 A2UI |
| 城市输入中断 | AG-UI Interrupt | 不变，异常流程继续用 interrupt |
| 多轮上下文、查询记录 | AG-UI State | 新增，结构化共享状态 |
| 用户偏好（温度单位等） | AG-UI State | 新增，前端可写 |
| 人机协作编辑 | AG-UI State | 新增，双向数据流 |
| 刷新恢复 | AG-UI State | 新增，快照恢复 |

---

## 五、建议实施路径

建议从**多轮对话上下文感知**入手，改动最小、效果最直观：

1. **服务端**：`lib/agent.ts` 中天气查询成功后，emit `STATE_SNAPSHOT` 事件，将当前城市和查询结果作为共享状态
2. **客户端**：`components/chat.tsx` 中 subscriber 添加 `onStateSnapshotEvent` / `onStateChanged` 处理器
3. **验证**：多轮对话时 agent 能自动感知上文城市，无需重复输入
