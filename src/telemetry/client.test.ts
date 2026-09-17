import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DummyBackendStore } from '../backend/store';
import { offlineDb } from '../data/offline-db';
import { browserTelemetryTransport, TelemetryClient, type TelemetryEvent, type TelemetryTransport } from './client';

const sentTransport = (batches: TelemetryEvent[][]): TelemetryTransport => ({
  send: async (events) => { batches.push([...events]); },
});

describe('TelemetryClient lifecycle', () => {
  const clients: TelemetryClient[] = [];
  const create = (options: ConstructorParameters<typeof TelemetryClient>[0] = {}): TelemetryClient => {
    const client = new TelemetryClient(options);
    clients.push(client);
    return client;
  };

  beforeEach(async () => { await offlineDb.telemetryBatches.clear(); });
  afterEach(async () => {
    clients.splice(0).forEach((client) => client.dispose());
    vi.useRealTimers();
    vi.restoreAllMocks();
    await offlineDb.telemetryBatches.clear();
  });

  it('flushes an ordered batch when the size threshold is reached', async () => {
    const sent: TelemetryEvent[][] = [];
    const client = create({ batchSize: 3, transport: sentTransport(sent) });
    await client.ready();
    client.track('A'); client.track('B');
    expect(sent).toEqual([]);
    client.track('C');
    await client.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.map((event) => event.name)).toEqual(['A', 'B', 'C']);
    expect(client.getDiagnostics()).toMatchObject({ queuedEvents: 0, inFlightEvents: 0 });
  });

  it('flushes exactly once at the configured time threshold', async () => {
    vi.useFakeTimers();
    const sent: TelemetryEvent[][] = [];
    const client = create({ flushIntervalMs: 1_000, transport: sentTransport(sent) });
    await client.ready();
    client.track('timer');
    await vi.advanceTimersByTimeAsync(999);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]![0]!.name).toBe('timer');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent).toHaveLength(1);
  });

  it('flushes pending work at the public route-change boundary', async () => {
    const sent: TelemetryEvent[][] = [];
    const client = create({ transport: sentTransport(sent) });
    await client.ready();
    client.track('before-route');
    await client.onRouteChange();
    expect(sent).toHaveLength(1);
    expect(sent[0]![0]!.name).toBe('before-route');
  });

  it('flushes with keepalive when the document becomes hidden', async () => {
    const send = vi.fn<TelemetryTransport['send']>().mockResolvedValue(undefined);
    const client = create({ transport: { send } });
    await client.ready();
    client.track('hidden');
    const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await client.flush();
    if (visibility !== undefined) Object.defineProperty(document, 'visibilityState', visibility);
    expect(send).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ name: 'hidden' })]), { keepalive: true });
  });

  it('attempts a keepalive delivery on pagehide without blocking the page lifecycle', async () => {
    const send = vi.fn<TelemetryTransport['send']>().mockResolvedValue(undefined);
    const client = create({ transport: { send } });
    await client.ready();
    client.track('unload');
    window.dispatchEvent(new Event('pagehide'));
    await client.flush();
    expect(send).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ name: 'unload' })]), { keepalive: true });
  });

  it('retries one failed batch with exponential backoff and preserves event identity', async () => {
    vi.useFakeTimers();
    const send = vi.fn<TelemetryTransport['send']>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    const client = create({ retryBaseDelayMs: 100, maxAttempts: 3, transport: { send } });
    await client.ready();
    client.track('retry');
    await client.flush();
    const failedEvent = send.mock.calls[0]![0][0]!;
    expect(client.getDiagnostics()).toMatchObject({ inFlightEvents: 1, retryTimerCount: 1 });
    await vi.advanceTimersByTimeAsync(99);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0][0]!.id).toBe(failedEvent.id);
    expect(client.getDiagnostics()).toMatchObject({ inFlightEvents: 0, retryTimerCount: 0 });
  });

  it('parks a retry-exhausted batch in IndexedDB without changing its event IDs', async () => {
    const client = create({ maxAttempts: 1, transport: { send: async () => { throw new Error('offline'); } } });
    await client.ready();
    client.track('parked', { value: 1 });
    await client.flush();
    const persisted = await offlineDb.telemetryBatches.toArray();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.attempts).toBe(1);
    expect(persisted[0]!.events).toEqual([expect.objectContaining({ name: 'parked', properties: { value: 1 }, id: expect.any(String) })]);
  });

  it('recovers a persisted batch on initialization and clears it only after acknowledgement', async () => {
    const failed = create({ maxAttempts: 1, transport: { send: async () => { throw new Error('offline'); } } });
    await failed.ready();
    failed.track('recover');
    await failed.flush();
    const parked = (await offlineDb.telemetryBatches.toArray())[0]!;
    const eventId = (parked.events[0] as TelemetryEvent).id;

    const sent: TelemetryEvent[][] = [];
    const recovered = create({ transport: sentTransport(sent) });
    await recovered.ready();
    expect(sent).toHaveLength(1);
    expect(sent[0]![0]!.id).toBe(eventId);
    expect(await offlineDb.telemetryBatches.count()).toBe(0);
  });

  it('does not block a note save when telemetry delivery fails', async () => {
    const telemetry = create({ maxAttempts: 1, transport: { send: async () => { throw new Error('telemetry unavailable'); } } });
    await telemetry.ready();
    telemetry.track('save_clicked');
    await telemetry.flush();

    const store = new DummyBackendStore({ seedCount: 1, now: () => '2026-09-17T12:00:00.000Z' });
    const result = store.saveVersion('note-1', {
      baseVersionId: 'version-1-1', clientMutationId: 'telemetry-regression',
      actor: { id: 'clinician-1', displayName: 'Clinician', roles: ['CLINICIAN'] },
      content: { subjective: 's', objective: 'o', assessment: 'a', plan: 'p' },
    });
    expect(result).toMatchObject({ ok: true, data: { id: 'version-1-2' } });
  });

  it('starts lifecycle handling once and fully cleans up its timers and listeners', async () => {
    const documentAdd = vi.spyOn(document, 'addEventListener');
    const documentRemove = vi.spyOn(document, 'removeEventListener');
    const windowAdd = vi.spyOn(window, 'addEventListener');
    const windowRemove = vi.spyOn(window, 'removeEventListener');
    const client = create({ transport: sentTransport([]) });
    client.start(); client.start();
    expect(documentAdd.mock.calls.filter(([name]) => name === 'visibilitychange')).toHaveLength(1);
    expect(windowAdd.mock.calls.filter(([name]) => name === 'pagehide')).toHaveLength(1);
    client.dispose();
    expect(documentRemove.mock.calls.filter(([name]) => name === 'visibilitychange')).toHaveLength(1);
    expect(windowRemove.mock.calls.filter(([name]) => name === 'pagehide')).toHaveLength(1);
    expect(client.getDiagnostics()).toMatchObject({ retryTimerCount: 0, lifecycleActive: false });
  });

  it('treats only successful transport responses as delivered and prefers sendBeacon on unload', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const event: TelemetryEvent = { id: 'event-1', name: 'transport', properties: {}, important: false, occurredAt: '2026-01-01T00:00:00.000Z' };
    await expect(browserTelemetryTransport.send([event], { keepalive: false })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/telemetry', expect.objectContaining({ keepalive: false }));

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(browserTelemetryTransport.send([event], { keepalive: false })).rejects.toThrow('Telemetry failed (500)');

    const originalBeacon = Object.getOwnPropertyDescriptor(navigator, 'sendBeacon');
    const beacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon });
    await expect(browserTelemetryTransport.send([event], { keepalive: true })).resolves.toBeUndefined();
    expect(beacon).toHaveBeenCalledWith('/api/telemetry', expect.stringContaining('event-1'));
    if (originalBeacon === undefined) delete (navigator as { sendBeacon?: unknown }).sendBeacon;
    else Object.defineProperty(navigator, 'sendBeacon', originalBeacon);
  });
});
