# DEMO.md — the 3-minute video

Recording plan for the demo video. Hard limit **3:00**.

Companion to `PRESENTATION.md` (which is the quarry). This file is the shot list and the
words to say.

---

## The thesis of the video

One sentence has to survive:

> **Anteroom is an investor who has already formed an opinion about you before you open your
> mouth — and can prove where you lost them.**

Everything in the cut serves that. Anything that doesn't is out, however good it is.

---

## What's in, and what's cut

Three minutes buys roughly **four scenes**. Not six. The triage:

### In

| Beat | Why it earns the seconds |
|---|---|
| **Pre-read memo** | The artifact nobody has ever seen. The case for passing, written *before* the founder speaks. No competitor has this. |
| **Category brief** | The most novel idea in the project: the replies under a competitor's launch *are* the investor's questions. 16 seconds, lands instantly. |
| **Live voice + ledger catch** | The money shot. A contradiction caught in deterministic code, injected into a live voice session, and **spoken back**. This is the centerpiece and gets the most time. |
| **Posture delta** | The payoff. "What you fixed, what you made worse." Closes the loop the pre-read opened. |

### Cut (and why — these are good, they just don't fit)

- **The seven investor profiles / the blowhard.** Genuinely the most fun material in the
  project, and a 20-second sidebar that breaks the single-session narrative. It belongs in
  the live talk, not the video.
- **Planted-flaw eval, 7/7.** Not a scene — it's a **lower-third caption** during the pre-read
  beat. Two seconds of screen text, zero seconds of voiceover.
- **Anti-sycophancy architecture.** Seven controls, all interesting, none visual. Compressed
  to one clause of narration: *"the grader never sees the persona."*
- **Auto duo (`npm run duo`).** This is a *recording tool*, not a scene — see fallback B.
- **Architecture diagram / five loops.** One line of narration over the close, no diagram.

**The discipline:** the video's job is to make someone want the demo, not to transfer the
whole design. Under-explain on purpose.

---

## Flow (shot list)

Total **180s**. Timings are targets — the voice beat is the one allowed to run long, and S2/S5
are where you cut if it does.

| # | Beat | In | Dur | On screen |
|---|---|---|---|---|
| S1 | Cold open | 0:00 | 14s | Deck upload → investor's opening line already on screen |
| S2 | The pre-read | 0:14 | 32s | Memo panel: posture, case for passing, ranked probes |
| S3 | The market knows | 0:46 | 16s | Split: raw X reply ↔ compiled investor question |
| S4 | **Live voice + the catch** | 1:02 | 80s | Voice session, claim chips, finding fires, investor speaks it |
| S5 | The debrief | 2:22 | 26s | Posture delta: fixed in the room / made worse |
| S6 | Close | 2:48 | 12s | Numbers card |

**Proportion is the message.** S4 is 44% of the runtime. If a beat has to be sacrificed to
protect it, sacrifice S2 (trim to posture + one probe) — never S4.

---

## Script

Voiceover is **~260 words**, which at a natural 150wpm leaves real silence for the product
audio to breathe. Do not fill the gaps. During S4 the agents talk and **you say almost
nothing** — that restraint is what sells it.

---

### S1 · Cold open — 0:00–0:14

**On screen:** UI already open. Drag the deck in. Cut immediately to the investor's first
line rendered on screen, before any founder message exists.

**VO:**
> Founders get one shot per investor. And most of the opinion is formed in the four minutes
> the investor spends skimming your deck — before you say a single word.
>
> They never find out what that opinion was.

**Note:** the cold open must show the investor speaking *first*. That's the whole hook: there
is no founder turn above it.

---

### S2 · The pre-read — 0:14–0:46

**On screen:** click `sample deck` — a plain click loads the **precomputed** memo instantly, so
this beat has no wait in it. Scroll slowly: posture badge → the case for passing → ranked
probes. Hold on the case for passing.

> The UI labels this as precomputed and offers shift-click to re-run the full ~80s pipeline
> live. **Leave the label in frame.** It costs nothing and it's the honest version — and a
> five-pass vision pipeline that takes 80 seconds is a *feature* (it's off the latency path),
> not something to hide.

**VO:**
> This is what it thought. Five vision passes over the slides, and the case for *declining*
> gets written first — before the memo, so the memo can't read like a summary by someone who
> wants to like you.

*(pause — let the screen carry it, ~4s)*

> It walks in **looking for the no**, and it already has six questions ranked, each tied to a
> specific slide.

**Screen text (lower-third, no VO):**
`8 slides · 24.6s · 7 of 7 planted flaws caught`

**Hold on this, verbatim:**
> *"Skip this one. Traction is mostly optics: slide 4 leads with '12 design partners' and a 40%
> WoW curve on an unlabeled axis, while slide 5's logo grid is footnoted as pilots/trials and
> slide 8 admits only 8 paying customers today."*

**Optional 6s insert if you're running fast** — the one-liner test. Two sentences side by side:
what slide 1 says you do vs what the whole deck says you do. The divergence needs no
explanation. Cut it without hesitation if S2 is over 32s.

---

### S3 · The market knows — 0:46–1:02

**On screen:** split screen. Left, the raw X post. Right, the compiled investor question.

**VO:**
> It also read the room the category is in. The replies under every competitor's launch are a
> free, crowd-sourced list of the sharpest objections in your space —

*(beat, right side appears)*

> — which is very close to the list a seed investor will ask you. Not textbook questions.
> **This month's** questions.

**Left (short excerpt, source visible on screen):** patio11 on velocity checks having been in
the literature since the 1990s and still not shipping.

**Right (verbatim, from the brief):**
> *"When a buyer already knows the checklist, what have you actually built on the real-time
> path that isn't the same signals every competent fraud team already wishes they had?"*

**Screen text:** `mined from N X posts · asked as the investor's own read, never cited`

> Full quotes and source URLs:
> `fixtures/briefs/real-time-payment-fraud-detection-for-fintechs.json`

---

### S4 · Live voice + the catch — 1:02–2:22 · **THE CENTREPIECE**

**On screen:** one continuous take. Click **🎙 Voice**. Real microphone, real speech-to-speech.
Claim chips and the finding appear inline in the transcript as it happens.

**VO (before you click, ~7s):**
> Now the actual meeting. Voice, both directions, about a second to first audio.

*(click — then stop talking)*

**INVESTOR speaks first, unprompted, deck-aware.** Do not talk over it.

**You say, as the founder — line 1:**
> "Six years at Stripe before this. We have twelve design partners in production."

*(chip appears: `design partners = 12`)*

**You say — line 2 (this is the trigger; deliver it confidently, like a founder who thinks
it's a strong line):**
> "All twelve of those design partners are paying customers now, and we grew forty percent
> week over week."

*(chips: `customers paying = 12`, `growth rate wow = 40%` — then the finding fires)*

**The investor says it out loud. This is the moment the video exists for:**
> *"You've called the same twelve both design partners and paying customers. Are those the same
> twelve — and how many of them actually pay you?"*

**VO, quietly, over the finding card (~13s):**
> Nothing asked a model whether that was a contradiction. It's arithmetic and string matching,
> running in the relay, in about a second — then injected into the live session as a system
> turn.
>
> A bug caught in deterministic code, spoken back to you mid-sentence.

**Optional, only if you have ≥15s left in the beat** — answer weakly ("about four have signed")
and let it press:
> *"40% growth on four is two more. Give me the absolute numbers month by month."*

That line is the ledger *steering* the conversation, not just flagging. Best single line in the
project — include it if time allows.

---

### S5 · The debrief — 2:22–2:48

**On screen:** click **Debrief**. Land on the posture delta. Hold on "made worse."

**VO:**
> Hang up, and it re-reads you against what it thought going in.

*(pause ~3s)*

> Not a score. Two things: what you fixed in the room, and what you made worse. It moves in
> both directions — and "never came up" is reported as its own outcome, because an unaddressed
> concern is a missed opportunity, not a pass.

**Verbatim on screen:**
> **SKEPTICAL ↓ LOOKING FOR THE NO**
> *"Traction is less bankable than before the meeting."*

---

### S6 · Close — 2:48–3:00

**On screen:** numbers card, then the one-liner.

**VO:**
> Deck to memo to voice to debrief. Every model call is xAI — Grok for vision and reasoning,
> Grok voice for the room.

**Card:**
```
pre-read      ~40s      ~$0.17
voice         first audio ~1.0s
text session  ~$0.07
grader        never sees the persona
```

**Final line, on black:**
> **Anteroom. It already has an opinion about you.**

---

## Pre-flight checklist

Run this **before** the camera rolls. Half of these are 40–80 second waits that must not
happen on screen.

- [ ] `npm test` and `npm run typecheck` — both green (43 tests as of this writing)
- [ ] `npm run fixture:deck` — sample deck PDF exists
- [ ] **Plain-click the sample deck, don't shift-click.** Since `2b48cee` a plain click serves
      the precomputed memo instantly; shift-click re-runs the full ~80s pipeline. On camera you
      want the plain click. **Never record the spinner.**
- [ ] Fixtures present (both committed as of `2b48cee`, so a clean checkout is fine):
      `fixtures/prereads/planted-flaws.json` and
      `fixtures/briefs/real-time-payment-fraud-detection-for-fintechs.json`
- [ ] `npm run ui` running, `/voice` and `/duo` both connecting
- [ ] Mic permission **already granted** in the browser — the permission dialog on camera is a
      retake
- [ ] Headphones on. Without them the investor's audio re-enters the mic and server VAD
      interrupts itself.
- [ ] Do a full voice dry run. First audio should be ~1.0s; if it's slower, the network is the
      problem, not the code.
- [ ] Rehearse the two founder lines until they're natural. They have to sound like a founder
      making a strong claim, not an actor reading a trigger.
- [ ] Browser zoom up so the claim chips and finding text are legible at video resolution.

---

## Known gap that affects the cut

**The category brief is wired into text sessions, not voice.** `+ market` loads it and the
panel renders "What this market says", and `src/voice/relay.ts` already accepts a `brief` on
`start` — but `src/server/public/voice.js` only sends `memo`, so the browser never passes it.

Consequence for the video: S3 (brief) and S4 (voice) are **different modes**, so S3 has to be a
static split-screen rather than a continuous shot into the voice session.

Closing it is small — thread `briefId` through the voice start path, same shape as `memoId`.
Worth doing if you want S3→S4 as one unbroken take, where the investor raises a mined category
objection *out loud*. That would be a materially better video.

---

## Risks and fallbacks

| Risk | Fallback |
|---|---|
| Live voice fails on the day | **B:** `npm run duo` — two AI agents, produces a `.wav` and a markdown script. Record it once as insurance *before* the real attempt. 10 turns, 44s wall clock. |
| Ledger doesn't fire on your phrasing | Use the exact rehearsed lines. Verified triggers: "twelve design partners" → "all twelve are paying customers." |
| Pre-read is slow / errors live | Largely solved — the plain click is a committed fixture, no model call. If it still fails, screen-record the memo separately and cut it in; S2 has no live interaction, so nothing is lost. |
| Over 3:00 in the edit | Cut in this order: (1) the one-liner insert, (2) the S4 follow-up line, (3) S2 down to posture + one probe. **Never cut into S4's core.** |
| Network flaky | Everything except voice can be pre-recorded. Voice cannot — protect it with fallback B. |

---

## Editing notes

- **No music under S4.** The investor's voice is the product; anything competing with it costs
  you the beat the whole video is built around.
- Let the claim chips **land before you cut**. They appear a beat after the sentence — cutting
  early destroys the causality the viewer needs to see.
- Screen text over verbatim model output should say **"unedited"** once. Claiming it and
  showing it is worth more than saying it twice.
- Cold open with **zero** setup. No logo, no title card. First frame is the product.
