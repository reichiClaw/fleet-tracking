import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { QRPrintPage } from './QRPrintPage';

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

describe('QRPrintPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:qr') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    await i18n.changeLanguage('en');
  });

  it('keeps selected QR labels across server pages and prints only the selection', async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/vehicle-categories/')) return jsonResponse([]);
      if (url.includes('/vehicles/qr-bulk/')) {
        requestedUrls.push(url);
        const second = url.includes('page=2');
        return jsonResponse({
          count: 2,
          next: second ? null : '/api/v1/vehicles/qr-bulk/?page=2',
          previous: second ? '/api/v1/vehicles/qr-bulk/?page=1' : null,
          results: [{
            id: second ? 'vehicle-2' : 'vehicle-1',
            qr_code: second ? 'VH-TWO' : 'VH-ONE',
            internal_number: second ? 'FZ-00002' : 'FZ-00001',
            license_plate: second ? 'M-B 2' : 'M-A 1',
            status: 'available',
            label: second ? 'FZ-00002 · Globex · Crane' : 'FZ-00001 · Acme · Lift',
            public_url: second ? 'https://fleet.example/v/VH-TWO' : 'https://fleet.example/v/VH-ONE',
          }],
        });
      }
      return jsonResponse([]);
    }));
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(
      <MemoryRouter>
        <QRPrintPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'QR bulk management' })).toBeInTheDocument();
    expect(requestedUrls[0]).toContain('include_inactive=false');
    fireEvent.click(screen.getByRole('checkbox', { name: /Select FZ-00001/ }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    const firstPagination = screen.getByText(/Showing 1–1 of 2/).closest('nav') as HTMLElement;
    fireEvent.click(within(firstPagination).getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('FZ-00002 · Globex · Crane', { selector: 'td' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Select FZ-00002/ }));

    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: /FZ-0000[12]/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Print selected' }));
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
  });
});
