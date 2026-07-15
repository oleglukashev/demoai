"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import { API_URL, type ChatMessage, type DocFile } from "./types";

export default function Home() {
  const [docs, setDocs] = useState<DocFile[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadDocs = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/documents`);
      setDocs(await res.json());
    } catch {
      /* backend not reachable yet */
    }
  }, []);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
    };
    const pendingId = `a-${Date.now()}`;
    const pendingMsg: ChatMessage = {
      id: pendingId,
      role: "assistant",
      content: "",
      pending: true,
    };

    setMessages((prev) => [...prev, userMsg, pendingMsg]);
    setInput("");
    setSending(true);
    requestAnimationFrame(autoGrow);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId
            ? {
                ...m,
                content:
                  data?.reply ?? "Извините, не удалось получить ответ.",
                sources: data?.sources ?? [],
                pending: false,
              }
            : m
        )
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId
            ? {
                ...m,
                content:
                  "Ошибка сети. Убедитесь, что API запущен на " + API_URL,
                pending: false,
              }
            : m
        )
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="app">
      <Sidebar docs={docs} onChanged={loadDocs} />

      <main className="main">
        <header className="chat-header">
          <div className="eyebrow">AI Assistant</div>
          <h1>Чат с ассистентом</h1>
        </header>

        <div className="messages">
          {messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-mark">#</div>
              <h2>Начните диалог</h2>
              <p>
                Загрузите текстовые документы слева — они разбиваются на чанки и
                сохраняются в базе. Задайте вопрос, и ассистент ответит по их
                содержимому.
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`msg ${m.role}`}>
                <div className="msg-avatar">
                  {m.role === "user" ? "Вы" : "AI"}
                </div>
                <div className="msg-body">
                  <div className="msg-role">
                    {m.role === "user" ? "Вы" : "Ассистент"}
                  </div>
                  <div className="msg-bubble">
                    {m.pending ? (
                      <span className="typing">
                        <span />
                        <span />
                        <span />
                      </span>
                    ) : (
                      m.content
                    )}
                  </div>
                  {m.sources && m.sources.length > 0 && (
                    <div className="msg-sources">
                      Источники: {m.sources.join(", ")}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="composer">
          <div className="composer-inner">
            <textarea
              ref={textareaRef}
              value={input}
              placeholder="Напишите сообщение ассистенту…"
              rows={1}
              onChange={(e) => {
                setInput(e.target.value);
                autoGrow();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
            />
            <button
              className="send-btn"
              onClick={sendMessage}
              disabled={!input.trim() || sending}
              aria-label="Отправить"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
          <div className="composer-hint">
            Enter — отправить · Shift+Enter — новая строка
          </div>
        </div>
      </main>
    </div>
  );
}
