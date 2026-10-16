import { WebSocketServer } from 'ws';
import { dropEvents } from './services/events.js';
import { getSenderView } from './services/drop.js';

/**
 * Live updates for the sender. A client connects to /ws and must send
 * { type: 'auth', dropId, token } within 5 seconds; it then receives a snapshot and
 * every later event for that drop (accessed, downloaded, destroyed).
 */
export function attachWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });
  const rooms = new Map(); // dropId -> Set<WebSocket>

  const leave = (socket) => {
    const room = socket.dropId && rooms.get(socket.dropId);
    if (!room) return;
    room.delete(socket);
    if (!room.size) rooms.delete(socket.dropId);
  };

  wss.on('connection', (socket) => {
    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });

    const authTimer = setTimeout(() => socket.close(4408, 'auth timeout'), 5000);

    socket.on('message', async (raw) => {
      if (socket.dropId) return;
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type !== 'auth') throw new Error('expected auth');
        const view = await getSenderView(String(msg.dropId), msg.token);
        if (!view) return socket.close(4401, 'unauthorized');

        clearTimeout(authTimer);
        socket.dropId = view.dropId;
        if (!rooms.has(view.dropId)) rooms.set(view.dropId, new Set());
        rooms.get(view.dropId).add(socket);
        socket.send(JSON.stringify({ type: 'snapshot', ...view }));
      } catch {
        socket.close(4400, 'bad request');
      }
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      leave(socket);
    });
    socket.on('error', () => socket.terminate());
  });

  const forward = (event) => {
    const room = rooms.get(event.dropId);
    if (!room) return;
    const payload = JSON.stringify(event);
    for (const socket of room) if (socket.readyState === 1) socket.send(payload);
  };
  dropEvents.on('drop', forward);

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, 30_000);
  heartbeat.unref();

  wss.on('close', () => {
    clearInterval(heartbeat);
    dropEvents.off('drop', forward);
  });

  return wss;
}
