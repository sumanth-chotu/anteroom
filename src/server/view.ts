/**
 * Session → view model.
 *
 * `SessionState` holds Sets and class instances that don't survive
 * JSON.stringify, so the wire format is built explicitly rather than by
 * serializing internals. Keeping it explicit also means the UI can't
 * accidentally depend on engine internals that are still moving.
 */

import { runChecks } from '../ledger/checks.ts';
import { sessionMetrics, type SessionState } from '../session/session.ts';
import { usageSummary, type Usage } from '../xai/client.ts';
import { SEED_SPINE } from '../investor/spine.ts';
import type { InvestorProfile } from '../investor/profiles.ts';
import { DISCLAIMER, avatarDataUri, personaFor } from '../investor/persona.ts';

export interface UsageSnapshot {
  calls: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  estimatedUsd: number;
}

/**
 * grok-4.5 list rates. Enough for an order-of-magnitude read in the panel;
 * the authoritative number is the xAI dashboard.
 */
const USD_PER_M_IN = 2;
const USD_PER_M_OUT = 6;

export function snapshotUsage(): UsageSnapshot {
  const u = usageSummary();
  return {
    calls: u.calls,
    promptTokens: u.totalPromptTokens,
    cachedTokens: u.totalCachedTokens,
    completionTokens: u.totalCompletionTokens,
    estimatedUsd: (u.totalPromptTokens / 1e6) * USD_PER_M_IN + (u.totalCompletionTokens / 1e6) * USD_PER_M_OUT,
  };
}

/**
 * Per-session usage by diffing against a snapshot taken at session start.
 *
 * Usage accounting is process-wide, so with concurrent sessions these figures
 * interleave. Fine for a single-operator dev tool; the panel labels it.
 */
export function diffUsage(start: UsageSnapshot, now: UsageSnapshot): UsageSnapshot {
  return {
    calls: now.calls - start.calls,
    promptTokens: now.promptTokens - start.promptTokens,
    cachedTokens: now.cachedTokens - start.cachedTokens,
    completionTokens: now.completionTokens - start.completionTokens,
    estimatedUsd: now.estimatedUsd - start.estimatedUsd,
  };
}

export function profileView(p: InvestorProfile) {
  const persona = personaFor(p.id);
  return {
    id: p.id,
    name: p.name,
    persona: persona
      ? {
          fullName: persona.fullName,
          shortName: persona.shortName,
          title: persona.title,
          firm: persona.firm,
          location: persona.location,
          bio: persona.bio,
          fictional: persona.fictional ?? false,
          avatar: persona.photoUrl ?? avatarDataUri(persona.avatar, 96),
          disclaimer: persona.fictional ? 'Fictional character.' : DISCLAIMER,
        }
      : null,
    kind: p.kind,
    blurb: p.blurb,
    dials: {
      warmth: p.warmth,
      derailment: p.derailment,
      selfRegard: p.selfRegard,
      followUpDepth: p.followUpDepth,
      interruptThresholdMs: p.interruptThresholdMs,
    },
    quirks: p.quirks,
    provenance: p.provenance ?? null,
  };
}

export function sessionView(session: SessionState, usageAtStart: UsageSnapshot) {
  const metrics = sessionMetrics(session);
  const findings = runChecks(session.ledger);

  return {
    id: session.id,
    profile: profileView(session.profile),
    turns: session.turns.map((t) => ({
      id: t.id,
      role: t.role,
      text: t.text,
      layer: t.layer ?? null,
      verdict: t.verdict
        ? {
            answered: t.verdict.answered,
            specificity: t.verdict.specificity,
            missing: t.verdict.missing,
            satisfied: t.verdict.satisfied,
            reasoning: t.verdict.reasoning,
          }
        : null,
      claims: (t.claims ?? []).map((c) => ({
        metric: c.metric,
        valueRaw: c.valueRaw,
        confidence: c.confidence,
      })),
      roomControl: t.roomControl ?? null,
    })),
    ledger: session.ledger.claims.map((c) => ({
      id: c.id,
      metric: c.metric,
      value: c.value,
      valueRaw: c.valueRaw,
      period: c.period ?? null,
      verbatim: c.verbatim,
      confidence: c.confidence,
    })),
    findings: findings.map((f) => ({
      kind: f.kind,
      severity: f.severity,
      summary: f.summary,
      probe: f.probe,
      claimIds: f.claims.map((c) => c.id),
    })),
    // Every spine topic with its state, so the panel renders the full checklist
    // rather than three disjoint lists.
    spine: SEED_SPINE.map((t) => ({
      id: t.id,
      label: t.label,
      state: session.engine.satisfied.has(t.id)
        ? ('satisfied' as const)
        : session.engine.dodged.has(t.id)
          ? ('dodged' as const)
          : session.engine.asked.has(t.id)
            ? ('asking' as const)
            : ('unasked' as const),
    })),
    metrics: {
      founderTurns: metrics.founderTurns,
      nonAnswerRate: metrics.nonAnswerRate,
      handWaveRate: metrics.handWaveRate,
      hedgesPer100Words: metrics.hedgesPer100Words,
      avgFounderWordsPerTurn: metrics.avgFounderWordsPerTurn,
      talkRatio: metrics.talkRatio,
      claimsCaptured: metrics.claimsCaptured,
      contradictionsFound: metrics.contradictionsFound,
    },
    roomControl: metrics.chaotic
      ? {
          derails: metrics.derails,
          judged: metrics.derailsJudged,
          reclaimed: metrics.reclaimed,
          partial: metrics.partial,
          followed: metrics.followed,
          score: metrics.roomControlScore,
          notes: metrics.roomControlNotes,
        }
      : null,
    usage: diffUsage(usageAtStart, snapshotUsage()),
  };
}

export type SessionViewModel = ReturnType<typeof sessionView>;
