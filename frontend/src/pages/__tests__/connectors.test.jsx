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

  // ── the header this page was rendering without ─────────────────────────
  //
  // `hi=` and `sub=` are not PageHeader props and are not among its two
  // aliases (`sans`→sanskrit, `subtitle`→lede). React says nothing about an
  // extra prop on a function component, so both simply vanished and the page
  // rendered a bare "Connectors" — the same silent failure PageHeader's own
  // header documents for the twelve call sites it was written to fix.
  it('renders its Devanagari and its subtitle rather than dropping both', async () => {
    serve([{ ...WHATSAPP, org: WHATSAPP, client: null }]);
    render(<ConnectorsPage />);
    expect(await screen.findByText('जोड़')).toBeTruthy();
    expect(screen.getByText(/app credentials each network needs/i)).toBeTruthy();
  });
});

// ── the client tab was showing the organisation's app ──────────────────────
//
// `save`, `test` and `remove` all send `client_id` when the client tab is
// selected, but the form was built from `card.fields` — which the server
// builds from the ORG row. So an operator setting up one client's own app was
// shown the organisation's saved app id and the organisation's saved-secret
// hint, and told by both that this client was already configured.
describe('the connectors page · one client’s own app', () => {
  const ORG_ROW = {
    ...WHATSAPP,
    secret_hint: 'ORG9',
    fields: [
      { ...WHATSAPP.fields[0], value: 'org-109555', saved: true },
      { ...WHATSAPP.fields[1], saved: true },
    ],
  };
  const CLIENT_ROW = {
    ...WHATSAPP,
    has_secret: false,
    secret_hint: '',
    is_active: false,
    fields: [
      { ...WHATSAPP.fields[0], value: '', saved: false },
      { ...WHATSAPP.fields[1], saved: false },
    ],
  };

  function serveBothLevels() {
    get.mockImplementation((url, opts) => {
      if (url === '/v1/hub/clients') {
        return Promise.resolve({ data: { data: [{ id: 'c1', name: 'Unicode Group' }] } });
      }
      if (url === '/v1/hub/connectors') {
        const scoped = !!opts?.params?.client_id;
        return Promise.resolve({
          data: {
            data: [{
              ...ORG_ROW,
              org: ORG_ROW,
              client: scoped ? CLIENT_ROW : null,
              effective_scope: 'org',
            }],
            retired: [], where_checked: '2026-08-21',
            client_id: scoped ? 'c1' : null,
          },
        });
      }
      return Promise.resolve({ data: { data: [] } });
    });
  }

  async function openClientTab() {
    serveBothLevels();
    render(<ConnectorsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /one client’s own app/i }));
    fireEvent.change(await screen.findByLabelText('Client'), { target: { value: 'c1' } });
    return screen.findByRole('button', { name: /set it up|edit/i });
  }

  it('renders the client’s own fields, not the organisation’s', async () => {
    fireEvent.click(await openClientTab());

    // The organisation's saved app id must NOT be sitting in the client's box
    // saying this client is already configured.
    expect(screen.queryByDisplayValue('org-109555')).toBeNull();
    expect(document.body.textContent).not.toContain('ORG9');
    // The client's own empty box IS drawn — the fix is the right row, not no row.
    expect(screen.getByPlaceholderText('109…')).toBeTruthy();
  });

  it('does not offer the organisation’s saved-secret hint over the client’s empty box', async () => {
    fireEvent.click(await openClientTab());
    const pw = document.querySelector('input[type="password"]');
    expect(pw).toBeTruthy();
    expect(pw.value).toBe('');
    // "saved · ends ORG9" over a client row with no secret is an instruction to
    // leave the box empty — which saves a client app with no secret at all.
    expect(pw.getAttribute('placeholder') || '').not.toContain('ORG9');
    expect(screen.queryByText(/Leave this empty to keep it/)).toBeNull();
  });

  it('still writes to the client, which is what made the mismatch dangerous', async () => {
    put.mockResolvedValue({ data: {} });
    fireEvent.click(await openClientTab());
    fireEvent.change(screen.getByPlaceholderText('109…'), { target: { value: 'client-777' } });
    fireEvent.click(screen.getByRole('button', { name: /save and switch on/i }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    const body = put.mock.calls[0][1];
    expect(body.client_id).toBe('c1');
    expect(body.values).toEqual({ phone_number_id: 'client-777' });
  });
});
