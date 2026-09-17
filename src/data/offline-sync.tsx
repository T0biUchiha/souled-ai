import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { noteApi } from './api-client';
import { completeReplayConflict, queuedMutationCount, replayQueue } from './offline-queue';

export interface OfflineSyncState { online: boolean; queued: number; syncing: { completed: number; total: number } | null; replayConflict: Awaited<ReturnType<typeof replayQueue>>['conflict']; refreshQueue: () => Promise<void>; completeConflict: (noteId: string, mutationId: string) => Promise<void> }
const OfflineSyncContext = createContext<OfflineSyncState | null>(null);
const onlineNow = (): boolean => typeof navigator === 'undefined' || navigator.onLine;

export function OfflineSyncProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(onlineNow); const [queued, setQueued] = useState(0); const [syncing, setSyncing] = useState<OfflineSyncState['syncing']>(null); const [replayConflict, setReplayConflict] = useState<OfflineSyncState['replayConflict']>(null);
  const refreshQueue = useCallback(async (): Promise<void> => setQueued(await queuedMutationCount()), []);
  const replay = useCallback(async (): Promise<void> => {
    if (!onlineNow()) return;
    await refreshQueue(); setSyncing({ completed: 0, total: await queuedMutationCount() });
    const result = await replayQueue({ saveVersion: noteApi.saveVersion, transition: noteApi.transition }, (completed, total) => setSyncing({ completed, total }));
    setReplayConflict(result.conflict); setSyncing(null); await refreshQueue();
  }, [refreshQueue]);
  const completeConflict = useCallback(async (noteId: string, mutationId: string): Promise<void> => { await completeReplayConflict(noteId, mutationId); setReplayConflict(null); await refreshQueue(); }, [refreshQueue]);
  useEffect(() => { void refreshQueue(); const onOnline = () => { setOnline(true); void replay(); }; const onOffline = () => setOnline(false); window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline); if (onlineNow()) void replay(); return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); }; }, [refreshQueue, replay]);
  const value = useMemo(() => ({ online, queued, syncing, replayConflict, refreshQueue, completeConflict }), [completeConflict, online, queued, refreshQueue, replayConflict, syncing]);
  return <OfflineSyncContext.Provider value={value}>{children}</OfflineSyncContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useOfflineSync = (): OfflineSyncState => {
  const value = useContext(OfflineSyncContext); if (value === null) throw new Error('OfflineSyncProvider is missing.'); return value;
};

export function ConnectivityStatus() {
  const { online, queued, syncing, replayConflict } = useOfflineSync();
  const message = replayConflict !== null ? 'Conflict needs attention' : syncing !== null ? `Syncing ${syncing.completed}/${syncing.total}` : !online ? `Offline — ${queued} changes waiting` : queued > 0 ? `Saved locally — ${queued} changes waiting` : 'Saved';
  return <p aria-live="polite" className="connectivity-status">{message}</p>;
}
