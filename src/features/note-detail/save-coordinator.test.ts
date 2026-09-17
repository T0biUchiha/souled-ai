import { describe, expect, it, vi } from 'vitest';
import { SaveCoordinator } from './save-coordinator';

const settle = async (): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, 5)); };

describe('SaveCoordinator', () => {
  it('coalesces edits made while a save is in flight without concurrent writes', async () => {
    let resolveFirst: ((value: string) => void) | undefined; let active = 0; let maximumActive = 0;
    const saves: string[] = [];
    const coordinator = new SaveCoordinator<string, string>({ debounceMs: 0, prepare: (content) => ({ baseVersionId: 'v1', content, clientMutationId: content }), save: (request) => { saves.push(request.content); active += 1; maximumActive = Math.max(maximumActive, active); return new Promise((resolve) => { resolveFirst = (value) => { active -= 1; resolve(value); }; }); }, onSaved: () => undefined, onFailed: () => undefined });
    coordinator.schedule('first'); await settle(); expect(saves).toEqual(['first']);
    coordinator.schedule('second'); coordinator.schedule('third'); expect(saves).toEqual(['first']);
    resolveFirst!('v2'); await settle(); expect(saves).toEqual(['first', 'third']);
    expect(maximumActive).toBe(1);
  });

  it('retries the same failed mutation ID', async () => {
    const sent: string[] = []; let attempt = 0;
    const coordinator = new SaveCoordinator<string, string>({ debounceMs: 0, prepare: (content) => ({ baseVersionId: 'v1', content, clientMutationId: 'fixed-id' }), save: async (request) => { sent.push(request.clientMutationId); attempt += 1; if (attempt === 1) throw new Error('offline'); return 'saved'; }, onSaved: () => undefined, onFailed: () => undefined });
    coordinator.flush('draft'); await settle(); expect(sent).toHaveLength(1); coordinator.retryFailed(); await settle(); expect(sent).toHaveLength(2);
    expect(sent).toEqual(['fixed-id', 'fixed-id']);
  });

  it('does not deliver a stale completion after disposal', async () => {
    let resolveSave: ((value: string) => void) | undefined;
    const saved = vi.fn();
    const coordinator = new SaveCoordinator<string, string>({ debounceMs: 0, prepare: (content) => ({ baseVersionId: 'v1', content, clientMutationId: 'm1' }), save: () => new Promise((resolve) => { resolveSave = resolve; }), onSaved: saved, onFailed: vi.fn() });
    coordinator.flush('draft'); await Promise.resolve(); coordinator.dispose(); resolveSave?.('version-2'); await Promise.resolve();
    expect(saved).not.toHaveBeenCalled();
  });
});
