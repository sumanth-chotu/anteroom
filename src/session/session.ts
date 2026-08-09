/**
 * Session orchestrator — the Phase 0 loop.
 *
 * ask → founder answers → extract claims → judge the answer → pick the next move
 *
 * Claim extraction and the satisfaction gate are independent of each other, so
 * they run concurrently. In Phase 2 this matters: both sit inside a voice turn.
 */

import { extractClaims } from '../ledger/extract.ts';
import { runChecks } from '../ledger/checks.ts';
import { addClaim, emptyLedger, type Claim, type Finding, type Ledger } from '../ledger/types.ts';
import {
  judgeAnswer,
  judgeRoomControl,
  type RoomControlVerdict,
  type SatisfactionVerdict,
} from '../investor/satisfaction.ts';
import {
  applyMove,
  coverageReport,
  initialState,
  selectMove,
  speakChecked,
  type EngineState,
  type NextMove,
  type Turn,
} from '../investor/engine.ts';
import { getProfile, isChaotic, type InvestorProfile } from '../investor/profiles.ts';
import { loadBriefing, type Briefing } from '../investor/briefing.ts';
import type { PreReadMemo } from '../preread/types.ts';
import type { CategoryBrief } from '../category/types.ts';
import { topicById } from '../investor/spine.ts';

export interface SessionTurn extends Turn {
  id: string;
  at: number;
  /** Present on investor turns. */
  layer?: NextMove['layer'];
  /** Present when this turn asked a pre-read probe. */
  probeId?: string;
  /** Present on founder turns — the verdict on that answer. */
  verdict?: SatisfactionVerdict;
  /** Investor turns: summed AI-tell weight of what shipped. 0 is clean. */
  tellScore?: number;
  /** Investor turns: the first attempt tripped the detector and was rerolled. */
  regenerated?: boolean;
  /** Investor turns: which of the investor's own convictions drove the question. */
  convictionBelief?: string;
  /** Claims extracted from a founder turn. */
  claims?: Claim[];
  /** Present when this answer followed a derail. */
  roomControl?: RoomControlVerdict;
}

export interface SessionState {
  id: string;
  profile: InvestorProfile;
  /** Present when the founder uploaded a deck before the meeting. */
  memo?: PreReadMemo;
  /** Present when a category brief has been built for this space. */
  brief?: CategoryBrief;
  engine: EngineState;
  ledger: Ledger;
  turns: SessionTurn[];
  pendingMove?: NextMove;
  /** Corpus persona + dossier, loaded once by `openSession`. */
  briefing?: Briefing;
}

/**
 * Create a session with the investor's research already loaded.
 *
 * Prefer this over `createSession`. The corpus persona and dossier are read from
 * disk once here rather than per turn, so prompt building stays synchronous and
 * the conversation path touches no I/O.
 */
export async function openSession(
  profileId: string,
  sessionId = `s${Date.now()}`,
  memo?: PreReadMemo,
  brief?: CategoryBrief,
): Promise<SessionState> {
  const session = createSession(profileId, sessionId, memo, brief);
  return { ...session, briefing: await loadBriefing(profileId) };
}

export function createSession(
  profileId: string,
  sessionId = `s${Date.now()}`,
  memo?: PreReadMemo,
  brief?: CategoryBrief,
): SessionState {
  // Deck claims are seeded into the ledger BEFORE the first word, which is what
  // makes deck-vs-spoken contradiction possible on turn one: the founder can
  // contradict slide 4 with their opening sentence and get caught for it.
  const ledger = memo
    ? { ...emptyLedger(sessionId), claims: memo.claims.map((c) => ({ ...c, sessionId })) }
    : emptyLedger(sessionId);

  const session: SessionState = {
    id: sessionId,
    profile: getProfile(profileId),
    engine: initialState(),
    ledger,
    turns: [],
  };
  if (memo) session.memo = memo;
  if (brief) session.brief = brief;
  return session;
}

let turnSeq = 0;
const nextTurnId = () => `t${++turnSeq}`;

/** Produce the investor's next utterance. */
export async function investorTurn(
  session: SessionState,
): Promise<{ session: SessionState; text: string; move: NextMove }> {
  const lastFounderTurn = [...session.turns].reverse().find((t) => t.role === 'founder');
  const move = selectMove(
    session.engine,
    session.ledger,
    session.profile,
    lastFounderTurn?.verdict,
    session.memo,
    session.brief,
    lastFounderTurn?.text,
    session.briefing?.corpus,
  );

  const spoken = await speakChecked(
    session.profile,
    session.turns.map(({ role, text }) => ({ role, text })),
    move,
    session.turns.length === 0,
    session.memo,
    session.briefing,
  );
  const text = spoken.text;

  const turn: SessionTurn = {
    id: nextTurnId(),
    role: 'investor',
    text,
    at: Date.now(),
    layer: move.layer,
    tellScore: spoken.tellScore,
    regenerated: spoken.regenerated,
  };
  if (move.probeId) turn.probeId = move.probeId;
  if (move.conviction) turn.convictionBelief = move.conviction.belief;

  return {
    session: { ...session, turns: [...session.turns, turn], pendingMove: move },
    text,
    move,
  };
}

/** Record a founder answer: extract claims, judge it, advance engine state. */
export async function founderTurn(
  session: SessionState,
  answer: string,
): Promise<{ session: SessionState; verdict: SatisfactionVerdict; newFindings: Finding[] }> {
  const lastInvestorTurn = [...session.turns].reverse().find((t) => t.role === 'investor');
  const question = lastInvestorTurn?.text ?? '';
  const move = session.pendingMove;
  const topic = move?.topicId ? topicById(move.topicId) : undefined;

  const turnId = nextTurnId();

  const wasDerail = move?.layer === 'derail';

  // Independent — run concurrently. Matters inside a voice turn later.
  const [claims, verdict, roomControl] = await Promise.all([
    extractClaims(answer, { sessionId: session.id, turnId }),
    judgeAnswer(question, answer, topic),
    wasDerail ? judgeRoomControl(question, answer) : Promise.resolve(undefined),
  ]);

  const beforeKeys = new Set(runChecks(session.ledger).map((f) => f.summary));
  const ledger = claims.reduce(addClaim, session.ledger);
  const newFindings = runChecks(ledger).filter((f) => !beforeKeys.has(f.summary));

  const turn: SessionTurn = {
    id: turnId,
    role: 'founder',
    text: answer,
    at: Date.now(),
    verdict,
    claims,
  };
  if (roomControl) turn.roomControl = roomControl;

  const engine = applyMove(session.engine, move ?? { layer: 'spine', directive: '' }, verdict);

  return {
    session: { ...session, turns: [...session.turns, turn], ledger, engine },
    verdict,
    newFindings,
  };
}

/**
 * Which pre-read probes actually got answered.
 *
 * "They came in wanting to understand your retention. You never gave them a
 * number." — that line only exists because this is tracked.
 */
export function probeOutcomes(session: SessionState) {
  const memo = session.memo;
  if (!memo) return [];

  return memo.plannedProbes.map((probe) => {
    const askedAt = session.turns.findIndex(
      (t) => t.role === 'investor' && t.probeId === probe.id,
    );
    if (askedAt === -1) return { ...probe, resolved: 'unasked' as const };

    const answer = session.turns.slice(askedAt + 1).find((t) => t.role === 'founder');
    return {
      ...probe,
      resolved: answer?.verdict?.satisfied ? ('satisfied' as const) : ('dodged' as const),
    };
  });
}

/** Transcript with elapsed-time stamps, so the delta can cite moments. */
export function transcriptFor(session: SessionState) {
  const start = session.turns[0]?.at ?? Date.now();
  return session.turns.map((t) => {
    const secs = Math.max(0, Math.round((t.at - start) / 1000));
    return {
      role: t.role,
      text: t.text,
      stamp: `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`,
    };
  });
}

export function isComplete(session: SessionState): boolean {
  const probesLeft = probeOutcomes(session).some((p) => p.resolved === 'unasked');
  return coverageReport(session.engine).unasked.length === 0 && !probesLeft;
}

/** Deterministic metrics computable without a model. (PLAN.md §8.3) */
export function sessionMetrics(session: SessionState) {
  const founderTurns = session.turns.filter((t) => t.role === 'founder');
  const investorTurns = session.turns.filter((t) => t.role === 'investor');

  const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
  const founderWords = founderTurns.reduce((n, t) => n + wordCount(t.text), 0);
  const investorWords = investorTurns.reduce((n, t) => n + wordCount(t.text), 0);

  const nonAnswers = founderTurns.filter(
    (t) => t.verdict?.answered === 'dodged' || t.verdict?.answered === 'non_answer',
  ).length;

  const handWaves = founderTurns.filter((t) => t.verdict?.specificity === 'hand_wave').length;

  const HEDGES = /\b(roughly|about|around|approximately|i think|probably|sort of|kind of|maybe|somewhere)\b/gi;
  const hedgeHits = founderTurns.reduce((n, t) => n + (t.text.match(HEDGES)?.length ?? 0), 0);

  return {
    founderTurns: founderTurns.length,
    investorTurns: investorTurns.length,
    founderWords,
    investorWords,
    talkRatio: investorWords > 0 ? founderWords / investorWords : 0,
    avgFounderWordsPerTurn: founderTurns.length ? Math.round(founderWords / founderTurns.length) : 0,
    nonAnswerRate: founderTurns.length ? nonAnswers / founderTurns.length : 0,
    handWaveRate: founderTurns.length ? handWaves / founderTurns.length : 0,
    hedgesPer100Words: founderWords ? (hedgeHits / founderWords) * 100 : 0,
    claimsCaptured: session.ledger.claims.length,
    contradictionsFound: runChecks(session.ledger).length,
    coverage: coverageReport(session.engine),
    ...roomControlMetrics(session),
    ...voiceMetrics(session),
  };
}

/**
 * How synthetic the investor sounded, measured rather than asserted.
 *
 * `tellsPerTurn` is the headline: it is the number this whole personality layer
 * exists to move, and reporting it makes a regression visible instead of a
 * matter of opinion. `regeneratedTurns` is the cost side — every one of those was
 * a second model call, so the two numbers together say whether the detector is
 * earning its latency.
 *
 * `convictionTurns` is the other half of the story: questions that came from one
 * of the investor's own documented positions rather than from the generic spine.
 */
function voiceMetrics(session: SessionState) {
  const investorTurns = session.turns.filter((t) => t.role === 'investor');
  if (investorTurns.length === 0) return { tellsPerTurn: 0, regeneratedTurns: 0, convictionTurns: 0 };

  const totalTells = investorTurns.reduce((n, t) => n + (t.tellScore ?? 0), 0);

  return {
    tellsPerTurn: totalTells / investorTurns.length,
    regeneratedTurns: investorTurns.filter((t) => t.regenerated).length,
    convictionTurns: investorTurns.filter((t) => t.layer === 'conviction').length,
    convictionsPressed: investorTurns.flatMap((t) => (t.convictionBelief ? [t.convictionBelief] : [])),
  };
}

/**
 * Room control — only meaningful for chaotic profiles.
 *
 * A founder who reclaims the room every time is ready for a bad meeting; one who
 * follows every tangent will lose the half hour they came for.
 */
function roomControlMetrics(session: SessionState) {
  if (!isChaotic(session.profile)) return { chaotic: false as const };

  const judged = session.turns.flatMap((t) => (t.roomControl ? [t.roomControl] : []));
  const reclaimed = judged.filter((r) => r.outcome === 'reclaimed').length;
  const partial = judged.filter((r) => r.outcome === 'partial').length;

  return {
    chaotic: true as const,
    derails: session.engine.derailCount,
    derailsJudged: judged.length,
    reclaimed,
    partial,
    followed: judged.filter((r) => r.outcome === 'followed').length,
    /** Partial credit for eventually getting back. */
    roomControlScore: judged.length ? (reclaimed + partial * 0.5) / judged.length : 1,
    roomControlNotes: judged.map((r) => r.note),
  };
}
