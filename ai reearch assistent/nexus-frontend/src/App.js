import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "./AuthContext";
import { jsPDF } from "jspdf";

// ─── PALETTE & CONSTANTS ────────────────────────────────────────
const PHASES = [
  {
    step: "01", label: "Parse Query", icon: "◈", color: "#7C5CBF",
    bg: "rgba(124,92,191,0.08)", border: "rgba(124,92,191,0.25)"
  },
  {
    step: "02", label: "Exa Search", icon: "⊕", color: "#5A82B8",
    bg: "rgba(90,130,184,0.08)", border: "rgba(90,130,184,0.25)"
  },
  {
    step: "03", label: "Fetch Articles", icon: "≋", color: "#5C9E8F",
    bg: "rgba(92,158,143,0.08)", border: "rgba(92,158,143,0.25)"
  },
  {
    step: "04", label: "Groq AI", icon: "✦", color: "#CB8A4E",
    bg: "rgba(203,138,78,0.08)", border: "rgba(203,138,78,0.25)"
  },
  {
    step: "05", label: "Generate", icon: "◎", color: "#E0827A",
    bg: "rgba(224,130,122,0.08)", border: "rgba(224,130,122,0.25)"
  },
];

const QUICK_TOPICS = [
  "Quantum Computing", "Neural Networks", "Web3 & DeFi",
  "Climate Tech", "CRISPR Gene Editing", "Large Language Models"
];

const CHAT_PROMPTS = [
  "Explain in simpler terms", "Give real-world examples",
  "How is this used today?", "Explain in Hinglish 🇮🇳"
];

// ─── UTILS ──────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── SAVE / BOOKMARK LIBRARY (localStorage, per-user) ────────────
// "saved" = full research reports the student wants to keep long-term
// "bookmarks" = quick markers on topics to revisit later
function libraryKey(type, userId) {
  return `nexus_${type}_${userId || "guest"}`;
}

function getLibrary(type, userId) {
  try {
    return JSON.parse(localStorage.getItem(libraryKey(type, userId))) || [];
  } catch {
    return [];
  }
}

function saveLibraryItems(type, userId, items) {
  localStorage.setItem(libraryKey(type, userId), JSON.stringify(items));
}

function addToLibrary(type, userId, item) {
  const items = getLibrary(type, userId);
  if (items.some(i => i.title === item.title)) return { items, added: false };
  const updated = [{ ...item, id: `${Date.now()}`, savedAt: new Date().toISOString() }, ...items];
  saveLibraryItems(type, userId, updated);
  return { items: updated, added: true };
}

function removeFromLibrary(type, userId, id) {
  const updated = getLibrary(type, userId).filter(i => i.id !== id);
  saveLibraryItems(type, userId, updated);
  return updated;
}

// ─── STUDY NOTES PDF EXPORT ───────────────────────────────────────
function downloadNotesPDF(data) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 48;
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - marginX * 2;
  let y = 56;

  const ensureSpace = (needed) => {
    if (y + needed > doc.internal.pageSize.getHeight() - 48) {
      doc.addPage();
      y = 56;
    }
  };

  const addHeading = (text, size = 16) => {
    ensureSpace(size + 12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.setTextColor(36, 31, 53);
    doc.text(text, marginX, y);
    y += size + 8;
  };

  const addParagraph = (text, size = 10.5) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(60, 55, 80);
    const lines = doc.splitTextToSize(text || "", maxWidth);
    lines.forEach(line => {
      ensureSpace(size + 4);
      doc.text(line, marginX, y);
      y += size + 4;
    });
    y += 6;
  };

  const addSection = (label, items) => {
    if (!items?.length) return;
    addHeading(label, 13);
    items.forEach(it => {
      ensureSpace(14);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(90, 60, 140);
      const titleLines = doc.splitTextToSize(`• ${it.title}`, maxWidth);
      titleLines.forEach(line => { ensureSpace(13); doc.text(line, marginX, y); y += 13; });
      addParagraph(it.desc, 10);
    });
    y += 6;
  };

  addHeading(data.title || "Study Notes", 20);
  doc.setDrawColor(124, 92, 191);
  doc.line(marginX, y - 4, pageWidth - marginX, y - 4);
  y += 14;

  addHeading("Summary", 13);
  addParagraph(data.summary);

  if (data.keyPoints?.length) {
    addHeading("Key Points", 13);
    data.keyPoints.forEach(p => addParagraph(`• ${p}`, 10.5));
  }

  addSection("Definition", data.notes?.definition?.items);
  addSection("Advantages", data.notes?.advantages?.items);
  addSection("Disadvantages", data.notes?.disadvantages?.items);
  addSection("Applications", data.notes?.applications?.items);

  if (data.terms?.length) {
    addHeading("Key Terms", 13);
    data.terms.forEach(t => addParagraph(`${t.name}: ${t.def}`, 10.5));
  }

  if (data.takeaway) {
    addHeading("Key Takeaway", 13);
    addParagraph(data.takeaway);
  }

  const safeName = (data.title || "study-notes").replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
  doc.save(`${safeName}-study-notes.pdf`);
}

// ─── BACKEND BASE URL ────────────────────────────────────────────
// Your Node server (server.js) must be running for these to work.
// In dev, create-react-app proxies "/api/*" if you add a "proxy" field
// in package.json, e.g.  "proxy": "http://localhost:5000"
// Otherwise hit the full URL here.
const API_BASE = "http://localhost:5000";

// ─── RESEARCH GENERATOR ─────────────────────────────────────────
// Calls YOUR backend's POST /api/research (Exa + Gemini), not Claude.
async function generateResearch(query) {
  const res = await fetch(`http://localhost:5000/api/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}
// ─── CHAT HANDLER ───────────────────────────────────────────────
// Calls YOUR backend's POST /api/chat (Gemini), not Claude.
async function chatWithContext(history, researchTitle) {
  const res = await fetch(`http://localhost:5000/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: researchTitle, messages: history }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.reply;
}
// ─── ROADMAP GENERATOR ──────────────────────────────────────────
// Calls YOUR backend's POST /api/roadmap (Groq) — a study plan for the
// TOPIC the student researched, not a plan for building the Nexus app.
async function generateRoadmap({ topic, summary, keyPoints, terms }) {
  const res = await fetch(`${API_BASE}/api/roadmap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, summary, keyPoints, terms }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}

// ─── COMPONENTS ─────────────────────────────────────────────────

function Orb({ style }) {
  return (
    <div style={{
      position: "absolute", borderRadius: "50%",
      filter: "blur(60px)", pointerEvents: "none", ...style
    }} />
  );
}

function PipelineBar({ activeStep }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 0,
      padding: "0.75rem 1.75rem", background: "#fff",
      borderBottom: "1px solid rgba(124,92,191,0.1)",
      overflowX: "auto"
    }}>
      {PHASES.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flexShrink: 0 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 9,
              background: i <= activeStep ? p.bg : "rgba(0,0,0,0.03)",
              border: `1.5px solid ${i <= activeStep ? p.border : "rgba(0,0,0,0.08)"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "1rem", color: i <= activeStep ? p.color : "#bbb",
              transition: "all 0.4s",
              boxShadow: i <= activeStep ? `0 0 12px ${p.border}` : "none"
            }}>{p.icon}</div>
            <span style={{
              fontSize: "0.55rem", fontFamily: "monospace", textTransform: "uppercase",
              letterSpacing: "0.08em", color: i <= activeStep ? p.color : "#bbb",
              transition: "color 0.4s"
            }}>{p.label}</span>
          </div>
          {i < PHASES.length - 1 && (
            <div style={{
              width: 28, height: 1.5,
              background: i < activeStep ? `linear-gradient(90deg,${PHASES[i].color},${PHASES[i+1].color})` : "rgba(0,0,0,0.08)",
              margin: "0 4px", marginTop: -12, transition: "background 0.5s"
            }} />
          )}
        </div>
      ))}
    </div>
  );
}

function NoteCard({ type, data }) {
  const configs = {
    definition: { label: "Definition", icon: "📖", num: "1", accent: "#CB8A4E", bg: "#FFF8F0", border: "rgba(203,138,78,0.2)", bull: "●" },
    advantages:  { label: "Advantages", icon: "🏆", num: "2", accent: "#5C9E8F", bg: "#F0FAF7", border: "rgba(92,158,143,0.2)", bull: "✓" },
    disadvantages: { label: "Disadvantages", icon: "⚠", num: "3", accent: "#C8645C", bg: "#FFF4F3", border: "rgba(200,100,92,0.2)", bull: "!" },
    applications: { label: "Applications", icon: "🎯", num: "4", accent: "#5A82B8", bg: "#F0F5FC", border: "rgba(90,130,184,0.2)", bull: "▸" },
  };
  const c = configs[type];
  return (
    <div style={{
      background: c.bg, border: `1px solid ${c.border}`, borderRadius: 14,
      padding: "1.1rem", display: "flex", flexDirection: "column", gap: 0
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "0.75rem", paddingBottom: "0.6rem",
        borderBottom: "1px solid rgba(36,31,53,0.06)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div style={{
            width: 20, height: 20, borderRadius: 5, background: `${c.accent}22`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "0.65rem", fontWeight: 700, color: c.accent, fontFamily: "monospace"
          }}>{c.num}</div>
          <span style={{ fontFamily: "monospace", fontSize: "0.6rem", fontWeight: 700, color: c.accent, letterSpacing: "0.1em", textTransform: "uppercase" }}>{c.label}</span>
        </div>
        <span style={{ fontSize: "0.95rem" }}>{c.icon}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {data?.items?.map((it, i) => (
          <div key={i} style={{ display: "flex", gap: "0.55rem", alignItems: "flex-start" }}>
            <div style={{
              width: 16, height: 16, borderRadius: "50%", background: `${c.accent}22`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "0.5rem", color: c.accent, flexShrink: 0, marginTop: 2
            }}>{c.bull}</div>
            <div>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#241F35", marginBottom: 2 }}>{it.title}</div>
              <div style={{ fontSize: "0.72rem", color: "#564E6E", lineHeight: 1.55 }}>{it.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceItem({ src, idx }) {
  return (
    <div style={{
      display: "flex", gap: "0.65rem", alignItems: "flex-start",
      padding: "0.6rem 0", borderBottom: "1px solid rgba(124,92,191,0.08)",
      cursor: "pointer"
    }}>
      <div style={{
        fontFamily: "monospace", fontSize: "0.58rem", color: "#7C5CBF",
        background: "rgba(124,92,191,0.1)", border: "1px solid rgba(124,92,191,0.2)",
        borderRadius: 5, padding: "2px 6px", flexShrink: 0, marginTop: 2
      }}>{String(idx + 1).padStart(2, "0")}</div>
      <div>
        <div style={{ fontSize: "0.8rem", fontWeight: 500, color: "#241F35", lineHeight: 1.3 }}>{src.title}</div>
        <div style={{ fontSize: "0.66rem", color: "#9D94AE", fontFamily: "monospace", marginTop: 2 }}>{src.domain}</div>
      </div>
    </div>
  );
}

function Toast({ message }) {
  if (!message) return null;
  return (
    <div style={{
      position: "fixed", bottom: "1.5rem", left: "50%", transform: "translateX(-50%)",
      background: "#241F35", color: "#fff", padding: "0.6rem 1.2rem", borderRadius: 10,
      fontSize: "0.82rem", zIndex: 1000, boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
      display: "flex", alignItems: "center", gap: "0.5rem"
    }}>
      <span>✓</span>{message}
    </div>
  );
}

// ─── PROFILE MENU (clickable, with logout) ───────────────────────
function ProfileMenu({ user, onLogout, onNav, dropUp = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const displayName = user?.name || user?.email?.split("@")[0] || "Student";
  const initials = displayName.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "U";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: "0.7rem", cursor: "pointer",
          padding: "0.3rem 0.4rem", borderRadius: 10, transition: "background 0.15s"
        }}
      >
        <div style={{
          width: 30, height: 30, borderRadius: "50%", background: "#7C5CBF",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "0.62rem", fontWeight: 700, color: "#fff", flexShrink: 0
        }}>{initials}</div>
        <div style={{ overflow: "hidden" }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#241F35", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 130 }}>{displayName}</div>
          <div style={{ fontSize: "0.63rem", color: "#9D94AE" }}>Free plan</div>
        </div>
        <span style={{ fontSize: "0.65rem", color: "#9D94AE", marginLeft: "auto" }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{
          position: "absolute", [dropUp ? "bottom" : "top"]: "calc(100% + 6px)", left: 0,
          minWidth: 200, background: "#fff", borderRadius: 12,
          border: "1px solid rgba(124,92,191,0.15)", boxShadow: "0 10px 32px rgba(90,60,140,0.18)",
          overflow: "hidden", zIndex: 300
        }}>
          <div style={{ padding: "0.7rem 0.9rem", borderBottom: "1px solid rgba(124,92,191,0.08)" }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "#241F35" }}>{displayName}</div>
            {user?.email && <div style={{ fontSize: "0.68rem", color: "#9D94AE", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</div>}
          </div>
          <button onClick={() => { setOpen(false); onNav("library"); }} style={menuBtnStyle}>
            🔖 Saved & Bookmarks
          </button>
          <button onClick={() => { setOpen(false); onLogout(); onNav("landing"); }} style={{ ...menuBtnStyle, color: "#C8645C" }}>
            ⎋ Logout
          </button>
        </div>
      )}
    </div>
  );
}

const menuBtnStyle = {
  display: "block", width: "100%", textAlign: "left", padding: "0.6rem 0.9rem",
  background: "transparent", border: "none", cursor: "pointer",
  fontSize: "0.8rem", fontFamily: "Inter,sans-serif", color: "#564E6E"
};

// ─── LANDING PAGE ────────────────────────────────────────────────
function LandingPage({ onSearch, onNav, user, onLogout }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  const submit = () => { if (query.trim()) onSearch(query.trim()); };
  const handleKey = e => { if (e.key === "Enter") submit(); };

  return (
    <div style={{ minHeight: "100vh", background: "#F4F1EC", position: "relative", overflow: "hidden" }}>
      {/* Ambient orbs */}
      <Orb style={{ width: 600, height: 600, background: "rgba(124,92,191,0.12)", top: -100, right: -100 }} />
      <Orb style={{ width: 400, height: 400, background: "rgba(242,166,160,0.18)", bottom: 50, left: -80 }} />
      <Orb style={{ width: 300, height: 300, background: "rgba(92,158,143,0.10)", top: "40%", left: "60%" }} />

      {/* Nav */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 200,
        padding: "1rem 2.5rem", display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "rgba(244,241,236,0.85)", backdropFilter: "blur(18px)",
        borderBottom: "1px solid rgba(124,92,191,0.12)"
      }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "1.25rem", fontWeight: 700, color: "#241F35", letterSpacing: "-0.02em" }}>
          Nex<span style={{ color: "#7C5CBF" }}>us</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <button onClick={() => onNav("roadmap")} style={{
            background: "transparent", border: "1.5px solid rgba(124,92,191,0.25)",
            color: "#564E6E", padding: "0.45rem 1.1rem", borderRadius: 100,
            fontSize: "0.82rem", fontWeight: 500, cursor: "pointer"
          }}>Roadmap</button>
          {user ? (
            <ProfileMenu user={user} onLogout={onLogout} onNav={onNav} />
          ) : (
            <>
              <button onClick={() => onNav("login")} style={{
                background: "transparent", border: "1.5px solid rgba(124,92,191,0.25)",
                color: "#564E6E", padding: "0.45rem 1.1rem", borderRadius: 100,
                fontSize: "0.82rem", fontWeight: 500, cursor: "pointer"
              }}>Login</button>
              <button onClick={() => onNav("signup")} style={{
                background: "#7C5CBF", border: "none", color: "#fff",
                padding: "0.48rem 1.3rem", borderRadius: 100, fontSize: "0.82rem",
                fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 16px rgba(124,92,191,0.3)"
              }}>Sign Up</button>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section style={{
        minHeight: "100vh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "8rem 2rem 4rem", textAlign: "center", position: "relative", zIndex: 1
      }}>
        {/* Badge */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: "0.5rem",
          background: "rgba(124,92,191,0.08)", border: "1px solid rgba(124,92,191,0.22)",
          borderRadius: 100, padding: "0.3rem 1rem", marginBottom: "1.5rem"
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%", background: "#7C5CBF",
            animation: "pulse 2s infinite"
          }} />
          <span style={{ fontSize: "0.72rem", color: "#684CA3", fontWeight: 600, fontFamily: "'Space Grotesk',sans-serif" }}>
            Powered by Groq AI · Real-time Research
          </span>
        </div>

        {/* Headline */}
        <h1 style={{
          fontFamily: "'Space Grotesk',sans-serif", fontSize: "clamp(2.8rem,5.5vw,5rem)",
          fontWeight: 700, lineHeight: 1.06, letterSpacing: "-0.04em",
          color: "#241F35", marginBottom: "1rem", maxWidth: 750
        }}>
          Research anything.<br />
          <span style={{ color: "#E0827A" }}>Understand everything.</span>
        </h1>

        <p style={{
          fontSize: "1.05rem", color: "#564E6E", maxWidth: 460,
          lineHeight: 1.78, marginBottom: "2.5rem"
        }}>
          Type a topic. Get an AI-generated summary, structured study notes, key terms, curated sources — and a chat assistant that answers follow-up questions.
        </p>

        {/* Search box */}
        <div style={{ width: "100%", maxWidth: 620, margin: "0 auto 1rem" }}>
          <div style={{
            display: "flex", alignItems: "center",
            background: "#fff", border: `1.5px solid ${focused ? "#7C5CBF" : "rgba(124,92,191,0.22)"}`,
            borderRadius: 16, overflow: "hidden",
            boxShadow: focused ? "0 0 0 4px rgba(124,92,191,0.1), 0 8px 32px rgba(90,60,140,0.10)" : "0 8px 32px rgba(90,60,140,0.08)",
            transition: "all 0.25s"
          }}>
            <span style={{ padding: "0 1rem", color: "#9D94AE", fontSize: "1.1rem", flexShrink: 0 }}>⊕</span>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKey}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="Try: Blockchain for beginners, or Neural Networks..."
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                padding: "1.05rem 0.25rem", color: "#241F35",
                fontFamily: "Inter,sans-serif", fontSize: "1rem"
              }}
            />
            <button
              onClick={submit}
              style={{
                margin: 6, padding: "0.65rem 1.5rem",
                background: "#7C5CBF", color: "#fff", border: "none", borderRadius: 10,
                fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.875rem",
                fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.2s"
              }}
            >Research ✦</button>
          </div>
        </div>

        {/* Quick tags */}
        <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap", justifyContent: "center" }}>
          {QUICK_TOPICS.map(t => (
            <button key={t} onClick={() => onSearch(t)} style={{
              background: "#fff", border: "1px solid rgba(124,92,191,0.18)",
              borderRadius: 100, padding: "0.3rem 0.9rem", fontSize: "0.77rem",
              color: "#564E6E", cursor: "pointer", transition: "all 0.2s",
              fontFamily: "Inter,sans-serif"
            }}>{t}</button>
          ))}
        </div>

        {/* Stats */}
        <div style={{
          display: "flex", gap: "3rem", justifyContent: "center",
          marginTop: "3rem", paddingTop: "2rem",
          borderTop: "1px solid rgba(124,92,191,0.12)",
          position: "relative", zIndex: 5
        }}>
          {[
            ["10K+", "Students helped"],
            ["5s", "Average research time"],
            ["98%", "Accuracy rate"],
          ].map(([num, lbl]) => (
            <div key={lbl} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "1.9rem", fontWeight: 700, color: "#241F35", letterSpacing: "-0.03em" }}>
                {num.replace(/(\d+)/, m => m)}<span style={{ color: "#E0827A" }}>+</span>
              </div>
              <div style={{ fontSize: "0.7rem", color: "#9D94AE", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>{lbl}</div>
            </div>
          ))}
        </div>
      </section>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
    </div>
  );
}

// ─── LOADING OVERLAY ─────────────────────────────────────────────
function LoadingOverlay({ step, query }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 500,
      background: "rgba(244,241,236,0.94)", backdropFilter: "blur(14px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexDirection: "column", gap: "1.5rem"
    }}>
      {/* Spinner */}
      <div style={{ position: "relative", width: 64, height: 64 }}>
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          border: "3px solid rgba(124,92,191,0.15)",
          borderTopColor: "#7C5CBF", borderRightColor: "#E0827A",
          animation: "spin 0.9s linear infinite"
        }} />
        <div style={{
          position: "absolute", inset: 12, borderRadius: "50%",
          background: "rgba(124,92,191,0.07)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "1.1rem"
        }}>✦</div>
      </div>

      {/* Query display */}
      <div style={{
        background: "#fff", border: "1px solid rgba(124,92,191,0.18)",
        borderRadius: 12, padding: "0.55rem 1.2rem",
        fontFamily: "monospace", fontSize: "0.8rem", color: "#7C5CBF",
        maxWidth: 320, textAlign: "center", overflow: "hidden",
        textOverflow: "ellipsis", whiteSpace: "nowrap"
      }}>"{query}"</div>

      {/* Step labels */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem", alignItems: "center" }}>
        {PHASES.map((p, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: "0.6rem",
            opacity: i === step ? 1 : i < step ? 0.5 : 0.25,
            transition: "opacity 0.4s",
            transform: i === step ? "scale(1.03)" : "scale(1)"
          }}>
            <span style={{
              fontFamily: "monospace", fontSize: "0.6rem", color: p.color,
              background: p.bg, border: `1px solid ${p.border}`,
              borderRadius: 4, padding: "1px 5px"
            }}>{p.step}</span>
            <span style={{ fontSize: "0.8rem", color: "#241F35", fontWeight: i === step ? 600 : 400 }}>
              {p.label}…
            </span>
            {i < step && <span style={{ color: "#5C9E8F", fontSize: "0.7rem" }}>✓</span>}
          </div>
        ))}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ─── RESULTS PAGE ────────────────────────────────────────────────
function ResultsPage({ data, query, history, onBack, onNewSearch, onNav, user, onLogout }) {
  const [chatHistory, setChatHistory] = useState([
    { role: "assistant", content: `Hi! I've researched **${data.title}** using live sources. Ask me anything about this topic!` }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("summary");
  const chatRef = useRef(null);
  const [newSearch, setNewSearch] = useState("");
  const [topFocused, setTopFocused] = useState(false);
  const [toast, setToast] = useState("");

  const flashToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  };

  const handleCopy = async () => {
    const text = `${data.title}\n\n${data.summary}\n\n${(data.keyPoints || []).map(p => `• ${p}`).join("\n")}`;
    try {
      await navigator.clipboard.writeText(text);
      flashToast("Copied to clipboard");
    } catch {
      flashToast("Couldn't copy — try selecting the text manually");
    }
  };

  const handleSave = () => {
    const uid = user?.$id || "guest";
    const { added } = addToLibrary("saved", uid, { title: data.title, query, data });
    flashToast(added ? "Saved to your library" : "Already saved");
  };

  const handleBookmark = () => {
    const uid = user?.$id || "guest";
    const { added } = addToLibrary("bookmarks", uid, { title: data.title, query, data });
    flashToast(added ? "Bookmarked" : "Already bookmarked");
  };

  const handlePDF = () => {
    downloadNotesPDF(data);
    flashToast("Study notes PDF downloading...");
  };

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chatHistory]);

  const sendChat = async (msg) => {
    const m = msg || chatInput.trim();
    if (!m || chatLoading) return;
    setChatInput("");
    const userMsg = { role: "user", content: m };
    const newHistory = [...chatHistory, userMsg];
    setChatHistory(newHistory);
    setChatLoading(true);

    // Build API history (skip first assistant welcome)
    const apiHistory = newHistory
      .filter((_, i) => i > 0)
      .map(h => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content }));

    try {
      const reply = await chatWithContext(apiHistory, data.title);
      setChatHistory(h => [...h, { role: "assistant", content: reply }]);
    } catch {
      setChatHistory(h => [...h, { role: "assistant", content: "Sorry, I couldn't connect right now. Please try again!" }]);
    }
    setChatLoading(false);
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#F4F1EC" }}>
      {/* Sidebar */}
      <div style={{
        width: 260, background: "#fff", borderRight: "1px solid rgba(124,92,191,0.1)",
        position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 100,
        display: "flex", flexDirection: "column", overflow: "hidden"
      }}>
        {/* Logo */}
        <div style={{
          padding: "1.2rem 1.25rem 0.9rem", borderBottom: "1px solid rgba(124,92,191,0.1)",
          display: "flex", alignItems: "center", justifyContent: "space-between"
        }}>
          <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "1.1rem", fontWeight: 700, color: "#241F35" }}>
            Nex<span style={{ color: "#7C5CBF" }}>us</span>
          </span>
          <button onClick={onBack} style={{
            width: 26, height: 26, borderRadius: 7, background: "rgba(124,92,191,0.08)",
            border: "none", color: "#7C5CBF", cursor: "pointer", fontSize: "0.9rem"
          }}>+</button>
        </div>

        {/* History */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem 0" }}>
          <div style={{ padding: "0.35rem 1.25rem", fontSize: "0.64rem", fontWeight: 700, color: "#9D94AE", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Recent
          </div>
          {history.map((h, i) => (
            <div key={i} style={{
              padding: "0.55rem 1.2rem", cursor: "pointer",
              display: "flex", alignItems: "center", gap: "0.65rem",
              background: h === query ? "rgba(124,92,191,0.07)" : "transparent",
              borderLeft: h === query ? "2.5px solid #7C5CBF" : "2.5px solid transparent",
              transition: "all 0.15s"
            }}>
              <div style={{
                width: 26, height: 26, borderRadius: 7, background: "rgba(124,92,191,0.08)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.7rem", flexShrink: 0
              }}>📄</div>
              <div style={{ overflow: "hidden" }}>
                <div style={{ fontSize: "0.78rem", fontWeight: 500, color: "#241F35", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>{h}</div>
                <div style={{ fontSize: "0.63rem", color: "#9D94AE", marginTop: 1 }}>Just now</div>
              </div>
            </div>
          ))}
        </div>

        {/* User */}
        <div style={{
          borderTop: "1px solid rgba(124,92,191,0.1)", padding: "0.9rem 1.2rem"
        }}>
          <ProfileMenu user={user} onLogout={onLogout} onNav={onNav} dropUp />
        </div>
      </div>

      <Toast message={toast} />

      {/* Main content */}
      <div style={{ marginLeft: 260, flex: 1, display: "flex", flexDirection: "column" }}>
        {/* Topbar */}
        <div style={{
          position: "sticky", top: 0, zIndex: 50,
          background: "#fff", borderBottom: "1px solid rgba(124,92,191,0.1)",
          padding: "0.75rem 1.75rem", display: "flex", alignItems: "center", gap: "0.75rem"
        }}>
          <button onClick={onBack} style={{
            background: "transparent", border: "1px solid rgba(124,92,191,0.18)",
            color: "#564E6E", padding: "0.38rem 0.85rem", borderRadius: 8,
            fontSize: "0.78rem", cursor: "pointer"
          }}>← Back</button>
          <div style={{
            flex: 1, display: "flex", alignItems: "center", gap: "0.55rem",
            background: topFocused ? "#fff" : "#F9F7F4",
            border: `1.5px solid ${topFocused ? "#7C5CBF" : "rgba(124,92,191,0.16)"}`,
            borderRadius: 10, padding: "0.48rem 0.95rem", transition: "all 0.25s",
            boxShadow: topFocused ? "0 0 0 4px rgba(124,92,191,0.08)" : "none"
          }}>
            <span style={{ color: "#9D94AE", fontSize: "0.82rem" }}>⊕</span>
            <input
              value={newSearch}
              onChange={e => setNewSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && newSearch.trim()) onNewSearch(newSearch.trim()); }}
              onFocus={() => setTopFocused(true)}
              onBlur={() => setTopFocused(false)}
              placeholder="Search a new topic..."
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                fontFamily: "Inter,sans-serif", fontSize: "0.86rem", color: "#241F35"
              }}
            />
          </div>
          <button onClick={() => onNav("roadmap")} style={{
            background: "transparent", border: "1px solid rgba(124,92,191,0.18)",
            color: "#564E6E", padding: "0.38rem 0.85rem", borderRadius: 8,
            fontSize: "0.78rem", cursor: "pointer"
          }}>Roadmap</button>
        </div>

        {/* Pipeline */}
        <PipelineBar activeStep={4} />

        {/* Tab nav */}
        <div style={{
          padding: "0 1.75rem", background: "#fff",
          borderBottom: "1px solid rgba(124,92,191,0.1)",
          display: "flex", gap: "0.25rem"
        }}>
          {["summary", "notes", "chat"].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding: "0.75rem 1.25rem", background: "transparent",
              border: "none", borderBottom: `2px solid ${activeTab === tab ? "#7C5CBF" : "transparent"}`,
              color: activeTab === tab ? "#7C5CBF" : "#9D94AE",
              fontFamily: "Inter,sans-serif", fontSize: "0.83rem", fontWeight: activeTab === tab ? 600 : 400,
              cursor: "pointer", transition: "all 0.2s", textTransform: "capitalize"
            }}>{tab === "chat" ? "💬 Chat" : tab === "notes" ? "📝 Study Notes" : "📄 Summary"}</button>
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: "1.75rem", display: "flex", flexDirection: "column", gap: "1.4rem" }}>

          {/* SUMMARY TAB */}
          {activeTab === "summary" && (
            <>
              {/* Summary card */}
              <div style={{
                background: "#fff", borderRadius: 18, border: "1px solid rgba(124,92,191,0.1)",
                boxShadow: "0 2px 14px rgba(90,60,140,0.06)", overflow: "hidden"
              }}>
                <div style={{ padding: "1.5rem 1.75rem 0", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
                  <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "1.3rem", fontWeight: 700, color: "#241F35", letterSpacing: "-0.02em", lineHeight: 1.3 }}>
                    {data.title}
                  </h2>
                  <div style={{
                    display: "flex", alignItems: "center", gap: "0.35rem",
                    background: "rgba(124,92,191,0.07)", border: "1px solid rgba(124,92,191,0.2)",
                    borderRadius: 100, padding: "0.25rem 0.75rem", flexShrink: 0
                  }}>
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#7C5CBF", animation: "pulse 2s infinite" }} />
                    <span style={{ fontFamily: "monospace", fontSize: "0.64rem", color: "#684CA3", fontWeight: 600 }}>Groq AI</span>
                  </div>
                </div>
                <div style={{ padding: "1rem 1.75rem" }}>
                  <p style={{ fontSize: "0.92rem", lineHeight: 1.82, color: "#564E6E", marginBottom: "1rem" }}>{data.summary}</p>
                  <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                    {data.keyPoints?.map((p, i) => (
                      <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: "0.65rem", fontSize: "0.85rem", color: "#241F35", lineHeight: 1.55 }}>
                        <div style={{
                          width: 18, height: 18, borderRadius: 5, flexShrink: 0, marginTop: 1,
                          background: "rgba(92,158,143,0.12)", border: "1px solid rgba(92,158,143,0.3)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: "0.58rem", color: "#5C9E8F"
                        }}>✓</div>
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
                <div style={{
                  padding: "0.85rem 1.75rem 1.25rem",
                  borderTop: "1px solid rgba(124,92,191,0.08)",
                  display: "flex", gap: "0.6rem", flexWrap: "wrap"
                }}>
                  {[["⧉ Copy", handleCopy], ["☆ Save", handleSave], ["🔖 Bookmark", handleBookmark], ["↓ PDF", handlePDF]].map(([lbl, fn]) => (
                    <button key={lbl} onClick={fn} style={{
                      display: "flex", alignItems: "center", gap: "0.3rem",
                      padding: "0.42rem 0.85rem", borderRadius: 9, fontSize: "0.76rem",
                      fontFamily: "'Space Grotesk',sans-serif", fontWeight: 500, cursor: "pointer",
                      border: "1px solid rgba(124,92,191,0.18)", background: "#F9F7F4", color: "#564E6E",
                      transition: "all 0.2s"
                    }}>{lbl}</button>
                  ))}
                </div>
              </div>

              {/* Two column: Sources + Terms */}
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "1.4rem" }}>
                <div style={{
                  background: "#fff", borderRadius: 18, border: "1px solid rgba(124,92,191,0.1)",
                  boxShadow: "0 2px 14px rgba(90,60,140,0.06)", padding: "1.35rem"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.9rem" }}>
                    <div style={{ width: 3, height: 12, background: "#E0827A", borderRadius: 2 }} />
                    <span style={{ fontFamily: "monospace", fontSize: "0.68rem", fontWeight: 700, color: "#9D94AE", textTransform: "uppercase", letterSpacing: "0.1em" }}>Sources</span>
                  </div>
                  {data.sources?.map((s, i) => <SourceItem key={i} src={s} idx={i} />)}
                </div>
                <div style={{
                  background: "#fff", borderRadius: 18, border: "1px solid rgba(124,92,191,0.1)",
                  boxShadow: "0 2px 14px rgba(90,60,140,0.06)", padding: "1.35rem"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.9rem" }}>
                    <div style={{ width: 3, height: 12, background: "#7C5CBF", borderRadius: 2 }} />
                    <span style={{ fontFamily: "monospace", fontSize: "0.68rem", fontWeight: 700, color: "#9D94AE", textTransform: "uppercase", letterSpacing: "0.1em" }}>Key Terms</span>
                  </div>
                  {data.terms?.map((t, i) => (
                    <div key={i} style={{ marginBottom: i < data.terms.length - 1 ? "0.75rem" : 0 }}>
                      <div style={{ fontFamily: "monospace", fontSize: "0.68rem", color: "#684CA3", fontWeight: 700, marginBottom: 2 }}>{t.name}</div>
                      <div style={{ fontSize: "0.74rem", color: "#564E6E", lineHeight: 1.55 }}>{t.def}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* NOTES TAB */}
          {activeTab === "notes" && (
            <>
              <div style={{
                background: "#fff", borderRadius: 18, border: "1px solid rgba(124,92,191,0.1)",
                boxShadow: "0 2px 14px rgba(90,60,140,0.06)", padding: "1.5rem"
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 11,
                      background: "linear-gradient(135deg,#7C5CBF,#E0827A)",
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.1rem"
                    }}>📝</div>
                    <div>
                      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "1.25rem", fontWeight: 700, color: "#241F35" }}>Study Notes</div>
                      <div style={{ fontSize: "0.72rem", color: "#9D94AE", marginTop: 2 }}>Auto-generated by Nexus AI</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <div style={{
                      background: "rgba(124,92,191,0.07)", border: "1px solid rgba(124,92,191,0.2)",
                      borderRadius: 100, padding: "0.28rem 0.8rem", fontSize: "0.62rem",
                      color: "#684CA3", fontFamily: "monospace", display: "flex", alignItems: "center", gap: "0.3rem"
                    }}>
                      <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#7C5CBF", animation: "pulse 2s infinite" }} />
                      AI Generated
                    </div>
                    <button onClick={handlePDF} style={{
                      display: "flex", alignItems: "center", gap: "0.35rem",
                      background: "#7C5CBF", border: "none", color: "#fff",
                      padding: "0.4rem 0.85rem", borderRadius: 9, fontSize: "0.74rem",
                      fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, cursor: "pointer"
                    }}>↓ Download PDF</button>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.9rem", marginBottom: "0.9rem" }}>
                  {["definition", "advantages", "disadvantages", "applications"].map(type => (
                    <NoteCard key={type} type={type} data={data.notes?.[type]} />
                  ))}
                </div>

                {/* Takeaway */}
                <div style={{
                  background: "rgba(124,92,191,0.06)", border: "1px solid rgba(124,92,191,0.18)",
                  borderRadius: 13, padding: "0.85rem 1.1rem", display: "flex", alignItems: "center", gap: "0.8rem"
                }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 9, background: "rgba(124,92,191,0.12)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.9rem", flexShrink: 0
                  }}>💡</div>
                  <div>
                    <div style={{ fontSize: "0.59rem", color: "#684CA3", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3, fontFamily: "monospace" }}>Key Takeaway</div>
                    <div style={{ fontSize: "0.8rem", color: "#564E6E", lineHeight: 1.55 }}>{data.takeaway}</div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* CHAT TAB */}
          {activeTab === "chat" && (
            <div style={{
              background: "#fff", borderRadius: 18, border: "1px solid rgba(124,92,191,0.1)",
              boxShadow: "0 2px 14px rgba(90,60,140,0.06)", overflow: "hidden"
            }}>
              <div style={{
                padding: "0.9rem 1.5rem", borderBottom: "1px solid rgba(124,92,191,0.08)",
                display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
                  <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.88rem", fontWeight: 600, color: "#241F35" }}>Chat with Research</span>
                  <div style={{
                    background: "rgba(124,92,191,0.08)", border: "1px solid rgba(124,92,191,0.2)",
                    borderRadius: 100, padding: "0.16rem 0.55rem", fontSize: "0.58rem", color: "#684CA3", fontFamily: "monospace", fontWeight: 600
                  }}>RAG · Groq AI</div>
                </div>
              </div>

              {/* Messages */}
              <div ref={chatRef} style={{
                padding: "1.1rem 1.5rem", display: "flex", flexDirection: "column",
                gap: "0.85rem", maxHeight: 380, overflowY: "auto"
              }}>
                {chatHistory.map((msg, i) => (
                  <div key={i} style={{ display: "flex", gap: "0.65rem", flexDirection: msg.role === "user" ? "row-reverse" : "row" }}>
                    <div style={{
                      width: 27, height: 27, borderRadius: "50%", flexShrink: 0,
                      background: msg.role === "user" ? "rgba(242,166,160,0.3)" : "rgba(124,92,191,0.1)",
                      border: `1px solid ${msg.role === "user" ? "rgba(242,166,160,0.5)" : "rgba(124,92,191,0.2)"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "0.62rem", fontWeight: 700, fontFamily: "monospace",
                      color: msg.role === "user" ? "#C8645C" : "#7C5CBF"
                    }}>{msg.role === "user" ? "U" : "AI"}</div>
                    <div style={{
                      maxWidth: "80%", padding: "0.65rem 0.9rem", borderRadius: 12,
                      fontSize: "0.83rem", lineHeight: 1.65,
                      background: msg.role === "user" ? "rgba(242,166,160,0.15)" : "rgba(124,92,191,0.07)",
                      border: `1px solid ${msg.role === "user" ? "rgba(242,166,160,0.3)" : "rgba(124,92,191,0.15)"}`,
                      color: "#241F35"
                    }}
                      dangerouslySetInnerHTML={{ __html: msg.content.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") }}
                    />
                  </div>
                ))}
                {chatLoading && (
                  <div style={{ display: "flex", gap: "0.65rem" }}>
                    <div style={{
                      width: 27, height: 27, borderRadius: "50%", background: "rgba(124,92,191,0.1)",
                      border: "1px solid rgba(124,92,191,0.2)", display: "flex",
                      alignItems: "center", justifyContent: "center", fontSize: "0.62rem",
                      fontFamily: "monospace", color: "#7C5CBF"
                    }}>AI</div>
                    <div style={{
                      padding: "0.65rem 0.9rem", borderRadius: 12, background: "rgba(124,92,191,0.07)",
                      border: "1px solid rgba(124,92,191,0.15)", display: "flex", gap: "0.3rem", alignItems: "center"
                    }}>
                      {[0, 1, 2].map(j => (
                        <div key={j} style={{
                          width: 6, height: 6, borderRadius: "50%", background: "#7C5CBF",
                          animation: "pulse 1.2s infinite", animationDelay: `${j * 0.2}s`
                        }} />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Quick prompts */}
              <div style={{ padding: "0 1.5rem 0.6rem", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                {CHAT_PROMPTS.map(p => (
                  <button key={p} onClick={() => sendChat(p)} style={{
                    background: "#F9F7F4", border: "1px solid rgba(124,92,191,0.14)",
                    borderRadius: 7, padding: "0.26rem 0.62rem", fontSize: "0.68rem",
                    color: "#564E6E", cursor: "pointer", transition: "all 0.2s",
                    fontFamily: "Inter,sans-serif"
                  }}>{p}</button>
                ))}
              </div>

              {/* Input */}
              <div style={{
                padding: "0.75rem 1.5rem", borderTop: "1px solid rgba(124,92,191,0.08)",
                display: "flex", alignItems: "center", gap: "0.5rem",
                background: "#F9F7F4", margin: "0 1rem 1rem", borderRadius: 12,
              }}>
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") sendChat(); }}
                  placeholder="Ask a follow-up question..."
                  disabled={chatLoading}
                  style={{
                    flex: 1, background: "transparent", border: "none", outline: "none",
                    fontFamily: "Inter,sans-serif", fontSize: "0.85rem", color: "#241F35"
                  }}
                />
                <button
                  onClick={() => sendChat()}
                  disabled={chatLoading || !chatInput.trim()}
                  style={{
                    width: 32, height: 32, borderRadius: 9, background: chatLoading ? "#bbb" : "#7C5CBF",
                    border: "none", cursor: chatLoading ? "not-allowed" : "pointer",
                    color: "#fff", fontSize: "0.85rem", display: "flex",
                    alignItems: "center", justifyContent: "center", transition: "all 0.2s", flexShrink: 0
                  }}
                >→</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
    </div>
  );
}

// ─── ROADMAP PAGE ────────────────────────────────────────────────
const ROADMAP_COLORS = [
  { color: "#5A82B8", bg: "#EFF4FB", border: "rgba(90,130,184,0.2)", icon: "🌱" },
  { color: "#7C5CBF", bg: "#F3EEF9", border: "rgba(124,92,191,0.2)", icon: "📚" },
  { color: "#5C9E8F", bg: "#EBF5F2", border: "rgba(92,158,143,0.2)", icon: "🛠" },
  { color: "#E0827A", bg: "#FBF0EE", border: "rgba(224,130,122,0.2)", icon: "🚀" },
];

function RoadmapPage({ onBack, query, researchData, onSearch }) {
  const [roadmap, setRoadmap] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [topicInput, setTopicInput] = useState("");

  const load = useCallback(async (topic, ctx) => {
    setLoading(true);
    setErr("");
    try {
      const data = await generateRoadmap({
        topic,
        summary: ctx?.summary,
        keyPoints: ctx?.keyPoints,
        terms: ctx?.terms,
      });
      setRoadmap(data);
    } catch (e) {
      setErr("Couldn't generate a study roadmap. Check your backend is running and try again.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (researchData && query) {
      load(query, researchData);
    }
  }, [query, researchData, load]);

  return (
    <div style={{ minHeight: "100vh", background: "#F4F1EC", padding: "5rem 2rem 4rem" }}>
      {/* Nav */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 200,
        padding: "0.9rem 2.5rem", display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "rgba(244,241,236,0.88)", backdropFilter: "blur(18px)",
        borderBottom: "1px solid rgba(124,92,191,0.1)"
      }}>
        <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "1.2rem", fontWeight: 700, color: "#241F35" }}>
          Nex<span style={{ color: "#7C5CBF" }}>us</span>
        </span>
        <button onClick={onBack} style={{
          background: "transparent", border: "1.5px solid rgba(124,92,191,0.25)",
          color: "#564E6E", padding: "0.45rem 1.1rem", borderRadius: 100,
          fontSize: "0.82rem", cursor: "pointer"
        }}>← Back</button>
      </nav>

      <div style={{ textAlign: "center", marginBottom: "3rem", marginTop: "1.5rem" }}>
        <div style={{
          display: "inline-block", fontFamily: "monospace", fontSize: "0.7rem", letterSpacing: "0.2em",
          color: "#7C5CBF", textTransform: "uppercase", marginBottom: "0.75rem"
        }}>Study Roadmap</div>
        <h1 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "clamp(2rem,4.5vw,3.4rem)", fontWeight: 700, color: "#241F35", marginBottom: "0.6rem", letterSpacing: "-0.03em" }}>
          {researchData ? `How to master ${researchData.title}` : "Learn any topic, phase by phase."}
        </h1>
        <p style={{ color: "#684CA3", fontSize: "0.95rem", maxWidth: 560, margin: "0 auto" }}>
          {researchData ? "A personalized study plan generated for the topic you researched." : "Research a topic first, or type one below, to get a step-by-step study plan."}
        </p>
      </div>

      {/* No topic yet — let them type one directly */}
      {!researchData && (
        <div style={{ maxWidth: 520, margin: "0 auto 2.5rem", display: "flex", gap: "0.5rem" }}>
          <input
            value={topicInput}
            onChange={e => setTopicInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && topicInput.trim()) load(topicInput.trim()); }}
            placeholder="e.g. Neural Networks, DBMS Normalization..."
            style={{
              flex: 1, padding: "0.75rem 1rem", borderRadius: 12,
              border: "1.5px solid rgba(124,92,191,0.22)", outline: "none",
              fontFamily: "Inter,sans-serif", fontSize: "0.88rem", background: "#fff"
            }}
          />
          <button
            onClick={() => topicInput.trim() && load(topicInput.trim())}
            style={{
              background: "#7C5CBF", color: "#fff", border: "none", borderRadius: 12,
              padding: "0.75rem 1.4rem", fontFamily: "'Space Grotesk',sans-serif",
              fontWeight: 600, fontSize: "0.85rem", cursor: "pointer"
            }}
          >Generate</button>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", color: "#684CA3", fontSize: "0.9rem", padding: "2rem" }}>
          <div style={{
            width: 36, height: 36, margin: "0 auto 1rem", borderRadius: "50%",
            border: "3px solid rgba(124,92,191,0.2)", borderTopColor: "#7C5CBF",
            animation: "spin 0.9s linear infinite"
          }} />
          Building your study roadmap...
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {err && (
        <div style={{ textAlign: "center", color: "#C8645C", fontSize: "0.85rem", marginBottom: "1.5rem" }}>{err}</div>
      )}

      {roadmap && !loading && (
        <>
          {roadmap.overview && (
            <div style={{
              maxWidth: 760, margin: "0 auto 2.5rem", background: "#fff",
              border: "1px solid rgba(124,92,191,0.12)", borderRadius: 16,
              padding: "1.1rem 1.4rem", fontSize: "0.86rem", color: "#564E6E",
              lineHeight: 1.7, boxShadow: "0 2px 14px rgba(90,60,140,0.05)"
            }}>{roadmap.overview}</div>
          )}

          <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: "2rem" }}>
            {(roadmap.phases || []).map((ph, i) => {
              const c = ROADMAP_COLORS[i % ROADMAP_COLORS.length];
              return (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "1.75rem", flexDirection: i % 2 === 1 ? "row-reverse" : "row" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem", flexShrink: 0, width: 80, paddingTop: "0.5rem" }}>
                    <div style={{
                      width: 56, height: 56, borderRadius: "50%", fontSize: "1.3rem",
                      border: `2px solid ${c.color}`, background: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: `0 6px 20px ${c.border}`
                    }}>{c.icon}</div>
                    <span style={{ fontFamily: "monospace", fontSize: "0.58rem", color: "#9D94AE", textTransform: "uppercase", letterSpacing: "0.1em" }}>{ph.phase || `Phase ${i + 1}`}</span>
                  </div>
                  <div style={{
                    flex: 1, background: "#fff", border: `1px solid rgba(124,92,191,0.1)`,
                    borderRadius: 16, padding: "1.35rem 1.6rem", position: "relative", overflow: "hidden",
                    boxShadow: "0 2px 14px rgba(90,60,140,0.05)"
                  }}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: c.color }} />
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                      <div style={{ fontFamily: "monospace", fontSize: "0.56rem", color: "#9D94AE", textTransform: "uppercase", letterSpacing: "0.14em" }}>{ph.phase || `Phase ${i + 1}`}</div>
                      {ph.duration && (
                        <div style={{ fontFamily: "monospace", fontSize: "0.62rem", color: c.color, background: c.bg, border: `1px solid ${c.border}`, borderRadius: 100, padding: "0.15rem 0.6rem" }}>⏱ {ph.duration}</div>
                      )}
                    </div>
                    <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "1.1rem", fontWeight: 700, color: "#241F35", margin: "0.3rem 0 0.4rem" }}>{ph.title}</div>
                    <div style={{ height: 1, background: "rgba(124,92,191,0.08)", margin: "0.55rem 0" }} />
                    {ph.goal && <p style={{ fontSize: "0.82rem", color: "#564E6E", lineHeight: 1.65, marginBottom: "0.7rem", fontStyle: "italic" }}>🎯 {ph.goal}</p>}
                    {ph.topics?.length > 0 && (
                      <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.28rem", marginBottom: "0.85rem" }}>
                        {ph.topics.map((f, j) => (
                          <li key={j} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.77rem", color: "#564E6E" }}>
                            <span style={{ color: c.color, fontSize: "0.7rem" }}>▸</span>{f}
                          </li>
                        ))}
                      </ul>
                    )}
                    {ph.howToStudy && (
                      <p style={{ fontSize: "0.78rem", color: "#564E6E", lineHeight: 1.6, marginBottom: "0.8rem" }}>
                        <strong style={{ color: "#241F35" }}>How to study this: </strong>{ph.howToStudy}
                      </p>
                    )}
                    {ph.resourceTypes?.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                        {ph.resourceTypes.map((r, j) => (
                          <span key={j} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8, padding: "0.3rem 0.65rem", fontSize: "0.68rem", fontFamily: "monospace", color: c.color }}>{r}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {roadmap.tips?.length > 0 && (
            <div style={{
              maxWidth: 700, margin: "2.5rem auto 0", background: "#fff",
              border: "1px solid rgba(124,92,191,0.15)", borderRadius: 16,
              padding: "1.2rem 1.5rem", boxShadow: "0 2px 14px rgba(90,60,140,0.06)"
            }}>
              <div style={{ fontSize: "0.62rem", color: "#9D94AE", textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: "monospace", marginBottom: "0.6rem" }}>Study Tips</div>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {roadmap.tips.map((t, i) => (
                  <li key={i} style={{ display: "flex", gap: "0.6rem", fontSize: "0.84rem", color: "#564E6E", lineHeight: 1.6 }}>
                    <span style={{ color: "#7C5CBF" }}>💡</span>{t}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {!researchData && !roadmap && !loading && !err && (
        <div style={{ maxWidth: 480, margin: "0 auto", textAlign: "center", color: "#9D94AE", fontSize: "0.85rem" }}>
          Tip: type a topic above, or go research one from the home page and come back here.
        </div>
      )}
    </div>
  );
}

// ─── AUTH PAGE (Login + Register) — powered by Appwrite ──────────
function AuthPage({ onBack, onSuccess, defaultTab = "register" }) {
  const { user, login, register, authError, setAuthError } = useAuth();
  const [tab, setTab]           = useState(defaultTab); // "register" | "login"
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [success, setSuccess]   = useState("");

  // If a session is already active (e.g. user navigated here by mistake,
  // or reopened this tab), just take them onward instead of showing a
  // login form that would fail with "session is active".
  useEffect(() => {
    if (user) {
      const t = setTimeout(() => (onSuccess || onBack)(), 0);
      return () => clearTimeout(t);
    }
  }, [user, onBack, onSuccess]);

  // Clear error when switching tabs
  const switchTab = (t) => { setTab(t); setAuthError(""); setSuccess(""); };

  const finish = () => { (onSuccess || onBack)(); };

  const handleSubmit = async () => {
    if (user) { finish(); return; }
    if (!email || !password) return;
    if (tab === "register" && !name) return;
    setLoading(true);
    setSuccess("");

    let ok;
    if (tab === "register") {
      ok = await register(email, password, name);
      if (ok) {
        setSuccess("Account created! Taking you to research...");
        setTimeout(finish, 1200);
      }
    } else {
      ok = await login(email, password);
      if (ok) {
        setSuccess("Welcome back! Loading...");
        setTimeout(finish, 800);
      }
    }
    setLoading(false);
  };

  const inputStyle = {
    width: "100%", padding: "0.62rem 0.9rem", borderRadius: 9,
    border: "1.5px solid rgba(124,92,191,0.18)", background: "#F9F7F4",
    fontFamily: "Inter,sans-serif", fontSize: "0.84rem", color: "#241F35",
    outline: "none", boxSizing: "border-box", transition: "border-color 0.2s"
  };

  return (
    <div style={{ minHeight: "100vh", background: "#ECE7DF", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
      <div style={{
        background: "#fff", borderRadius: 26, overflow: "hidden",
        display: "flex", width: "100%", maxWidth: 860, minHeight: 540,
        boxShadow: "0 20px 60px rgba(90,60,140,0.14)"
      }}>
        {/* ── Left decorative panel ── */}
        <div style={{
          flex: 1, background: "linear-gradient(150deg,rgba(124,92,191,0.08) 0%,#F2EAFB 45%,rgba(242,166,160,0.1) 100%)",
          padding: "2.5rem", display: "flex", flexDirection: "column", justifyContent: "space-between",
          position: "relative", overflow: "hidden"
        }}>
          <Orb style={{ width: 220, height: 220, background: "rgba(124,92,191,0.1)", top: -40, right: -40 }} />
          <Orb style={{ width: 120, height: 120, background: "rgba(242,166,160,0.15)", bottom: 60, left: -30 }} />
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "1rem", fontWeight: 700, color: "#684CA3" }}>
            Nex<span style={{ color: "#7C5CBF" }}>us</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}>
            <div style={{
              width: 90, height: 90, borderRadius: 18,
              background: "linear-gradient(135deg,#7C5CBF,#E0827A)",
              animation: "cubeFloat 4s ease-in-out infinite",
              boxShadow: "0 18px 50px rgba(124,92,191,0.3)"
            }} />
          </div>
          <div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "1.15rem", fontWeight: 700, color: "#684CA3", lineHeight: 1.3 }}>
              Research smarter.<br />Learn faster.
            </div>
            <div style={{ fontSize: "0.8rem", color: "#564E6E", marginTop: "0.35rem" }}>
              {tab === "register" ? "Create your free account in seconds." : "Welcome back to Nexus AI."}
            </div>
          </div>
          <style>{`@keyframes cubeFloat{0%,100%{transform:rotate(14deg) skewX(-4deg)}50%{transform:rotate(14deg) skewX(-4deg) translateY(-12px)}}`}</style>
        </div>

        {/* ── Right form panel ── */}
        <div style={{ flex: 1.1, padding: "2.5rem 2.25rem", display: "flex", flexDirection: "column", justifyContent: "center" }}>

          {/* Tab switcher */}
          <div style={{ display: "flex", gap: 0, marginBottom: "1.75rem", background: "#F4F1EC", borderRadius: 12, padding: 4 }}>
            {[["register","Create Account"], ["login","Sign In"]].map(([t, lbl]) => (
              <button key={t} onClick={() => switchTab(t)} style={{
                flex: 1, padding: "0.55rem", borderRadius: 9, border: "none",
                background: tab === t ? "#fff" : "transparent",
                fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.82rem", fontWeight: tab === t ? 600 : 400,
                color: tab === t ? "#241F35" : "#9D94AE", cursor: "pointer",
                boxShadow: tab === t ? "0 1px 6px rgba(90,60,140,0.1)" : "none",
                transition: "all 0.2s"
              }}>{lbl}</button>
            ))}
          </div>

          {/* Error / Success banners */}
          {authError && (
            <div style={{ background: "#FFF0F0", border: "1px solid rgba(200,100,92,0.3)", borderRadius: 10, padding: "0.6rem 0.9rem", marginBottom: "1rem", fontSize: "0.8rem", color: "#C8645C" }}>
              {authError}
            </div>
          )}
          {success && (
            <div style={{ background: "#F0FAF5", border: "1px solid rgba(90,158,143,0.3)", borderRadius: 10, padding: "0.6rem 0.9rem", marginBottom: "1rem", fontSize: "0.8rem", color: "#5C9E8F" }}>
              {success}
            </div>
          )}

          {/* Name field — only on register tab */}
          {tab === "register" && (
            <div style={{ marginBottom: "0.85rem" }}>
              <label style={{ fontSize: "0.74rem", fontWeight: 500, color: "#564E6E", display: "block", marginBottom: "0.3rem" }}>Full Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Jyoti Sharma" style={inputStyle} />
            </div>
          )}

          {/* Email */}
          <div style={{ marginBottom: "0.85rem" }}>
            <label style={{ fontSize: "0.74rem", fontWeight: 500, color: "#564E6E", display: "block", marginBottom: "0.3rem" }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"
              onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }}
              style={inputStyle} />
          </div>

          {/* Password */}
          <div style={{ marginBottom: "1.2rem" }}>
            <label style={{ fontSize: "0.74rem", fontWeight: 500, color: "#564E6E", display: "block", marginBottom: "0.3rem" }}>Password</label>
            <div style={{ position: "relative" }}>
              <input
                type={showPwd ? "text" : "password"}
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder={tab === "register" ? "Min. 8 characters" : "Your password"}
                onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }}
                style={{ ...inputStyle, paddingRight: "2.2rem" }}
              />
              <span onClick={() => setShowPwd(!showPwd)} style={{ position: "absolute", right: "0.7rem", top: "50%", transform: "translateY(-50%)", cursor: "pointer", fontSize: "0.85rem", color: "#9D94AE" }}>
                {showPwd ? "🙈" : "👁"}
              </span>
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              width: "100%", padding: "0.75rem", borderRadius: 11,
              background: loading ? "#B8A0E0" : "#7C5CBF",
              border: "none", color: "#fff", fontFamily: "'Space Grotesk',sans-serif",
              fontSize: "0.88rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer",
              transition: "background 0.2s"
            }}>
            {loading ? "Please wait..." : tab === "register" ? "Create Account" : "Sign In"}
          </button>

          {/* Switch hint */}
          <div style={{ textAlign: "center", marginTop: "0.85rem", fontSize: "0.76rem", color: "#9D94AE" }}>
            {tab === "register"
              ? <>Already have an account? <span onClick={() => switchTab("login")} style={{ color: "#7C5CBF", cursor: "pointer", fontWeight: 500 }}>Sign in</span></>
              : <>Don't have an account? <span onClick={() => switchTab("register")} style={{ color: "#7C5CBF", cursor: "pointer", fontWeight: 500 }}>Create one</span></>
            }
          </div>

          <button onClick={onBack} style={{ display: "block", textAlign: "center", marginTop: "0.6rem", background: "none", border: "none", fontSize: "0.74rem", color: "#9D94AE", cursor: "pointer" }}>
            ← Back to Research
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── LIBRARY PAGE (Saved & Bookmarks) ────────────────────────────
function LibraryPage({ user, onBack, onOpen }) {
  const uid = user?.$id || "guest";
  const [tab, setTab] = useState("saved");
  const [saved, setSaved] = useState(() => getLibrary("saved", uid));
  const [bookmarks, setBookmarks] = useState(() => getLibrary("bookmarks", uid));

  const items = tab === "saved" ? saved : bookmarks;

  const remove = (id) => {
    const updated = removeFromLibrary(tab, uid, id);
    if (tab === "saved") setSaved(updated); else setBookmarks(updated);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F4F1EC", padding: "5rem 2rem 4rem" }}>
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 200,
        padding: "0.9rem 2.5rem", display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "rgba(244,241,236,0.88)", backdropFilter: "blur(18px)",
        borderBottom: "1px solid rgba(124,92,191,0.1)"
      }}>
        <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "1.2rem", fontWeight: 700, color: "#241F35" }}>
          Nex<span style={{ color: "#7C5CBF" }}>us</span>
        </span>
        <button onClick={onBack} style={{
          background: "transparent", border: "1.5px solid rgba(124,92,191,0.25)",
          color: "#564E6E", padding: "0.45rem 1.1rem", borderRadius: 100,
          fontSize: "0.82rem", cursor: "pointer"
        }}>← Back</button>
      </nav>

      <div style={{ textAlign: "center", marginBottom: "2.5rem", marginTop: "1.5rem" }}>
        <div style={{
          display: "inline-block", fontFamily: "monospace", fontSize: "0.7rem", letterSpacing: "0.2em",
          color: "#7C5CBF", textTransform: "uppercase", marginBottom: "0.75rem"
        }}>Your Library</div>
        <h1 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "clamp(1.9rem,4vw,3rem)", fontWeight: 700, color: "#241F35", letterSpacing: "-0.03em" }}>
          Saved & Bookmarked Research
        </h1>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto 2rem", display: "flex", gap: "0.4rem", background: "#fff", padding: 4, borderRadius: 12, border: "1px solid rgba(124,92,191,0.12)" }}>
        {[["saved", `☆ Saved (${saved.length})`], ["bookmarks", `🔖 Bookmarked (${bookmarks.length})`]].map(([t, lbl]) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: "0.6rem", borderRadius: 9, border: "none",
            background: tab === t ? "#7C5CBF" : "transparent",
            color: tab === t ? "#fff" : "#564E6E",
            fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.82rem",
            fontWeight: 600, cursor: "pointer", transition: "all 0.2s"
          }}>{lbl}</button>
        ))}
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
        {items.length === 0 && (
          <div style={{ textAlign: "center", color: "#9D94AE", fontSize: "0.85rem", padding: "2rem" }}>
            Nothing here yet. Go research a topic and hit {tab === "saved" ? "☆ Save" : "🔖 Bookmark"} to add it.
          </div>
        )}
        {items.map(item => (
          <div key={item.id} style={{
            background: "#fff", border: "1px solid rgba(124,92,191,0.1)", borderRadius: 14,
            padding: "1rem 1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between",
            boxShadow: "0 2px 14px rgba(90,60,140,0.05)", gap: "1rem"
          }}>
            <div style={{ overflow: "hidden", cursor: "pointer" }} onClick={() => onOpen(item)}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.95rem", fontWeight: 700, color: "#241F35" }}>{item.title}</div>
              <div style={{ fontSize: "0.72rem", color: "#9D94AE", marginTop: 3 }}>
                {new Date(item.savedAt).toLocaleDateString()} · {item.data?.summary?.slice(0, 90)}{item.data?.summary?.length > 90 ? "…" : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
              <button onClick={() => onOpen(item)} style={{
                background: "rgba(124,92,191,0.08)", border: "1px solid rgba(124,92,191,0.2)",
                color: "#684CA3", borderRadius: 8, padding: "0.4rem 0.75rem", fontSize: "0.74rem", cursor: "pointer"
              }}>Open</button>
              <button onClick={() => remove(item.id)} style={{
                background: "rgba(200,100,92,0.08)", border: "1px solid rgba(200,100,92,0.2)",
                color: "#C8645C", borderRadius: 8, padding: "0.4rem 0.6rem", fontSize: "0.74rem", cursor: "pointer"
              }}>✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ROOT APP ────────────────────────────────────────────────────
export default function App() {
  const { user, loading: authLoading, logout } = useAuth();

  const [page, setPage]               = useState("landing");
  const [query, setQuery]             = useState("");
  const [loadStep, setLoadStep]       = useState(0);
  const [researchData, setResearchData] = useState(null);
  const [history, setHistory]         = useState([]);
  const [error, setError]             = useState("");
  const [pendingQuery, setPendingQuery] = useState("");

  // While Appwrite is checking the session, show a spinner
  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F4F1EC" }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", border: "3px solid rgba(124,92,191,0.2)", borderTopColor: "#7C5CBF", animation: "spin 0.9s linear infinite" }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  const runSearch = async (q) => {
    // If not logged in, remember what they wanted to search and send them to auth first
    if (!user) { setPendingQuery(q); setPage("signup"); return; }

    setQuery(q);
    setError("");
    setLoadStep(0);
    setPage("loading");

    for (let i = 0; i < PHASES.length; i++) {
      await sleep(520);
      setLoadStep(i);
    }

    try {
      const data = await generateResearch(q);
      if (!data) throw new Error("parse");
      setResearchData(data);
      setHistory(h => [q, ...h.filter(x => x !== q)].slice(0, 12));
      setPage("results");
    } catch {
      setError("Research failed. Check your backend is running and try again.");
      setPage("landing");
    }
  };

  // Called once login/register succeeds. If they were trying to search
  // something before being asked to log in, pick that search back up.
  const handleAuthSuccess = () => {
    if (pendingQuery) {
      const q = pendingQuery;
      setPendingQuery("");
      runSearch(q);
    } else {
      setPage("landing");
    }
  };

  const handleLogout = async () => {
    await logout();
    setResearchData(null);
    setQuery("");
    setHistory([]);
    setPage("landing");
  };

  if (page === "loading") return <LoadingOverlay step={loadStep} query={query} />;

  if (page === "results" && researchData) {
    return (
      <ResultsPage
        data={researchData}
        query={query}
        history={history}
        onBack={() => setPage("landing")}
        onNewSearch={runSearch}
        onNav={p => setPage(p)}
        user={user}
        onLogout={handleLogout}
      />
    );
  }

  if (page === "roadmap") {
    return (
      <RoadmapPage
        query={query}
        researchData={researchData}
        onBack={() => setPage(researchData ? "results" : "landing")}
      />
    );
  }

  if (page === "library") {
    return (
      <LibraryPage
        user={user}
        onBack={() => setPage(researchData ? "results" : "landing")}
        onOpen={(item) => {
          setResearchData(item.data);
          setQuery(item.query || item.title);
          setHistory(h => [item.query || item.title, ...h.filter(x => x !== (item.query || item.title))].slice(0, 12));
          setPage("results");
        }}
      />
    );
  }

  // Auth pages — "signup" shows register tab, "login" shows login tab
  if (page === "signup") return <AuthPage onBack={() => { setPendingQuery(""); setPage("landing"); }} onSuccess={handleAuthSuccess} defaultTab="register" />;
  if (page === "login")  return <AuthPage onBack={() => { setPendingQuery(""); setPage("landing"); }} onSuccess={handleAuthSuccess} defaultTab="login" />;

  // LANDING PAGE
  return (
    <>
      {error && (
        <div style={{
          position: "fixed", top: "1rem", left: "50%", transform: "translateX(-50%)",
          background: "#fff", border: "1px solid rgba(200,100,92,0.3)", borderRadius: 10,
          padding: "0.65rem 1.2rem", fontSize: "0.82rem", color: "#C8645C", zIndex: 999,
          boxShadow: "0 4px 16px rgba(200,100,92,0.15)"
        }}>{error}</div>
      )}
      <LandingPage onSearch={runSearch} onNav={setPage} user={user} onLogout={handleLogout} />
    </>
  );
}
