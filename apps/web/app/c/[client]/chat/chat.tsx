"use client";

import { useEffect, useRef, useState } from "react";

type Part = { kind: "text"; text: string } | { kind: "tool"; name: string; ok?: boolean; summary?: string };
type Msg = { role: "user" | "assistant"; parts: Part[] };

const SUGGESTIONS = [
  "Which 5 accounts should we email this week, and why?",
  "Write a first email for our top Tier 1 account.",
  "What does our ICP say we should avoid?",
  "Which segment should we scale next?",
];

export function Chat({ client, enabled }: { client: string; enabled: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [msgs]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setError(null);
    const history = [...msgs, { role: "user" as const, parts: [{ kind: "text" as const, text }] }];
    setMsgs([...history, { role: "assistant", parts: [] }]);
    setInput("");
    setBusy(true);
    const update = (fn: (parts: Part[]) => Part[]) =>
      setMsgs((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, parts: fn([...last.parts]) };
        return copy;
      });
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client,
          messages: history.map((m) => ({ role: m.role, content: m.parts.filter((p) => p.kind === "text").map((p) => (p as { text: string }).text).join("") })),
        }),
      });
      if (!res.body) throw new Error("No response from the server.");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (e.type === "text")
            update((p) => {
              const last = p[p.length - 1];
              if (last?.kind === "text") p[p.length - 1] = { kind: "text", text: last.text + e.delta };
              else p.push({ kind: "text", text: e.delta });
              return p;
            });
          else if (e.type === "tool") update((p) => [...p, { kind: "tool", name: e.name }]);
          else if (e.type === "tool_result")
            update((p) => {
              for (let i = p.length - 1; i >= 0; i--) {
                const x = p[i];
                if (x.kind === "tool" && x.name === e.name && x.ok === undefined) {
                  p[i] = { ...x, ok: e.ok, summary: e.summary };
                  break;
                }
              }
              return p;
            });
          else if (e.type === "error") setError(e.message);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat panel">
      <div className="chat-log" ref={logRef} aria-live="polite">
        {msgs.length === 0 ? (
          <div style={{ margin: "auto 0", padding: "20px 0" }}>
            <h2>Ask anything about this client</h2>
            <p className="muted" style={{ margin: "6px 0 16px", maxWidth: "60ch" }}>
              Answers come from the brain and live data through the same tools Claude Code, Codex and Grok use. Each tool call is shown as it runs.
            </p>
            <div className="actions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn ghost" onClick={() => send(s)} disabled={!enabled || busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          msgs.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.parts.length === 0 && busy ? <span className="faint">Thinking…</span> : null}
              {m.parts.map((p, j) =>
                p.kind === "text" ? (
                  <span key={j}>{p.text}</span>
                ) : (
                  <div key={j} className="tool-call" style={{ margin: "6px 0" }}>
                    {p.ok === undefined ? "Running" : p.ok ? "Ran" : "Failed"} <strong>{p.name}</strong>
                    {p.summary ? <span className="faint">: {p.summary}</span> : null}
                  </div>
                ),
              )}
            </div>
          ))
        )}
        {error ? <div className="notice bad">{error}</div> : null}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={enabled ? "Ask about accounts, the ICP, campaigns…" : "Add ANTHROPIC_API_KEY to .env.local to chat"} disabled={!enabled} aria-label="Message" />
        <button className="btn primary" type="submit" disabled={!enabled || busy || !input.trim()}>
          {busy ? "Working…" : "Send"}
        </button>
      </form>
    </div>
  );
}
