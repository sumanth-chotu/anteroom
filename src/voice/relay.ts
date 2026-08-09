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

import { config } from '../config.ts';
import { NOTE_CLAIM_TOOL, type ServerEvent } from './protocol.ts';
import { buildSystemPrompt, getProfile } from '../investor/profiles.ts';
import { personaFor } from '../investor/persona.ts';
import { briefingSummary, loadBriefing, type Briefing } from '../investor/briefing.ts';
import { relevantConvictions } from '../corpus/types.ts';
import { convictionDirective } from '../investor/voiceprint.ts';
import { assertVoice, castingNote, realtimeUrl, voiceFor } from './voices.ts';
import { addClaim, emptyLedger, type Claim, type Ledger } from '../ledger/types.ts';
import { findingKey, runChecks } from '../ledger/checks.ts';
import { normaliseSpokenClaim } from '../ledger/normalise.ts';
import { parseSpokenNumber } from '../ledger/number.ts';
import type { PreReadMemo } from '../preread/types.ts';
import type { CategoryBrief } from '../category/types.ts';

// Built per session, not once — the voice is part of the URL and differs by
// investor. See src/voice/voices.ts for why it cannot go in `session.update`.
const upstreamFor = (voice: string) => realtimeUrl(config.xai.baseUrl, config.xai.voice, voice);

/**
 * Per-session logging.
 *
 * A voice session that stops mid-conversation leaves no trace otherwise — the
 * process stays healthy, the UI just goes quiet, and there is nothing to read.
 * Every lifecycle transition gets a line so the next silent drop is diagnosable
 * from the server log alone.
 */
let sessionSeq = 0;
function makeLog(id: string) {
  const started = Date.now();
  return (event: string, detail?: unknown) => {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1).padStart(6);
    console.log(
      `\x1b[2m[voice ${id} ${elapsed}s]\x1b[0m ${event}` +
        (detail === undefined ? '' : ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`),
    );
  };
}

export interface VoiceSessionOptions {
  profileId: string;
  memo?: PreReadMemo;
  brief?: CategoryBrief;
  /** Corpus persona + dossier. Loaded once per session, before connecting. */
  briefing?: Briefing;
}

/** Everything the UI needs to render the session as it happens. */
export type RelayNotice =
  | { kind: 'status'; state: 'connecting' | 'ready' | 'closed'; detail?: string }
  | { kind: 'transcript'; role: 'investor' | 'founder'; text: string; final: boolean }
  | { kind: 'claim'; metric: string; value: string; verbatim: string }
  | { kind: 'finding'; severity: string; summary: string; probe: string }
  | { kind: 'conviction'; belief: string; question: string }
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

  // `opening: true` — a realtime session gets ONE set of instructions for the
  // whole conversation and drives its own turn-taking, so the opening directive
  // has to be front-loaded here. In text mode it is passed only on the first
  // turn; here there is no per-turn hook to add it later.
  const parts = [buildSystemPrompt(profile, options.briefing, { opening: true })];

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

  // Category objections, pre-compiled into questions by the brief pipeline.
  // Asked as the investor's own read of the market — never attributed to X.
  if (options.brief && profile.useCategoryBrief && options.brief.objectionThemes.length) {
    parts.push(
      `\nWHAT YOU KNOW ABOUT THIS CATEGORY.\n` +
        `You have watched this space closely. These criticisms come up every time a company ` +
        `here launches:\n` +
        options.brief.objectionThemes
          .slice(0, 4)
          .map((o, i) => `${i + 1}. "${o.theme}" — you'd ask: ${o.investorQuestion}`)
          .join('\n') +
        `\n\nWork at least one of these in. Never mention X, posts or "people online" — this is ` +
        `your own read of the market, not a citation.`,
    );
  }

  if (persona) {
    parts.push(`\nYou are ${persona.fullName}. Open the meeting yourself; the founder has just sat down.`);
  }

  return parts.join('\n');
}

/**
 * Built with `noServer: true` and mounted by the router in `server/ws-router.ts`.
 *
 * NOT `new WebSocketServer({ server, path })`. `ws` registers one `upgrade`
 * listener per instance, and any instance whose path does not match calls
 * `abortHandshake` — destroying the socket before the instance that *would*
 * have handled it ever sees the request. Two relays on one HTTP server that way
 * break each other: adding /duo made /voice fail with "Invalid WebSocket frame".
 */
export function createVoiceRelay(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (client: WebSocket, request: IncomingMessage) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const profileId = url.searchParams.get('profile') ?? 'seed_skeptic';

    const sessionId = `s${++sessionSeq}`;
    const log = makeLog(sessionId);
    const voice = voiceFor(profileId);
    log('client connected', { profile: profileId, voice, casting: castingNote(profileId) });

    // Traffic counters — a drop is usually visible as one direction stopping.
    let framesIn = 0;
    let audioOut = 0;
    let turns = 0;

    /**
     * Per-response state, for the tool-only turn problem.
     *
     * `note_claim` is silent by design. When the founder states a number the
     * investor's whole turn can be spent on the tool call, producing no speech —
     * and with server VAD nothing re-triggers until the founder speaks again, so
     * the conversation simply goes quiet. That is the "it stopped in the middle"
     * failure.
     *
     * The two-agent demo hit this first and fixed it; the human relay had the
     * same bug. On a response that ends with tool calls and no audio, ask for
     * one more so the investor actually says something.
     */
    let responseAudioChunks = 0;
    let responseToolCalls = 0;
    let responseContinued = false;

    let upstream: WebSocket | undefined;

    /**
     * Mic audio arrives the instant the user clicks, while the upstream socket
     * is still CONNECTING. `upstream?.send()` guards against undefined but NOT
     * against a not-yet-open socket, and `ws` throws on send in that state —
     * which crashed the whole server the first time Voice was clicked.
     *
     * Frames are buffered until upstream is open, then flushed, so the founder's
     * first words are not lost either.
     */
    const preConnect: string[] = [];
    const MAX_BUFFERED_FRAMES = 400; // ~8s at 20ms/frame; bounded, not unbounded

    const sendUpstream = (payload: string): void => {
      if (upstream?.readyState === WebSocket.OPEN) {
        upstream.send(payload);
      } else if (preConnect.length < MAX_BUFFERED_FRAMES) {
        preConnect.push(payload);
      }
    };

    let ledger: Ledger = emptyLedger(`voice-${Date.now()}`);
    const raised = new Set<string>();
    let claimSeq = 0;
    let memo: PreReadMemo | undefined;
    let brief: CategoryBrief | undefined;
    let briefing: Briefing | undefined;
    let closed = false;
    /** Convictions already pressed, so a belief fires once per conversation. */
    const pressed = new Set<string>();

    const notify = (notice: RelayNotice) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ __relay: true, ...notice }));
      }
    };

    /**
     * Inject a steer into the live conversation.
     *
     * A bracketed `conversation.item.create` the investor picks up on its next
     * turn. This is Loop 2 closing the circle: a contradiction detected in code
     * becomes a spoken question.
     */
    const steer = (text: string) => {
      // role:user, not role:system. Both are accepted by the API, but a system
      // item is treated as meta-conversation and merely acknowledged, while a
      // bracketed user item actually redirects the next question. Verified
      // directly against the socket.
      sendUpstream(
        JSON.stringify({
          type: 'conversation.item.create',
          item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
        }),
      );
    };

    /**
     * The corpus feature, in voice mode.
     *
     * Text mode can pick a layer per turn; a realtime model drives its own
     * turn-taking, so the only lever is the same steer mechanism the ledger uses
     * for contradictions. The founder says something that trips a trigger on one
     * of this investor's documented positions, and the argument behind it is
     * injected as a bracketed user item they pick up on their next turn.
     *
     * At most one per conversation turn and never the same belief twice —
     * otherwise a founder who says "huge market" three times gets the same
     * lecture three times.
     */
    const pressConviction = (heard: string): void => {
      const corpus = briefing?.corpus;
      if (!corpus || heard.trim().length < 12) return;

      const conviction = relevantConvictions(corpus, heard).find(
        (c) => !pressed.has(c.belief),
      );
      if (!conviction) return;
      pressed.add(conviction.belief);

      log('conviction tripped', conviction.belief.slice(0, 60));
      notify({ kind: 'conviction', belief: conviction.belief, question: conviction.question });
      steer(`[${convictionDirective([conviction])}]`);
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
      sendUpstream(
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
    //
    // Wrapped: an exception in a socket handler is an unhandled 'error' event on
    // the process, which terminates the server. One bad voice session must never
    // take the UI down with it.
    client.on('message', (raw: RawData, isBinary: boolean) => {
      try {
        handleClientMessage(raw, isBinary);
      } catch (error) {
        notify({ kind: 'error', message: error instanceof Error ? error.message : 'relay error' });
      }
    });

    function handleClientMessage(raw: RawData, isBinary: boolean): void {
      // Audio arrives as binary PCM16 and is forwarded as base64 without
      // inspection — the audio path stays free of work.
      if (isBinary) {
        framesIn++;
        if (framesIn === 1) log('first mic frame');
        sendUpstream(
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
        brief = message['brief'] as CategoryBrief | undefined;
        if (memo?.claims?.length) {
          ledger = { ...ledger, claims: memo.claims.map((c) => ({ ...c, sessionId: ledger.sessionId })) };
        }
        // Read the research from disk BEFORE opening the upstream socket. The
        // instructions are sent once, on `open`, and a briefing that arrives
        // after that point can never reach the conversation.
        void loadBriefing(profileId)
          .then((loaded) => {
            briefing = loaded;
            log('briefing', briefingSummary(loaded));
          })
          .catch(() => undefined)
          .finally(connectUpstream);
        return;
      }

      if (message['type'] === 'interrupt') {
        sendUpstream(JSON.stringify({ type: 'response.cancel' }));
        return;
      }
    }

    client.on('error', (error) => {
      log('client socket error', error.message);
      notify({ kind: 'error', message: `socket: ${error.message}` });
    });

    client.on('close', (code, reason) => {
      closed = true;
      log('client closed', {
        code,
        reason: reason.toString(),
        framesIn,
        audioOutBytes: audioOut,
        turns,
      });
      upstream?.close();
    });

    // ── relay → xAI ──────────────────────────────────────────────────────────
    function connectUpstream(): void {
      notify({ kind: 'status', state: 'connecting' });

      upstream = new WebSocket(upstreamFor(voice), {
        headers: { Authorization: `Bearer ${config.xai.apiKey}` },
      });

      upstream.on('open', () => {
        log('upstream open');
        upstream?.send(
          JSON.stringify({
            type: 'session.update',
            session: {
              instructions: buildInstructions({
                profileId,
                ...(memo ? { memo } : {}),
                ...(brief ? { brief } : {}),
                ...(briefing ? { briefing } : {}),
              }),
              // Server VAD is OFF by default — without this the agent never
              // responds to speech. Verified via probe.
              turn_detection: { type: 'server_vad' },
              tools: [NOTE_CLAIM_TOOL],
            },
          }),
        );
        // Kick off the opening turn — the investor speaks first.
        upstream?.send(JSON.stringify({ type: 'response.create' }));

        // Flush anything the mic produced while we were connecting.
        for (const frame of preConnect) upstream?.send(frame);
        preConnect.length = 0;

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

          // The only place a wrong voice becomes visible. An unrecognised id is
          // silently swapped for human_eve rather than rejected, so without this
          // check every investor would sound identical and nothing would say so.
          case 'session.created': {
            const reported = (event as { session?: { voice?: string } }).session?.voice;
            const warning = assertVoice(voice, reported);
            if (warning) {
              log('VOICE NOT HONOURED', warning);
              notify({ kind: 'error', message: warning });
            } else {
              log('voice confirmed', reported);
            }
            return;
          }

          case 'response.created':
            responseAudioChunks = 0;
            responseToolCalls = 0;
            responseContinued = false;
            return;

          case 'response.output_audio.delta': {
            // Straight through as binary — no base64 round trip in the browser.
            if (typeof event.delta === 'string' && client.readyState === WebSocket.OPEN) {
              const chunk = Buffer.from(event.delta, 'base64');
              responseAudioChunks++;
              audioOut += chunk.length;
              client.send(chunk, { binary: true });
            }
            return;
          }

          case 'response.done':
            if (responseAudioChunks === 0 && responseToolCalls > 0 && !responseContinued) {
              responseContinued = true;
              log('tool-only turn — requesting speech');
              sendUpstream(JSON.stringify({ type: 'response.create' }));
            }
            return;

          case 'response.output_audio_transcript.delta':
            notify({ kind: 'transcript', role: 'investor', text: String(event.delta ?? ''), final: false });
            return;

          case 'response.output_audio_transcript.done':
            turns++;
            log('investor turn', String(event.transcript ?? '').slice(0, 70));
            notify({ kind: 'transcript', role: 'investor', text: String(event.transcript ?? ''), final: true });
            return;

          case 'conversation.item.input_audio_transcription.completed': {
            const heard = String(event.transcript ?? '');
            log('founder heard', heard.slice(0, 70));
            notify({ kind: 'transcript', role: 'founder', text: heard, final: true });
            pressConviction(heard);
            return;
          }

          case 'input_audio_buffer.speech_started':
            log('VAD: speech started');
            notify({ kind: 'speech', active: true });
            return;

          case 'input_audio_buffer.speech_stopped':
            log('VAD: speech stopped');
            notify({ kind: 'speech', active: false });
            return;

          case 'response.function_call_arguments.done':
            if (event.name === 'note_claim' && typeof event.call_id === 'string') {
              responseToolCalls++;
              void handleClaim(event.call_id, String(event.arguments ?? '{}'));
            }
            return;

          case 'error':
            log('UPSTREAM ERROR', event.error ?? event);
            notify({ kind: 'error', message: event.error?.message ?? 'upstream error' });
            return;

          default:
            return;
        }
      });

      upstream.on('error', (error) => {
        log('upstream socket error', error.message);
        notify({ kind: 'error', message: error.message });
      });

      upstream.on('close', (code, reason) => {
        log('UPSTREAM CLOSED', {
          code,
          reason: reason.toString(),
          framesIn,
          audioOutBytes: audioOut,
          turns,
        });
        if (!closed) {
          notify({
            kind: 'status',
            state: 'closed',
            detail: `upstream closed (${code}${reason.toString() ? ` ${reason.toString()}` : ''})`,
          });
        }
        client.close();
      });
    }
  });

  return wss;
}
