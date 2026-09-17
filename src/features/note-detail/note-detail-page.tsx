import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { diffWords, isNoteReadOnly, selectActions, type SoapContent, type TransitionAction } from '../../domain';
import { noteApi } from '../../data/api-client';
import { ApiClientError } from '../../data/api-client';
import type { NoteVersion } from '../../domain';
import { dirtySections, type SoapSection, type WorkingDraft } from './draft';
import { beginOptimisticTransition, reconcileTransitionEvents } from './optimistic-transition';
import { SaveCoordinator } from './save-coordinator';
import { resolveVersionConflict, type VersionConflict } from './conflict-resolution';
import { queueVersionSave } from '../../data/offline-queue';
import { queueTransition } from '../../data/offline-queue';
import { useOfflineSync } from '../../data/offline-sync';
import { useRealtimeNotes } from '../../data/use-realtime-notes';
import { otherViewers, presenceLabel } from './presence';
import { useSessionStore } from '../../auth/session-store';
import { saveDraft } from '../../data/draft-store';
import { offlineDb } from '../../data/offline-db';
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
  const actor = useSessionStore((state) => state.currentUser);
  const { online, refreshQueue, replayConflict, completeConflict } = useOfflineSync();
  const detail = useQuery({ queryKey: ['note', noteId], queryFn: () => noteApi.get(noteId), enabled: noteId !== '' });
  const [draft, setDraft] = useState<WorkingDraft | null>(null); const [rejectReason, setRejectReason] = useState(''); const [rejectOpen, setRejectOpen] = useState(false);
  const [selectedVersions, setSelectedVersions] = useState<readonly string[]>([]);
  const [acknowledged, setAcknowledged] = useState<NoteVersion | null>(null); const [saveError, setSaveError] = useState<string | null>(null); const [saveStatus, setSaveStatus] = useState('Saved');
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [presence, setPresence] = useState<Extract<Parameters<NonNullable<Parameters<typeof useRealtimeNotes>[1]>>[0], { type: 'note.presence' }> | null>(null);
  const [optimistic, setOptimistic] = useState<ReturnType<typeof beginOptimisticTransition> | null>(null); const [transitionError, setTransitionError] = useState<string | null>(null); const [transitionPending, setTransitionPending] = useState(false);
  const initializedNoteId = useRef<string | null>(null); const draftRef = useRef<WorkingDraft | null>(null); const acknowledgedRef = useRef<NoteVersion | null>(null); const historyRef = useRef<HTMLElement>(null); const saveButtonRef = useRef<HTMLButtonElement>(null); const rejectTriggerRef = useRef<HTMLButtonElement>(null); const actorIdRef = useRef(''); const resolvedReplayConflictRef = useRef<{ noteId: string; mutationId: string } | null>(null); const baseVersionIdRef = useRef(''); const coordinatorRef = useRef<SaveCoordinator<SoapContent, NoteVersion | { queued: true }> | null>(null);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { acknowledgedRef.current = acknowledged; }, [acknowledged]);
  const realtimeNoteIds = useMemo(() => noteId === '' ? [] : [noteId], [noteId]);
  const onRealtimeEvent = useCallback((event: Parameters<NonNullable<Parameters<typeof useRealtimeNotes>[1]>>[0]) => { if (event.type === 'note.presence') setPresence(event); if (event.type === 'note.version_added' && draftRef.current !== null) { const local = draftRef.current; const isCompetingChild = event.version.parentVersionId === local.baseVersionId; const matchesLocalDraft = Object.keys(local.content).every((key) => local.content[key as keyof SoapContent] === event.version.content[key as keyof SoapContent]); const isOwnSave = event.version.createdById === actorIdRef.current; if (isCompetingChild && !matchesLocalDraft && !isOwnSave) setConflict({ commonAncestor: acknowledgedRef.current, server: event.version, local }); } }, []);
  useRealtimeNotes(realtimeNoteIds, onRealtimeEvent);
  useEffect(() => { if (replayConflict !== null && replayConflict.noteId === noteId && draftRef.current !== null) setConflict({ commonAncestor: replayConflict.commonAncestor, server: replayConflict.current, local: draftRef.current }); }, [noteId, replayConflict]);
  useEffect(() => { if (detail.data?.currentVersion !== null && detail.data?.currentVersion !== undefined && initializedNoteId.current !== noteId) { initializedNoteId.current = noteId; const server = detail.data.currentVersion; void offlineDb.noteDrafts.get(noteId).then((stored) => { const initial = stored?.baseVersionId === server.id ? { baseVersionId: stored.baseVersionId, content: { ...stored.content } } : { baseVersionId: server.id, content: { ...server.content } }; baseVersionIdRef.current = initial.baseVersionId; setAcknowledged(server); setDraft(initial); setConflict(null); }); } }, [detail.data?.currentVersion, noteId]);
  useEffect(() => { actorIdRef.current = actor?.id ?? ''; }, [actor]);
  useEffect(() => { if (actor === null || noteId === '') return; const role = actor.roles[0] ?? 'REVIEWER'; void noteApi.presence({ noteId, userId: actor.id, displayName: actor.displayName, role, mode: 'join' }); return () => { void noteApi.presence({ noteId, userId: actor.id, mode: 'leave' }); setPresence(null); }; }, [actor, noteId]);
  const displayedNote = optimistic?.optimisticNote ?? detail.data;
  const context = displayedNote === undefined ? null : { note: displayedNote, actor, source: 'USER' as const, now: new Date().toISOString(), mfaReauthenticated: true };
  const actions = context === null ? [] : selectActions(context, { reject: { type: 'reject', reason: rejectReason } });
  const visibleActions = actions.filter((action) => action.visible);
  const canReject = visibleActions.some((action) => action.action === 'reject');
  const readOnly = context === null || isNoteReadOnly(context);
  const dirtiness = draft === null || acknowledged === null ? null : dirtySections(draft.content, acknowledged.content);
  const refresh = useCallback((): void => { void queryClient.invalidateQueries({ queryKey: ['note', noteId] }); void queryClient.invalidateQueries({ queryKey: ['notes'] }); }, [noteId, queryClient]);
  useEffect(() => {
    if (actor === null) return;
    coordinatorRef.current?.dispose();
    coordinatorRef.current = new SaveCoordinator<SoapContent, NoteVersion | { queued: true }>({ debounceMs: 700, prepare: (content) => ({ baseVersionId: baseVersionIdRef.current, content, clientMutationId: mutationId() }), save: async (request) => { if (!online) { await queueVersionSave(noteId, { ...request, actor }); await refreshQueue(); return { queued: true }; } return noteApi.saveVersion(noteId, { ...request, actor }); }, onSaved: (result) => { if ('queued' in result) { setSaveError(null); setSaveStatus('Offline — change queued'); return; } baseVersionIdRef.current = result.id; setAcknowledged(result); setDraft((current) => current === null ? current : { ...current, baseVersionId: result.id }); const resolved = resolvedReplayConflictRef.current; if (resolved?.noteId === noteId) { resolvedReplayConflictRef.current = null; void completeConflict(noteId, resolved.mutationId); } setSaveError(null); setSaveStatus('Saved'); refresh(); }, onFailed: (error) => { if (error instanceof ApiClientError && error.payload.error === 'version_conflict' && draftRef.current !== null) { setConflict({ commonAncestor: error.payload.commonAncestor, server: error.payload.current, local: draftRef.current }); setSaveStatus('Conflict requires attention'); } else setSaveStatus('Save failed'); setSaveError(error instanceof Error ? error.message : 'Unable to save draft.'); } });
    return () => coordinatorRef.current?.dispose();
  }, [actor, completeConflict, noteId, online, refresh, refreshQueue]);
  useEffect(() => { if (draft !== null && dirtiness !== null && Object.values(dirtiness).some(Boolean) && conflict === null) { setSaveStatus('Saving…'); coordinatorRef.current?.schedule(draft.content); } }, [conflict, dirtiness, draft]);
  useEffect(() => { if (draft !== null) void saveDraft(noteId, draft.baseVersionId, draft.content); }, [draft, noteId]);
  const executeAction = (type: TransitionAction['type']): void => {
    const action: TransitionAction = type === 'reject' ? { type, reason: rejectReason } : { type };
    if (context === null || transitionPending) return;
    const transaction = beginOptimisticTransition(context, action, `temporary-${mutationId()}`);
    if (transaction === null) return;
    setTransitionError(null); setOptimistic(transaction); setTransitionPending(true);
    if (!online) { void queueTransition(noteId, { action, actor, mfaReauthenticated: true }, transaction.temporaryEvent.id).then(async () => { await refreshQueue(); setTransitionPending(false); }); return; }
    void noteApi.transition(noteId, { action, actor, mfaReauthenticated: true }).then((response) => {
      queryClient.setQueryData(['note', noteId], (previous: typeof detail.data | undefined) => previous === undefined ? previous : { ...previous, ...response.note, events: reconcileTransitionEvents([...previous.events, transaction.temporaryEvent], transaction.temporaryEvent.id, response.event) });
      setOptimistic(null); setTransitionPending(false); refresh();
    }).catch((error: unknown) => { setOptimistic(null); setTransitionPending(false); setTransitionError(error instanceof Error ? error.message : 'Transition failed.'); });
  };
  const compared = selectedVersions.map((id) => detail.data?.versions.find((version) => version.id === id)).filter((version): version is NoteVersion => version !== undefined);
  useEffect(() => { if (compared.length === 2) historyRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }, [compared.length]);

  if (detail.status === 'pending') return <p aria-busy="true">Loading note…</p>;
  if (detail.status === 'error' || detail.data === undefined) return <p role="alert">Could not load this note.</p>;
  const viewers = otherViewers(presence, noteId, actor?.id ?? '');
  return <section aria-labelledby="note-title" className="note-detail-page"><header className="note-detail-hero"><Link className="back-link" to="/notes">← Back to notes</Link><div className="note-title-row"><div><p className="eyebrow">Clinical note review</p><h1 id="note-title">{detail.data.patientName}</h1><p className="note-meta">Encounter {detail.data.encounterId} · Last updated {new Date(detail.data.updatedAt).toLocaleString()}</p><p aria-live="polite" data-testid="presence-indicator">{presenceLabel(viewers)}</p></div><span aria-live="polite" className={`detail-status status-${detail.data.status.toLowerCase().replaceAll('_', '-')}`}>{detail.data.status.replaceAll('_', ' ')}</span></div></header>
    {visibleActions.length > 0 ? <div className="note-actions" aria-label="Note actions">
      {visibleActions.map((item) => <span key={item.action}><button aria-describedby={item.disabledReason === null || item.action === 'reject' ? undefined : `${item.action}-reason`} disabled={(item.action === 'reject' ? false : !item.enabled) || transitionPending} onClick={() => item.action === 'reject' ? setRejectOpen(true) : executeAction(item.action)} ref={item.action === 'reject' ? rejectTriggerRef : undefined} type="button">{actionLabels[item.action]}</button>{item.disabledReason === null || item.action === 'reject' ? null : <span className="sr-only" id={`${item.action}-reason`}>{item.disabledReason}</span>}</span>)}
      {canReject ? <label>Rejection reason <input aria-describedby="reject-reason-help" onChange={(event) => setRejectReason(event.target.value)} placeholder="Required to reject" value={rejectReason} /><span className="sr-only" id="reject-reason-help">A reason is required before rejection can be confirmed.</span></label> : null}
      {transitionError === null ? null : <p role="alert">{transitionError}</p>}
    </div> : <p className="workflow-notice" role="status">This note is locked. Its clinical content and audit record are read-only.</p>}
    <div className="note-detail-layout"><form aria-label="SOAP editor" className="soap-editor" onSubmit={(event) => { event.preventDefault(); if (draft !== null) coordinatorRef.current?.flush(draft.content); }}>
      <div className="editor-heading"><div><p className="eyebrow">Working draft</p><h2>SOAP note</h2></div><span className={readOnly ? 'editor-state locked' : 'editor-state'}>{readOnly ? 'Read only' : 'Autosaves enabled'}</span></div><p aria-atomic="true" aria-live="polite" className="sr-only" data-testid="save-status">{saveStatus}</p>{sections.map(({ key, label }) => <label className="soap-section" key={key}><span>{label}{dirtiness?.[key] ? <span className="dirty-indicator"> Unsaved changes</span> : null}</span><textarea aria-label={label} disabled={readOnly} onChange={(event) => setDraft((current) => current === null ? current : { ...current, content: { ...current.content, [key]: event.target.value } })} value={draft?.content[key] ?? ''} /></label>)}
      <button disabled={readOnly || draft === null || dirtiness === null || !Object.values(dirtiness).some(Boolean)} ref={saveButtonRef} type="submit">Save now</button>{saveError === null ? null : <p role="alert">{saveError} <button onClick={() => coordinatorRef.current?.retryFailed()} type="button">Retry</button></p>}
    </form>
    <aside aria-label="Version history" className="history-sidebar" ref={historyRef}><div className="history-heading"><div><p className="eyebrow">Immutable record</p><h2>Version history</h2></div><span>{detail.data.versions.length}</span></div><p className="history-help">Select two versions to compare their changes.</p>{compared.length === 2 ? <VersionDiff after={compared[0]!} before={compared[1]!} /> : <p className="comparison-placeholder">Choose two versions to view their comparison here.</p>}<ol>{detail.data.versions.map((version) => <li key={version.id}><label><input aria-label={`Compare ${version.id}`} aria-checked={selectedVersions.includes(version.id)} checked={selectedVersions.includes(version.id)} onChange={() => setSelectedVersions((current) => current.includes(version.id) ? current.filter((selectedId) => selectedId !== version.id) : [...current.slice(-1), version.id])} type="checkbox" /><span><strong>{version.id}</strong><small>{new Date(version.createdAt).toLocaleString()}</small></span></label></li>)}</ol></aside>
    </div>
    {rejectOpen ? <RejectDialog initialReason={rejectReason} onCancel={() => { setRejectOpen(false); rejectTriggerRef.current?.focus(); }} onConfirm={(reason) => { setRejectReason(reason); setRejectOpen(false); executeAction('reject'); }} /> : null}
    {conflict === null ? null : <ConflictPanel conflict={conflict} onResolve={(content) => { const replay = replayConflict?.noteId === noteId ? replayConflict : null; baseVersionIdRef.current = conflict.server.id; setAcknowledged(conflict.server); setDraft({ baseVersionId: conflict.server.id, content }); if (replay !== null && JSON.stringify(content) === JSON.stringify(conflict.server.content)) void completeConflict(noteId, replay.mutationId); else if (replay !== null) resolvedReplayConflictRef.current = { noteId, mutationId: replay.mutationId }; setConflict(null); saveButtonRef.current?.focus(); }} />}
    <section aria-label="Review timeline" className="timeline-panel"><p className="eyebrow">Audit trail</p><h2>Review timeline</h2><ol className="timeline">{[...detail.data.events, ...(optimistic === null ? [] : [optimistic.temporaryEvent])].map((event) => <li key={event.id}><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time><span><strong>{event.action.replaceAll('_', ' ')}</strong> by {event.actorId}{event.reason === null ? '' : `: ${event.reason}`}</span></li>)}</ol></section>
  </section>;
}

function RejectDialog({ initialReason, onCancel, onConfirm }: { initialReason: string; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState(initialReason); const inputRef = useRef<HTMLInputElement>(null); const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  return <div aria-labelledby="reject-dialog-title" aria-modal="true" className="reject-dialog" onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); if (event.key === 'Tab') { const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('input, button:not([disabled])') ?? [])]; const first = focusable[0]; const last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }} ref={dialogRef} role="dialog"><h2 id="reject-dialog-title">Reject note</h2><label>Rejection reason <input aria-describedby="reject-dialog-help" ref={inputRef} value={reason} onChange={(event) => setReason(event.target.value)} /></label><p id="reject-dialog-help">Provide a reason before confirming rejection.</p><button onClick={onCancel} type="button">Cancel</button><button disabled={reason.trim() === ''} onClick={() => onConfirm(reason)} type="button">Confirm rejection</button></div>;
}

function ConflictPanel({ conflict, onResolve }: { conflict: VersionConflict; onResolve: (content: SoapContent) => void }) {
  const resolveRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { resolveRef.current?.focus(); }, []);
  return <section aria-labelledby="conflict-title" className="conflict-panel" role="dialog" tabIndex={-1}><h2 id="conflict-title">Version conflict</h2><p>Your edits are preserved. Choose a starting resolution, then save a new version based on the server head.</p><div className="conflict-columns"><article aria-label="Common ancestor content"><h3>Common ancestor</h3><pre>{JSON.stringify(conflict.commonAncestor?.content ?? null, null, 2)}</pre></article><article aria-label="Server head content"><h3>Server head</h3><pre>{JSON.stringify(conflict.server.content, null, 2)}</pre></article><article aria-label="Your local edits content"><h3>Your local edits</h3><pre>{JSON.stringify(conflict.local.content, null, 2)}</pre></article></div><button ref={resolveRef} onClick={() => onResolve(resolveVersionConflict(conflict, 'local').content)} type="button">Accept local</button><button onClick={() => onResolve(resolveVersionConflict(conflict, 'server').content)} type="button">Accept server</button><button onClick={() => onResolve(resolveVersionConflict(conflict, 'manual').content)} type="button">Continue manual merge</button></section>;
}

function VersionDiff({ before, after }: { before: NoteVersion; after: NoteVersion }) {
  return <section aria-label="Word-level version comparison"><h3>Version comparison</h3><p className="sr-only">Added and removed words are identified in text as well as by visual styling.</p>{sections.map(({ key, label }) => <article key={key}><h4>{label}</h4><p>{diffWords(before.content[key], after.content[key]).map((token, index) => <span aria-label={token.kind === 'unchanged' ? undefined : `${token.kind === 'added' ? 'Added' : 'Removed'}: ${token.value}`} className={`diff-${token.kind}`} key={`${token.value}-${index}`}>{token.value}</span>)}</p></article>)}</section>;
}
