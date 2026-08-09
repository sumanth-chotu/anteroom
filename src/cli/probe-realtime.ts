/**
 * Probe the xAI realtime socket and report what it actually does.
 *
 *   npm run probe:realtime
 *
 * The docs give the endpoint and a couple of event shapes but not the audio
 * format, the sample rate, or the full event list. Rather than guess and debug
 * later, connect and observe: the `session.created` event the server sends on
 * connect carries the real defaults.
 *
 * This is a throwaway diagnostic, kept because it is the fastest way to
 * re-verify the contract when the API moves.
 */

import WebSocket from 'ws';
import { config } from '../config.ts';

const URL = `${config.xai.baseUrl.replace(/^http/, 'ws')}/realtime?model=${config.xai.voice}`;

console.log(`\n\x1b[1mProbing\x1b[0m ${URL}\n`);

const socket = new WebSocket(URL, {
  headers: { Authorization: `Bearer ${config.xai.apiKey}` },
});

const seen = new Set<string>();
let audioChunks = 0;
let firstAudioAt = 0;
const startedAt = Date.now();

function show(label: string, value: unknown, depth = 6): void {
  console.log(`\x1b[36m${label}\x1b[0m`, JSON.stringify(value, null, 2).split('\n').slice(0, depth * 4).join('\n'));
}

socket.on('open', () => {
  console.log(`\x1b[32m✓\x1b[0m connected in ${Date.now() - startedAt}ms\n`);

  socket.send(
    JSON.stringify({
      type: 'session.update',
      session: {
        instructions: 'You are a terse seed investor. Ask one short question.',
        turn_detection: { type: 'server_vad' },
        tools: [
          {
            type: 'function',
            name: 'note_claim',
            description: 'Silently record a number the founder stated.',
            parameters: {
              type: 'object',
              properties: {
                metric: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['metric', 'value'],
            },
          },
        ],
      },
    }),
  );

  // Ask for a spoken response with no audio input, to see the output pipeline.
  setTimeout(() => {
    socket.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Say exactly: ready.' }],
        },
      }),
    );
    socket.send(JSON.stringify({ type: 'response.create' }));
  }, 400);
});

socket.on('message', (raw) => {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(raw.toString()) as Record<string, unknown>;
  } catch {
    console.log('\x1b[31mnon-JSON frame\x1b[0m', raw.toString().slice(0, 120));
    return;
  }

  const type = String(event['type']);

  // Audio deltas arrive in bulk — count them, print the first only.
  if (type.includes('audio.delta')) {
    audioChunks++;
    if (audioChunks === 1) {
      firstAudioAt = Date.now() - startedAt;
      const delta = String(event['delta'] ?? '');
      console.log(
        `\x1b[36m${type}\x1b[0m  first at ${firstAudioAt}ms · ` +
          `${delta.length} b64 chars ≈ ${Math.round((delta.length * 3) / 4)} bytes`,
      );
    }
    return;
  }

  // response.done is where a usage block would live, if the API reports one.
  if (type === 'response.done') {
    const response = event['response'] as Record<string, unknown> | undefined;
    console.log('\x1b[33musage on response.done:\x1b[0m', JSON.stringify(response?.['usage'] ?? null));
  }

  if (seen.has(type)) return;
  seen.add(type);

  // session.created / session.updated carry the real defaults — the whole
  // point of the probe.
  if (type.startsWith('session.')) {
    show(type, event['session']);
  } else if (type === 'error') {
    show(type, event['error'] ?? event);
  } else {
    const compact = { ...event };
    delete compact['delta'];
    show(type, compact, 3);
  }
});

socket.on('error', (error) => console.log('\x1b[31msocket error\x1b[0m', error.message));

socket.on('close', (code, reason) => {
  console.log(`\n\x1b[2mclosed ${code} ${reason.toString()}\x1b[0m`);
  summarise();
});

function summarise(): void {
  console.log(`\n\x1b[1mEvent types observed (${seen.size})\x1b[0m`);
  for (const type of [...seen].sort()) console.log(`  ${type}`);
  console.log(`\n  audio deltas: ${audioChunks}${firstAudioAt ? ` · first at ${firstAudioAt}ms` : ''}\n`);
}

setTimeout(() => {
  socket.close();
  setTimeout(() => process.exit(0), 300);
}, 20_000);
