"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components";
import { useStore } from "@/store";
import { BRIDGE_ACTIVITY } from "@/seed";

interface ChatMsg {
  from: "ai" | "user";
  text: string;
}

// The Universal Wizard, activity variant — matches the redesign's "New lesson"
// wizard (Content type + Source material step on the left, Wizard guide chat +
// Artifacts on the right). Generation is simulated; it hands off to the builder.
export function CreateWizard() {
  const router = useRouter();
  const setCurrent = useStore((s) => s.setCurrentActivity);
  const [sources, setSources] = useState<string[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([
    { from: "ai", text: "Continuing from the dashboard — you're generating a team Activity from your prompt. I'll draft the questions, rubric, and team settings whenever you're ready." },
  ]);
  const [input, setInput] = useState("");

  function addSample() {
    setSources((s) => [...s, "Bridge structures (reading).pdf — 6 pages"]);
    setChat((c) => [...c, { from: "ai", text: "Added your source. I can draft 5 questions and a matching rubric from it — say “generate” when ready." }]);
  }

  function send() {
    if (!input.trim()) return;
    setChat((c) => [...c, { from: "user", text: input.trim() }, { from: "ai", text: "Got it — I'll use that as guidance while generating." }]);
    setInput("");
  }

  function generate() {
    // Simulated generation → open the drafted activity in the builder.
    setCurrent(BRIDGE_ACTIVITY.id);
    router.push(`/i/activity/${BRIDGE_ACTIVITY.id}?tab=build`);
  }

  return (
    <div className="wiz">
      <div className="wiz__head">
        <button className="fac-icon-btn" onClick={() => router.push("/i/create")} title="Exit wizard">
          <Icon name="close" size="sm" /> Exit wizard
        </button>
      </div>

      <div className="wiz__grid">
        <div className="wiz__panel">
          <h1 className="wiz__title">New activity</h1>
          <p className="wiz__sub">The wizard reads your source material and builds the activity with you, step by step.</p>

          <div className="wiz__label">Content type</div>
          <div className="wiz__type">
            <span className="wiz__type-icon">
              <Icon name="groups" />
            </span>
            <div style={{ flex: 1 }}>
              <div className="wiz__type-title">Team activity</div>
              <div className="wiz__type-desc">Four-stage team-based learning — prep, discussion, submission, assessment.</div>
            </div>
            <button className="fac-icon-btn">
              <Icon name="edit" size="sm" />
            </button>
          </div>

          <div className="wiz__label" style={{ marginTop: 24 }}>Step 1 — Source material</div>
          <div className="wiz__drop">
            <Icon name="upload" size="lg" style={{ color: "var(--muted-fg)" }} />
            <div style={{ margin: "8px 0 4px", fontWeight: 600, color: "var(--navy)" }}>
              Drag and drop or <span style={{ textDecoration: "underline" }}>upload a file</span>
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--muted-fg)" }}>
              slides, PDFs, docs, text, images, or video — up to 25 MB each
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
              <button className="wiz__btn" onClick={addSample}>
                <Icon name="upload_file" size="sm" /> Upload a file
              </button>
              <button className="wiz__btn" onClick={addSample}>
                <Icon name="auto_awesome" size="sm" /> Use sample PDF
              </button>
            </div>
          </div>

          {sources.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <button className="fac-gen-cta" onClick={generate}>
                <Icon name="auto_awesome" size="sm" /> Generate activity
              </button>
            </div>
          )}
        </div>

        <div className="wiz__guide">
          <div className="wiz__guide-head">
            <span className="wiz__guide-spark">
              <Icon name="auto_awesome" size="sm" />
            </span>
            Wizard guide
          </div>
          <div className="wiz__label" style={{ padding: "0 16px" }}>Artifacts</div>
          <div className="wiz__artifacts">
            {sources.length === 0 ? (
              <span style={{ color: "var(--muted-fg)", fontSize: "var(--text-sm)" }}>
                Uploads and generated material collect here.
              </span>
            ) : (
              sources.map((s) => (
                <div key={s} className="wiz__artifact">
                  <Icon name="description" size="sm" /> {s}
                </div>
              ))
            )}
          </div>
          <div className="wiz__chat">
            {chat.map((m, i) => (
              <div key={i} className={`wiz__msg wiz__msg--${m.from}`}>
                {m.from === "ai" && (
                  <span className="wiz__msg-spark">
                    <Icon name="auto_awesome" size="sm" />
                  </span>
                )}
                <div className="wiz__bubble">{m.text}</div>
              </div>
            ))}
          </div>
          <div className="wiz__input">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Guide the wizard…"
            />
            <button className="wiz__send" onClick={send}>
              <Icon name="send" size="sm" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
