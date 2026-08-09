/**
 * Relay smoke test.
 *
 *   npm run probe:relay        (server must be running)
 *
 * Connects to the local relay exactly as the browser does — start message, then
 * listen — and reports whether audio and transcripts come back. Verifies the
 * whole chain except the microphone, which needs a human.
 */

import WebSocket from 'ws';

const PORT = process.env['PORT'] ?? 4317;
const url = `ws://localhost:${PORT}/voice?profile=${process.argv[2] ?? 'seed_skeptic'}`;

console.log(`\n\x1b[1mRelay probe\x1b[0m ${url}\n`);

const started = Date.now();
let audioBytes = 0;
let firstAudioAt = 0;
const notices: string[] = [];
let transcript = '';

const socket = new WebSocket(url);

socket.on('open', () => {
  console.log(`\x1b[32m✓\x1b[0m relay connected in ${Date.now() - started}ms`);
  socket.send(JSON.stringify({ type: 'start' }));
});

socket.on('message', (raw, isBinary) => {
  if (isBinary) {
    // `ws` hands back a Buffer by default; be tolerant either way.
    audioBytes += (raw as Buffer).length ?? (raw as unknown as ArrayBuffer).byteLength ?? 0;
    if (!firstAudioAt) {
      firstAudioAt = Date.now() - started;
      console.log(`\x1b[32m✓\x1b[0m first audio at \x1b[1m${firstAudioAt}ms\x1b[0m`);
    }
    return;
  }
  const notice = JSON.parse(raw.toString()) as Record<string, unknown>;
  const kind = String(notice['kind']);
  if (kind === 'transcript' && notice['final']) {
    transcript = String(notice['text']);
    console.log(`\x1b[36m${notice['role']}:\x1b[0m ${transcript}`);
  } else if (kind !== 'transcript') {
    const line = `${kind}${notice['state'] ? `:${notice['state']}` : ''}${notice['message'] ? ` — ${notice['message']}` : ''}`;
    if (!notices.includes(line)) { notices.push(line); console.log(`\x1b[2m${line}\x1b[0m`); }
  }
});

socket.on('error', (e) => console.log(`\x1b[31m✗\x1b[0m ${e.message}`));

setTimeout(() => {
  const seconds = audioBytes / 2 / 24000;
  console.log(
    `\n  audio: ${audioBytes.toLocaleString()} bytes ≈ ${seconds.toFixed(1)}s of speech` +
      `${firstAudioAt ? ` · first byte ${firstAudioAt}ms` : ' · NONE'}`,
  );
  console.log(`  ${transcript ? '\x1b[32m✓ end to end OK\x1b[0m' : '\x1b[31m✗ no transcript\x1b[0m'}\n`);
  socket.close();
  process.exit(transcript ? 0 : 1);
}, 25_000);
