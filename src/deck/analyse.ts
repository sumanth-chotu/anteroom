/**
 * Deck analysis — deterministic checks, the one-liner test, and scoring.
 * (PLAN.md §5.4, §5.6, §8.2)
 *
 * Deck numbers are normalised into `Claim`s and run through the SAME ledger
 * checks the conversation uses, rather than a parallel deck-specific check
 * system. Two reasons: the seed failure modes are identical (design partner vs
 * paying customer does not change because it is printed rather than spoken),
 * and it is what makes deck-vs-spoken contradiction detection fall out for free
 * once the session starts.
 */

import { chat } from '../xai/client.ts';
import { extractClaims } from '../ledger/extract.ts';
import { runChecks } from '../ledger/checks.ts';
import { emptyLedger, type Claim } from '../ledger/types.ts';
import {
  ISSUE_PROBES,
  type DeckAnalysis,
  type DeckIssueFinding,
  type DeckScore,
  type DeckSection,
  type Slide,
  type SlideCritique,
} from './types.ts';

/** Sections a seed deck is expected to cover. Absence is itself a finding. */
const EXPECTED_SECTIONS: DeckSection[] = [
  'problem', 'solution', 'traction', 'market', 'competition', 'team', 'ask',
];

/** Words on one slide above which it stops being readable at a glance. */
const DENSITY_LIMIT = 120;

// ─────────────────────────────────────────────────────────────────────────────
// The one-liner test (§5.6)
// ─────────────────────────────────────────────────────────────────────────────

const ONE_LINER_SYSTEM = `
State what this company does in ONE sentence, as a stranger would after reading
only what you were shown.

Write what the material actually communicates, not the most charitable reading.
If it is vague, be vague — "an AI platform for teams" is the correct answer to a
slide that says nothing more. Do not add specificity that is not there; the
vagueness is the finding.

No preamble. One sentence.
`.trim();

async function oneLiner(images: string[], label: string): Promise<string> {
  const result = await chat(
    [
      { role: 'system', content: ONE_LINER_SYSTEM },
      {
        role: 'user',
        content: [
          ...images.map((url) => ({ type: 'image_url' as const, image_url: { url, detail: 'high' as const } })),
          { type: 'text' as const, text: 'What does this company do?' },
        ],
      },
    ],
    { tag: `deck:one-liner:${label}`, reasoningEffort: 'low', maxTokens: 2048 },
  );
  return result.text.trim().replace(/^["']|["']$/g, '');
}

// ─────────────────────────────────────────────────────────────────────────────

/** Turn slide text into normalised claims via the shared extractor. */
async function deckClaims(critiques: SlideCritique[]): Promise<Claim[]> {
  const perSlide = await Promise.all(
    critiques
      .filter((c) => c.numbers.length > 0 || /\d/.test(c.visibleText))
      .map((c) =>
        extractClaims(
          // Labelled numbers first — they disambiguate what a bare figure means.
          `${c.numbers.map((n) => `${n.label}: ${n.value}`).join('\n')}\n\n${c.visibleText}`,
          {
            sessionId: 'deck',
            turnId: `slide-${c.slideNumber}`,
            source: 'deck',
            slideNumber: c.slideNumber,
          },
        ),
      ),
  );
  return perSlide.flat();
}

function scoreDeck(
  critiques: SlideCritique[],
  findings: DeckIssueFinding[],
  missing: DeckSection[],
  oneLinerVague: boolean,
  oneLinerDiverged: boolean,
): DeckScore {
  const slides = Math.max(critiques.length, 1);
  const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)));

  const honestyIssues = critiques.flatMap((c) =>
    c.issues.filter((i) =>
      (['unlabeled_axis', 'truncated_axis', 'projection_as_actual', 'logo_soup', 'vanity_metric'] as string[]).includes(i),
    ),
  ).length;

  const unsourced = critiques.filter((c) => c.issues.includes('no_source')).length;
  const dense = critiques.filter((c) => c.issues.includes('text_wall')).length;
  const contradictions = findings.filter((f) => f.kind === 'cross_slide_number').length;

  return {
    // Both halves of the one-liner test feed this: a vague whole-deck summary
    // means the deck failed outright, and a slide-1 summary that diverges from
    // it means the opening slide misrepresents the company.
    comprehension: oneLinerVague ? 2 : oneLinerDiverged ? 3 : 5,
    coverage: clamp(5 - missing.length * 1.2),
    honestyOfVisuals: clamp(5 - honestyIssues * 1.1),
    substantiation: clamp(5 - (unsourced / slides) * 6),
    internalConsistency: clamp(5 - contradictions * 2),
    density: clamp(5 - (dense / slides) * 8),
  };
}

/**
 * A one-liner is vague when it leans on category nouns and says nothing about
 * who it is for or what it actually does. Cheap heuristic, deliberately — the
 * founder sees both sentences and judges for themselves (§5.6); this only
 * drives the score.
 */
function looksVague(text: string): boolean {
  const VAGUE = /\b(platform|solution|intelligence|powered|modern|teams|businesses|enterprise|streamline|leverage|next[- ]generation|end[- ]to[- ]end)\b/gi;
  const hits = text.match(VAGUE)?.length ?? 0;
  const hasConcreteNoun = /\b(fraud|payment|invoice|scheduling|logistics|recruiting|compliance|transaction|inventory|claims|payroll|freight|lending)\b/i.test(text);
  return hits >= 2 && !hasConcreteNoun;
}

export async function analyseDeck(slides: Slide[], critiques: SlideCritique[]): Promise<DeckAnalysis> {
  const findings: DeckIssueFinding[] = [];

  // ── Deterministic: missing sections ────────────────────────────────────────
  const present = [...new Set(critiques.map((c) => c.detectedSection))];
  const missing = EXPECTED_SECTIONS.filter((s) => !present.includes(s));

  for (const section of missing) {
    findings.push({
      kind: 'missing_section',
      severity: section === 'competition' || section === 'traction' ? 'high' : 'medium',
      summary: `No ${section.replace(/_/g, ' ')} slide.`,
      slideNumbers: [],
      probe:
        section === 'competition'
          ? "There's no competition slide. Who else is solving this, and why do you win?"
          : `The deck never covers ${section.replace(/_/g, ' ')}. Walk me through it.`,
    });
  }

  // ── Deterministic: density ─────────────────────────────────────────────────
  for (const c of critiques) {
    const words = c.visibleText.trim().split(/\s+/).filter(Boolean).length;
    if (words > DENSITY_LIMIT) {
      findings.push({
        kind: 'density',
        severity: 'low',
        summary: `Slide ${c.slideNumber} has ${words} words — unreadable at a glance.`,
        slideNumbers: [c.slideNumber],
        probe: `Slide ${c.slideNumber} is a wall of text. What's the one thing it's meant to say?`,
      });
    }
  }

  // ── Model-seen slide issues ────────────────────────────────────────────────
  for (const c of critiques) {
    for (const issue of c.issues) {
      findings.push({
        kind: 'slide_issue',
        severity:
          (['unlabeled_axis', 'truncated_axis', 'projection_as_actual'] as string[]).includes(issue)
            ? 'high'
            : (['logo_soup', 'vanity_metric', 'buried_caveat', 'top_down_tam'] as string[]).includes(issue)
              ? 'medium'
              : 'low',
        summary: `Slide ${c.slideNumber}: ${issue.replace(/_/g, ' ')} — ${c.evidence}`,
        slideNumbers: [c.slideNumber],
        probe: ISSUE_PROBES[issue],
      });
    }
  }

  // ── Cross-slide numbers, via the shared ledger checks ──────────────────────
  const claims = await deckClaims(critiques);
  const ledgerFindings = runChecks({ ...emptyLedger('deck'), claims });
  for (const f of ledgerFindings) {
    findings.push({
      kind: 'cross_slide_number',
      severity: f.severity,
      summary: f.summary,
      slideNumbers: [...new Set(f.claims.map((c) => c.slideNumber).filter((n): n is number => n !== undefined))],
      probe: f.probe,
    });
  }

  // ── The one-liner test ─────────────────────────────────────────────────────
  const first = slides[0];
  const [fromSlide1, fromDeck] = await Promise.all([
    first ? oneLiner([first.dataUri], 'slide1') : Promise.resolve('(no slides)'),
    oneLiner(slides.map((s) => s.dataUri), 'full'),
  ]);

  // Divergence: slide 1 reads vague while the full deck reads specific — the
  // opening slide is not saying what the company does.
  const diverged = looksVague(fromSlide1) && !looksVague(fromDeck);
  if (diverged) {
    findings.push({
      kind: 'slide_issue',
      severity: 'high',
      summary:
        `Slide 1 says you do "${fromSlide1}" — the full deck says "${fromDeck}". ` +
        `Your opening slide is not describing your company.`,
      slideNumbers: [1],
      probe:
        "Your title slide told me you're an AI platform for teams. It took seven more slides " +
        'to learn you do real-time fraud scoring. Why is the specific thing not slide one?',
    });
  }

  const vague = looksVague(fromDeck);
  if (vague) {
    findings.push({
      kind: 'slide_issue',
      severity: 'high',
      summary: `After the whole deck, what you do reads as: "${fromDeck}"`,
      slideNumbers: [1],
      probe: "Having read your deck, I still couldn't tell someone what you do. Say it in one sentence.",
    });
  }

  const SEVERITY = { high: 0, medium: 1, low: 2 } as const;
  findings.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);

  return {
    slideCount: slides.length,
    slides,
    critiques,
    findings,
    sectionsPresent: present,
    sectionsMissing: missing,
    oneLinerFromSlide1: fromSlide1,
    oneLinerFromFullDeck: fromDeck,
    score: scoreDeck(critiques, findings, missing, vague, diverged),
  };
}
