import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { JwtPayload } from '../utils/jwt.js';
import { verifyToken } from '../utils/jwt.js';

const clients = new Map<string, Set<WebSocket>>();

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Missing token');
      return;
    }

    let payload: JwtPayload;
    try {
      payload = await verifyToken(token);
    } catch {
      ws.close(4001, 'Invalid token');
      return;
    }

    const uid = payload.sub;
    if (!clients.has(uid)) clients.set(uid, new Set());
    clients.get(uid)!.add(ws);

    ws.on('close', () => {
      clients.get(uid)?.delete(ws);
      if (clients.get(uid)?.size === 0) clients.delete(uid);
    });

    // Send welcome
    ws.send(JSON.stringify({ type: 'connected', uid }));
  });
}

export function notifyUser(
  userId: string,
  data: Record<string, unknown>,
): void {
  const sockets = clients.get(userId);
  if (sockets) {
    const msg = JSON.stringify(data);
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }
}
