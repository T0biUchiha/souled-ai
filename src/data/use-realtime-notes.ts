import { useEffect, useRef } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { RealtimeEvent } from '../backend/realtime';
import type { NoteDetail, NotePage } from '../backend/contracts';
import { realtimeClient } from './realtime-client';
import { mergeRealtimeVersion, reconcileRealtimeNote } from './realtime-reconcile';

export const useRealtimeNotes = (noteIds: readonly string[], onEvent?: (event: RealtimeEvent) => void): void => {
  const queryClient = useQueryClient(); const delivered = useRef(new Set<string>());
  useEffect(() => {
    const unsubscribe = realtimeClient.subscribe(noteIds);
    const removeListener = realtimeClient.onEvent((event) => {
      if (!noteIds.includes(event.noteId) || delivered.current.has(event.id)) return;
      delivered.current.add(event.id); if (delivered.current.size > 2_000) delivered.current.clear();
      if (event.type === 'note.status_changed') {
        queryClient.setQueriesData<InfiniteData<NotePage>>({ queryKey: ['notes'] }, (previous) => previous === undefined ? previous : { ...previous, pages: previous.pages.map((page) => ({ ...page, items: page.items.map((item) => item.id === event.noteId ? { ...item, ...reconcileRealtimeNote(item, event) } : item) })) });
        queryClient.setQueryData<NoteDetail>(['note', event.noteId], (previous) => previous === undefined ? previous : { ...previous, ...reconcileRealtimeNote(previous, event) });
      }
      if (event.type === 'note.version_added') queryClient.setQueryData(['note', event.noteId], (previous: { versions: readonly typeof event.version[] } | undefined) => previous === undefined ? previous : { ...previous, versions: mergeRealtimeVersion(previous.versions, event.version) });
      onEvent?.(event);
    });
    return () => { removeListener(); unsubscribe(); };
  }, [noteIds, onEvent, queryClient]);
};
