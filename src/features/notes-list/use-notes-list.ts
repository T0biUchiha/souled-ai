import { useInfiniteQuery } from '@tanstack/react-query';
import { useDeferredValue, useEffect, useState } from 'react';
import { noteApi } from '../../data/api-client';
import type { NotesListUrlState } from './url-state';
import { notesListQueryKey } from './url-state';

const useDebouncedValue = <T,>(value: T, delayMs: number): T => {
  const deferred = useDeferredValue(value);
  const [debounced, setDebounced] = useState(deferred);
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(deferred), delayMs); return () => window.clearTimeout(timer); }, [deferred, delayMs]);
  return debounced;
};

export const useNotesList = (urlState: NotesListUrlState) => {
  const debouncedSearch = useDebouncedValue(urlState.search, 300);
  const query = { ...urlState, search: debouncedSearch };
  return useInfiniteQuery({
    queryKey: notesListQueryKey(query),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => noteApi.list(pageParam === undefined ? query : { ...query, cursor: pageParam }, signal),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 15_000,
  });
};
