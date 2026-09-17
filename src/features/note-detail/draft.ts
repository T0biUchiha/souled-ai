import type { SoapContent } from '../../domain';

export type SoapSection = keyof SoapContent;
export interface WorkingDraft { baseVersionId: string; content: SoapContent }

export const dirtySections = (draft: SoapContent, acknowledged: SoapContent): Readonly<Record<SoapSection, boolean>> => ({
  subjective: draft.subjective !== acknowledged.subjective,
  objective: draft.objective !== acknowledged.objective,
  assessment: draft.assessment !== acknowledged.assessment,
  plan: draft.plan !== acknowledged.plan,
});
