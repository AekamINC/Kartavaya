import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * A file lives in object storage, and the number a screen prints is the
 * server's.
 *
 * ── Why this suite reads the backend off disk ────────────────────────────────
 *
 * The defect it exists for is not a crash. `TaskDrawer` and `DrawerAttachments`
 * both offered 25 MB for a document and 50 MB for video; `esign/CreateTab`
 * offered 20 MB; `NewTaskModal` printed the right numbers and checked nothing;
 * mobile's `NewTaskSheet` carried a 5 MB constant it never read. Every one of
 * them was a literal typed beside a server that enforces 10 MB, 25 MB for video
 * and 10 MB for an e-sign PDF — and four of the five were wrong UPWARDS, which
 * is the harmful direction: the file uploads for however long the connection
 * takes and is refused on arrival.
 *
 * So the assertions below are against `backend/routers/uploads.py` and
 * `backend/routers/esign.py` as text. Raise a cap on the server without raising
 * it here and this goes red; lower one and it goes red too. A FAILED READ FAILS
 * — "the file moved" and "the numbers agree" must not look the same from here.
 *
 * The second half is about the KEY. A stored presigned url expires in nine
 * hours and the key is the only thing it can be re-signed from; `FilesField`
 * threw the key away, which is how a link dies overnight with nothing left to
 * repair it from. And the third is about a refusal being visible: the server
 * now refuses an upload when no bucket resolves instead of inlining the bytes
 * as a data URI, so every screen that swallowed the rejection would have shown
 * a silent no-op to everyone.
 */

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { api } from '../lib/api';
import { ToastProvider } from '../components/ui/toast';
import FilesField from '../components/fields/FilesField';
import TabProfile from '../pages/org/TabProfile';
import {
  MAX_MB, MAX_MB_VIDEO, MAX_MB_ESIGN_PDF, limitMbFor, oversizeMessage,
} from '../lib/uploadLimits';

const REPO = resolve(__dirname, '..', '..', '..');

/** Read, or fail loudly with the path. Never returns null. */
function readOrFail(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`Could not read ${path} — ${e.message}`);
  }
}

/** `NAME = 10 * 1024 * 1024` → 10. Throws rather than returning a guess. */
function serverCapMb(source, name, path) {
  const m = new RegExp(`${name}\\s*=\\s*(\\d+)\\s*\\*\\s*1024\\s*\\*\\s*1024`).exec(source);
  if (!m) throw new Error(`${name} is no longer declared as N * 1024 * 1024 in ${path}`);
  return Number(m[1]);
}

const UPLOADS_PY = resolve(REPO, 'backend', 'routers', 'uploads.py');
const ESIGN_PY   = resolve(REPO, 'backend', 'routers', 'esign.py');
const src = (...p) => readOrFail(resolve(REPO, 'frontend', 'src', ...p));

describe('the client caps are the server’s caps', () => {
  const uploads = readOrFail(UPLOADS_PY);
  const esign   = readOrFail(ESIGN_PY);

  it('MAX_MB matches uploads.MAX_BYTES', () => {
    expect(MAX_MB).toBe(serverCapMb(uploads, 'MAX_BYTES', UPLOADS_PY));
  });

  it('MAX_MB_VIDEO matches uploads.MAX_BYTES_VIDEO', () => {
    expect(MAX_MB_VIDEO).toBe(serverCapMb(uploads, 'MAX_BYTES_VIDEO', UPLOADS_PY));
  });

  it('MAX_MB_ESIGN_PDF matches esign._MAX_PDF_BYTES', () => {
    expect(MAX_MB_ESIGN_PDF).toBe(serverCapMb(esign, '_MAX_PDF_BYTES', ESIGN_PY));
  });

  it('never claims more than the server accepts', () => {
    const serverDoc   = serverCapMb(uploads, 'MAX_BYTES', UPLOADS_PY);
    const serverVideo = serverCapMb(uploads, 'MAX_BYTES_VIDEO', UPLOADS_PY);
    expect(MAX_MB).toBeLessThanOrEqual(serverDoc);
    expect(MAX_MB_VIDEO).toBeLessThanOrEqual(serverVideo);
    expect(MAX_MB_ESIGN_PDF).toBeLessThanOrEqual(serverDoc);
  });

  it('sizes by extension, the way uploads.py does', () => {
    expect(limitMbFor('scan.pdf')).toBe(MAX_MB);
    expect(limitMbFor('site-walk.MOV')).toBe(MAX_MB_VIDEO);
    expect(limitMbFor('clip.mkv')).toBe(MAX_MB_VIDEO);
    expect(limitMbFor(null)).toBe(MAX_MB);
  });
});

describe('the message names the file, its size and its limit', () => {
  it('is null when nothing is over', () => {
    expect(oversizeMessage([{ name: 'a.pdf', size: 1024 }])).toBeNull();
  });

  it('names one offender exactly', () => {
    const msg = oversizeMessage([{ name: 'plan.pdf', size: 41 * 1024 * 1024 }]);
    expect(msg).toContain('plan.pdf');
    expect(msg).toContain('41.0 MB');
    expect(msg).toContain(`${MAX_MB} MB`);
  });

  it('applies the video cap to a video', () => {
    const under = { name: 'walk.mov', size: (MAX_MB + 1) * 1024 * 1024 };
    expect(oversizeMessage([under])).toBeNull();
    const over = { name: 'walk.mov', size: (MAX_MB_VIDEO + 1) * 1024 * 1024 };
    expect(oversizeMessage([over])).toContain('walk.mov');
  });

  it('a file of unknown size is never refused — the server still counts', () => {
    expect(oversizeMessage([{ name: 'mystery.bin' }])).toBeNull();
    expect(oversizeMessage([{ name: 'mystery.bin', size: null }])).toBeNull();
  });
});

describe('no screen restates a size literal', () => {
  // Per file: the symbols it must actually USE, so an import left behind by a
  // revert does not satisfy the check on its own.
  const SCREENS = [
    ['components/TaskDrawer.jsx', ['oversizeMessage']],
    ['components/drawer/DrawerAttachments.jsx', ['MAX_MB', 'MAX_MB_VIDEO', 'VIDEO_EXT']],
    ['components/NewTaskModal.jsx', ['MAX_MB', 'MAX_MB_VIDEO', 'oversizeMessage']],
    ['components/fields/FilesField.jsx', ['oversizeMessage']],
    ['pages/esign/CreateTab.jsx', ['MAX_MB_ESIGN_PDF']],
    ['pages/org/TabProfile.jsx', ['oversizeMessage']],
  ];

  it.each(SCREENS)('%s imports its limits rather than declaring them', (rel) => {
    const code = src(...rel.split('/'));
    expect(code).toMatch(/from '(\.\.\/)+lib\/uploadLimits'/);
    // A local `const MAX_MB = 25` is the exact shape of the bug. The comments
    // in these files quote the old numbers deliberately, so only declarations
    // count.
    expect(code).not.toMatch(/^\s*const\s+MAX_MB(_VIDEO|_ESIGN_PDF)?\s*=/m);
  });

  it.each(SCREENS.filter(([, names]) => names.length))(
    '%s uses the imported names',
    (rel, names) => {
      const code = src(...rel.split('/'));
      for (const n of names) expect(code).toContain(n);
    },
  );
});

/** A picked file as the DOM hands it over — only `name` and `size` are read. */
const picked = (name, size) => ({ name, size });

/** Put files on a hidden input and fire the change the component listens for. */
function pick(input, files) {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
}

describe('FilesField keeps the key', () => {
  beforeEach(() => vi.clearAllMocks());

  const field = { field_id: 'f1', name: 'Drawings', type: 'files' };

  it('stores the key the upload returned, not the url alone', async () => {
    api.post.mockResolvedValueOnce({
      data: {
        name: 'plan.pdf',
        url: 'https://r2.example/plan.pdf?X-Amz-Expires=32400',
        key: 'projects/7/plan.pdf',
        size: 2048,
      },
    });
    const onChange = vi.fn();
    const { container } = render(
      <FilesField field={field} value={[]} onChange={onChange} />,
    );

    pick(container.querySelector('input[type="file"]'), [picked('plan.pdf', 2048)]);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalledWith([{
      name: 'plan.pdf',
      url: 'https://r2.example/plan.pdf?X-Amz-Expires=32400',
      key: 'projects/7/plan.pdf',
    }]);
  });

  it('records a null key rather than dropping the member when the server sends none', async () => {
    api.post.mockResolvedValueOnce({ data: { name: 'a.pdf', url: 'https://r2.example/a.pdf' } });
    const onChange = vi.fn();
    const { container } = render(<FilesField field={field} value={[]} onChange={onChange} />);

    pick(container.querySelector('input[type="file"]'), [picked('a.pdf', 10)]);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0][0][0]).toHaveProperty('key', null);
  });

  it('renders an entry that already has a key exactly as before', () => {
    render(
      <FilesField
        field={field}
        value={[{ name: 'old.pdf', url: 'https://r2.example/old.pdf', key: 'k/old.pdf' }]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('old.pdf')).toHaveAttribute('href', 'https://r2.example/old.pdf');
  });
});

describe('a refused upload is visible and attaches nothing', () => {
  beforeEach(() => vi.clearAllMocks());
  const field = { field_id: 'f1', name: 'Drawings', type: 'files' };

  it('shows the server’s reason and calls onChange with nothing', async () => {
    api.post.mockRejectedValueOnce({
      response: { status: 503, data: { detail: 'Storage is not configured: R2_ACCOUNT_ID is unset.' } },
    });
    const onChange = vi.fn();
    const { container } = render(<FilesField field={field} value={[]} onChange={onChange} />);

    pick(container.querySelector('input[type="file"]'), [picked('plan.pdf', 2048)]);

    expect(await screen.findByRole('alert')).toHaveTextContent('R2_ACCOUNT_ID is unset');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuses an oversized file before any request is made', async () => {
    const onChange = vi.fn();
    const { container } = render(<FilesField field={field} value={[]} onChange={onChange} />);

    pick(container.querySelector('input[type="file"]'), [
      picked('drone.mp4', (MAX_MB_VIDEO + 15) * 1024 * 1024),
    ]);

    expect(await screen.findByRole('alert')).toHaveTextContent('drone.mp4');
    expect(api.post).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('the org logo sends its key', () => {
  beforeEach(() => vi.clearAllMocks());

  const PROFILE = {
    name: 'Aekam Inc', gstin: '', pan: '', tan: '',
    logo_url: '', logo_key: '',
    email: '', phone: '', website: '',
    billing_address: {}, bank_details: {}, invoice_note: '',
  };

  const renderProfile = () => render(<ToastProvider><TabProfile /></ToastProvider>);

  it('PATCHes logo_key alongside logo_url after an upload', async () => {
    api.get.mockResolvedValue({ data: PROFILE });
    api.post.mockResolvedValue({
      data: {
        name: 'logo.png',
        url: 'https://r2.example/logo.png?X-Amz-Expires=32400',
        key: 'org/1/logo.png',
      },
    });
    api.patch.mockResolvedValue({ data: { code_warnings: {} } });

    const { container } = renderProfile();
    await screen.findByText('Logo');

    pick(container.querySelector('input[type="file"]'), [picked('logo.png', 4096)]);
    await waitFor(() => expect(api.post).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Save company profile'));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());

    const [, body] = api.patch.mock.calls[0];
    // The key is what survives: the url is a nine-hour signature and GET mints
    // a fresh one from the key on every read.
    expect(body.logo_key).toBe('org/1/logo.png');
    expect(body.logo_url).toBe('https://r2.example/logo.png?X-Amz-Expires=32400');
  });

  it('does not attach a logo the server refused', async () => {
    api.get.mockResolvedValue({ data: PROFILE });
    api.post.mockRejectedValue({
      response: { status: 503, data: { detail: 'Storage is not configured: R2_BUCKET is unset.' } },
    });

    const { container } = renderProfile();
    await screen.findByText('Logo');

    pick(container.querySelector('input[type="file"]'), [picked('logo.png', 4096)]);
    await waitFor(() => expect(api.post).toHaveBeenCalled());

    // findAll, not find: the toast is announced twice on purpose — once in the
    // live region and once on screen.
    expect((await screen.findAllByText(/R2_BUCKET is unset/)).length).toBeGreaterThan(0);
    expect(container.querySelector('.olg__z img')).toBeNull();
  });
});
