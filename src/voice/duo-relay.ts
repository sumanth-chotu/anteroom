/**
 * WebSocket wrapper around the two-agent demo, so the UI can watch it live.
 *
 * The CLI (`npm run duo`) is the better tool for producing a script — it writes
 * markdown and a .wav. This exists so the demo can be *shown*: transcripts and
 * findings appear as they happen, and both voices play in the browser.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';

import { runDuo } from './duo.ts';
import type { PreReadMemo } from '../preread/types.ts';

/** `noServer` — mounted by `server/ws-router.ts`. See the note in relay.ts. */
export function createDuoRelay(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (client: WebSocket, request: IncomingMessage) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const profileId = url.searchParams.get('profile') ?? 'seed_skeptic';
    const founderId = url.searchParams.get('founder') ?? 'sentinel';
    const maxTurns = Number(url.searchParams.get('turns') ?? 6);

    client.once('message', (raw) => {
      let memo: PreReadMemo | undefined;
      try {
        memo = (JSON.parse(raw.toString()) as { memo?: PreReadMemo }).memo;
      } catch {
        /* no memo */
      }

      void runDuo({
        profileId,
        founderId,
        ...(memo ? { memo } : {}),
        maxTurns,
        onEvent: (event) => {
          if (client.readyState !== WebSocket.OPEN) return;
          // Audio goes as binary so the browser can play it without a base64
          // round trip; everything else is JSON.
          if (event.kind === 'audio') {
            client.send(Buffer.from(event.base64, 'base64'), { binary: true });
          } else {
            client.send(JSON.stringify(event));
          }
        },
      }).finally(() => client.close());
    });
  });

  return wss;
}
