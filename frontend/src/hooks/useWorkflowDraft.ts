import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../api/client';
import {
  discardWorkflowDraft,
  getWorkflowDraft,
  upsertWorkflowDraft,
  type WorkflowDraft,
  type WorkflowDraftType,
} from '../api/fleet';

export type DraftSaveStatus = 'loading' | 'idle' | 'saving' | 'saved' | 'offline' | 'error' | 'conflict';

type DraftOptions = {
  workflowType: WorkflowDraftType;
  scopeKey: string;
  objectId?: string | null;
  formData: Record<string, unknown>;
  stagedMediaIds: string[];
  step: number;
  enabled?: boolean;
  resumeId?: string | null;
  onHydrate: (draft: WorkflowDraft) => void;
  storageKey?: string;
};

const ACTIVE_DRAFT_PREFIX = 'fleet-active-draft:';

function activeDraftKey(workflowType: WorkflowDraftType, storageKey?: string) {
  return `${ACTIVE_DRAFT_PREFIX}${workflowType}${storageKey ? `:${storageKey}` : ''}`;
}

export function useWorkflowDraft({
  workflowType,
  scopeKey,
  objectId,
  formData,
  stagedMediaIds,
  step,
  enabled = true,
  resumeId,
  onHydrate,
  storageKey,
}: DraftOptions) {
  const [draft, setDraft] = useState<WorkflowDraft | null>(null);
  const [status, setStatus] = useState<DraftSaveStatus>('loading');
  const [error, setError] = useState<unknown>(null);
  const [conflictingDraft, setConflictingDraft] = useState<WorkflowDraft | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const draftRef = useRef<WorkflowDraft | null>(null);
  const onHydrateRef = useRef(onHydrate);
  const lastSavedRef = useRef('');
  const hydrationCompleteRef = useRef(false);

  useEffect(() => {
    onHydrateRef.current = onHydrate;
  }, [onHydrate]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const storedId = typeof window !== 'undefined'
      ? window.localStorage.getItem(activeDraftKey(workflowType, storageKey))
      : null;
    const id = resumeId || storedId;
    hydrationCompleteRef.current = false;
    setStatus(id ? 'loading' : 'idle');

    async function load() {
      if (!id) {
        hydrationCompleteRef.current = true;
        return;
      }
      try {
        const loaded = await getWorkflowDraft(id, controller.signal);
        if (!active || loaded.workflow_type !== workflowType) return;
        setDraft(loaded);
        draftRef.current = loaded;
        lastSavedRef.current = JSON.stringify({
          form_data: loaded.form_data,
          staged_media_ids: loaded.staged_media_ids,
          step: loaded.step,
          object_id: loaded.object_id ?? null,
        });
        window.localStorage.setItem(activeDraftKey(workflowType, storageKey), loaded.id);
        onHydrateRef.current(loaded);
        setStatus('saved');
      } catch (loadError) {
        if (!active || controller.signal.aborted) return;
        if (loadError instanceof ApiError && loadError.status === 404) {
          window.localStorage.removeItem(activeDraftKey(workflowType, storageKey));
          setStatus('idle');
        } else {
          setError(loadError);
          setStatus(navigator.onLine ? 'error' : 'offline');
        }
      } finally {
        hydrationCompleteRef.current = true;
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [resumeId, storageKey, workflowType]);

  const snapshot = JSON.stringify({
    form_data: formData,
    staged_media_ids: [...new Set(stagedMediaIds)],
    step,
    object_id: objectId ?? null,
  });

  useEffect(() => {
    if (!enabled || !hydrationCompleteRef.current || snapshot === lastSavedRef.current) return;
    const timer = window.setTimeout(async () => {
      if (!navigator.onLine) {
        setStatus('offline');
        return;
      }
      setStatus('saving');
      setError(null);
      try {
        const current = draftRef.current;
        const saved = await upsertWorkflowDraft({
          workflow_type: workflowType,
          scope_key: current?.scope_key || scopeKey,
          object_id: objectId || undefined,
          form_data: formData,
          staged_media_ids: [...new Set(stagedMediaIds)],
          step,
          ...(current ? { expected_version: current.version } : {}),
        });
        draftRef.current = saved;
        setDraft(saved);
        setConflictingDraft(null);
        lastSavedRef.current = snapshot;
        window.localStorage.setItem(activeDraftKey(workflowType, storageKey), saved.id);
        setStatus('saved');
      } catch (saveError) {
        if (saveError instanceof ApiError && saveError.status === 409) {
          const current = (saveError.details as { current?: WorkflowDraft } | undefined)?.current ?? null;
          setConflictingDraft(current);
          setStatus('conflict');
        } else {
          setError(saveError);
          setStatus(navigator.onLine ? 'error' : 'offline');
        }
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    enabled,
    formData,
    objectId,
    retryToken,
    scopeKey,
    snapshot,
    stagedMediaIds,
    storageKey,
    step,
    workflowType,
  ]);

  useEffect(() => {
    const retry = () => setRetryToken((value) => value + 1);
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, []);

  const useServerVersion = useCallback(() => {
    if (!conflictingDraft) return;
    draftRef.current = conflictingDraft;
    setDraft(conflictingDraft);
    setConflictingDraft(null);
    lastSavedRef.current = JSON.stringify({
      form_data: conflictingDraft.form_data,
      staged_media_ids: conflictingDraft.staged_media_ids,
      step: conflictingDraft.step,
      object_id: conflictingDraft.object_id ?? null,
    });
    onHydrateRef.current(conflictingDraft);
    setStatus('saved');
  }, [conflictingDraft]);

  const overwriteServerVersion = useCallback(() => {
    if (!conflictingDraft) return;
    draftRef.current = conflictingDraft;
    setDraft(conflictingDraft);
    setConflictingDraft(null);
    setStatus('idle');
    lastSavedRef.current = '';
    setRetryToken((value) => value + 1);
  }, [conflictingDraft]);

  const discard = useCallback(async () => {
    const current = draftRef.current;
    if (current) await discardWorkflowDraft(current.id);
    window.localStorage.removeItem(activeDraftKey(workflowType, storageKey));
    draftRef.current = null;
    setDraft(null);
    setStatus('idle');
  }, [storageKey, workflowType]);

  const completed = useCallback(async () => {
    try {
      await discard();
    } catch {
      // Completion is authoritative. An expired draft can be cleaned up later.
      window.localStorage.removeItem(activeDraftKey(workflowType, storageKey));
    }
  }, [discard, storageKey, workflowType]);

  return {
    draft,
    status,
    error,
    conflictingDraft,
    retry: () => setRetryToken((value) => value + 1),
    useServerVersion,
    overwriteServerVersion,
    discard,
    completed,
  };
}
