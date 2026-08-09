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

---

## 2026-08-08 — Testing UI (glass-box instrument panel)

**Phase:** 0 · **Commit:** pending

**What:** `npm run ui` → http://localhost:4317. Two panes: conversation on the left, every
piece of machinery exposed live on the right.

- `src/server/server.ts` — plain Node HTTP server, in-memory sessions, per-session lock
- `src/server/view.ts` — explicit view model (SessionState holds Sets that don't serialize)
- `src/server/public/index.html` — single self-contained page, vanilla JS, no build step

Panel shows: profile card with behavioural dials and provenance · live spine coverage
(satisfied / asking / dodged / unasked) · findings with severity and probe text · claim ledger ·
room control (chaotic profiles only) · deterministic metrics · token usage and estimated cost.
Conversation turns are annotated inline — layer tag on investor turns, verdict + extracted
claims on founder turns.

**Why plain Node over Next.js.** No build step, no new dependencies, and session state lives in
the same process as the engine so there's no serialization boundary to debug. More importantly
Phase 2 needs a long-lived process for the WebSocket relay anyway (PLAN.md §2.3) — which Vercel
serverless could not host. This server becomes that host. Next.js can wrap the founder-facing
product later; this is the instrument panel, not the product.

The view model is built explicitly rather than by serializing `SessionState`: it holds Sets and
would silently JSON.stringify to `{}`, and keeping it explicit stops the UI depending on engine
internals that are still moving.

Turns are serialized per session with a promise lock — a double-submit would interleave two
`founderTurn` calls and corrupt engine state.

**Learned:** seeing the layer tags inline makes engine behaviour legible in a way the CLI
`--debug` output never did. Watching `spine → spine → contradiction` fire in sequence, with the
claim chips appearing on the turn that caused it, is the whole system explaining itself.

**Next:** adversarial founder eval suite, then Phase 1 (deck ingestion + pre-read).

---

## 2026-08-08 — Named investors with faces

**Phase:** 0 · **Commit:** pending

**What:** Every profile is now a named real public investor with an illustrated face, title,
firm and bio. Fred Wilson (USV), Bill Gurley (Benchmark), Elad Gil (angel), Marc Andreessen
(a16z), Michael Seibel (YC), Jason Calacanis (LAUNCH), and Erlich Bachman (fictional).

`src/investor/persona.ts` holds identity; `profiles.ts` keeps behaviour. Deliberately split —
the behavioural dials can be tuned without touching anything that makes a claim about a real
person.

**Why this shape.** I initially built fictional identities and recommended them. The user chose
real names, which is their call for their own tool, so three things carry the weight instead:

1. **`identityGuardrail()`** is injected *ahead of* every real-person prompt, before any
   behavioural instruction can start filling gaps with invention. Stay inside publicly expressed
   views · invent no biography, deals or colleagues · say nothing the person would object to ·
   never claim to be deciding on behalf of the real firm · don't discuss real third parties
   critically.
2. **`DISCLAIMER` is surfaced everywhere** a profile appears — CLI header, UI profile card,
   exported JSON. Not a footer.
3. **Bios state only publicly known facts.** Firm, role, what they are known for. Nothing
   inferred.

**Faces are generated SVG, not photographs.** Photographs belong to the photographers who took
them and licensing can't be verified, so these are flat caricatures parameterised on hair,
glasses and beard — recognisable at 40px, obviously illustrative, never passing as a photo.
`photoUrl` on `Persona` takes precedence if licensed photography is ever dropped in.

**Learned:** identity in the prompt does more for realism than temperament ever did. Andreessen
opened, unprompted, with *"Software is eating the world—again—and the only question is which
teams actually capture the next wave instead of watching it. Why are you the ones who win this
market?"* Nothing in the behavioural profile asked for that framing — it came from knowing who
it was.

**Next:** adversarial founder eval suite, then Phase 1 (deck ingestion + pre-read).

---

## 2026-08-08 — Phase 1a: deck ingestion + visual analysis

**Phase:** 1 · **Commit:** pending

**What:** `npm run deck -- <file>`. PDF/PPTX/image → PNG per slide → per-slide vision critique →
deterministic checks → one-liner test → deck score.

- `deck/ingest.ts` — pdftoppm at 200 DPI; LibreOffice for PPTX; clear `MissingToolError` naming
  the brew command when a binary is absent
- `deck/vision.ts` — one `grok-4.5` call per slide, typed `SlideIssue` enum, concurrency 4
- `deck/analyse.ts` — missing sections, density, cross-slide numbers, one-liner test, score
- `fixtures/decks/planted-flaws/` — an eval deck with authored ground truth

**Why one call per slide** rather than one batched call for the deck: a batched call skims, and
the whole point is catching what a skim misses — the missing y-axis label, the 7px footnote, the
logo wall where half are pilots. Cost is not a constraint here (PLAN.md §12).

**Why deck numbers go through the *existing* ledger checks** rather than a parallel deck check
system: the seed failure modes are identical — design partner vs paying customer does not change
because it is printed rather than spoken — and it means deck-vs-spoken contradiction detection
falls out for free once a session starts.

**Verified empirically before building:** xAI vision wants OpenAI-style
`{type:'image_url', image_url:{url}}`, **not** the `input_image` blocks the guide shows. Minimum
image dimension is 8px. Worth an API probe rather than a guess.

**Result on the planted-flaw fixture: 7 of 7 flaws detected** — unlabeled axis, logo soup, the
7px buried caveat, top-down TAM, text wall, missing competition slide, unsourced statistic.

**The one-liner test worked exactly as designed:**
- slide 1 → *"Sentinel is an AI-powered intelligence platform for modern teams."*
- whole deck → *"…scores online payment transactions in under 200ms to accept, review, or decline
  them before settlement."*

The divergence *is* the finding, and it needs no explanation to land.

**Learned — two bugs the first real run exposed, both false positives:**

1. **"Stated headcount as 4 and 2 for the same period."** Slide 8 says "four engineers and two
   go-to-market hires" — both normalise to `headcount`, and got compared. Fixed with a rule
   worth keeping: **two numbers stated in the same breath are a breakdown, not a
   contradiction.** A contradiction now requires claims from different origins (turn or slide).
   Three tests encode it.
2. **Comprehension scored 4 despite the one-liner test failing.** Only the whole-deck sentence
   fed the score, so the divergence — the actual signal — was invisible. Now both halves feed
   it, and divergence emits its own high-severity finding.

Both are the same failure class flagged in PLAN.md §14: a false finding discredits every true
one, so precision matters more than recall here.

**Measured:** 8-slide deck, 24.6s wall clock, 18 model calls, 58k in / 3.1k out.

**Next:** the five-pass pre-read memo (planned probes, posture, caseForNo), wiring it into the
session opening, and deck UI.

---

## 2026-08-08 — Phase 1b: the pre-read memo

**Phase:** 1 · **Commit:** pending

**What:** `npm run preread -- <deck>` and `npm run pitch -- <profile> --deck <deck>`.

Five passes: per-slide vision → cross-slide checks → (category priors, Phase 4) → **adversarial
case-for-no** → synthesis. Produces understood/confused, ranked red flags, `caseForNo` verbatim,
4–6 ranked planned probes, and an initial posture.

Wired into the session: deck claims seed the ledger *before* turn one, planned probes become
question layer 4, and posture modulates warmth and patience.

**Why pass 4 runs before pass 5, strictly.** The case for declining is an *input* to synthesis,
not a sibling of it. Forcing an explicit best-case-for-no before the memo is written is what
stops it reading like a summary by someone who wants to like the company. It produced:
*"Skip this one. Traction is mostly optics: slide 4 leads with 12 design partners and a 40% WoW
curve on an unlabeled axis, while slide 5's logo grid is footnoted as pilots and slide 8 admits
only 8 paying customers today."*

**Why deck claims seed the ledger before the first word.** It makes the opening turn a
deck-derived contradiction. On the fixture the investor opened with *"40% growth on 8 customers
is three people. Give me the absolute paying numbers month by month"* — before the founder said
anything. That is the demo.

**Probe ordering:** contradiction → derail → follow-up → **planned probe** → spine. After
follow-up deliberately (finish the thread you are on), ahead of spine (what the deck made you
want to ask beats a generic checklist item).

**Learned — a subtle bug only a live session surfaced.** `findingKey` was keyed on claim ids.
As the founder revised a number the check re-fired against the *new* claim, produced a fresh
key, and asked the same question again: *"40% growth on 8 is three people, give me the monthly
numbers"* … three turns later … *"40% growth on 4 is two people, give me the monthly numbers."*
Same question, and it reads as not listening — the one thing an investor never does. Now keyed
on kind + metrics, which are stable across revisions. Two tests encode it.

**Measured:** pre-read on an 8-slide deck — 26 calls, 68k in / 5.3k out, **~$0.17**, ~40s.
Posture came out `LOOKING FOR THE NO` on the deliberately weak fixture, which is correct.

**Next:** deck upload + memo panel in the UI, then the posture delta (§6.6).
