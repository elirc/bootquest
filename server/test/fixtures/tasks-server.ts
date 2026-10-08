import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Tiny learner-style "tasks API" (node:http, no deps) that the http-check
 * fixture lesson (check-lessons.json, fixture:http-tasks-api) is written
 * against. Variants model a learner's server:
 *   good         satisfies every request of the lesson
 *   wrong-shape  POST answers 201 but `id` is a string and `done` is missing;
 *                GET /api/tasks returns a bare array instead of {items: [...]}
 *   wrong-status POST answers 200 instead of 201
 *   no-json      /health answers text/plain "ok"
 * Listens on an OS-assigned free port; `host` defaults to 127.0.0.1.
 */
export type TasksVariant = 'good' | 'wrong-shape' | 'wrong-status' | 'no-json';

export interface RunningFixture {
  port: number;
  server: Server;
  close(): Promise<void>;
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8'): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((ok) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        ok(raw ? JSON.parse(raw) : null);
      } catch {
        ok(null);
      }
    });
  });
}

export function startTasksServer(variant: TasksVariant = 'good', host = '127.0.0.1'): Promise<RunningFixture> {
  const tasks: { id: number; title: string; done: boolean }[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://fixture');
      if (req.method === 'GET' && url.pathname === '/health') {
        if (variant === 'no-json') return send(res, 200, 'ok', 'text/plain');
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/tasks') {
        const body = (await readJson(req)) as { title?: unknown } | null;
        if (!body || typeof body.title !== 'string' || !body.title.trim()) return send(res, 400, { error: 'title required' });
        const task = { id: tasks.length + 1, title: body.title, done: false };
        tasks.push(task);
        if (variant === 'wrong-shape') return send(res, 201, { id: String(task.id), title: task.title });
        return send(res, variant === 'wrong-status' ? 200 : 201, task);
      }
      if (req.method === 'GET' && url.pathname === '/api/tasks') {
        if (variant === 'wrong-shape') return send(res, 200, tasks);
        return send(res, 200, { items: tasks });
      }
      return send(res, 404, { error: 'not found' });
    })();
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, host, () => {
      const port = (server.address() as AddressInfo).port;
      ok({
        port,
        server,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
