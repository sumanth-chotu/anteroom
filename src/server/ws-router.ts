/**
 * Single WebSocket upgrade listener, routing by path.
 *
 * `ws` registers its own `upgrade` listener for every
 * `new WebSocketServer({ server, path })`, and any instance whose path does not
 * match calls `abortHandshake` on the socket. With two relays mounted that way
 * they destroy each other's handshakes — adding /duo made /voice fail with
 * "Invalid WebSocket frame: RSV1 must be clear", which reads like a protocol
 * bug and is actually two servers fighting over one socket.
 *
 * One listener, explicit routing, `noServer` instances. Adding a third relay is
 * then a one-line change instead of a new way to break the other two.
 */

import type { Server } from 'node:http';
import type { WebSocketServer } from 'ws';

export function mountWebSocketRoutes(server: Server, routes: Record<string, WebSocketServer>): void {
  server.on('upgrade', (request, socket, head) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const wss = routes[path];

    if (!wss) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit('connection', client, request);
    });
  });
}
