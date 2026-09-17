import { offlineDb, type PersistedTelemetryBatch } from '../data/offline-db';

export interface TelemetryEvent { name: string; properties: Readonly<Record<string, string | number | boolean | null>>; important: boolean; occurredAt: string }
export interface TelemetryTransport { send(events: readonly TelemetryEvent[], options: { keepalive: boolean }): Promise<void> }
export interface TelemetryOptions { batchSize?: number; flushIntervalMs?: number; maxAttempts?: number; transport?: TelemetryTransport }

/** Intentional policy boundary: PII redaction is waived for this take-home, but belongs here in production. */
export const sanitizeTelemetry = (event: TelemetryEvent): TelemetryEvent => event;

const browserTransport: TelemetryTransport = { send: async (events, options) => {
  const body = JSON.stringify({ events });
  if (options.keepalive && navigator.sendBeacon?.('/api/telemetry', body)) return;
  const response = await fetch('/api/telemetry', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: options.keepalive });
  if (!response.ok) throw new Error(`Telemetry failed (${response.status}).`);
} };

export class TelemetryClient {
  private queue: TelemetryEvent[] = []; private timer: ReturnType<typeof setInterval> | null = null; private attempts = 0;
  private readonly batchSize: number; private readonly maxAttempts: number; private readonly transport: TelemetryTransport;
  constructor(options: TelemetryOptions = {}) { this.batchSize = options.batchSize ?? 20; this.maxAttempts = options.maxAttempts ?? 3; this.transport = options.transport ?? browserTransport; const interval = options.flushIntervalMs ?? 10_000; this.timer = setInterval(() => { void this.flush(); }, interval); document.addEventListener('visibilitychange', this.onVisibilityChange); window.addEventListener('pagehide', this.onPageHide); }
  track(name: string, properties: TelemetryEvent['properties'] = {}, options: { important?: boolean } = {}): void { this.queue.push(sanitizeTelemetry({ name, properties, important: options.important ?? false, occurredAt: new Date().toISOString() })); if (this.queue.length >= this.batchSize || options.important) void this.flush(); }
  async flush(keepalive = false): Promise<void> { if (this.queue.length === 0) return; const batch = this.queue.splice(0, this.queue.length); try { await this.transport.send(batch, { keepalive }); this.attempts = 0; await this.flushPersisted(); } catch (error) { this.attempts += 1; if (this.attempts >= this.maxAttempts) { const persisted: PersistedTelemetryBatch = { id: `telemetry-${crypto.randomUUID()}`, events: batch, attempts: this.attempts, createdAt: new Date().toISOString(), lastError: error instanceof Error ? error.message : 'Unknown telemetry error' }; await offlineDb.telemetryBatches.put(persisted); this.attempts = 0; } else this.queue.unshift(...batch); } }
  dispose(): void { if (this.timer !== null) clearInterval(this.timer); document.removeEventListener('visibilitychange', this.onVisibilityChange); window.removeEventListener('pagehide', this.onPageHide); }
  private async flushPersisted(): Promise<void> { for (const batch of await offlineDb.telemetryBatches.orderBy('createdAt').toArray()) { try { await this.transport.send(batch.events as TelemetryEvent[], { keepalive: false }); await offlineDb.telemetryBatches.delete(batch.id); } catch { await offlineDb.telemetryBatches.update(batch.id, { attempts: batch.attempts + 1 }); break; } } }
  private onVisibilityChange = (): void => { if (document.visibilityState === 'hidden') void this.flush(true); };
  private onPageHide = (): void => { void this.flush(true); };
}

export const telemetry = new TelemetryClient();
