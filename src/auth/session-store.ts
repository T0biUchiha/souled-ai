import { create } from 'zustand';
import type { User } from '../domain';

interface SessionState {
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
}

/** Only ephemeral client session UI state belongs here; API resources use TanStack Query. */
export const useSessionStore = create<SessionState>((set) => ({
  currentUser: null,
  setCurrentUser: (currentUser) => set({ currentUser }),
}));
