import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Exa from "exa-js";
import Groq from "groq-sdk";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const exa = new Exa(process.env.EXA_API_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.get("/", (req, res) => {
  res.json({ status: "Nexus AI backend running!" });
});

// ─── RESEARCH ENDPOINT ───────────────────────────────────────────
app.post("/api/research", async (req, res) => {
  const { query } = req.body;
  if (!query || query.trim() === "") {
    return res.status(400).json({ error: "Query is required" });
  }

  try {
    console.log(`[Exa] Searching for: "${query}"`);
    const exaResults = await exa.search(query, {
      type: "auto",
      numResults: 8,
      contents: { highlights: true },
    });

    const articles = exaResults.results.map((r) => ({
      title: r.title || "Untitled",
      url: r.url,
      domain: new URL(r.url).hostname.replace("www.", ""),
      highlights: r.highlights ? r.highlights.join(" ") : "",
    }));

    const context = articles
      .map((a, i) => `[Source ${i + 1}] ${a.title}\n${a.highlights}`)
      .join("\n\n");

    console.log(`[Exa] Found ${articles.length} articles`);
    console.log(`[Groq] Generating research summary...`);

    const prompt = `You are Nexus AI, an expert research assistant for students.
Based on the following articles fetched from the web, generate structured research notes.

TOPIC: "${query}"

ARTICLES FROM WEB:
${context}

Return ONLY valid JSON with this exact structure (no markdown, no backticks, no extra text):
{
  "title": "clean topic title",
  "summary": "2-3 sentence overview of the topic",
  "keyPoints": ["point 1", "point 2", "point 3", "point 4", "point 5"],
  "terms": [
    {"name": "Term 1", "def": "definition"},
    {"name": "Term 2", "def": "definition"},
    {"name": "Term 3", "def": "definition"}
  ],
  "notes": {
    "definition": {
      "items": [
        {"title": "What it is", "desc": "explanation"},
        {"title": "Origin", "desc": "explanation"},
        {"title": "Core concept", "desc": "explanation"}
      ]
    },
    "advantages": {
      "items": [
        {"title": "Advantage 1", "desc": "explanation"},
        {"title": "Advantage 2", "desc": "explanation"},
        {"title": "Advantage 3", "desc": "explanation"}
      ]
    },
    "disadvantages": {
      "items": [
        {"title": "Disadvantage 1", "desc": "explanation"},
        {"title": "Disadvantage 2", "desc": "explanation"},
        {"title": "Disadvantage 3", "desc": "explanation"}
      ]
    },
    "applications": {
      "items": [
        {"title": "Application 1", "desc": "explanation"},
        {"title": "Application 2", "desc": "explanation"},
        {"title": "Application 3", "desc": "explanation"}
      ]
    }
  },
  "takeaway": "one sentence key takeaway for a student"
}`;

    const groqResponse = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1500,
    });

    const rawText = groqResponse.choices[0].message.content;

    let researchData;
    try {
      const cleaned = rawText.replace(/```json|```/g, "").trim();
      researchData = JSON.parse(cleaned);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        researchData = JSON.parse(match[0]);
      } else {
        throw new Error("Groq returned invalid JSON");
      }
    }

    researchData.sources = articles.slice(0, 3).map((a) => ({
      title: a.title,
      domain: a.domain,
      url: a.url,
    }));

    console.log(`[Done] Research generated for: "${query}"`);
    res.json({ success: true, data: researchData });

  } catch (error) {
    console.error("[Error]", error.message);
    res.status(500).json({
      error: "Failed to generate research. Please try again.",
      details: error.message,
    });
  }
});

// ─── CHAT ENDPOINT ───────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { topic, messages } = req.body;
  if (!messages || messages.length === 0) {
    return res.status(400).json({ error: "Messages are required" });
  }

  try {
    console.log(`[Chat] Topic: "${topic}"`);

    const groqMessages = [
      {
        role: "system",
        content: `You are Nexus AI's research chat assistant. The student has already researched "${topic}". 
Answer their follow-up questions helpfully and concisely in 2-4 sentences.
If asked to explain in Hinglish, do so naturally.
Keep answers student-friendly and easy to understand.`,
      },
      ...messages.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    ];

    const result = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: groqMessages,
      max_tokens: 400,
    });

    const reply = result.choices[0].message.content;
    res.json({ success: true, reply });

  } catch (error) {
    console.error("[Chat Error]", error.message);
    res.status(500).json({
      error: "Chat failed. Please try again.",
      details: error.message,
    });
  }
});

// ─── STUDY ROADMAP ENDPOINT ───────────────────────────────────────
// Generates a phase-by-phase plan for STUDYING the researched topic
// (not a plan for building the Nexus app itself).
app.post("/api/roadmap", async (req, res) => {
  const { topic, summary, keyPoints, terms } = req.body;
  if (!topic || topic.trim() === "") {
    return res.status(400).json({ error: "Topic is required" });
  }

  try {
    console.log(`[Roadmap] Generating study roadmap for: "${topic}"`);

    const context = `
TOPIC: "${topic}"
SUMMARY: ${summary || "N/A"}
KEY POINTS: ${(keyPoints || []).join("; ")}
KEY TERMS: ${(terms || []).map((t) => t.name).join(", ")}
`;

    const prompt = `You are Nexus AI, a study-planning assistant for a college student.
Create a personalized, phase-by-phase STUDY ROADMAP for learning the topic below.
Do NOT talk about building software or apps — this is purely a guide for a student to learn the subject itself.

${context}

Return ONLY valid JSON with this exact structure (no markdown, no backticks, no extra text):
{
  "topic": "clean topic name",
  "overview": "2-3 sentence explanation of how to approach studying this topic and roughly how long it takes to become comfortable with it",
  "phases": [
    {
      "phase": "Phase 1",
      "title": "short phase title (e.g. Build the Foundations)",
      "duration": "estimated time e.g. 3-5 days",
      "goal": "one sentence goal for this phase",
      "topics": ["sub-topic 1", "sub-topic 2", "sub-topic 3", "sub-topic 4"],
      "howToStudy": "2-3 sentences of concrete advice on how to study this phase (methods, order, practice ideas)",
      "resourceTypes": ["type of resource 1 e.g. official documentation", "type of resource 2 e.g. YouTube playlist", "type of resource 3 e.g. hands-on practice problems"]
    }
  ],
  "tips": ["practical study tip 1", "practical study tip 2", "practical study tip 3"]
}

Generate exactly 4 phases, ordered from beginner fundamentals to advanced/mastery, tailored specifically to "${topic}".`;

    const groqResponse = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1800,
    });

    const rawText = groqResponse.choices[0].message.content;

    let roadmapData;
    try {
      const cleaned = rawText.replace(/```json|```/g, "").trim();
      roadmapData = JSON.parse(cleaned);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        roadmapData = JSON.parse(match[0]);
      } else {
        throw new Error("Groq returned invalid JSON");
      }
    }

    console.log(`[Done] Roadmap generated for: "${topic}"`);
    res.json({ success: true, data: roadmapData });
  } catch (error) {
    console.error("[Roadmap Error]", error.message);
    res.status(500).json({
      error: "Failed to generate study roadmap. Please try again.",
      details: error.message,
    });
  }
});

// ─── START SERVER ────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n🚀 Nexus AI Backend running on http://localhost:${PORT}`);
  console.log(`   POST /api/research  →  Exa search + Groq summary`);
  console.log(`   POST /api/chat      →  Groq chat`);
  console.log(`   POST /api/roadmap   →  Groq study roadmap\n`);
});