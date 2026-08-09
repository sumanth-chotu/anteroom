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
- [x] **Cost per text session: ~$0.07** (34 calls, 32.7k in / 1.7k out, 37% cache hit)
- [ ] Cost per session with vision/pre-read — estimated ~$1–1.50
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

### 2026-08-08 — First working session. Transcript excerpts (real output, unedited)

Adversarial founder: fraud-detection startup, planted contradiction — *12 design partners*
early, *12 paying customers* later.

**The satisfaction gate escalating on its own.** Nothing prompts it to count dodges; the
follow-up counter feeds back into the directive and this emerges:

> *"You're dodging. Twice now I've asked what changed in the last twelve months — answer that,
> not who you sell to."*
> *"That's the third dodge. Name the specific model, API, or cost drop after 2022…"*
> *"Fourth dodge. Name the model or API and the per-transaction inference cost in 2022 versus
> today — actual numbers."*

**The money shot — ledger catches the planted conflation live:**

> *"You've called the same 12 both design partners and paying customers. How many of them
> actually pay you?"*

**Small-base growth, resolved to absolutes automatically:**

> *"40% on 12 is five customers. Give me absolute numbers month by month, not the percentage."*

**Graceful abandonment** (added after the first run showed it pressing forever):

> *"You never gave me the three numbers on paying customers, so I'm moving on."*

**Scorecard on that founder:** non-answer rate 55%, hand-wave rate 45%, 2 contradictions caught,
12 claims captured. No praise offered anywhere in the session.

### Slide idea: "Three bugs only a live run could find"

Good material — all three are quality bugs unit tests would have passed:

1. **False contradiction** from a catch-all metric bucket. Lesson: *a false positive is worse
   than a false negative* — it discredits every other finding.
2. **"Asked" reported as "covered"** — told the founder they'd handled a topic they dodged.
   Precisely the miscalibration the product exists to prevent.
3. **Follow-up loop never let go** — burned a whole session on one topic. The fix produced the
   best line in the transcript.

---

## Slide: investor profiles (and the one that steals the show)

Seven profiles, three kinds — **synthetic** composites, **derived** styles distilled from
public investor behaviour, and one **character**.

**The naming decision is worth a beat on stage.** Derived profiles model a *pattern*, never a
named person: a simulation is a caricature, not a prediction, and putting fabricated quotes in
a real investor's mouth is both inaccurate and a legal problem at ship time. Every profile
carries provenance. The system supports named real people; that is deliberately a launch
decision, not an engineering default. *Good answer to have ready — someone will ask.*

### The incubator blowhard — a joke that turned into a feature

The serious profiles test whether your **answers** hold up. The blowhard tests whether you can
hold the **room**. That is a different skill, it is under-practised, and plenty of real
meetings genuinely go this way.

Real unedited output:

> *"Retention. When I sold my company — eight figures if you count the earnout the way any
> rational person would — half the team stuck around for the pizza and left the second the wire
> cleared, which taught me more about loyalty than any board deck ever did. I still think about
> that closing dinner at the old Boulevard, the one with the bad wine and the guy from Sequoia
> who never called me back."*

The "accidentally sharp, then ruins it" quirk firing on its own:

> *"Never got a straight answer on why now, but fine. When I sold my company — eight figures if
> you squint — the whole room disagreed with me until the wire hit."*

**It has its own metric.** Room control, judged after every derail:
`reclaimed` / `partial` / `followed`, scored `(reclaimed + 0.5 × partial) / judged`. Politely
engaging a tangent at length and never returning counts as **followed** — charm is not control.

**The number that lands:** in that session the blowhard had a **talk ratio of 0.3:1** — he
talked three times more than the founder. The entire premise, in one measurement. Coverage told
the rest: 2 topics asked, both dodged, 5 never reached. The meeting was wasted, and the debrief
says so plainly.

*Demo idea: run the same founder answers through `skeptic` and `blowhard` back to back. Same
input, two completely different failure modes, two different metrics.*

---

## Slide: the testing UI — the system explaining itself

`npm run ui` → glass-box instrument panel. Conversation left, machinery right.

**This is the best live demo in the project**, because it makes the engine legible. You watch
`spine → spine → contradiction` fire in sequence, with the claim chips that caused it appearing
on the founder turn two messages earlier. Nothing has to be explained — it's visible.

What the panel exposes live:

| Section | Shows |
|---|---|
| Profile | Behavioural dials (warmth, derailment, self-regard) + provenance disclaimer |
| Coverage | All 8 spine topics: satisfied ✓ / asking › / dodged ✗ / unasked · |
| Findings | Contradictions with severity bar and the exact probe generated |
| Claim ledger | Every number captured, normalized to canonical metrics |
| Room control | Chaotic profiles only — reclaimed / partial / followed |
| Metrics | Non-answer rate, hand-wave rate, hedges, talk ratio |
| Usage | Calls, tokens, cache hits, estimated cost — live |

**Demo sequence that works** (verified end to end):

1. Pick **The incubator blowhard** → opening turn: *"Sit down, sit down. Reminds me of the first
   pitch I took after my exit — tiny deal, changed everything, Marc almost came by my place
   once. Anyway. Why you?"*
2. Answer: *"Six years at Stripe. We have 12 design partners in production."*
   → chips appear: `answered · concrete`, `design partners = 12`. Coverage ticks to ✓.
3. Answer: *"All 12 of those design partners are paying customers now, and we grew 40% WoW."*
   → chips: `dodged · concrete`, `customers paying = 12`, `growth rate wow = 40%`
   → **two findings appear in the panel at the same moment**
4. Investor turn tagged **CONTRADICTION**: *"You've called the same 12 both design partners and
   paying customers. Are those the same 12 — and how many of them actually pay you?"*

Four messages from cold start to the money shot, with the panel showing exactly why it happened.

**Architecture note worth one line on the slide:** deliberately a plain Node server, not
Next.js. Phase 2's WebSocket voice relay needs a long-lived process that Vercel serverless
cannot host — so the testing UI is already running on the infrastructure the voice loop will
need.

---

## Slide: the cast

Seven named investors, each with a face, a firm and a documented interviewing style.

| Archetype | Investor | Kills you on |
|---|---|---|
| Warm generalist | **Fred Wilson**, USV | Founder-market fit, why-now |
| Cold skeptic | **Bill Gurley**, Benchmark | Unit economics, inflated numbers |
| Technical | **Elad Gil**, angel | The moat, "we use AI" hand-waving |
| Thesis-driven | **Marc Andreessen**, a16z | "Why isn't this ten times bigger?" |
| Rapid-fire operator | **Michael Seibel**, YC | Abstraction, no user contact |
| Solo / online | **Jason Calacanis**, LAUNCH | Distribution, founder brand |
| Chaos | **Erlich Bachman** *(fictional)* | Whether you can hold the room |

Andreessen's unprompted opening line, verbatim:

> *"Software is eating the world—again—and the only question is which teams actually capture the
> next wave instead of watching it. Why are you the ones who win this market?"*

Nothing in the behavioural profile asked for that framing. It came from the model knowing who it
was — **identity in the prompt did more for realism than temperament ever did.**

### Have this answer ready — someone will ask about the real names

Three concrete safeguards, worth naming on the slide because they show judgement:

1. **Accuracy guardrail injected ahead of every prompt** — stay inside publicly expressed views,
   invent no biography or deals, say nothing the person would object to, never claim to decide
   on behalf of the real firm.
2. **Disclaimer surfaced everywhere** the profile appears — CLI, UI card, exported session JSON.
   Not buried in a footer.
3. **Faces are generated SVG caricatures, never photographs.** Photos belong to the
   photographers who took them. A `photoUrl` field exists if licensed imagery is ever obtained.

Bios state only publicly known facts — firm, role, what they're known for.

---

## Slide: the deck reads the deck

`npm run deck -- deck.pdf` — PDF → PNG per slide → one vision call per slide.

**Why vision and not text extraction:** `pdf-to-text` throws away everything an investor
actually reacts to. The unlabeled y-axis. The 7px footnote. The wall of logos where half are
pilots. None of it survives as text.

### The one-liner test — the cheapest high-signal feature in the product

Two sentences, generated separately, shown side by side:

> **from slide 1:** *"Sentinel is an AI-powered intelligence platform for modern teams."*
> **from the whole deck:** *"Sentinel is a real-time AI platform that scores online payment
> transactions in under 200ms to accept, review, or decline them before settlement."*

The divergence *is* the finding. The title slide is not describing the company, and it takes no
explanation for a founder to see it. **Five seconds of demo, zero setup.**

### Eval result: 7 of 7 planted flaws detected

The fixture deck has authored ground truth — every flaw is a detection assertion:

| Planted | Caught |
|---|---|
| Unlabeled y-axis on the growth chart | ✓ |
| Logo soup labelled "our customers" | ✓ |
| 7px caveat: "not all are paying" | ✓ |
| Top-down TAM ("1% of $50B") | ✓ |
| 136-word text wall | ✓ |
| No competition slide at all | ✓ |
| Unsourced "costs billions" statistic | ✓ |

8 slides, 24.6 seconds, 18 model calls.

### The engineering story worth telling: two false positives

Both found by the first real run, both passing unit tests:

1. **"Stated headcount as 4 and 2."** The slide said "four engineers and two go-to-market
   hires" — both normalise to `headcount`. Fixed with a rule that generalises: **two numbers
   stated in the same breath are a breakdown, not a contradiction.**
2. **Comprehension scored 4 while the one-liner test was visibly failing** — only half the test
   fed the score.

The through-line: **a false finding is worse than a missed one.** It discredits every true
finding, and this product is nothing if the founder stops believing it.

---

## Slide: the pre-read — the artifact nobody has seen

A real investor forms most of their opinion in the four minutes they skim your deck. **Founders
never learn what that opinion was.** This is it.

Five passes. The ordering matters: the **case for declining is written before the memo**, and
fed into it as an input. That is the anti-sycophancy control at this stage — it stops the memo
reading like a summary by someone who wants to like the company.

Real output, unedited:

> **Walking in:** `LOOKING FOR THE NO`
>
> **The case for passing** *(written before anything else)*
> *"Skip this one. Traction is mostly optics: slide 4 leads with '12 design partners' and a 40%
> WoW curve on an unlabeled axis, while slide 5's logo grid is footnoted as pilots/trials and
> slide 8 admits only 8 paying customers today. Real-time fraud scoring is a crowded
> knife-fight; this deck doesn't show me why they win it."*
>
> **What I'm going to ask you** *(6 ranked probes)*
> 1. *"Slide 5 titles eight logos 'Our customers' with a footnote that includes pilots and design
>    partners, and slide 8 says eight paying today — are those the same eight?"*
> 2. *"The slide 4 curve is labeled volume scored but has no y-axis numbers — what was weekly
>    volume at the left edge versus now, and is that 40% on a base near the eight paying?"*

### The moment that makes the demo

With the deck attached, the investor opens **before the founder speaks**:

> *"40% growth on 8 customers is three people. Give me the absolute paying numbers month by
> month."*

Deck claims are seeded into the ledger at session start, so the founder can contradict slide 4
with their opening sentence — and get caught for it. In testing they did: claimed "all 12 are
paying", then "about four have signed", and the ledger caught both.

**Posture is derived, not configured.** The weak fixture deck produced `LOOKING FOR THE NO`,
which then made the investor colder and less patient for the whole session. Sessions stop
feeling identical because the deck changes the room.

**Cost:** ~$0.17 and ~40s for an 8-slide deck. Entirely off the latency path — it runs before
the founder joins.

### One more bug worth telling

`findingKey` was keyed on claim ids. When the founder revised a number, the check re-fired
against the new claim with a fresh key — and asked the same question again three turns later.
**An investor who repeats a question reads as not listening**, the one thing they never do.
Fixed by keying on metrics, which are stable across revisions.

---

## Slide: the posture delta — what you fixed, what you made worse

Re-run the investor's assessment after the meeting, diff it against the pre-read. Real output:

> **SKEPTICAL ↓ LOOKING FOR THE NO**
> *"The only live diligence thread — paid demand — moved from an already-soft '8 paying' to
> 4 × $4k and an immediate headcount contradiction, so traction is less bankable than before the
> meeting."*
>
> ● → ● **paid customers / traction credibility**
> *Got worse: founder cut '8 paying' to 'four of the twelve pay us', then on the next beat could
> not reconcile whether design partners were 12 or 8 when challenged.*
>
> ● → ● **team** — *never came up*

**It moves in both directions.** On another run `team` went concern → strength off one sentence
while four other things darkened. A delta that only ever darkens is as broken as one that only
brightens — and "never came up" is reported as its own outcome, because an unaddressed concern
is a missed opportunity, not a resolution.

**Isolated like the grader** — the delta call never sees the persona prompt or the word
"encouraging."

### The full demo, now one click

`npm run ui` → **sample** → wait ~80s → **New session** → answer → **Debrief**

1. Pre-read memo appears *before any conversation exists* — posture, the case for passing, six
   ranked probes with slide references
2. Start the session: the investor opens with a deck-derived contradiction
3. Answer; watch claim chips and findings appear live
4. Debrief: the posture delta

**Phase 1 complete.** Deck ingestion → per-slide vision → one-liner test → deck score →
five-pass pre-read → seeded ledger → planned probes → posture → posture delta → UI.

---

## Slide: voice

`wss://api.x.ai/v1/realtime` · speech-to-speech · PCM16 24 kHz · **first audio ~1.0s**

> *"I'm Bill Gurley with Benchmark. What's the business?"* — spoken, from the same persona
> definition the text mode uses.

### The relay isn't plumbing — it's Loop 2

The xAI key can't live in the browser, so a relay sits in the middle regardless. Since it's
there, it does the work:

```
browser ──ws──▶ relay ──wss──▶ xAI realtime
                  │
                  ├─ watches note_claim tool calls
                  ├─ feeds the claim ledger
                  ├─ runs deterministic contradiction checks
                  └─ injects a system message back into the LIVE session
```

**A contradiction detected in code becomes a spoken question, mid-conversation.**

### Verifying instead of assuming — the docs were wrong twice

I probed the live socket before writing the client. Two things would have cost a day each:

- Default voice is `xai_ara`, **not** the documented "eve"
- `turn_detection` defaults to **null** — server VAD is off unless you ask, so the agent would
  simply never respond to speech

Audio format isn't in the docs at all; it came from the cookbook (PCM16 / 24 kHz / mono).

### The latency constraint that forced a design decision

`note_claim` fires mid-sentence and the model **blocks on the tool result** — so the voice path
cannot afford the model call the text path uses to normalise metric labels. That produced
`ledger/normalise.ts`: deterministic keyword matching, ordered most-specific-first so "paying
customers" never collapses into "customers". If those two ever merged, the conflation check goes
blind and the product's signature catch stops working.

**A latency budget changing an architectural decision — a good, concrete engineering story.**

### The cost question, finally answered

`usage` on `response.done` is `{}`. **The realtime API reports no token counts.** Voice cost is
dashboard-only; there is no programmatic path. Worth stating as a finding rather than an open
question.

---

## Slide: the demo runs itself

`npm run duo` — or the **Auto demo** button. An AI founder pitches the AI investor. Two
`grok-voice-latest` sessions, different voices, audio piped between them. Out comes a markdown
script and a .wav.

**10 turns · 123s of audio · 44s wall clock · 9 claims captured · 3 contradictions caught.**

Real excerpt, unedited:

> **Bill:** *"I've read the deck. Slide five shows eight logos labeled our customers, but the
> footnote mentions pilots and design partners. Slide eight says eight paying today. Are those
> the same eight?"*
>
> **Maya:** *"Of those, four are actually paying — four thousand a month each. The other eight
> are unpaid design partners. Slide eight's eight paying was a mistake on our end."*
>
> *[ledger fires: the same number (8) described as both customers paying and design partners]*
>
> **Bill:** *"40% growth on four is two more. Give me the absolute numbers month by month
> instead of the percentage."*

That last line is the **ledger steering the conversation** — a contradiction caught in
deterministic code, injected into a live voice session, and spoken.

### Why the founder is good at their job

A strawman founder makes a boring demo *and* a useless test — the investor catches everything on
turn one and there's no arc. Maya knows her numbers and concedes cleanly when pressed. The first
version was *too* honest: she volunteered the four/eight split unprompted, the ledger never
fired, and the demo had no money moment. Tightening her to lead with the flattering framing took
contradictions from **zero to four**.

**Tuning the adversary is part of building the eval.**

### Three bugs, all found by running it

1. Founder too honest → no contradictions to catch
2. `revenue per paying customer` normalised to a customer *count* — $4,000 compared against 4
   customers
3. A turn spent entirely on silent tool calls produced no speech, and the other agent timed out
   waiting

Plus one thing learned by testing rather than assuming: `role: "system"` items are *accepted*
but merely acknowledged (*"Understood. What's the play?"*). `role: "user"` with a bracketed
direction actually redirects. Not documented anywhere.
