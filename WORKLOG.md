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
