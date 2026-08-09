/**
 * The AI-tell detector, and the retrieval that makes questions specific.
 *
 * Two properties matter here, and they pull against each other:
 *
 *   RECALL      the phrasings that make an investor sound like a chatbot are
 *               actually caught, so a slipped turn gets regenerated.
 *   PRECISION   things a real investor genuinely says are NOT caught. A false
 *               tell costs a pointless model call and, worse, would train us to
 *               ignore the detector — the same trade the ledger's contradiction
 *               checks already make.
 *
 * The precision cases are the ones worth guarding. Recall failures are visible
 * the moment you read a transcript; a detector that fires on ordinary speech is
 * invisible and expensive.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HUMAN_SPEECH,
  REGENERATE_ABOVE,
  beliefsDirective,
  detectTells,
  openingDirective,
  shouldRegenerate,
  speechDirective,
  tellComplaint,
  tellScore,
} from './voiceprint.ts';
import { relevantConvictions, type Conviction, type CorpusPersona } from '../corpus/types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const conviction = (over: Partial<Conviction> = {}): Conviction => ({
  belief: 'Start with a tiny group of users you understand.',
  argument: 'A small market you dominate beats a large one you cannot reach.',
  triggersOn: ['the tam is billions', 'everyone needs this', 'all small businesses'],
  question: 'Can you name ten people who would be upset if you shut down tomorrow?',
  quote: 'Make something people want.',
  sourceTitle: 'Ideas for Startups',
  sourceUrl: 'https://paulgraham.com/ideas.html',
  ...over,
});

const persona = (over: Partial<CorpusPersona> = {}): CorpusPersona => ({
  profileId: 'essayist',
  person: 'Test Subject',
  builtAt: '2026-08-08T00:00:00Z',
  corpus: { label: 'test', documents: 2, chars: 100, titles: ['a', 'b'] },
  convictions: [conviction()],
  diagnostics: [{ move: 'Ask for the denominator.', when: 'given a percentage', example: 'Of how many?' }],
  canon: ['ramen profitable'],
  dismissals: ['TAM slides'],
  opening: { style: 'Opens with a direct question.', examples: ['Who uses this today?'] },
  voice: {
    signaturePhrases: ['make something people want'],
    rhythm: 'Short sentences. The point comes first.',
    tics: ['Replaces an abstraction with the concrete version.'],
    register: 'Plain, unadorned.',
    humour: 'Dry, rare.',
    neverSays: ['synergy', 'leverage'],
  },
  cost: { seconds: 1, promptTokens: 1, completionTokens: 1 },
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
// Recall — what must be caught
// ─────────────────────────────────────────────────────────────────────────────

describe('detectTells catches what makes an investor sound synthetic', () => {
  it('flags complimenting the question', () => {
    assert.ok(detectTells('Great question. How many users pay?').some((t) => t.kind === 'preamble'));
  });

  it('flags reflective listening', () => {
    const tells = detectTells("So if I understand correctly, you're targeting dentists?");
    assert.ok(tells.some((t) => t.kind === 'mirroring'));
    assert.ok(shouldRegenerate("It sounds like you're pre-revenue then."));
  });

  it('flags announcing a question instead of asking it', () => {
    assert.ok(detectTells('Let me ask you this — what is churn?').some((t) => t.kind === 'signposting'));
    assert.ok(detectTells('Help me understand the pricing.').some((t) => t.kind === 'signposting'));
  });

  it('flags consultant vocabulary', () => {
    assert.ok(detectTells('The competitive landscape is robust.').some((t) => t.kind === 'assistant_vocab'));
    assert.ok(detectTells('Let me delve into the numbers.').some((t) => t.kind === 'assistant_vocab'));
  });

  it('flags the "not X — it\'s Y" cadence', () => {
    assert.ok(
      detectTells("It's not just about growth — it's about retention.").some(
        (t) => t.kind === 'antithesis',
      ),
      'the antithesis construction is a generated-text signature',
    );
  });

  it('flags the rule of three', () => {
    const tells = detectTells('I care about margins, retention, and distribution.');
    assert.ok(tells.some((t) => t.kind === 'triad'));
  });

  it('flags coaching, which the base persona already forbids', () => {
    assert.ok(detectTells('You might want to reframe slide four.').some((t) => t.kind === 'coaching'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Precision — what must NOT be caught
// ─────────────────────────────────────────────────────────────────────────────

describe('detectTells leaves real investor speech alone', () => {
  it('passes blunt, clipped questions', () => {
    for (const line of [
      'How many pay?',
      'Since when?',
      'Forty percent. Of what denominator?',
      "That's not an answer.",
      'Who are the ten people who would be upset if you shut down tomorrow?',
      'At fifteen percent a month, how long until you run out of users?',
      "You said eight hundred users ten minutes ago. Now it's two thousand.",
      'Okay.',
    ]) {
      assert.equal(tellScore(line), 0, `false positive on: ${line}`);
    }
  });

  it('does not flag a genuine enumeration of long clauses as a triad', () => {
    // The triad pattern requires short parallel items; real speech that happens
    // to contain commas must survive.
    const line =
      'I want to know how many customers renewed last quarter, and whether the ones who left told you why.';
    assert.equal(
      detectTells(line).filter((t) => t.kind === 'triad').length,
      0,
    );
  });

  it('tolerates a single mild connective without forcing a retry', () => {
    // "however" is weight 1 — real, overused, not on its own worth a model call.
    const line = 'However, you said the number was eight hundred.';
    assert.ok(tellScore(line) > 0, 'should still be noticed');
    assert.ok(!shouldRegenerate(line), 'one mild tell must not trigger a regeneration');
  });

  it('regenerates on one unmistakable tell', () => {
    assert.ok(tellScore('Great question.') > REGENERATE_ABOVE);
    assert.ok(shouldRegenerate('Great question.'));
  });
});

describe('tellComplaint', () => {
  it('names the offending words, because repeating the rule did not work', () => {
    const complaint = tellComplaint(detectTells('Great question. That said, help me understand.'));
    assert.match(complaint, /Great question/);
    assert.ok(complaint.length > 80);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Retrieval — the mechanism that makes a question specific
// ─────────────────────────────────────────────────────────────────────────────

describe('relevantConvictions', () => {
  it('fires when the founder says the thing the belief is about', () => {
    const found = relevantConvictions(persona(), 'Honestly the TAM is billions of dollars here.');
    assert.equal(found.length, 1);
    assert.match(found[0]!.question, /ten people/);
  });

  it('stays silent when nothing matches, rather than guessing', () => {
    assert.deepEqual(relevantConvictions(persona(), 'We were founded in Berlin in 2024.'), []);
  });

  it('ranks by how many distinct triggers were hit', () => {
    const focused = conviction({
      belief: 'Focus beats breadth.',
      triggersOn: ['three products', 'multiple verticals', 'platform play'],
      question: 'Which two would you drop?',
    });
    const found = relevantConvictions(
      persona({ convictions: [conviction(), focused] }),
      'We have three products across multiple verticals — a real platform play. Everyone needs this.',
    );
    assert.equal(found[0]?.belief, 'Focus beats breadth.', 'three hits should outrank one');
  });

  it('ignores very short triggers that would match anything', () => {
    const noisy = persona({ convictions: [conviction({ triggersOn: ['ai', 'we'] })] });
    assert.deepEqual(relevantConvictions(noisy, 'We are building with AI.'), []);
  });

  it('returns nothing without a persona, so the app degrades cleanly', () => {
    assert.deepEqual(relevantConvictions(null, 'the tam is billions'), []);
    assert.deepEqual(relevantConvictions(persona(), ''), []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Prompt assembly
// ─────────────────────────────────────────────────────────────────────────────

describe('directives', () => {
  it('the human-speech block bans the tells the detector looks for', () => {
    // Otherwise the prompt and the check would drift apart and every turn would
    // pay for a regeneration.
    for (const banned of ['Great question', 'That said', 'help me understand', 'landscape']) {
      assert.ok(HUMAN_SPEECH.includes(banned), `${banned} should be prohibited in the prompt`);
    }
  });

  it('beliefs carry the ARGUMENT, not just the belief', () => {
    // A belief alone gets asserted once. The argument is what lets the investor
    // keep pushing when the founder pushes back.
    const block = beliefsDirective(persona());
    assert.match(block, /A small market you dominate/);
  });

  it('an opening directive exists, since a missing one is the cold open', () => {
    assert.match(openingDirective(persona()), /direct question/);
    assert.equal(openingDirective(null), '');
  });

  it('renders the researched voice, and nothing at all without research', () => {
    assert.match(speechDirective({ corpus: persona() }), /The point comes first/);
    assert.equal(speechDirective(null), '');
    assert.equal(speechDirective({}), '');
  });

  it('discards a thin dossier voice rather than following an invented one', () => {
    // Confidently imitating someone from almost no material produces a
    // caricature of a real person. Better to fall back to the generic rules.
    const thin = {
      dossier: {
        publicFootprint: 'thin' as const,
        speech: persona().voice,
      },
    } as never;
    assert.equal(speechDirective(thin), '');
  });
});
