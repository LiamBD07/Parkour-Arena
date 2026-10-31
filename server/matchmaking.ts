import { WebSocket, WebSocketServer } from 'ws';
import type { Server, IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Database } from './db.js';
import { sessionPlayer } from './auth.js';
import { getPlayer } from './app.js';
import { z } from 'zod';
import { POSES } from '../shared/movement.js';
import { managedAuthEnabled, managedPlayer } from './neon-auth.js';

interface Member {
  id: string;
  name: string;
  skin: string;
  mmr: number;
  classId: string;
  bot: boolean;
}
interface Client extends Member {
  ws: WebSocket;
  map: string;
  region: string;
  queuedAt: number;
  room?: string;
  lastState: number;
}
interface Room {
  id: string;
  clients: Client[];
  members: Member[];
  created: number;
}
const joinSchema = z.object({
  type: z.literal('join'),
  map: z.enum(['skyline', 'foundry', 'harbor']),
  classId: z.enum(['runner', 'traceur', 'acrobat']),
  region: z.string().max(60),
  token: z.string().max(12000).optional(),
});
const stateSchema = z.object({
  type: z.literal('state'),
  p: z.tuple([
    z.number().min(-70).max(70),
    z.number().min(-20).max(45),
    z.number().min(-20).max(180),
  ]),
  yaw: z.number().min(-100).max(100),
  pose: z.enum(POSES),
  phase: z.number().min(0).max(1).optional(),
  wallSide: z.number().min(-1).max(1).optional(),
  progress: z.number().min(0).max(1),
  finished: z.number().min(8000).max(600000).optional(),
});
export function attachMatchmaking(server: Server, db: Database) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 40000 });
  const clients = new Map<string, Client>();
  const rooms = new Map<string, Room>();
  const send = (ws: WebSocket, data: unknown) => {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 100000)
      ws.send(JSON.stringify(data));
  };
  const membersOf = (c: Client) => (c.room ? rooms.get(c.room)?.clients || [] : []);
  server.on('upgrade', async (req: IncomingMessage, socket, head) => {
    if (req.url?.split('?')[0] !== '/arena') return;
    const origin = req.headers.origin;
    if (
      origin &&
      origin !== (process.env.APP_ORIGIN || 'http://localhost:3000').replace(/\/$/, '')
    ) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    if (clients.size >= 200) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', async (ws, req) => {
    const id = randomUUID();
    const client: Client = {
      id,
      ws,
      name: `Guest_${id.slice(0, 4)}`,
      skin: 'standard',
      mmr: 1000,
      classId: 'runner',
      bot: false,
      map: '',
      region: '',
      queuedAt: 0,
      lastState: 0,
    };
    clients.set(id, client);
    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 30000);
    ws.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(id);
      for (const other of membersOf(client))
        if (other.id !== id) send(other.ws, { type: 'disconnected', id });
      if (client.room) {
        const room = rooms.get(client.room);
        if (room) {
          room.clients = room.clients.filter((c) => c.id !== id);
          if (!room.clients.length) rooms.delete(room.id);
        }
      }
    });
    ws.on('error', () => ws.close());
    try {
      const cookie = req.headers.cookie
        ?.split(';')
        .find((c) => c.trim().startsWith('pa_session='))
        ?.trim()
        .slice('pa_session='.length);
      const playerId = await sessionPlayer(db, { cookies: { pa_session: cookie } });
      if (playerId) {
        const p = await getPlayer(db, playerId);
        client.name = p.username;
        client.skin = p.equipped;
        client.mmr = p.mmr;
      }
    } catch {
      send(ws, { type: 'error', error: 'Account unavailable; joining as a guest.' });
    }
    if (ws.readyState !== WebSocket.OPEN) return;
    send(ws, { type: 'hello', id, name: client.name });
    let messages = 0;
    const budget = setInterval(() => {
      messages = 0;
    }, 1000);
    ws.on('close', () => clearInterval(budget));
    let joining = false;
    ws.on('message', async (data) => {
      if (++messages > 40) {
        ws.close(1008, 'Message rate exceeded');
        return;
      }
      try {
        const raw = JSON.parse(data.toString());
        if (raw.type === 'join' && !client.room) {
          if (joining || client.queuedAt) return;
          joining = true;
          const join = joinSchema.parse(raw);
          if (managedAuthEnabled() && join.token) {
            const p = await getPlayer(db, await managedPlayer(db, join.token));
            client.name = p.username;
            client.skin = p.equipped;
            client.mmr = p.mmr;
          }
          if (ws.readyState !== WebSocket.OPEN) return;
          client.map = join.map;
          client.region = join.region;
          client.classId = join.classId;
          client.queuedAt = Date.now();
          send(ws, { type: 'queued', waiting: 1, wait: 12 });
        } else if (raw.type === 'signal' && client.room) {
          const signal = z.object({ to: z.string().max(40), data: z.unknown() }).parse(raw);
          const target = membersOf(client).find((c) => c.id === signal.to && c.id !== client.id);
          if (target) send(target.ws, { type: 'signal', from: id, data: signal.data });
        } else if (raw.type === 'state' && client.room && Date.now() - client.lastState >= 65) {
          const state = stateSchema.parse(raw);
          client.lastState = Date.now();
          for (const other of membersOf(client))
            if (other.id !== id) send(other.ws, { ...state, id });
        } else if (raw.type === 'leave') {
          ws.close(1000);
        }
      } catch {
        send(ws, { type: 'error', error: 'Invalid arena message.' });
      } finally {
        joining = false;
      }
    });
  });
  const interval = setInterval(() => {
    const queue = [...clients.values()]
      .filter((c) => c.queuedAt && !c.room)
      .sort((a, b) => a.queuedAt - b.queuedAt);
    for (const first of queue) {
      if (first.room) continue;
      // Region preference, then provisional MMR. The queue widens after 6 seconds.
      const elapsed = Date.now() - first.queuedAt;
      const group = queue
        .filter(
          (c) =>
            !c.room &&
            c.map === first.map &&
            (elapsed > 6000 || c.region === first.region) &&
            Math.abs(c.mmr - first.mmr) < 450,
        )
        .slice(0, 4);
      if (group.length < 4 && elapsed < 12000) {
        for (const c of group)
          send(c.ws, {
            type: 'queued',
            waiting: group.length,
            wait: Math.max(0, Math.ceil((12000 - elapsed) / 1000)),
          });
        continue;
      }
      const id = randomUUID();
      const members: Member[] = group.map((c) => ({
        id: c.id,
        name: c.name,
        skin: c.skin,
        mmr: c.mmr,
        classId: c.classId,
        bot: false,
      }));
      const names = ['ECHO', 'VECTOR', 'DRIFT', 'APEX'];
      for (let i = members.length; i < 4; i++)
        members.push({
          id: `bot-${id}-${i}`,
          name: names[i],
          skin: ['carbon', 'ember', 'violet', 'chalk'][i],
          mmr: first.mmr + i * 15,
          classId: 'runner',
          bot: true,
        });
      const room: Room = { id, clients: group, members, created: Date.now() };
      rooms.set(id, room);
      for (const c of group) {
        c.room = id;
        c.queuedAt = 0;
        send(c.ws, {
          type: 'matched',
          room: id,
          map: first.map,
          members,
          startsAt: Date.now() + 4500,
        });
      }
    }
    for (const room of rooms.values())
      if (Date.now() - room.created > 900000) {
        for (const c of room.clients) c.ws.close(1000, 'Race expired');
        rooms.delete(room.id);
      }
  }, 500);
  return () => {
    clearInterval(interval);
    for (const c of clients.values()) c.ws.terminate();
    wss.close();
  };
}
