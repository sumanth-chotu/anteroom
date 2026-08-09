/**
 * Two-agent demo: an AI founder pitching the AI investor.
 *
 *   founder session ──audio──▶ investor session ──audio──▶ founder session
 *
 * Both are `grok-voice-latest` with different voices. No TTS and no human — the
 * founder speaks natively, which also exercises the realtime *input* path that
 * a text-driven fake founder would skip entirely.
 *
 * ── HALF DUPLEX, DELIBERATELY ───────────────────────────────────────────────
 *
 * Turns alternate under orchestration rather than both sockets running open
 * with server VAD. Full duplex is more realistic but produces two agents talking
 * over each other, and the output of this is a recording and a script — both of
 * which need clean, separable turns. Barge-in is exercised by the human voice
 * mode (`relay.ts`), not here.
 *
 * The investor's ledger still runs: claims the founder speaks are captured and
 * contradictions steer the investor mid-conversation, exactly as with a human.
 */

import { WebSocket } from 'ws';

import { config } from '../config.ts';
import { NOTE_CLAIM_TOOL, type ServerEvent } from './protocol.ts';
import { buildSystemPrompt, getProfile } from '../investor/profiles.ts';
import { personaFor } from '../investor/persona.ts';
import { FOUNDER_SCRIPTS, type FounderScript } from './founder.ts';
import { addClaim, emptyLedger, type Claim, type Ledger } from '../ledger/types.ts';
import { findingKey, runChecks } from '../ledger/checks.ts';
import { normaliseSpokenClaim } from '../ledger/normalise.ts';
import { parseSpokenNumber } from '../ledger/number.ts';
import type { PreReadMemo } from '../preread/types.ts';

const UPSTREAM = `${config.xai.baseUrl.replace(/^http/, 'ws')}/realtime?model=${config.xai.voice}`;

export type DuoEvent =
  | { kind: 'status'; text: string }
  | { kind: 'turn'; speaker: 'investor' | 'founder'; text: string; index: number }
  | { kind: 'claim'; metric: string; value: string }
  | { kind: 'finding'; severity: string; summary: string }
  | { kind: 'audio'; speaker: 'investor' | 'founder'; base64: string }
  | { kind: 'done'; turns: number }
  | { kind: 'error'; message: string };

export interface DuoOptions {
  profileId: string;
  founderId: string;
  memo?: PreReadMemo;
  /** Investor turns before the demo stops. Keeps a runaway loop bounded. */
  maxTurns?: number;
  onEvent: (event: DuoEvent) => void;
}

/**
 * One side of the conversation.
 *
 * Wraps a realtime socket in a request/response shape: `say(audio)` feeds the
 * other agent's speech in and resolves with this agent's reply.
 */
class Agent {
  readonly label: 'investor' | 'founder';
  private socket: WebSocket;
  private ready: Promise<void>;
  private onAudioChunk: (b64: string) => void;
  private onToolCall: ((callId: string, args: string) => void) | undefined;

  private pending?: {
    resolve: (value: { text: string; audio: Buffer }) => void;
    reject: (error: Error) => void;
    chunks: Buffer[];
    transcript: string;
    timer: NodeJS.Timeout;
    /** Tool calls seen this turn — a tool-only turn produces no speech. */
    toolCalls: number;
    /** Guard so a continuation can only happen once per turn. */
    continued: boolean;
  };

  constructor(opts: {
    label: 'investor' | 'founder';
    instructions: string;
    voice: string;
    tools?: unknown[];
    onAudioChunk: (b64: string) => void;
    onToolCall?: (callId: string, args: string) => void;
  }) {
    this.label = opts.label;
    this.onAudioChunk = opts.onAudioChunk;
    this.onToolCall = opts.onToolCall;

    this.socket = new WebSocket(UPSTREAM, {
      headers: { Authorization: `Bearer ${config.xai.apiKey}` },
    });

    this.ready = new Promise<void>((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.on('open', () => {
        this.socket.send(
          JSON.stringify({
            type: 'session.update',
            session: {
              instructions: opts.instructions,
              voice: opts.voice,
              // Turn-taking is orchestrated here, so server VAD is off — with it
              // on, each agent would try to respond to its own injected audio.
              turn_detection: { type: null },
              ...(opts.tools ? { tools: opts.tools } : {}),
            },
          }),
        );
        resolve();
      });
    });

    this.socket.on('message', (raw) => this.handle(raw.toString()));
  }

  private handle(raw: string): void {
    let event: ServerEvent;
    try {
      event = JSON.parse(raw) as ServerEvent;
    } catch {
      return;
    }

    switch (event.type) {
      case 'response.output_audio.delta': {
        const b64 = String(event.delta ?? '');
        if (!b64) return;
        this.pending?.chunks.push(Buffer.from(b64, 'base64'));
        this.onAudioChunk(b64);
        return;
      }
      case 'response.output_audio_transcript.done':
        if (this.pending) this.pending.transcript = String(event.transcript ?? '');
        return;
      case 'response.function_call_arguments.done':
        if (event.name === 'note_claim' && typeof event.call_id === 'string') {
          if (this.pending) this.pending.toolCalls += 1;
          this.onToolCall?.(event.call_id, String(event.arguments ?? '{}'));
        }
        return;
      case 'response.done': {
        const pending = this.pending;
        if (!pending) return;

        // A turn spent entirely on tool calls produces no speech. That is
        // correct model behaviour — note_claim is silent — but it leaves the
        // conversation with nothing to say. Ask for one more response so the
        // agent actually talks. Observed live: the investor logged four claims
        // and said nothing, and the founder then timed out waiting.
        if (pending.chunks.length === 0 && pending.toolCalls > 0 && !pending.continued) {
          pending.continued = true;
          this.send({ type: 'response.create' });
          return;
        }

        this.pending = undefined as typeof this.pending;
        clearTimeout(pending.timer);
        pending.resolve({ text: pending.transcript, audio: Buffer.concat(pending.chunks) });
        return;
      }
      case 'error':
        this.pending?.reject(new Error(event.error?.message ?? 'agent error'));
        return;
      default:
        return;
    }
  }

  send(payload: unknown): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  /** Feed the other agent's audio in (if any) and wait for this agent's reply. */
  async respond(incoming?: Buffer): Promise<{ text: string; audio: Buffer }> {
    await this.ready;

    if (incoming?.length) {
      // Chunk the append so a long turn doesn't arrive as one huge frame.
      const CHUNK = 32_000;
      for (let offset = 0; offset < incoming.length; offset += CHUNK) {
        this.send({
          type: 'input_audio_buffer.append',
          audio: incoming.subarray(offset, offset + CHUNK).toString('base64'),
        });
      }
      this.send({ type: 'input_audio_buffer.commit' });
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined as typeof this.pending;
        reject(new Error(`${this.label} timed out`));
      }, 60_000);
      this.pending = { resolve, reject, chunks: [], transcript: '', timer, toolCalls: 0, continued: false };
      this.send({ type: 'response.create' });
    });
  }

  close(): void {
    try { this.socket.close(); } catch { /* already gone */ }
  }
}

export async function runDuo(options: DuoOptions): Promise<void> {
  const { onEvent, profileId, founderId } = options;
  const maxTurns = options.maxTurns ?? 8;

  const profile = getProfile(profileId);
  const persona = personaFor(profileId);
  const founder: FounderScript = FOUNDER_SCRIPTS[founderId] ?? FOUNDER_SCRIPTS['sentinel']!;

  let ledger: Ledger = emptyLedger('duo');
  if (options.memo?.claims.length) {
    ledger = { ...ledger, claims: options.memo.claims.map((c) => ({ ...c, sessionId: 'duo' })) };
  }
  const raised = new Set<string>();
  let claimSeq = 0;

  // Steers are queued and drained BETWEEN turns, never during one.
  //
  // Injecting `conversation.item.create` while a response is in flight starved
  // the investor's turn entirely — it returned empty text and no audio, and the
  // founder then timed out waiting for something to answer. One steer per turn,
  // highest severity, delivered when the socket is idle.
  const steerQueue: string[] = [];

  const investorInstructions = [
    buildSystemPrompt(profile),
    `\nTHIS IS A SPOKEN CONVERSATION. Two or three sentences per turn, maximum.`,
    `Call note_claim every time the founder states a number. It is silent.`,
    options.memo
      ? `\nYou read their deck. It says: ${options.memo.oneLinerFromFullDeck}\n` +
        `Things you decided to dig into:\n` +
        options.memo.plannedProbes.slice(0, 4).map((p, i) => `${i + 1}. ${p.question}`).join('\n') +
        `\nNever mention notes or a memo — you simply read the deck.`
      : '',
    persona ? `\nYou are ${persona.fullName}. Open the meeting; the founder has just sat down.` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const investor = new Agent({
    label: 'investor',
    instructions: investorInstructions,
    // Investor keeps the default voice; the founder takes a different one so the
    // recording has two distinguishable speakers.
    voice: 'xai_ara',
    tools: [NOTE_CLAIM_TOOL],
    onAudioChunk: (base64) => onEvent({ kind: 'audio', speaker: 'investor', base64 }),
    onToolCall: (callId, args) => {
      investor.send({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: callId, output: 'ok' },
      });

      let parsed: { metric?: string; value?: string; verbatim?: string };
      try {
        parsed = JSON.parse(args) as typeof parsed;
      } catch {
        return;
      }
      if (!parsed.metric || !parsed.value) return;

      onEvent({ kind: 'claim', metric: parsed.metric, value: parsed.value });

      const claim: Claim = {
        id: `dc${++claimSeq}`,
        sessionId: 'duo',
        source: 'spoken',
        turnId: `duo-${claimSeq}`,
        metric: normaliseSpokenClaim(parsed.metric),
        // Spoken numbers are words: "twelve", not 12. Stripping non-digits
        // yielded null for every spoken claim and blinded the ledger.
        value: parseSpokenNumber(String(parsed.value)),
        valueRaw: parsed.value,
        verbatim: parsed.verbatim ?? `${parsed.metric}: ${parsed.value}`,
        confidence: 0.9,
        createdAt: Date.now(),
      };
      ledger = addClaim(ledger, claim);

      for (const finding of runChecks(ledger)) {
        const key = findingKey(finding);
        if (raised.has(key)) continue;
        raised.add(key);
        onEvent({ kind: 'finding', severity: finding.severity, summary: finding.summary });
        steerQueue.push(
          `[Something they just said does not add up. ${finding.summary} ` +
            `Press on it now, in your own words: "${finding.probe}"]`,
        );
      }
    },
  });

  const founderAgent = new Agent({
    label: 'founder',
    instructions: founder.instructions,
    voice: founder.voice,
    onAudioChunk: (base64) => onEvent({ kind: 'audio', speaker: 'founder', base64 }),
  });

  onEvent({ kind: 'status', text: `${persona?.fullName ?? profile.name} vs ${founder.name}, ${founder.company}` });

  let index = 0;
  try {
    let carry: Buffer | undefined;
    for (let turn = 0; turn < maxTurns; turn++) {
      // Drain at most one steer, now, while the socket is idle. Findings pile up
      // faster than a conversation can absorb them; the rest stay queued and the
      // report covers everything anyway.
      const steer = steerQueue.shift();
      if (steer) {
        steerQueue.length = 0;
        // role:user, not role:system. Both are accepted, but a system item is
        // treated as meta-conversation and merely acknowledged ("Understood.
        // What's the play?"), while a bracketed user item actually changes the
        // next question. Verified directly against the socket.
        investor.send({
          type: 'conversation.item.create',
          item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: steer }] },
        });
      }

      const fromInvestor = await investor.respond(carry);
      if (!fromInvestor.audio.length) {
        onEvent({ kind: 'error', message: 'investor produced no audio — stopping' });
        break;
      }
      onEvent({ kind: 'turn', speaker: 'investor', text: fromInvestor.text, index: index++ });

      const fromFounder = await founderAgent.respond(fromInvestor.audio);
      if (!fromFounder.audio.length) {
        onEvent({ kind: 'error', message: 'founder produced no audio — stopping' });
        break;
      }
      onEvent({ kind: 'turn', speaker: 'founder', text: fromFounder.text, index: index++ });

      carry = fromFounder.audio;
    }
    onEvent({ kind: 'done', turns: index });
  } catch (error) {
    onEvent({ kind: 'error', message: error instanceof Error ? error.message : 'duo failed' });
  } finally {
    investor.close();
    founderAgent.close();
  }
}
