import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client';
import type { WorkflowDraft } from '../api/fleet';
import { useWorkflowDraft } from './useWorkflowDraft';

const apiMocks = vi.hoisted(() => ({
  discard: vi.fn(),
  get: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('../api/fleet', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/fleet')>();
  return {
    ...original,
    discardWorkflowDraft: apiMocks.discard,
    getWorkflowDraft: apiMocks.get,
    upsertWorkflowDraft: apiMocks.upsert,
  };
});

function draft(overrides: Partial<WorkflowDraft> = {}): WorkflowDraft {
  return {
    id: 'draft-1',
    workflow_type: 'loan_return',
    scope_key: 'scope-1',
    object_id: 'loan-1',
    form_data: { notes: 'saved' },
    staged_media_ids: ['media-1'],
    step: 2,
    version: 1,
    owner: 'user-1',
    expires_at: '2026-08-01T00:00:00Z',
    created_at: '2026-07-17T00:00:00Z',
    updated_at: '2026-07-17T00:00:00Z',
    ...overrides,
  };
}

function Harness({ resumeId }: { resumeId?: string }) {
  const [formData, setFormData] = useState<Record<string, unknown>>({ notes: 'local' });
  const [mediaIds, setMediaIds] = useState(['media-local']);
  const [step, setStep] = useState(1);
  const hook = useWorkflowDraft({
    workflowType: 'loan_return',
    scopeKey: 'scope-1',
    objectId: 'loan-1',
    formData,
    stagedMediaIds: mediaIds,
    step,
    resumeId,
    onHydrate: (loaded) => {
      setFormData(loaded.form_data);
      setMediaIds(loaded.staged_media_ids);
      setStep(loaded.step);
    },
  });

  return (
    <div>
      <output data-testid="status">{hook.status}</output>
      <output data-testid="notes">{String(formData.notes || '')}</output>
      <output data-testid="step">{step}</output>
      <button type="button" onClick={() => setFormData({ notes: 'changed' })}>Change</button>
      <button type="button" onClick={() => void hook.discard()}>Discard</button>
      <button type="button" onClick={hook.useServerVersion}>Use server</button>
      <button type="button" onClick={hook.overwriteServerVersion}>Keep mine</button>
    </div>
  );
}

async function advanceAutosave() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(701);
  });
}

describe('useWorkflowDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    window.localStorage.clear();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    apiMocks.discard.mockResolvedValue(undefined);
    apiMocks.upsert.mockResolvedValue(draft());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces upserts, includes media and step, then uses expected_version', async () => {
    render(<Harness />);
    await advanceAutosave();

    expect(apiMocks.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      workflow_type: 'loan_return',
      scope_key: 'scope-1',
      object_id: 'loan-1',
      form_data: { notes: 'local' },
      staged_media_ids: ['media-local'],
      step: 1,
    }));
    expect(screen.getByTestId('status')).toHaveTextContent('saved');

    apiMocks.upsert.mockResolvedValueOnce(draft({
      version: 2,
      form_data: { notes: 'changed' },
      staged_media_ids: ['media-local'],
      step: 1,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await advanceAutosave();

    expect(apiMocks.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      expected_version: 1,
      form_data: { notes: 'changed' },
    }));
    expect(JSON.stringify(apiMocks.upsert.mock.calls)).not.toContain('data:image');
  });

  it('resumes and discards the requested server draft', async () => {
    apiMocks.get.mockResolvedValue(draft({ form_data: { notes: 'from server' }, step: 3 }));
    render(<Harness resumeId="draft-1" />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(apiMocks.get).toHaveBeenCalledWith('draft-1', expect.any(AbortSignal));
    expect(screen.getByTestId('notes')).toHaveTextContent('from server');
    expect(screen.getByTestId('step')).toHaveTextContent('3');

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(apiMocks.discard).toHaveBeenCalledWith('draft-1');
    expect(window.localStorage.getItem('fleet-active-draft:loan_return')).toBeNull();
  });

  it('surfaces a version conflict and can overwrite from the current server version', async () => {
    const current = draft({ version: 4, form_data: { notes: 'server edit' } });
    apiMocks.upsert
      .mockRejectedValueOnce(new ApiError(409, 'Conflict', { current }, 'version_conflict'))
      .mockResolvedValueOnce(draft({ version: 5, form_data: { notes: 'local' } }));

    render(<Harness />);
    await advanceAutosave();
    expect(screen.getByTestId('status')).toHaveTextContent('conflict');

    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    await advanceAutosave();
    expect(apiMocks.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      expected_version: 4,
      form_data: { notes: 'local' },
    }));
    expect(screen.getByTestId('status')).toHaveTextContent('saved');
  });
});
