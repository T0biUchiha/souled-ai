import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { queryClient } from './query-client';
import { router } from './router';
import { OfflineSyncProvider } from '../data/offline-sync';

export function App() {
  return (
    <QueryClientProvider client={queryClient}><OfflineSyncProvider><RouterProvider router={router} /></OfflineSyncProvider></QueryClientProvider>
  );
}
