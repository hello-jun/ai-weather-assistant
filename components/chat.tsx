"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { HttpAgent } from "@ag-ui/client";
import { WeatherCard } from "./weather-card";
import { TipsCard } from "./tips-card";
import { a2uiRenderer } from "@/lib/a2ui-renderer";
import { weatherCatalogRegistry } from "./a2ui-components";
import type { WeatherResult } from "@/lib/tools";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  toolStatus?: string;
  weatherData?: WeatherResult;
  tips?: string[];
  a2uiSurfaceId?: string;
}

/** Extract <tips> content from LLM text, returning [cleanText, tips[]] */
function extractTips(text: string): [string, string[] | undefined] {
  const openIdx = text.indexOf("<tips>");
  if (openIdx === -1) return [text, undefined];

  const afterOpen = text.slice(openIdx + 6);
  const closeIdx = afterOpen.search(/<\/tips/);
  const tipsText = closeIdx !== -1 ? afterOpen.slice(0, closeIdx) : afterOpen;

  const tips = tipsText
    .split("\n")
    .map((s) => s.replace(/^[-•*\s]+/, "").trim())
    .filter(Boolean);
  if (tips.length === 0) return [text, undefined];

  const cleanText = text.slice(0, openIdx).replace(/\n+$/, "").trim();
  return [cleanText, tips];
}

export function ChatApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [, setRenderTick] = useState(0);
  const agentRef = useRef<HttpAgent | null>(null);
  const pendingContentRef = useRef("");
  const pendingMsgIdRef = useRef("");
  const errorHandledRef = useRef(false);
  const clientToolContinuationRef = useRef(false);

  // Client-side tool definitions (AG-UI format: { name, description, parameters })
  const CLIENT_TOOLS = [
    {
      name: "get_user_location",
      description: "获取用户当前所在城市。当用户询问天气但未指定城市时调用。",
      parameters: { type: "object" as const, properties: {} },
    },
  ];

  // Initialize agent once
  useEffect(() => {
    const agent = new HttpAgent({
      url: "/api/agent",
      debug: false,
    });

    agent.subscribe({
      onTextMessageContentEvent({ textMessageBuffer }) {
        pendingContentRef.current = textMessageBuffer;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingMsgIdRef.current
              ? { ...m, content: textMessageBuffer }
              : m
          )
        );
      },

      onToolCallStartEvent({ event }) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingMsgIdRef.current
              ? { ...m, toolStatus: `正在查询 ${event.toolCallName}...` }
              : m
          )
        );
      },

      onToolCallEndEvent({ event, toolCallName, toolCallArgs }) {
        if (toolCallName === "get_user_location") {
          executeClientTool(event.toolCallId, toolCallArgs);
          return;
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingMsgIdRef.current
              ? { ...m, toolStatus: "已获取天气数据" }
              : m
          )
        );
      },

      onToolCallResultEvent({ event }) {
        try {
          const result = JSON.parse((event as { content: string }).content);
          if (result && result.city && result.current) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === pendingMsgIdRef.current
                  ? { ...m, weatherData: result as WeatherResult }
                  : m
              )
            );
          }
        } catch {
          // Not valid JSON or not weather data — ignore
        }
      },

      onRunErrorEvent({ event }) {
        errorHandledRef.current = true;
        const msg = (event as { message?: string }).message || "未知错误";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingMsgIdRef.current
              ? { ...m, content: `发生错误：${msg}`, isStreaming: false }
              : m
          )
        );
      },

      // A2UI event handling via AG-UI CUSTOM events
      onCustomEvent({ event }) {
        const { name, value } = event as { name: string; value: Record<string, unknown> };
        const msgId = pendingMsgIdRef.current;

        if (name === "a2ui_create_surface") {
          a2uiRenderer.createSurface(
            value.surfaceId as string,
            value.catalogId as string
          );
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId
                ? { ...m, a2uiSurfaceId: value.surfaceId as string }
                : m
            )
          );
        } else if (name === "a2ui_update_components") {
          a2uiRenderer.updateComponents(
            value.surfaceId as string,
            value.components as import("@/lib/a2ui-types").A2UIComponent[]
          );
          setRenderTick((t) => t + 1);
        } else if (name === "a2ui_update_data_model") {
          a2uiRenderer.updateDataModel(
            value.surfaceId as string,
            value.path as string | undefined,
            value.value
          );
          setRenderTick((t) => t + 1);
        } else if (name === "a2ui_delete_surface") {
          a2uiRenderer.deleteSurface(value.surfaceId as string);
          setRenderTick((t) => t + 1);
        }
      },
    });

    agentRef.current = agent;
  }, []);

  // Execute a client-side tool (called when LLM requests get_user_location)
  const executeClientTool = useCallback(
    async (toolCallId: string, _args: Record<string, unknown>) => {
      const agent = agentRef.current;
      if (!agent) return;

      const currentMsgId = pendingMsgIdRef.current;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === currentMsgId ? { ...m, toolStatus: "正在获取您的位置..." } : m
        )
      );

      clientToolContinuationRef.current = true;

      // Step 1: Get browser geolocation
      let coords: { latitude: number; longitude: number };
      try {
        coords = await new Promise((resolve, reject) => {
          if (!navigator.geolocation) {
            reject(new Error("浏览器不支持定位"));
            return;
          }
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
            (err) => reject(err),
            { timeout: 10000 }
          );
        });
      } catch {
        const errorResult = JSON.stringify({ error: "未获取到用户定位信息，请让用户手动指定城市。" });
        agent.addMessage({ id: crypto.randomUUID(), role: "assistant", content: "", toolCalls: [{ id: toolCallId, type: "function" as const, function: { name: "get_user_location", arguments: "{}" } }] });
        agent.addMessage({ id: crypto.randomUUID(), role: "tool", content: errorResult, toolCallId });
        setMessages((prev) =>
          prev.map((m) => (m.id === currentMsgId ? { ...m, toolStatus: undefined } : m))
        );
        await agent.runAgent({ tools: CLIENT_TOOLS });
        return;
      }

      // Step 2: Reverse geocode via Nominatim
      setMessages((prev) =>
        prev.map((m) =>
          m.id === currentMsgId ? { ...m, toolStatus: "正在解析城市..." } : m
        )
      );

      let locationResult: string;
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${coords.latitude}&lon=${coords.longitude}&format=json&accept-language=zh`;
        const res = await fetch(url, { headers: { "User-Agent": "ai-weather-assistant/1.0" } });
        if (!res.ok) throw new Error("geocoding failed");
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const state: string = data.address?.state || "";
        const city: string = data.address?.city || "";
        let cityName = "";
        if (state.endsWith("市")) cityName = state;
        else if (city) cityName = city;
        else {
          const match = data.display_name?.match(/([一-龥]{2,}市)/);
          cityName = match ? match[1] : "";
        }

        locationResult = cityName
          ? JSON.stringify({ city: cityName })
          : JSON.stringify({ error: "无法从定位结果中提取城市名，请让用户手动指定城市。" });
      } catch {
        locationResult = JSON.stringify({ error: "地理编码服务暂时不可用，请让用户手动指定城市。" });
      }

      // Step 3: Append tool messages and continue the conversation
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        toolCalls: [{ id: toolCallId, type: "function" as const, function: { name: "get_user_location", arguments: "{}" } }],
      });
      agent.addMessage({ id: crypto.randomUUID(), role: "tool", content: locationResult, toolCallId });

      setMessages((prev) =>
        prev.map((m) => (m.id === currentMsgId ? { ...m, toolStatus: undefined } : m))
      );

      await agent.runAgent({ tools: CLIENT_TOOLS });

      // Client tool continuation done
      clientToolContinuationRef.current = false;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingMsgIdRef.current ? { ...m, isStreaming: false, toolStatus: undefined } : m
        )
      );
      setIsRunning(false);
    },
    []
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const agent = agentRef.current;
      if (!agent || !text.trim() || isRunning) return;

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      };
      const aiMsgId = crypto.randomUUID();
      pendingMsgIdRef.current = aiMsgId;
      pendingContentRef.current = "";
      errorHandledRef.current = false;

      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsRunning(true);

      // Add pending AI message placeholder
      setMessages((prev) => [
        ...prev,
        { id: aiMsgId, role: "assistant", content: "", isStreaming: true },
      ]);

      try {
        agent.addMessage({ id: userMsg.id, role: "user", content: text });
        await agent.runAgent({ tools: CLIENT_TOOLS });
      } catch (err) {
        if (!errorHandledRef.current) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? {
                    ...m,
                    content: `请求失败：${err instanceof Error ? err.message : String(err)}`,
                    isStreaming: false,
                  }
                : m
            )
          );
        }
      } finally {
        if (!clientToolContinuationRef.current) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId ? { ...m, isStreaming: false, toolStatus: undefined } : m
            )
          );
          setIsRunning(false);
        }
      }
    },
    [isRunning]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input);
      }
    },
    [input, sendMessage]
  );

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="py-3 px-4 border-b bg-white text-center shrink-0">
        <h1 className="text-lg font-semibold text-gray-800">
          🌤️ 天气预报 AI 助手
        </h1>
        <p className="text-xs text-gray-400">基于 DeepSeek V4 · A2UI 协议</p>
      </header>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-20">
            <div className="text-4xl mb-3">🌤️</div>
            <p>向我提问吧，比如「今天北京天气怎么样？」</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl text-sm leading-relaxed break-words ${
                msg.role === "user"
                  ? "bg-blue-500 text-white rounded-br-md px-4 py-3 whitespace-pre-wrap"
                  : `bg-white border border-gray-200 text-gray-800 rounded-bl-md shadow-sm ${
                      msg.a2uiSurfaceId || msg.weatherData ? "p-0 overflow-hidden" : "px-4 py-3 whitespace-pre-wrap"
                    }`
              }`}
            >
              {/* A2UI surface rendering (primary path) */}
              {msg.role === "assistant" && msg.a2uiSurfaceId && (() => {
                const surface = a2uiRenderer.getSurface(msg.a2uiSurfaceId);
                if (!surface) return null;
                return <>{a2uiRenderer.renderSurface(msg.a2uiSurfaceId, weatherCatalogRegistry)}</>;
              })()}

              {/* Legacy weather card (fallback) */}
              {msg.role === "assistant" && !msg.a2uiSurfaceId && msg.weatherData && (
                <WeatherCard data={msg.weatherData} />
              )}

              {msg.toolStatus && (
                <div className={`text-xs text-blue-500 animate-pulse ${msg.a2uiSurfaceId || msg.weatherData ? "px-4 pt-3" : "mb-1"}`}>
                  🔧 {msg.toolStatus}
                </div>
              )}
              {(() => {
                const isAssistantText = msg.role === "assistant" && msg.content;
                if (!isAssistantText) return null;
                const [cleanText, tips] = extractTips(msg.content);
                const displayText = tips ? cleanText : msg.content;
                return (
                  <>
                    <div className={msg.a2uiSurfaceId || msg.weatherData ? "px-4 py-3" : ""}>
                      {displayText}
                      {msg.isStreaming && !msg.content && (
                        <span className="inline-flex gap-1 ml-1">
                          <span className="w-1.5 h-4 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-1.5 h-4 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-1.5 h-4 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </span>
                      )}
                      {msg.isStreaming && msg.content && (
                        <span className="inline-block w-1.5 h-4 bg-blue-400 ml-0.5 animate-pulse rounded-sm align-middle" />
                      )}
                    </div>
                    {/* Legacy tips rendering (fallback when A2UI is not active) */}
                    {tips && !msg.a2uiSurfaceId && <TipsCard tips={tips} />}
                  </>
                );
              })()}
            </div>
          </div>
        ))}
      </div>

      {/* Input area */}
      <div className="border-t bg-white p-4 shrink-0">
        <div className="max-w-3xl mx-auto flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='输入问题，例如 "今天北京天气怎么样？"'
            disabled={isRunning}
            className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={isRunning || !input.trim()}
            className="bg-blue-500 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-600 active:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
