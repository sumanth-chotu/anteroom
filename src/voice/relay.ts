/**
 * Voice relay. (PLAN.md §2.3, Loop 1 + Loop 2)
 *
 *   browser ──ws──▶ relay ──wss──▶ wss://api.x.ai/v1/realtime
 *
 * The relay exists because the xAI key cannot go in the browser. Since it is
 * already in the middle, it also runs Loop 2: it watches `note_claim` tool
 * calls, feeds the claim ledger, runs the deterministic contradiction checks,
 * and injects a steer back into the live session when one fires — so the
 * investor catches a contradiction mid-conversation rather than in the report.
 *
 * Audio is passed through untouched. Nothing in this file is allowed to sit on
 * the audio path: the only work done per frame is a `send`.
 */

import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';

import { config } from '../config.ts';
import { NOTE_CLAIM_TOOL, type ServerEvent } from './protocol.ts';
import { buildSystemPrompt, getProfile } from '../investor/profiles.ts';
import { personaFor } from '../investor/persona.ts';
import { addClaim, emptyLedger, type Claim, type Ledger } from '../ledger/types.ts';
import { findingKey, runChecks } from '../ledger/checks.ts';
import { normaliseSpokenClaim } from '../ledger/normalise.ts';
import type { PreReadMemo } from '../preread/types.ts';

const UPSTREAM = `${config.xai.baseUrl.replace(/^http/, 'ws')}/realtime?model=${config.xai.voice}`;

export interface VoiceSessionOptions {
  profileId: string;
  memo?: PreReadMemo;
}

/** Everything the UI needs to render the session as it happens. */
export type RelayNotice =
  | { kind: 'status'; state: 'connecting' | 'ready' | 'closed'; detail?: string }
  | { kind: 'transcript'; role: 'investor' | 'founder'; text: string; final: boolean }
  | { kind: 'claim'; metric: string; value: string; verbatim: string }
  | { kind: 'finding'; severity: string; summary: string; probe: string }
  | { kind: 'speech'; active: boolean }
  | { kind: 'error'; message: string };

/**
 * Instructions for the voice session.
 *
 * Everything the text engine does across many turns has to be front-loaded
 * here, because a realtime model drives its own turn-taking — we cannot select
 * a layer per turn. The ledger still steers mid-session by injecting messages
 * (see `steer`), which is the one lever that survives.
 */
function buildInstructions(options: VoiceSessionOptions): string {
  const profile = getProfile(options.profileId);
  const persona = personaFor(options.profileId);
  const memo = options.memo;

  const parts = [buildSystemPrompt(profile)];

  parts.push(
    `\nTHIS IS A SPOKEN CONVERSATION.\n` +
      `- Keep turns SHORT. One or two sentences. You are speaking, not writing.\n` +
      `- Never read out lists, numbers with decimals, or anything that only works on a page.\n` +
      `- If the founder rambles past about ${Math.round(profile.interruptThresholdMs / 1000)} ` +
      `seconds without a substantive point, cut in.\n` +
      `- Every time the founder states a number, call note_claim. It is silent. Do not ` +
      `mention it, pause for it, or let it interrupt what you are saying.`,
  );

  if (memo) {
    parts.push(
      `\nYOU READ THEIR DECK BEFORE THIS MEETING.\n` +
        `What it says they do: ${memo.oneLinerFromFullDeck}\n` +
        (memo.redFlags.length ? `What bothered you most: ${memo.redFlags[0]?.summary}\n` : '') +
        `\nThings you decided to dig into, in order:\n` +
        memo.plannedProbes
          .slice(0, 5)
          .map((p, i) => `${i + 1}. ${p.topic}${p.slideRef ? ` (slide ${p.slideRef})` : ''} — ${p.question}`)
          .join('\n') +
        `\n\nWork through these in your own words as the conversation allows. Never mention ` +
        `notes, a memo, or a pre-read — you simply read the deck.`,
    );
  }

  if (persona) {
    parts.push(`\nYou are ${persona.fullName}. Open the meeting yourself; the founder has just sat down.`);
  }

  return parts.join('\n');
}

export function attachVoiceRelay(server: Server, path = '/voice'): WebSocketServer {
  const wss = new WebSocketServer({ server, path });

  wss.on('connection', (client: WebSocket, request: IncomingMessage) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const profileId = url.searchParams.get('profile') ?? 'seed_skeptic';

    let upstream: WebSocket | undefined;
    let ledger: Ledger = emptyLedger(`voice-${Date.now()}`);
    const raised = new Set<string>();
    let claimSeq = 0;
    let memo: PreReadMemo | undefined;
    let closed = false;

    const notify = (notice: RelayNotice) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ __relay: true, ...notice }));
      }
    };

    /**
     * Inject a steer into the live conversation.
     *
     * `conversation.item.create` with role `system`, then `response.create` —
     * the investor picks it up on its next turn. This is Loop 2 closing the
     * circle: a contradiction detected in code becomes a spoken question.
     */
    const steer = (text: string) => {
      upstream?.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] },
        }),
      );
    };

    const handleClaim = async (callId: string, argsJson: string) => {
      let parsed: { metric?: string; value?: string; verbatim?: string };
      try {
        parsed = JSON.parse(argsJson) as typeof parsed;
      } catch {
        return;
      }
      if (!parsed.metric || !parsed.value) return;

      // Acknowledge immediately. The tool is silent by contract, but the model
      // still blocks on a result — a slow reply here stalls the conversation.
      upstream?.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: { type: 'function_call_output', call_id: callId, output: 'ok' },
        }),
      );

      notify({
        kind: 'claim',
        metric: parsed.metric,
        value: parsed.value,
        verbatim: parsed.verbatim ?? '',
      });

      const claim: Claim = {
        id: `vc${++claimSeq}`,
        sessionId: ledger.sessionId,
        source: 'spoken',
        turnId: `voice-${claimSeq}`,
        metric: normaliseSpokenClaim(parsed.metric),
        value: Number.parseFloat(String(parsed.value).replace(/[^0-9.-]/g, '')) || null,
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

        notify({
          kind: 'finding',
          severity: finding.severity,
          summary: finding.summary,
          probe: finding.probe,
        });

        steer(
          `[Something they just said does not add up. ${finding.summary} ` +
            `Press on it now, in your own words — a question of this shape works: ` +
            `"${finding.probe}". Do not explain how you noticed.]`,
        );
      }
    };

    // ── browser → relay ──────────────────────────────────────────────────────
    client.on('message', (raw: RawData, isBinary: boolean) => {
      // Audio arrives as binary PCM16 and is forwarded as base64 without
      // inspection — the audio path stays free of work.
      if (isBinary) {
        upstream?.send(
          JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: (raw as Buffer).toString('base64'),
          }),
        );
        return;
      }

      let message: Record<string, unknown>;
      try {
        message = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }

      // The client sends its memo once, at start, so the relay can build
      // instructions without a second round trip to the session store.
      if (message['type'] === 'start') {
        memo = message['memo'] as PreReadMemo | undefined;
        if (memo?.claims?.length) {
          ledger = { ...ledger, claims: memo.claims.map((c) => ({ ...c, sessionId: ledger.sessionId })) };
        }
        connectUpstream();
        return;
      }

      if (message['type'] === 'interrupt') {
        upstream?.send(JSON.stringify({ type: 'response.cancel' }));
        return;
      }
    });

    client.on('close', () => {
      closed = true;
      upstream?.close();
    });

    // ── relay → xAI ──────────────────────────────────────────────────────────
    function connectUpstream(): void {
      notify({ kind: 'status', state: 'connecting' });

      upstream = new WebSocket(UPSTREAM, {
        headers: { Authorization: `Bearer ${config.xai.apiKey}` },
      });

      upstream.on('open', () => {
        upstream?.send(
          JSON.stringify({
            type: 'session.update',
            session: {
              instructions: buildInstructions({ profileId, ...(memo ? { memo } : {}) }),
              // Server VAD is OFF by default — without this the agent never
              // responds to speech. Verified via probe.
              turn_detection: { type: 'server_vad' },
              tools: [NOTE_CLAIM_TOOL],
            },
          }),
        );
        // Kick off the opening turn — the investor speaks first.
        upstream?.send(JSON.stringify({ type: 'response.create' }));
        notify({ kind: 'status', state: 'ready' });
      });

      upstream.on('message', (raw: RawData) => {
        let event: ServerEvent;
        try {
          event = JSON.parse(raw.toString()) as ServerEvent;
        } catch {
          return;
        }

        switch (event.type) {
          case 'ping':
            return;

          case 'response.output_audio.delta':
            // Straight through as binary — no base64 round trip in the browser.
            if (typeof event.delta === 'string' && client.readyState === WebSocket.OPEN) {
              client.send(Buffer.from(event.delta, 'base64'), { binary: true });
            }
            return;

          case 'response.output_audio_transcript.delta':
            notify({ kind: 'transcript', role: 'investor', text: String(event.delta ?? ''), final: false });
            return;

          case 'response.output_audio_transcript.done':
            notify({ kind: 'transcript', role: 'investor', text: String(event.transcript ?? ''), final: true });
            return;

          case 'conversation.item.input_audio_transcription.completed':
            notify({ kind: 'transcript', role: 'founder', text: String(event.transcript ?? ''), final: true });
            return;

          case 'input_audio_buffer.speech_started':
            notify({ kind: 'speech', active: true });
            return;

          case 'input_audio_buffer.speech_stopped':
            notify({ kind: 'speech', active: false });
            return;

          case 'response.function_call_arguments.done':
            if (event.name === 'note_claim' && typeof event.call_id === 'string') {
              void handleClaim(event.call_id, String(event.arguments ?? '{}'));
            }
            return;

          case 'error':
            notify({ kind: 'error', message: event.error?.message ?? 'upstream error' });
            return;

          default:
            return;
        }
      });

      upstream.on('error', (error) => notify({ kind: 'error', message: error.message }));

      upstream.on('close', (code, reason) => {
        if (!closed) notify({ kind: 'status', state: 'closed', detail: `${code} ${reason.toString()}` });
        client.close();
      });
    }
  });

  return wss;
}
