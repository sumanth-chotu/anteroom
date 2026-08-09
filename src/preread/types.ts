/**
 * The pre-read. (PLAN.md §6)
 *
 * A real investor skims your deck for four minutes and walks in with a mental
 * model, three things to dig into, and one or two things that already bother
 * them. They do not discover you live. An AI that starts from a blank slate is
 * simulating an interview, not a pitch.
 *
 * The memo is also a shippable artifact in its own right: founders have never
 * seen what an investor thought before the meeting.
 */

import type { Claim } from '../ledger/types.ts';
import type { DeckAnalysis, DeckSection, SlideCritique } from '../deck/types.ts';

/**
 * How the investor walks in. Modulates warmth and patience for the session, so
 * a weak deck means an already-impatient investor — which is what happens in
 * reality, and stops every session feeling identical.
 */
export type Posture = 'leaning_in' | 'neutral' | 'skeptical' | 'looking_for_the_no';

export const POSTURE_LABEL: Record<Posture, string> = {
  leaning_in: 'Leaning in',
  neutral: 'Neutral',
  skeptical: 'Skeptical',
  looking_for_the_no: 'Looking for the no',
};

/** Warmth multiplier and patience multiplier applied to the profile's dials. */
export const POSTURE_EFFECT: Record<Posture, { warmth: number; patience: number }> = {
  leaning_in: { warmth: 1.25, patience: 1.3 },
  neutral: { warmth: 1.0, patience: 1.0 },
  skeptical: { warmth: 0.75, patience: 0.75 },
  looking_for_the_no: { warmth: 0.5, patience: 0.55 },
};

export interface RedFlag {
  /** Ranked: 1 is what bothers them most. */
  rank: number;
  summary: string;
  slideNumbers: number[];
  /** Why this specifically matters at seed. */
  whyItMatters: string;
}

export type ProbeOrigin = 'slide' | 'contradiction' | 'missing' | 'category_prior';

export interface PlannedProbe {
  id: string;
  topic: string;
  question: string;
  origin: ProbeOrigin;
  slideRef?: number;
  /** 1 = ask first. */
  priority: number;
  /** Filled in post-session — becomes report material. */
  resolved?: 'satisfied' | 'dodged' | 'unasked';
}

export interface PreReadMemo {
  generatedAt: string;
  deckPath: string;
  slideCount: number;

  /** §5.6 — the one-liner test. */
  oneLinerFromSlide1: string;
  oneLinerFromFullDeck: string;

  /** What came across clearly. */
  understood: string[];
  /** What did not. */
  confused: string[];
  missingSections: DeckSection[];

  /** Deck-sourced claims, seeded into the session ledger before a word is said. */
  claims: Claim[];
  slideCritiques: SlideCritique[];

  redFlags: RedFlag[];
  /** From the category brief. Empty until Phase 4. */
  priors: string[];

  /**
   * Pass 4, verbatim. The strongest case against investing, written BEFORE
   * synthesis — this is the anti-sycophancy control at the pre-read stage
   * (PLAN.md §9.2).
   */
  caseForNo: string;

  plannedProbes: PlannedProbe[];
  initialPosture: Posture;
  postureReason: string;

  deckScore: DeckAnalysis['score'];
  /** Wall-clock and token cost of generating this memo. */
  cost: { seconds: number; calls: number; promptTokens: number; completionTokens: number };
}
