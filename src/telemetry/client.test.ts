import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { offlineDb } from '../data/offline-db';
import { TelemetryClient } from './client';

describe('TelemetryClient', () => {
  beforeEach(async () => { await offlineDb.telemetryBatches.clear(); });
  it('batches and flushes events', async () => { const sent: number[] = []; const client = new TelemetryClient({ batchSize: 2, transport: { send: async (events) => { sent.push(events.length); } } }); client.track('one'); client.track('two'); await new Promise((resolve) => setTimeout(resolve, 0)); expect(sent).toEqual([2]); client.dispose(); });
  it('persists repeatedly failed batches for later delivery', async () => { const client = new TelemetryClient({ maxAttempts: 1, transport: { send: async () => { throw new Error('offline'); } } }); client.track('failure'); await client.flush(); expect(await offlineDb.telemetryBatches.count()).toBe(1); client.dispose(); });
});
