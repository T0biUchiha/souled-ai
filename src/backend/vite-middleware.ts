import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { ListNotesQuery, SaveVersionRequest, TransitionRequest } from './contracts';
import { DummyBackendStore } from './store';
import { mulberry32 } from './seed';

export interface DummyBackendConfig {
  seedCount?: number;
  latencyMinMs?: number;
  latencyMaxMs?: number;
  failureRate?: number;
  randomSeed?: number;
}

const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(body));
};

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const single = (value: string | string[] | undefined): string | undefined => Array.isArray(value) ? value[0] : value;
const list = (value: string | string[] | undefined): readonly string[] | undefined => {
  const parsed = single(value)?.split(',').filter(Boolean);
  return parsed === undefined || parsed.length === 0 ? undefined : parsed;
};

const queryFrom = (url: URL): ListNotesQuery => {
  const query: ListNotesQuery = {};
  const cursor = url.searchParams.get('cursor'); if (cursor !== null) query.cursor = cursor;
  const limit = url.searchParams.get('limit'); if (limit !== null) query.limit = Number(limit);
  const statuses = list(url.searchParams.get('status') ?? undefined); if (statuses !== undefined) query.statuses = statuses as NonNullable<ListNotesQuery['statuses']>;
  const reviewer = url.searchParams.get('reviewer'); if (reviewer !== null) query.reviewerId = reviewer;
  const patient = url.searchParams.get('patient'); if (patient !== null) query.patient = patient;
  const from = url.searchParams.get('from'); if (from !== null) query.from = from;
  const to = url.searchParams.get('to'); if (to !== null) query.to = to;
  const search = url.searchParams.get('search'); if (search !== null) query.search = search;
  const sort = url.searchParams.get('sort'); if (sort !== null) query.sort = sort as NonNullable<ListNotesQuery['sort']>;
  const direction = url.searchParams.get('direction'); if (direction !== null) query.direction = direction as NonNullable<ListNotesQuery['direction']>;
  return query;
};

export const createDummyBackendPlugin = (config: DummyBackendConfig = {}): Plugin => {
  const store = new DummyBackendStore({ seedCount: config.seedCount ?? 5_000 });
  const random = mulberry32(config.randomSeed ?? 2026);
  const latencyMinMs = config.latencyMinMs ?? 100;
  const latencyMaxMs = config.latencyMaxMs ?? 800;
  const failureRate = config.failureRate ?? 0.05;
  const delay = (): Promise<void> => new Promise((resolve) => {
    const milliseconds = latencyMinMs + Math.floor(random() * (latencyMaxMs - latencyMinMs + 1));
    setTimeout(resolve, milliseconds);
  });
  const shouldFail = (): boolean => random() < failureRate;

  return {
    name: 'clinical-note-dummy-backend',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/api/')) return next();
        try {
          if (url.pathname === '/api/dev/seed' && request.method === 'POST') {
            const body = await readBody(request);
            const count = typeof body === 'object' && body !== null && 'count' in body && typeof body.count === 'number' ? body.count : 5_000;
            store.seed(count); return json(response, 200, { count });
          }
          if (url.pathname === '/api/dev/reset' && request.method === 'POST') {
            store.reset(); return json(response, 200, { ok: true });
          }
          await delay();
          if (shouldFail()) return json(response, 503, { error: 'transient_server_error', message: 'Injected development failure.', retryable: true });
          if (url.pathname === '/api/notes' && request.method === 'GET') return json(response, 200, store.listNotes(queryFrom(url)));
          const match = /^\/api\/notes\/([^/]+)(?:\/(versions|transitions))?$/.exec(url.pathname);
          if (match === null) return json(response, 404, { error: 'not_found', message: 'Endpoint not found.' });
          const noteId = decodeURIComponent(match[1]!);
          const resource = match[2];
          if (resource === undefined && request.method === 'GET') {
            const result = store.getNote(noteId); return json(response, result.ok ? 200 : result.status, result.ok ? result.data : result.error);
          }
          const body = await readBody(request);
          if (resource === 'versions' && request.method === 'POST') {
            const result = store.saveVersion(noteId, body as SaveVersionRequest);
            return json(response, result.ok ? 201 : result.status, result.ok ? result.data : result.error);
          }
          if (resource === 'transitions' && request.method === 'POST') {
            const result = store.transition(noteId, body as TransitionRequest);
            return json(response, result.ok ? 200 : result.status, result.ok ? result.data : result.error);
          }
          return json(response, 405, { error: 'invalid_request', message: 'Method not allowed.' });
        } catch {
          return json(response, 400, { error: 'invalid_request', message: 'Malformed request payload.' });
        }
      });
    },
  };
};
