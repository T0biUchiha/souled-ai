import { create } from 'zustand';
import type { User } from '../domain';

const storageKey = 'clinical-note-mock-current-user';
export const defaultMockUser: User = { id: 'reviewer-1', displayName: 'Reviewer A', roles: ['REVIEWER', 'CLINICIAN', 'ADMIN'] };
const loadMockUser = (): User => {
  try { const raw = sessionStorage.getItem(storageKey); if (raw !== null) { const parsed = JSON.parse(raw) as User; if (typeof parsed.id === 'string' && typeof parsed.displayName === 'string' && Array.isArray(parsed.roles)) return parsed; } } catch { /* The browser-session mock falls back safely. */ }
  return defaultMockUser;
};

interface SessionState {
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
}

/** Only ephemeral client session UI state belongs here; API resources use TanStack Query. */
export const useSessionStore = create<SessionState>((set) => ({
  currentUser: typeof window === 'undefined' ? defaultMockUser : loadMockUser(),
  setCurrentUser: (currentUser) => { if (currentUser !== null) sessionStorage.setItem(storageKey, JSON.stringify(currentUser)); else sessionStorage.removeItem(storageKey); set({ currentUser }); },
}));

/** Assignment-only mock auth. Production identity belongs to the server session/token. */
export const mockCurrentUserStorageKey = storageKey;
