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
import { judgeAnswer, type SatisfactionVerdict } from '../investor/satisfaction.ts';
import {
  applyMove,
  coverageReport,
  initialState,
  selectMove,
  speak,
  type EngineState,
  type NextMove,
  type Turn,
} from '../investor/engine.ts';
import { ARCHETYPES, type Archetype, type ArchetypeId } from '../investor/archetypes.ts';
import { topicById } from '../investor/spine.ts';

export interface SessionTurn extends Turn {
  id: string;
  at: number;
  /** Present on investor turns. */
  layer?: NextMove['layer'];
  /** Present on founder turns — the verdict on that answer. */
  verdict?: SatisfactionVerdict;
  /** Claims extracted from a founder turn. */
  claims?: Claim[];
}

export interface SessionState {
  id: string;
  archetype: Archetype;
  engine: EngineState;
  ledger: Ledger;
  turns: SessionTurn[];
  pendingMove?: NextMove;
}

export function createSession(archetypeId: ArchetypeId, sessionId = `s${Date.now()}`): SessionState {
  return {
    id: sessionId,
    archetype: ARCHETYPES[archetypeId],
    engine: initialState(),
    ledger: emptyLedger(sessionId),
    turns: [],
  };
}

let turnSeq = 0;
const nextTurnId = () => `t${++turnSeq}`;

/** Produce the investor's next utterance. */
export async function investorTurn(
  session: SessionState,
): Promise<{ session: SessionState; text: string; move: NextMove }> {
  const lastFounderTurn = [...session.turns].reverse().find((t) => t.role === 'founder');
  const move = selectMove(session.engine, session.ledger, session.archetype, lastFounderTurn?.verdict);

  const text = await speak(
    session.archetype,
    session.turns.map(({ role, text }) => ({ role, text })),
    move,
    session.turns.length === 0,
  );

  const turn: SessionTurn = {
    id: nextTurnId(),
    role: 'investor',
    text,
    at: Date.now(),
    layer: move.layer,
  };

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

  // Independent — run concurrently. Matters inside a voice turn later.
  const [claims, verdict] = await Promise.all([
    extractClaims(answer, { sessionId: session.id, turnId }),
    judgeAnswer(question, answer, topic),
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

  const engine = applyMove(session.engine, move ?? { layer: 'spine', directive: '' }, verdict);

  return {
    session: { ...session, turns: [...session.turns, turn], ledger, engine },
    verdict,
    newFindings,
  };
}

export function isComplete(session: SessionState): boolean {
  return coverageReport(session.engine).unasked.length === 0;
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
  };
}
