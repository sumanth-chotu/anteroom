# Presentation Material

Raw material for the final presentation, captured as it happens. **Not** a finished deck —
this is the quarry we cut slides from. Bias toward over-capturing.

---

## The one-line pitch

> Radar is an AI seed investor that reads your deck, forms an opinion before you speak,
> interrogates you under real pressure — then shows you what it was thinking before you
> walked in.

---

## The problem (slide 1 material)

Founders get roughly one shot per investor. They practice by pitching friends, who are
unqualified and — more importantly — **too kind to be useful**. The feedback that would
actually change the outcome ("you lost me at minute four, and here's the sentence where it
happened") is exactly the feedback nobody gives them.

Meanwhile the single highest-leverage thing in a real pitch happens before the founder says a
word: the investor skims the deck for four minutes and forms most of their opinion. Founders
never find out what that opinion was.

---

## What makes this non-obvious

The naive version — "an LLM that asks VC questions" — is a weekend build with no value. Any
model generates "What's your TAM?" forever. Six things are actually hard, and each one is a
design decision worth a slide:

| Hard thing | Our answer |
|---|---|
| An investor who already has an opinion | Pre-read: 5-pass deck analysis before the call |
| Reading the *slides*, not scraped text | Per-slide vision — the unlabeled axis is the signal |
| Questions from *your* numbers | Live claim ledger + deterministic contradiction checks |
| Questions from *your market* | Mined X reply threads → category objections |
| Refusing to be a pushover | Isolated grader, adversarial pass, deterministic floors |
| Feedback specific enough to act on | Evidence-quoted rubric, timestamped clips |

---

## The two ideas worth the most airtime

### 1. The community's objections are the investor's questions

> The replies under a competitor's launch are a free, crowd-sourced list of the sharpest
> skeptical questions about a category — very close to the list a seed investor will ask you.

When an AI-SDR tool launches and the replies are *"this is a GPT wrapper"* and *"deliverability
will kill you"*, those aren't just tweets — they're two questions the founder will face in a
real meeting. A generic LLM asks textbook questions. One that has read the reaction to every
launch in your category asks **this month's** questions.

*Demo framing:* show the raw reply thread, then the compiled investor question beside it.

### 2. Founders never see what the investor thought beforehand

The **pre-read memo** is an artifact that has never existed. The **posture delta** is the
payoff:

> **Going in**, I thought your weak point was distribution.
> **Coming out**, distribution is fine — you answered that well at 08:12.
> But I'm **more worried about retention** than when I started, because at 14:30 you gave me a
> signup number when I asked how many people came back.

That maps onto the only two things a founder needs to know: **what you fixed in the room, and
what you made worse.**

---

## Cheapest high-signal feature: the one-liner test

Generate two one-sentence summaries of what the company does — one from **slide 1 alone**, one
from **the whole deck** — and show the founder both, verbatim.

- Whole-deck version wrong or vague → the deck failed. No explanation needed.
- The two diverge → the opening slide misrepresents the company.

*Great live demo: it takes five seconds and needs zero setup to understand.*

---

## Architecture (diagram slide)

Five loops, five latency budgets — the core insight is that **only one of them is
latency-bound**:

| Loop | When | Budget | Does |
|---|---|---|---|
| 0 — Category brief | Weekly, offline | none | Mine X for competitor events + objections |
| A — Pre-read | Before the call | 60–120s | 5-pass deck vision → memo, probes, posture |
| 1 — Conversation | Live | **p50 < 500ms** | `grok-voice-latest` realtime |
| 2 — Ledger | Async, in-session | ~1s | Claim capture + contradiction checks |
| 3 — Analysis | After hangup | 30–90s | Consensus grading, posture delta, report |

Everything expensive was deliberately moved off the latency path. That's the whole trick.

---

## Anti-sycophancy (a slide on its own — it's the most interesting engineering)

An AI investor impressed by a mediocre pitch is **actively harmful** — it sends a founder into
a real meeting overconfident. We treat it as a correctness bug, not a tone preference:

1. Grader isolation — never sees the persona prompt or the word "encouraging"
2. Adversarial pre-read pass — *"you want to say no; make the case"* runs **before** synthesis
3. Evidence-or-nothing — unquotable praise is dropped in post-processing
4. Anchored rubrics, not open 1–5 scales
5. Forced negative ordering — two weakest moments before any strength
6. Deterministic floors — non-answer rate >30% caps Specificity at 2, regardless of the model
7. Consensus grading — 3 runs, median per dimension

---

## Numbers to fill in as we go

- [ ] Voice round-trip latency, p50 / p95
- [ ] Pre-read wall-clock for a 20-slide deck
- [ ] Cost per session (text/vision) — estimated ~$1–1.50
- [ ] Cost per category brief refresh — estimated ~$7
- [ ] Eval: contradiction detection rate on adversarial founders
- [ ] Eval: generic-question rate (target <20%)
- [ ] Eval: score stability across 5 runs
- [ ] Eval: deck issue detection rate on planted-flaw decks

---

## Demo script (draft — refine as features land)

1. Upload a real seed deck
2. **Show the pre-read memo** — including `caseForNo`, before any conversation happens
3. **The one-liner test** — "here's what your deck actually says you do"
4. Start the voice pitch; investor opens with a deck-specific question
5. Founder contradicts a slide → investor catches it live
6. Founder says "no real competitors" → investor names four, with what they raised
7. Hang up → posture delta + annotated deck + the moment you lost them

---

## Moments worth capturing (fill in during the build)

<!-- Screenshots, transcript excerpts, things that broke, surprising outputs.
     Add them the moment they happen — they cannot be reconstructed later. -->

- **2026-08-08** — Dev machine had no Node runtime at all. Minor, but a real reminder that
  "check the toolchain before assuming the stack runs" applies even on a developer laptop.
