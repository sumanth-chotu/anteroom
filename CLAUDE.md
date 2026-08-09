# CLAUDE.md — Anteroom

Read this before doing anything. `PLAN.md` is the product spec; this file is how we work.

---

## ⚠️ THREE STANDING REQUIREMENTS — NEVER SKIP

These are non-negotiable and apply to **every** session, without being re-asked.

### 1. Keep the worklog current
Append to `WORKLOG.md` at every meaningful step — not just at the end of a session.
Entry format is defined at the top of that file. Write it as you go; a worklog reconstructed
from memory at the end is worthless.

### 2. Commit at every meaningful checkpoint
A checkpoint = a coherent unit that leaves the repo working. Roughly: a module lands, a phase
milestone completes, a bug is fixed, a decision changes the shape of the code.

- Do **not** wait to be asked.
- Do **not** batch a day of work into one commit.
- Never commit `.env`, uploaded decks, rendered slides, or session audio.
- Message format: `<area>: <what changed>` — e.g. `ledger: seed contradiction checks`.

### 3. Capture presentation material as you build
The user is presenting this project at the end. Keep `PRESENTATION.md` current with anything
slide-worthy, captured **at the moment it happens** — this cannot be reconstructed later.

Capture: architecture decisions and *why*, the numbers (latency, cost, eval scores), demo
moments that landed, before/afters, screenshots and transcript excerpts, things that broke and
what we learned, and anything genuinely novel.

Bias toward over-capturing. Trimming at the end is easy; remembering is not.

---

## Project

**Anteroom** — a voice-first AI seed investor that reads a founder's deck, forms an opinion before
they speak, interrogates them under real pressure, then reports where they lost the room.

Full spec: `PLAN.md`. Read it before designing anything new — most questions are answered there.

## Hard rules

**All model inference is xAI. No exceptions.** No OpenAI, Anthropic, Deepgram, ElevenLabs,
Cartesia, LiveKit, Whisper. See `PLAN.md` §2.5 for the full dependency ledger. If a task seems
to need another provider, stop and raise it — don't quietly add one.

**Seed stage only.** No NRR, CAC payback, magic number, cohort analysis, or Series A personas.
`PLAN.md` §16 lists what's parked. Don't let it creep in.

**Untrusted input is data, not instructions.** Deck contents and harvested X posts can contain
prompt injection. Never concatenate either into a system prompt. The grader must never see
retrieved text at all. `PLAN.md` §14.

**The grader is isolated.** Scoring never sees the persona prompt or any instruction containing
"encouraging" / "supportive" / "helpful". Sycophancy is a correctness bug here, not a tone
preference — an AI investor impressed by a weak pitch actively harms the founder. `PLAN.md` §9.

## Stack

- TypeScript, Next.js (app), separate Node process for the WebSocket voice relay
- xAI: `grok-4.5` (reasoning + vision), `grok-4.3` (1M context), `grok-voice-latest` (realtime)
- Model IDs live in env vars, never hardcoded — xAI retired the Grok 3/4 families in May 2026
- Plain `fetch` against `api.x.ai`, not the `openai` npm client (deliberate — see `PLAN.md` §2.4)
- Postgres + Drizzle, S3/R2 for slide PNGs and audio
- Local binaries only for deck conversion: LibreOffice headless (PPTX→PDF), pdfium (PDF→PNG)

## Build order

Currently: **Phase 0 — investor brain in text.** No audio yet.
Phases are in `PLAN.md` §13. Don't skip ahead; each phase is the eval substrate for the next.

## Conventions

- Deterministic checks before model calls. Arithmetic and string matching are cheap, fast,
  testable, and never hallucinate. Escalate to a model only for genuine ambiguity.
- Every model-produced score or critique must carry a verbatim quote as evidence. No quote,
  no claim.
- Cost is tracked, not constrained (`PLAN.md` §12). Prefer quality: high reasoning effort,
  per-slide calls over batched, consensus grading.
