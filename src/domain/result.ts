export interface DomainError {
  code:
    | 'INVALID_TRANSITION'
    | 'PERMISSION_DENIED'
    | 'INVALID_INPUT'
    | 'VERSION_NOT_FOUND'
    | 'VERSION_NOTE_MISMATCH'
    | 'VERSION_CYCLE';
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const err = (code: DomainError['code'], message: string): Result<never> => ({
  ok: false,
  error: { code, message },
});
