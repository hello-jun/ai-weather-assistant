"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { HttpAgent } from "@ag-ui/client";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  toolStatus?: string;
}

export function ChatApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const agentRef = useRef<HttpAgent | null>(null);
  const pendingContentRef = useRef("");
  const pendingMsgIdRef = useRef("");
  const errorHandledRef = useRef(false);

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

      onToolCallEndEvent() {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingMsgIdRef.current
              ? { ...m, toolStatus: "已获取天气数据" }
              : m
          )
        );
      },

      onRunErrorEvent({ event }) {
        errorHandledRef.current = true;
        const msg = (event as any).message || "未知错误";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingMsgIdRef.current
              ? { ...m, content: `发生错误：${msg}`, isStreaming: false }
              : m
          )
        );
      },
    });

    agentRef.current = agent;
  }, []);

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
        await agent.runAgent();
      } catch (err) {
        // Only show the catch-block error if the subscriber didn't already handle an error event
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
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId ? { ...m, isStreaming: false, toolStatus: undefined } : m
          )
        );
        setIsRunning(false);
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
        <p className="text-xs text-gray-400">基于 DeepSeek V4 · 流式实时回复</p>
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
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                msg.role === "user"
                  ? "bg-blue-500 text-white rounded-br-md"
                  : "bg-white border border-gray-200 text-gray-800 rounded-bl-md shadow-sm"
              }`}
            >
              {msg.toolStatus && (
                <div className="text-xs text-blue-500 mb-1 animate-pulse">
                  🔧 {msg.toolStatus}
                </div>
              )}
              <div>
                {msg.content}
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
