import { describe, expect, it } from 'vitest';
import { diffWords } from './word-diff';

describe('diffWords', () => { it('returns word-level additions and removals', () => { expect(diffWords('Patient is stable', 'Patient remains stable').map((token) => [token.value, token.kind])).toEqual([['Patient', 'unchanged'], [' ', 'unchanged'], ['is', 'removed'], ['remains', 'added'], [' ', 'unchanged'], ['stable', 'unchanged']]); }); });
