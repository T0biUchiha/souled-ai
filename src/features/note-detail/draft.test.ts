import { describe, expect, it } from 'vitest';
import { dirtySections } from './draft';

describe('SOAP draft dirty tracking', () => {
  it('marks only the changed Assessment section dirty', () => {
    const acknowledged = { subjective: 'S', objective: 'O', assessment: 'A', plan: 'P' };
    expect(dirtySections({ ...acknowledged, assessment: 'Revised A' }, acknowledged)).toEqual({ subjective: false, objective: false, assessment: true, plan: false });
  });
});
