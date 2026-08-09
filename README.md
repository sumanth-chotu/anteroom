# Anteroom

**An AI seed investor that reads your deck, forms an opinion before you speak, interrogates you
under real pressure, then shows you what it was thinking before you walked in.**

Founders get roughly one shot per investor. They practise by pitching friends, who are
unqualified and — more importantly — too kind to be useful. Anteroom is not kind.

```
deck  ─▶  pre-read memo  ─▶  live pitch (voice or text)  ─▶  what changed
          "here's what I         claims tracked,              "going in I thought X.
           think already"        contradictions caught         coming out, Y."
                                 mid-conversation
```

---

## Quick start

```bash
git clone git@github.com:sumanth-chotu/anteroom.git
cd anteroom
brew install node poppler          # macOS; see Prerequisites for Linux
npm install
cp .env.example .env               # then paste your xAI key into it
npm run smoke                      # verifies the key works
npm run ui                         # → http://localhost:4317
```

In the UI: click **sample deck**, then **+ market**, then **New session**.
Answer a couple of questions and hit **Debrief**.

---

## Prerequisites

| Requirement | Why | Install |
|---|---|---|
| **Node ≥ 22** | Runs TypeScript directly via `--experimental-strip-types`. No build step. | `brew install node` |
| **poppler** (`pdftoppm`) | Renders deck PDFs to PNG for the vision pass. **Required for anything deck-related.** | `brew install poppler` · `apt install poppler-utils` |
| **xAI API key** | All model inference. | [console.x.ai](https://console.x.ai) → API Keys |
| LibreOffice *(optional)* | Only needed to upload `.pptx` / `.odp`. PDFs work without it. | `brew install --cask libreoffice` |
| Google Chrome *(optional)* | Only to regenerate the fixture deck from HTML. | — |
| A microphone *(optional)* | Only for live voice mode. Everything else runs headless. | — |

Verified on macOS with Node 26. Nothing is macOS-specific except the `brew` commands and the
Chrome path in `fixture:deck`.

---

## Setup

**1. Install dependencies.** Two runtime packages only — `ws` and `zod`.

```bash
npm install
```

**2. Configure the environment.**

```bash
cp .env.example .env
```

Then edit `.env` and set your key:

```ini
XAI_API_KEY=xai-...
```

Everything else has working defaults. Model IDs are env vars, never hardcoded — xAI retired the
Grok 3/4 families in May 2026, so pinning them in one place matters:

```ini
XAI_BASE_URL=https://api.x.ai/v1
XAI_MODEL_REASONING=grok-4.5        # vision, grading, per-slide critique
XAI_MODEL_LONG_CONTEXT=grok-4.3     # whole-deck / whole-corpus passes (1M window)
XAI_MODEL_VOICE=grok-voice-latest   # realtime speech-to-speech
```

> `.env` is gitignored and has never been committed. Keep it that way.

**3. Verify the key works.**

```bash
npm run smoke
```

Checks chat, reasoning effort, schema-constrained structured output, and the long-context model.
If this fails, nothing else will work.

---

## Running it

### The UI — everything in one place

```bash
npm run ui        # http://localhost:4317
```

A glass-box panel: conversation on the left, every piece of machinery on the right — live
coverage, the claim ledger, contradictions as they fire, market objections, metrics and cost.

| Button | What it does |
|---|---|
| **sample deck** | Loads the bundled deck + its precomputed pre-read, instantly. *Shift-click* to re-run the full five-pass pipeline live (~80s). |
| **+ market** | Loads a category brief mined from X discussion. |
| **New session** | Starts a text pitch with the selected investor. |
| **🎙 Voice** | Real-time spoken pitch. Needs a mic. |
| **▶ Auto demo** | Two AI agents pitch each other — no human needed. Produces a downloadable script. |
| **Debrief** | Re-runs the investor's assessment and diffs it against the pre-read. |

### Command line

```bash
# Text pitch. --list shows all seven investors.
npm run pitch -- --list
npm run pitch -- skeptic --debug
npm run pitch -- skeptic --deck fixtures/decks/planted-flaws/deck.pdf --brief fixtures/briefs/*.json

# Analyse a deck: per-slide vision, one-liner test, deck score
npm run deck -- fixtures/decks/planted-flaws/deck.pdf

# The pre-read memo — what the investor thinks before you speak
npm run preread -- fixtures/decks/planted-flaws/deck.pdf --save

# Mine X for what a market objects to (~2-3 min)
npm run brief -- "real-time payment fraud detection" --competitors "Sift,Forter" --save

# Two AI agents pitch each other → markdown script + .wav in .tmp/demos/
npm run duo -- --turns 6 --deck fixtures/decks/planted-flaws/deck.pdf

# Diagnostics
npm run probe:realtime     # inspect the live xAI realtime contract
npm run probe:relay        # end-to-end voice relay check (server must be running)

npm test                   # 43 unit tests, no API calls, instant
npm run typecheck
```

### The investors

`npm run pitch -- --list`

| Alias | Who | Kills you on |
|---|---|---|
| `generalist` | Fred Wilson, USV | Founder-market fit, why-now |
| `skeptic` | Bill Gurley, Benchmark | Unit economics, inflated numbers |
| `angel` | Elad Gil | The moat, "we use AI" hand-waving |
| `thesis` | Marc Andreessen, a16z | "Why isn't this ten times bigger?" |
| `accelerator` | Michael Seibel, YC | Abstraction, no user contact |
| `solo` | Jason Calacanis, LAUNCH | Distribution, founder brand |
| `blowhard` | Erlich Bachman *(fictional)* | Whether you can hold the room |

Real investors are portrayed as **publicly documented interviewing styles**, not as themselves.
Every prompt carries an accuracy guardrail, every profile carries a disclaimer, and nothing said
is a real quote. See `src/investor/persona.ts`.

---

## How it works

Five loops, and **only one is latency-bound** — which is the whole trick.

| Loop | When | Budget | Does |
|---|---|---|---|
| 0 · Category brief | Weekly, offline | none | Mines X for what a market objects to |
| A · Pre-read | Before the call | 60–120s | Five-pass deck vision → memo, probes, posture |
| 1 · Conversation | Live | **p50 < 500ms** | `grok-voice-latest` over WebSocket |
| 2 · Ledger | In-session | ~1s | Captures claims, catches contradictions, steers the investor |
| 3 · Analysis | After hangup | 30–90s | Posture delta, metrics, report |

Everything expensive is deliberately off the latency path.

**Deterministic before model.** Contradiction checks are arithmetic and set logic — cheap,
instant, unit-tested, and incapable of hallucinating. A model is only asked about genuine
ambiguity. A *false* finding is worse than a missed one: it discredits every true finding.

Full design rationale is in **[PLAN.md](PLAN.md)**.

---

## Repository

```
src/
  xai/          client (plain fetch, usage accounting) + Agent Tools search
  deck/         PDF → PNG → per-slide vision critique → deck score
  preread/      five-pass memo, planned probes, posture, posture delta
  investor/     personas, seed spine, question engine, satisfaction gate
  ledger/       claim model + deterministic contradiction checks
  category/     X mining → objection themes → compiled investor questions
  voice/        realtime protocol, relay, two-agent demo
  session/      orchestration + deterministic metrics
  server/       dev server, WS routing, glass-box UI
fixtures/       eval deck with authored flaws, a brief, a pre-read
```

| Doc | |
|---|---|
| [PLAN.md](PLAN.md) | Product spec and design rationale |
| [CLAUDE.md](CLAUDE.md) | Working agreements and hard rules |
| [WORKLOG.md](WORKLOG.md) | What was built, why, and every bug worth remembering |
| [PRESENTATION.md](PRESENTATION.md) | Demo material and numbers |
| [DEMO.md](DEMO.md) | Three-minute video shot list |

---

## Troubleshooting

**`Required tool "pdftoppm" not found`** — `brew install poppler`. Needed for any deck work.

**`Required tool "soffice" not found`** — only for `.pptx`. Either
`brew install --cask libreoffice`, or export your deck to PDF first.

**`Missing required env var XAI_API_KEY`** — you skipped `cp .env.example .env`, or the scripts
were run without `--env-file=.env`. Use the `npm run` scripts; they pass it.

**Voice connects but nobody speaks** — check the server log. Each session logs every lifecycle
transition with elapsed time and traffic counters, so a silent drop is readable there.

**Voice mode does nothing at all** — the browser blocks microphone access on insecure origins.
`http://localhost` is treated as secure; a LAN IP is not.

**`+ market` or `sample deck` 404s** — the bundled fixtures are missing. Rebuild them:
`npm run brief -- "<category>" --save` and `npm run preread -- <deck> --save`.

**Port 4317 in use** — `PORT=4318 npm run ui`.

---

## Cost

Cost is tracked, not constrained — quality is the optimisation target. Measured:

| | |
|---|---|
| Text pitch session (~11 turns) | **~$0.07** |
| Pre-read, 8-slide deck | **~$0.17** · ~78s |
| Category brief | **~$23** · ~150s — cached per category, shared across founders |
| Voice | **unknown** — the realtime API reports no token usage; dashboard only |

The brief figure uses xAI's own `cost_in_usd_ticks`, assuming 1e9 ticks = $1. That conversion is
inferred, not documented — confirm against your dashboard before relying on it.

---

## Scope

Seed stage only. No NRR, CAC payback, magic number or cohort analysis — those are Series A
questions and are deliberately out (`PLAN.md` §16).

All model inference is xAI. No OpenAI, Anthropic, Deepgram, ElevenLabs, Cartesia or LiveKit
anywhere. Deck conversion runs on local binaries so founders' confidential decks never transit a
third party. Full dependency ledger in `PLAN.md` §2.5.
