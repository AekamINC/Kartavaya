/**
 * The connectors page — one card per network, each with the network's own form.
 *
 * What is pinned here is the half a backend test cannot see: that the SCREEN
 * draws every platform whether or not it is configured, that it puts the
 * network's own field labels and console paths in front of the operator, and
 * that a saved secret is never rendered into an input — including as a
 * `value` attribute a password field happens to mask, which looks identical on
 * screen and is not identical in the DOM.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const get = vi.fn();
const put = vi.fn();
vi.mock('../../lib/api', () => ({
  api: {
    get: (...a) => get(...a),
    put: (...a) => put(...a),
    post: vi.fn(() => Promise.resolve({ data: { ok: true, detail: '' } })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));
vi.mock('../../components/ui', async (orig) => {
  const real = await orig();
  return { ...real, useToast: () => ({ pushToast: vi.fn() }) };
});

import ConnectorsPage from '../ConnectorsPage';

const WHATSAPP = {
  platform: 'whatsapp_business',
  label: 'WhatsApp Business',
  kind: 'token',
  publishes: true,
  console: 'https://business.facebook.com/wa/manage',
  caution: 'This is not an OAuth connector.',
  notes: [],
  redirect_url: 'https://api.example.com/api/v1/varta/webhook',
  fields: [
    { key: 'phone_number_id', label: 'Phone number ID',
      where: 'Meta app → WhatsApp → API Setup → the ID under the sending number.',
      secret: false, required: true, placeholder: '109…', help: '', value: '109555',
      saved: true },
    { key: 'access_token', label: 'Permanent access token',
      where: 'Business settings → Users → System users → Generate token',
      secret: true, required: true, placeholder: '', help: '', value: '', saved: true },
  ],
  has_secret: true,
  secret_hint: '9zQ1',
  is_active: true,
  effective_scope: 'org',
  last_tested_at: null,
  last_test_ok: null,
  last_test_detail: '',
};

const JUSTDIAL = {
  ...WHATSAPP,
  platform: 'justdial', label: 'JustDial', kind: 'lead', publishes: false,
  redirect_url: '', has_secret: false, is_active: false, secret_hint: '',
  caution: 'Lead INGESTION is not built.',
  fields: [{ key: 'api_key', label: 'API key', where: 'Issued by your JustDial account manager',
             secret: true, required: true, placeholder: '', help: '', value: '', saved: false }],
};

function serve(cards) {
  get.mockImplementation((url) => {
    if (url === '/v1/hub/connectors') {
      return Promise.resolve({
        data: { data: cards, retired: ['snapchat', 'telegram', 'tiktok'],
                where_checked: '2026-08-07', client_id: null },
      });
    }
    return Promise.resolve({ data: { data: [] } });
  });
}

beforeEach(() => { get.mockReset(); put.mockReset(); });

describe('the connectors page', () => {
  it('draws WhatsApp Business as one card here, not as a separate page', async () => {
    serve([{ ...WHATSAPP, org: WHATSAPP, client: null }]);
    render(<ConnectorsPage />);
    expect(await screen.findByText('WhatsApp Business')).toBeTruthy();
    // Not "Connects by consent" — Meta's Cloud API has no consent round-trip,
    // and telling an operator to expect a popup that never comes is the failure
    // this label prevents.
    expect(screen.getByText('Connects by pasted token')).toBeTruthy();
  });

  it('puts the network’s own field label and console path in front of the operator', async () => {
    serve([{ ...WHATSAPP, org: WHATSAPP, client: null }]);
    render(<ConnectorsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /edit/i }));

    // Meta says "Phone number ID". A form saying "client id" makes the operator
    // guess which of four values on their console is meant.
    expect(screen.getByText('Phone number ID')).toBeTruthy();
    expect(screen.getByText(/API Setup → the ID under the sending number/)).toBeTruthy();
  });

  it('never renders a saved secret, not even as a masked value', async () => {
    serve([{ ...WHATSAPP, org: WHATSAPP, client: null }]);
    const { container } = render(<ConnectorsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /edit/i }));

    const pw = container.querySelector('input[type="password"]');
    expect(pw).toBeTruthy();
    expect(pw.value).toBe('');
    // The hint, so the operator can match it against their console without the
    // value ever crossing the network again.
    expect(pw.getAttribute('placeholder')).toContain('9zQ1');
    expect(screen.getByText(/Leave this empty to keep it/)).toBeTruthy();
  });

  it('sends only what was typed, so an untouched secret is not cleared', async () => {
    serve([{ ...WHATSAPP, org: WHATSAPP, client: null }]);
    put.mockResolvedValue({ data: {} });
    render(<ConnectorsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /edit/i }));

    fireEvent.change(screen.getByDisplayValue('109555'), { target: { value: '109666' } });
    fireEvent.click(screen.getByRole('button', { name: /save and switch on/i }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    const body = put.mock.calls[0][1];
    expect(body.values).toEqual({ phone_number_id: '109666' });
    expect('access_token' in body.values).toBe(false);
    expect(body.is_active).toBe(true);
  });

  it('shows the redirect URL to paste, before the fields', async () => {
    serve([{ ...WHATSAPP, org: WHATSAPP, client: null }]);
    render(<ConnectorsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /edit/i }));
    expect(screen.getByText('https://api.example.com/api/v1/varta/webhook')).toBeTruthy();
  });

  it('separates the inbound lead sources and says nothing reads them yet', async () => {
    serve([
      { ...WHATSAPP, org: WHATSAPP, client: null },
      { ...JUSTDIAL, org: JUSTDIAL, client: null },
    ]);
    render(<ConnectorsPage />);
    expect(await screen.findByText('Inbound lead sources')).toBeTruthy();
    expect(screen.getByText(/nothing reads these yet/i)).toBeTruthy();
  });

  it('names the retired platforms rather than letting them vanish', async () => {
    serve([{ ...WHATSAPP, org: WHATSAPP, client: null }]);
    render(<ConnectorsPage />);
    expect(await screen.findByText(/snapchat, telegram, tiktok/)).toBeTruthy();
  });
});
