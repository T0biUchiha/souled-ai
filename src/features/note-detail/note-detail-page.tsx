import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { diffWords, isNoteReadOnly, selectActions, type TransitionAction, type User } from '../../domain';
import { noteApi } from '../../data/api-client';
import type { NoteVersion } from '../../domain';
import { dirtySections, type SoapSection, type WorkingDraft } from './draft';
import './note-detail.css';

const sections: ReadonlyArray<{ key: SoapSection; label: string }> = [
  { key: 'subjective', label: 'Subjective' }, { key: 'objective', label: 'Objective' }, { key: 'assessment', label: 'Assessment' }, { key: 'plan', label: 'Plan' },
];
const actionLabels: Readonly<Record<TransitionAction['type'], string>> = {
  'generation.complete': 'Complete generation', 'generation.error': 'Record generation error', regenerate: 'Regenerate', start_review: 'Start review', return: 'Return to queue', approve: 'Approve', reject: 'Reject', resubmit: 'Resubmit', amend: 'Amend', grace_expired: 'Lock after grace period',
};

const mutationId = (): string => globalThis.crypto?.randomUUID?.() ?? `mutation-${Date.now()}`;

export function NoteDetailPage() {
  const { noteId = '' } = useParams(); const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['note', noteId], queryFn: () => noteApi.get(noteId), enabled: noteId !== '' });
  const [draft, setDraft] = useState<WorkingDraft | null>(null); const [rejectReason, setRejectReason] = useState('');
  const [selectedVersions, setSelectedVersions] = useState<readonly string[]>([]);
  useEffect(() => { if (detail.data?.currentVersion !== null && detail.data?.currentVersion !== undefined) setDraft({ baseVersionId: detail.data.currentVersion.id, content: { ...detail.data.currentVersion.content } }); }, [detail.data?.currentVersion]);
  const actor: User | null = useMemo(() => detail.data === undefined ? null : { id: detail.data.assignedReviewerId ?? 'reviewer-1', displayName: 'Demo review user', roles: ['CLINICIAN', 'REVIEWER', 'ADMIN'] }, [detail.data]);
  const context = detail.data === undefined ? null : { note: detail.data, actor, source: 'USER' as const, now: new Date().toISOString(), mfaReauthenticated: true };
  const actions = context === null ? [] : selectActions(context, { reject: { type: 'reject', reason: rejectReason } });
  const readOnly = context === null || isNoteReadOnly(context);
  const acknowledged = detail.data?.currentVersion?.content; const dirtiness = draft === null || acknowledged === undefined ? null : dirtySections(draft.content, acknowledged);
  const refresh = (): void => { void queryClient.invalidateQueries({ queryKey: ['note', noteId] }); void queryClient.invalidateQueries({ queryKey: ['notes'] }); };
  const save = useMutation({ mutationFn: () => noteApi.saveVersion(noteId, { baseVersionId: draft!.baseVersionId, content: draft!.content, clientMutationId: mutationId(), actor: actor! }), onSuccess: refresh });
  const transition = useMutation({ mutationFn: (action: TransitionAction) => noteApi.transition(noteId, { action, actor, mfaReauthenticated: true }), onSuccess: refresh });
  const executeAction = (type: TransitionAction['type']): void => {
    const action: TransitionAction = type === 'reject' ? { type, reason: rejectReason } : { type };
    transition.mutate(action);
  };
  const compared = selectedVersions.map((id) => detail.data?.versions.find((version) => version.id === id)).filter((version): version is NoteVersion => version !== undefined);

  if (detail.status === 'pending') return <p aria-busy="true">Loading note…</p>;
  if (detail.status === 'error' || detail.data === undefined) return <p role="alert">Could not load this note.</p>;
  return <section aria-labelledby="note-title"><Link to="/notes">← Notes</Link><h1 id="note-title">{detail.data.patientName}</h1><p>{detail.data.status}</p>
    <div className="note-actions" aria-label="Note actions">
      {actions.map((item) => <span key={item.action}><button aria-describedby={item.disabledReason === null ? undefined : `${item.action}-reason`} disabled={!item.enabled || transition.isPending} onClick={() => executeAction(item.action)} type="button">{actionLabels[item.action]}</button>{item.disabledReason === null ? null : <span className="sr-only" id={`${item.action}-reason`}>{item.disabledReason}</span>}</span>)}
      <label>Rejection reason <input onChange={(event) => setRejectReason(event.target.value)} value={rejectReason} /></label>
    </div>
    <div className="note-detail-layout"><form aria-label="SOAP editor" className="soap-editor" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <h2>SOAP note</h2>{sections.map(({ key, label }) => <label key={key}>{label}{dirtiness?.[key] ? <span className="dirty-indicator"> Unsaved changes</span> : null}<textarea aria-label={label} disabled={readOnly || save.isPending} onChange={(event) => setDraft((current) => current === null ? current : { ...current, content: { ...current.content, [key]: event.target.value } })} value={draft?.content[key] ?? ''} /></label>)}
      <button disabled={readOnly || draft === null || dirtiness === null || !Object.values(dirtiness).some(Boolean) || save.isPending} type="submit">Save new version</button>
    </form>
    <aside aria-label="Version history" className="history-sidebar"><h2>Version history</h2><ol>{detail.data.versions.map((version) => <li key={version.id}><label><input checked={selectedVersions.includes(version.id)} onChange={() => setSelectedVersions((current) => current.includes(version.id) ? current.filter((id) => id !== version.id) : [...current.slice(-1), version.id])} type="checkbox" />{version.id} · {new Date(version.createdAt).toLocaleString()}</label></li>)}</ol>
      {compared.length === 2 ? <VersionDiff after={compared[0]!} before={compared[1]!} /> : <p>Select two versions to compare.</p>}</aside>
    </div>
    <section aria-label="Review timeline"><h2>Review timeline</h2><ol className="timeline">{detail.data.events.map((event) => <li key={event.id}><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time> — {event.action} by {event.actorId}{event.reason === null ? '' : `: ${event.reason}`}</li>)}</ol></section>
  </section>;
}

function VersionDiff({ before, after }: { before: NoteVersion; after: NoteVersion }) {
  return <section aria-label="Word-level version comparison"><h3>Version comparison</h3>{sections.map(({ key, label }) => <article key={key}><h4>{label}</h4><p>{diffWords(before.content[key], after.content[key]).map((token, index) => <span className={`diff-${token.kind}`} key={`${token.value}-${index}`}>{token.value}</span>)}</p></article>)}</section>;
}
