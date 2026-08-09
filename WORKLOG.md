# Worklog

Running log of what got built, why, and what we learned. Newest entries at the bottom.

**Entry format**
```
## YYYY-MM-DD — <short title>
**Phase:** <phase> · **Commit:** <sha or pending>
What: <what was built>
Why: <the decision behind it, if there was one>
Learned: <anything surprising — omit if nothing was>
Next: <immediate next step>
```

---

## 2026-08-08 — Project setup

**Phase:** 0 (investor brain in text) · **Commit:** pending

**What:** Repo foundation. `PLAN.md` (full product spec, revised three times across the
session), `CLAUDE.md` (standing requirements + hard rules), `.gitignore`, `.env.example`,
this worklog, and `PRESENTATION.md`. Installed Node via Homebrew — the machine had no Node
runtime at all, only Python via miniconda.

**Why:** Three standing requirements were promoted into `CLAUDE.md` rather than left in chat,
so they survive across sessions: keep this worklog current, commit at every meaningful
checkpoint, and capture presentation material as it happens.

`.gitignore` was written *before* `.env` deliberately — the API key must never be committable,
not even for one commit. It also excludes `uploads/`, `storage/`, `sessions/`, and loose
`*.pdf`/`*.pptx`, because founders' decks and session audio are confidential material that
must never reach git.

**Learned:** The dev machine had no Node/npm/pnpm and no version manager — worth checking
toolchain before assuming a stack is runnable.

**Next:** Verify the xAI key works end to end (chat + vision), then scaffold the TypeScript
project and build the Phase 0 investor brain.

---

## 2026-08-08 — Planning (pre-code)

**Phase:** 0 · **Commit:** pending

**What:** Product spec went through three substantial revisions in one session:

1. **v1** — voice-first AI investor, Claude-based, generic stage.
2. **v2** — switched all inference to xAI/Grok at the user's direction. Added the category
   brief: mine X reply threads under competitors' launches and fundraises for recurring
   community objections, compile them into investor questions. Scoped hard to seed only,
   which meant rewriting the rubric and the contradiction checks (seed claims are about
   inflation and conflation — design partner vs customer vs paying customer — not unit
   economics).
3. **v3** — deck as a first-class *visual* input, plus the pre-read.

**Why (the decisions worth remembering):**

- **Vision over text extraction for decks.** `pdf-to-text` discards what investors actually
  react to: unlabeled y-axes, projections drawn as actuals, logo soup, buried footnotes. So:
  render each slide to PNG, one `grok-4.5` vision call per slide.
- **Precomputed category brief, not realtime lookups.** No latency in the voice loop, ~20×
  cheaper amortized, curatable, testable.
- **Build order changed** — deck + pre-read moved ahead of voice. Biggest jump in perceived
  intelligence, fully offline, testable in the text harness, and it makes every later phase
  better.
- **Reversed the X API recommendation.** Initially concluded it wasn't needed (Grok's built-in
  X Search covers ad-hoc lookups). Wrong for the brief corpus: reply trees and engagement
  ratios are the sentiment signal, and search-into-context doesn't carry them. Deferred to
  Phase 5 — brief v1 runs on X Search.

**Learned:** The most novel artifact in the product fell out of the pre-read rather than being
designed up front — the **posture delta**. Founders have never seen what an investor thought
before the meeting, and diffing pre-read vs post-meeting assessment answers the two things they
most need to know: what you fixed in the room, and what you made worse.

**Next:** Build it.

---

## 2026-08-08 — xAI client + toolchain verified

**Phase:** 0 · **Commit:** pending

**What:** TypeScript scaffold (no build step — Node 26 native type stripping via
`--experimental-strip-types`), `src/config.ts`, `src/xai/client.ts`, and a smoke-test CLI.
Client does chat, schema-constrained structured output, retries with backoff on 429/5xx,
typed errors, and per-stage usage accounting.

**Why:** Built usage accounting into the client from call one rather than bolting it on —
`PRESENTATION.md` needs real cost-per-session numbers, and those can't be reconstructed from a
dashboard after the fact. Every call carries a `tag` so cost is attributable by stage
(pre-read, grading, ledger).

Refusals are modeled as a distinct `XAIRefusalError` because xAI returns them as **HTTP 200**
with a populated `refusal` field — code that reads `choices[0].message.content` unconditionally
would silently produce an empty string instead of an error.

Zod validates every structured response even though the API is schema-constrained. Constrained
decoding is not a guarantee, and a silently-wrong shape downstream is worse than a throw.

**Learned:**
- Node's `--experimental-strip-types` **erases** types but cannot **transform** syntax, so TS
  parameter properties (`constructor(readonly x: string)`) throw at runtime. Fixed by declaring
  fields explicitly; `erasableSyntaxOnly: true` in tsconfig now catches it at typecheck.
- Smoke test results: chat ~1.0s · `reasoning_effort` accepted and Grok 4.5 **returns its
  reasoning trace** in `reasoning_content` · `json_schema` structured output works · prompt
  caching engaged automatically (512 of 941 prompt tokens cached across 4 calls).
- The structured-output test incidentally validated the core seed mechanic: it extracted
  `isPaying: false` from *"12 design partners, none of them pay us yet."*

**Next:** Investor brain — archetypes, seed spine, question engine, satisfaction gate.

---

## 2026-08-08 — Phase 0 investor brain running end to end

**Phase:** 0 · **Commit:** pending

**What:** The full text loop works — `ask → answer → extract claims → judge → select next move`.

- `investor/spine.ts` — eight seed topics, each with intent + satisfaction criteria
- `investor/archetypes.ts` — three seed archetypes over a shared base persona
- `investor/satisfaction.ts` — the satisfaction gate
- `investor/engine.ts` — layered question selection (contradiction → follow-up → spine)
- `ledger/extract.ts` — claim extraction normalized onto the canonical vocabulary
- `session/session.ts` — orchestrator + deterministic metrics
- `cli/pitch.ts`, `cli/input.ts` — interactive and scripted harness

**Why:** Question *selection* is deterministic and pure; only *phrasing* costs a model call.
That keeps the reasoning auditable, makes the engine unit-testable without mocking a model,
and means a bad question is traceable to either a bad layer choice or a bad prompt — never a
murky combination.

The base persona's most important rule is **do not coach**. A real investor doesn't stop
mid-pitch to explain how you should have answered, and an AI that does destroys the pressure
the founder came to practise under. All coaching goes in the post-session report where it can
be evidence-backed.

`cli/input.ts` exists because readline throws `ERR_USE_AFTER_CLOSE` when stdin is a pipe — the
stream drains to EOF while we're awaiting a model call. Rather than work around it, scripted
input became a first-class mode, which is what the adversarial-founder eval suite needs anyway.

**Learned — three bugs the first live run exposed, none of which unit tests would have caught:**

1. **False contradiction from the `other` bucket.** `other` is a catch-all, so "six years at
   Stripe" and "cheap enough about a year ago" both landed there and got compared: *"Stated
   other as 6 and 1 for the same period."* Fixed with a `NON_COMPARABLE` exclusion. Worth
   emphasising: **a false contradiction is worse than a missed one** — it discredits every
   other finding, and the product rests on findings being believable.

2. **Coverage counted "asked" as "covered".** The debrief showed ✓ on topics the founder had
   completely dodged — telling them they'd handled something they escaped, which is the exact
   miscalibration this product exists to prevent. Now three distinct states: satisfied,
   dodged, unasked.

3. **The follow-up loop never let go.** The skeptic burned four turns on one topic and the
   founder got no coverage. Now it abandons gracefully *and says so*, which turned out to
   produce the best line of the session: *"You never gave me the three numbers on paying
   customers, so I'm moving on."*

**Also learned:** the satisfaction gate is genuinely strict without being prompted to escalate —
it produced "You're dodging. Twice now…" → "That's the third dodge." → "Fourth dodge." on its
own, purely from the follow-up count being fed back in. Zero sycophancy across an 11-answer
evasive pitch.

**Measured:** 34 model calls per ~11-turn session · 32,674 prompt tokens (12,032 cached, 37%) ·
1,686 completion. Roughly **$0.07/session** at grok-4.5 rates.

**Next:** Adversarial founder eval suite, then Phase 1 (deck ingestion + pre-read).

---

## 2026-08-08 — Investor profiles + the derail mechanic

**Phase:** 0 · **Commit:** pending

**What:** Replaced the fixed three-archetype enum with a profile system. Seven profiles across
three kinds: synthetic (the original three), derived (three styles distilled from public
investor behaviour), character (the incubator blowhard). Added `derailment` and `selfRegard`
dials, a `derail` question layer, and a room-control judge.

**Why — the naming decision.** Derived profiles model an interaction *pattern*, never a named
person. A simulation is a caricature, not a prediction, and attributing fabricated quotes to a
named real investor is both inaccurate and a publicity-rights problem the moment it ships. So
profiles are named for the style ("The thesis guy"), carry a `provenance` block recording the
public material behind them, and never assert identity. The system *would* support named real
people — that is a launch decision, deliberately left out of the engineering.

**Why the meme VC is not a gag.** The serious profiles test whether your *answers* hold up. The
blowhard tests whether you can hold the *room* — a different and under-practised skill. Plenty
of real meetings go exactly this way. So it gets its own scoring axis rather than being graded
on the pitch rubric it is designed to prevent you completing.

The derail roll is **seeded on profile id + move count, not `Math.random()`** — the eval suite
replays sessions and needs identical behaviour across runs.

**Learned:** the blowhard produced better output than the serious profiles, which was not
expected. Sample: *"When I sold my company — eight figures if you count the earnout the way any
rational person would — half the team stuck around for the pizza and left the second the wire
cleared."* The "accidentally sharp, then ruins it" quirk also fired unprompted: *"Never got a
straight answer on why now, but fine."*

**Measured (blowhard session):** room control 2/2 reclaimed · **talk ratio 0.3:1** — he talked
three times more than the founder, which turns the entire premise into a single number.
Coverage told the real story: 2 topics asked, both dodged, 5 never reached. The meeting was
wasted, and the debrief says so.

**Next:** adversarial founder eval suite, then Phase 1 (deck ingestion + pre-read).
