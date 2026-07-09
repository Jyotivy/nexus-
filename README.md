# Nexus — AI Research Assistant

Nexus is a full-stack AI research assistant that turns any topic into a
structured, study-ready package: a live-source-grounded summary, key terms,
exam-style notes, a conversational chat grounded in the same sources, and a
personalized phase-by-phase study roadmap for actually learning the topic.

**🔴 Live demo:** [https://YOUR-LIVE-URL.vercel.app](https://YOUR-LIVE-URL.vercel.app)
*(replace this with your real Vercel URL once deployed)*

---

## ✨ Features

- 🔎 **Live research** — pulls real, current sources for any topic using the Exa search API
- 🧠 **AI summary** — Groq (LLaMA 3.3 70B) turns raw sources into a clean summary + key points
- 📝 **Structured study notes** — Definition, Advantages, Disadvantages, Applications, Key Terms
- 💬 **Source-grounded chat** — ask follow-up questions, answers stay grounded in the researched sources
- 🗺️ **Personalized study roadmap** — a 4-phase plan (foundations → concepts → practice → mastery) generated specifically for the topic you researched, with what to study, how to study it, and what kind of resources to look for
- 🔐 **Authentication** — email/password auth via Appwrite
- ☆ **Save & 🔖 Bookmark** — keep research sessions for later, view them all in one library view
- ⬇️ **Downloadable PDF study notes** — export any topic's notes as a real PDF

## 🛠️ Tech Stack

**Frontend:** React, custom CSS-in-JS (no framework), jsPDF
**Backend:** Node.js, Express
**Auth:** Appwrite
**AI:** Groq API (LLaMA 3.3 70B)
**Search:** Exa API

## 📂 Project Structure

This is a monorepo — one repo, both frontend and backend, deployed separately.

```
nexus/
├── nexus-frontend/     → React app (deploy on Vercel)
├── nexus-backend/      → Express API (deploy on Render)
└── README.md           → you are here
```

## 🚀 Running locally

**Backend:**
```bash
cd nexus-backend
npm install
cp .env.example .env   # fill in your real EXA_API_KEY and GROQ_API_KEY
npm start
```
Runs on `http://localhost:5000`.

**Frontend:**
```bash
cd nexus-frontend
npm install
cp .env.example .env   # fill in REACT_APP_BACKEND_URL
npm start
```
Runs on `http://localhost:3000`.

You'll also need an Appwrite project set up with Email/Password auth enabled,
and your deployed domain added under **Appwrite → Settings → Platforms**.

## ☁️ Deployment

Both services deploy from this same repo, using each platform's **Root
Directory** setting:

| Service  | Platform | Root Directory   |
|----------|----------|-------------------|
| Backend  | Render   | `nexus-backend`   |
| Frontend | Vercel   | `nexus-frontend`  |

**Backend env vars (Render):** `EXA_API_KEY`, `GROQ_API_KEY`, `PORT`
**Frontend env vars (Vercel):** `REACT_APP_BACKEND_URL` (your Render backend URL)

## 📸 Screenshots

*(Add a screenshot or two here — landing page, results page, roadmap —
they make a portfolio repo look a lot more finished)*

---

Built as a personal/academic project exploring full-stack AI product design —
frontend UX, backend API design, third-party AI/search API integration, and auth.
