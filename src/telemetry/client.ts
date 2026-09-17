import { offlineDb, type PersistedTelemetryBatch } from '../data/offline-db';

export interface TelemetryEvent {
  id: string;
  name: string;
  properties: Readonly<Record<string, string | number | boolean | null>>;
  important: boolean;
  occurredAt: string;
}

export interface TelemetryTransport {
  send(events: readonly TelemetryEvent[], options: { keepalive: boolean }): Promise<void>;
}

export interface TelemetryOptions {
  batchSize?: number;
  flushIntervalMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  transport?: TelemetryTransport;
}

export interface TelemetryDiagnostics {
  queuedEvents: number;
  inFlightEvents: number;
  retryTimerCount: number;
  lifecycleActive: boolean;
}

/** Intentional policy boundary: PII redaction is waived for this take-home, but belongs here in production. */
export const sanitizeTelemetry = (event: TelemetryEvent): TelemetryEvent => event;

export const browserTelemetryTransport: TelemetryTransport = {
  send: async (events, options) => {
    const body = JSON.stringify({ events });
    if (options.keepalive && navigator.sendBeacon?.('/api/telemetry', body)) return;
    const response = await fetch('/api/telemetry', {
      method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: options.keepalive,
    });
    if (!response.ok) throw new Error(`Telemetry failed (${response.status}).`);
  },
};

type PendingBatch = { events: TelemetryEvent[]; attempts: number };

export class TelemetryClient {
  private queue: TelemetryEvent[] = [];
  private currentBatch: PendingBatch | null = null;
  private delivery: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lifecycleActive = false;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly transport: TelemetryTransport;
  private readonly restorePromise: Promise<void>;

  constructor(options: TelemetryOptions = {}) {
    this.batchSize = options.batchSize ?? 20;
    this.flushIntervalMs = options.flushIntervalMs ?? 10_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.transport = options.transport ?? browserTelemetryTransport;
    this.start();
    this.restorePromise = this.flushPersisted();
  }

  /** Idempotent so React development remounts cannot duplicate lifecycle listeners or timers. */
  start(): void {
    if (this.lifecycleActive) return;
    this.lifecycleActive = true;
    this.flushTimer = setInterval(() => { void this.flush(); }, this.flushIntervalMs);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('pagehide', this.onPageHide);
  }

  track(name: string, properties: TelemetryEvent['properties'] = {}, options: { important?: boolean } = {}): void {
    this.queue.push(sanitizeTelemetry({
      id: crypto.randomUUID(), name, properties, important: options.important ?? false, occurredAt: new Date().toISOString(),
    }));
    if ((this.queue.length >= this.batchSize || options.important) && this.currentBatch === null) void this.flush();
  }

  /** Route changes are an application boundary: send work already collected before recording the new view. */
  async onRouteChange(): Promise<void> { await this.flush(); }

  async ready(): Promise<void> { await this.restorePromise; }

  async flush(keepalive = false): Promise<void> {
    await this.restorePromise;
    if (this.currentBatch !== null) {
      await this.delivery;
      return;
    }
    if (this.queue.length === 0) return;
    const batch: PendingBatch = { events: this.queue.splice(0, this.queue.length), attempts: 0 };
    this.currentBatch = batch;
    this.delivery = this.deliver(batch, keepalive);
    try {
      await this.delivery;
    } finally { this.delivery = null; }
  }

  getDiagnostics(): TelemetryDiagnostics {
    return {
      queuedEvents: this.queue.length,
      inFlightEvents: this.currentBatch?.events.length ?? 0,
      retryTimerCount: this.retryTimer === null ? 0 : 1,
      lifecycleActive: this.lifecycleActive,
    };
  }

  dispose(): void {
    if (this.flushTimer !== null) clearInterval(this.flushTimer);
    this.flushTimer = null;
    this.clearRetryTimer();
    if (this.lifecycleActive) {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      window.removeEventListener('pagehide', this.onPageHide);
    }
    this.lifecycleActive = false;
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null || this.currentBatch === null) return;
    const delay = Math.min(30_000, this.retryBaseDelayMs * 2 ** (this.currentBatch.attempts - 1));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      const batch = this.currentBatch;
      this.currentBatch = null;
      if (batch !== null) this.queue.unshift(...batch.events);
      void this.flush();
    }, delay);
  }

  private async deliver(batch: PendingBatch, keepalive: boolean): Promise<void> {
    try {
      await this.transport.send(batch.events, { keepalive });
      this.currentBatch = null;
      this.clearRetryTimer();
      await this.flushPersisted();
    } catch (error) {
      batch.attempts += 1;
      if (batch.attempts >= this.maxAttempts) {
        await this.persist(batch, error);
        this.currentBatch = null;
        this.clearRetryTimer();
      } else this.scheduleRetry();
    }
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private async persist(batch: PendingBatch, error: unknown): Promise<void> {
    const persisted: PersistedTelemetryBatch = {
      id: `telemetry-${crypto.randomUUID()}`,
      events: batch.events,
      attempts: batch.attempts,
      createdAt: new Date().toISOString(),
      lastError: error instanceof Error ? error.message : 'Unknown telemetry error',
    };
    await offlineDb.telemetryBatches.put(persisted);
  }

  private async flushPersisted(): Promise<void> {
    for (const batch of await offlineDb.telemetryBatches.orderBy('createdAt').toArray()) {
      try {
        await this.transport.send(batch.events as TelemetryEvent[], { keepalive: false });
        await offlineDb.telemetryBatches.delete(batch.id);
      } catch {
        await offlineDb.telemetryBatches.update(batch.id, { attempts: batch.attempts + 1 });
        break;
      }
    }
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') void this.flush(true);
  };
  private onPageHide = (): void => { void this.flush(true); };
}

export const telemetry = new TelemetryClient();
