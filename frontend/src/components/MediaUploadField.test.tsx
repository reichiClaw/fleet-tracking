import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaUploadField } from './MediaUploadField';

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? undefined : { 'Content-Type': 'application/json' },
  }));
}

describe('MediaUploadField staged cleanup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.cookie = 'csrftoken=test-token; path=/';
  });

  afterEach(() => vi.unstubAllGlobals());

  it('discards an unattached staged upload when the form unmounts', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/media/') && init?.method === 'POST') {
        return response({ id: 'staged-cleanup-1', media_type: 'photo', original_filename: 'vehicle.jpg' }, 201);
      }
      if (String(input).endsWith('/media/staged-cleanup-1/discard/') && init?.method === 'POST') {
        return response(undefined, 204);
      }
      return response({ error: { code: 'not_found', message: 'Not found', details: {} } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(
      <MediaUploadField mediaType="photo" label="Vehicle photo" onUploaded={() => undefined} />,
    );

    fireEvent.change(screen.getByLabelText('Vehicle photo'), {
      target: { files: [new File(['photo'], 'vehicle.jpg', { type: 'image/jpeg' })] },
    });
    await screen.findByText(/(?:Hochgeladen|Uploaded): vehicle\.jpg/);
    unmount();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/media/staged-cleanup-1/discard/',
      expect.objectContaining({ method: 'POST' }),
    ));
  });

  it('lets the user remove a staged upload immediately', async () => {
    const removed = vi.fn();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/media/') && init?.method === 'POST') {
        return response({ id: 'staged-remove-1', media_type: 'photo', original_filename: 'remove.jpg' }, 201);
      }
      return response(undefined, 204);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MediaUploadField mediaType="photo" label="Vehicle photo" onUploaded={() => undefined} onRemoved={removed} />,
    );

    fireEvent.change(screen.getByLabelText('Vehicle photo'), {
      target: { files: [new File(['photo'], 'remove.jpg', { type: 'image/jpeg' })] },
    });
    await screen.findByText(/(?:Hochgeladen|Uploaded): remove\.jpg/);
    fireEvent.click(screen.getByRole('button', { name: /Entfernen|Remove/ }));

    await waitFor(() => expect(removed).toHaveBeenCalledWith(expect.objectContaining({ id: 'staged-remove-1' })));
    expect(screen.queryByText(/(?:Hochgeladen|Uploaded): remove\.jpg/)).not.toBeInTheDocument();
  });
});
