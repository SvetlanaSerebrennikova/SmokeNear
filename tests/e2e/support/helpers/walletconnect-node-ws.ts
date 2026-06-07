import { WebSocket as NodeWebSocket } from 'ws';

const g = globalThis as typeof globalThis & {
  WebSocket?: typeof globalThis.WebSocket;
};

/**
 * Node 21 ships `WebSocket` without `terminate()`.
 * `@walletconnect/core` heartbeat calls `socket.terminate()` — polyfill avoids TypeError.
 */
if (
  typeof g.WebSocket === 'undefined' ||
  typeof (g.WebSocket.prototype as { terminate?: () => void }).terminate !== 'function'
) {
  g.WebSocket = NodeWebSocket as unknown as typeof globalThis.WebSocket;
}
