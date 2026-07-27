/**
 * The document download path: the blob is released, and a refusal is NAMED.
 *
 * Both failures these guard against are invisible in review:
 *
 *   · An object URL that is never revoked pins the blob for the life of the
 *     tab. A finance user generating a morning of statements leaks every one.
 *   · A 422 from `routers/documents.py` carries a STRUCTURED refusal — the list
 *     of mandatory fields the backend will not invent. `detail` is an OBJECT,
 *     not a string, and an earlier version of this code rendered it as one,
 *     producing "[object Object]" or falling through to "something went wrong".
 *     That list is the entire reason the backend refuses instead of emitting a
 *     document that looks finished.
 *
 * With `responseType: 'blob'` an ERROR body also arrives as a Blob and has to be
 * read back as text before it is JSON, which is why the whole path is async.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const request = vi.fn();

vi.mock('../lib/api', () => ({
  api: { request: (...a) => request(...a) },
}));

const { downloadDocument } = await import('../lib/documents');
const { describeDocumentError } = await import('../lib/docErrors');

let created = [];
let revoked = [];

/**
 * jsdom ships `Blob` without `Blob.prototype.text`.
 *
 * Every browser Kartavaya supports has it (Chrome 76+, Firefox 69+, Safari 14+)
 * — this is a gap in the test environment, not in the code under test. Shimmed
 * here rather than adding a FileReader fallback to `docErrors.js`, which would
 * be code written for a mock rather than for a user. What these tests then
 * genuinely exercise is the JSON/`detail` handling on top of it.
 */
function shimBlobText() {
  if (typeof Blob.prototype.text === 'function') return;
  Blob.prototype.text = function text() {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

beforeEach(() => {
  shimBlobText();
  created = [];
  revoked = [];
  request.mockReset();
  globalThis.URL.createObjectURL = vi.fn(() => {
    const url = `blob:mock/${created.length}`;
    created.push(url);
    return url;
  });
  globalThis.URL.revokeObjectURL = vi.fn(url => revoked.push(url));
  // jsdom navigates on a real anchor click; stub it to a no-op.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

/** An axios-shaped success carrying a PDF blob. */
const pdfResponse = (headers = {}) => ({
  data: new Blob(['%PDF-1.7'], { type: 'application/pdf' }),
  headers,
});

describe('downloadDocument', () => {
  it('revokes the object URL it created', async () => {
    request.mockResolvedValue(pdfResponse());

    await downloadDocument({ url: '/v1/documents/quotations/x/pdf', filename: 'q.pdf' });

    expect(created).toHaveLength(1);
    expect(revoked).toEqual(created);
  });

  it('still revokes when the click throws', async () => {
    request.mockResolvedValue(pdfResponse());
    HTMLAnchorElement.prototype.click.mockImplementation(() => { throw new Error('nope'); });

    await expect(
      downloadDocument({ url: '/v1/documents/quotations/x/pdf' }),
    ).rejects.toThrow('nope');
    // The blob must not be pinned just because the download failed.
    expect(revoked).toEqual(created);
  });

  it('prefers the filename the server chose', async () => {
    request.mockResolvedValue(pdfResponse({
      'content-disposition': 'attachment; filename="SOA-1A2B3C4D-20260731.pdf"',
    }));
    let downloaded = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      downloaded = this.download;
    });

    await downloadDocument({ url: '/x', filename: 'fallback.pdf' });

    expect(downloaded).toBe('SOA-1A2B3C4D-20260731.pdf');
  });

  it('falls back to the caller name when the header is not exposed', async () => {
    // Cross-origin, `Content-Disposition` absent from Access-Control-Expose-Headers.
    request.mockResolvedValue(pdfResponse());
    let downloaded = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      downloaded = this.download;
    });

    await downloadDocument({ url: '/x', filename: 'GSTR-3B-2026-07.pdf' });

    expect(downloaded).toBe('GSTR-3B-2026-07.pdf');
  });

  it('sends the body and query the POST routes need', async () => {
    request.mockResolvedValue(pdfResponse());

    await downloadDocument({
      method: 'post',
      url: '/v1/documents/projects/b1/report/pdf',
      params: { period_start: '2026-07-01', period_end: '2026-07-27' },
      data: {},
    });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'post',
      url: '/v1/documents/projects/b1/report/pdf',
      params: { period_start: '2026-07-01', period_end: '2026-07-27' },
      responseType: 'blob',
    }));
  });
});

describe('describeDocumentError — the refusal is an object, not a string', () => {
  /** A 422 body as the browser receives it under responseType: 'blob'. */
  const blobError = payload => ({
    response: {
      status: 422,
      data: new Blob([JSON.stringify(payload)], { type: 'application/json' }),
    },
  });

  it('names the missing field from a blob-wrapped 422', async () => {
    const { title, message } = await describeDocumentError(blobError({
      detail: {
        error: 'document_incomplete',
        document: 'TDS challan',
        blocking: [{ field: 'org.tan', label: 'TAN', reason: 'section 203A', fix: 'Organisation profile' }],
      },
    }), 'Could not generate the challan');

    expect(title).toContain('TDS challan');
    expect(message).toContain('TAN');
    expect(message).toContain('Organisation profile');
    // The specific regression: an object rendered as a string.
    expect(message).not.toContain('[object Object]');
  });

  it('lists every blocking field, not just the first', async () => {
    const { message } = await describeDocumentError(blobError({
      detail: {
        error: 'document_incomplete',
        document: 'service agreement',
        blocking: [
          { field: 'agreement.scope', label: 'Scope of services', fix: 'the contract' },
          { field: 'agreement.fee', label: 'Professional fee', fix: 'the contract' },
        ],
      },
    }));

    expect(message).toContain('Scope of services');
    expect(message).toContain('Professional fee');
  });

  it('does not report a permission failure as a missing field', async () => {
    const { title } = await describeDocumentError({ response: { status: 403 } });
    expect(title).toBe('Access denied');
  });

  it('falls back without throwing when the body is not JSON', async () => {
    const { title } = await describeDocumentError(
      { response: { status: 500, data: new Blob(['<html>502</html>']) } },
      'Could not generate the working paper',
    );
    expect(title).toBe('Could not generate the working paper');
  });
});
