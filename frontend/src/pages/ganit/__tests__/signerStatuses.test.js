/**
 * The Ganit signature drawer and the module that writes the statuses.
 *
 * A contract's signature request is an e-Sign document: it lives in
 * `staging.sign_documents` / `staging.sign_signers`, and `routers/esign.py`
 * advances the signer's status. It used to live in the Ganit module's own
 * `ganit_contract_signers`, whose statuses were a DIFFERENT set that happened to
 * overlap on two values.
 *
 * That overlap is the trap this file exists for. Moving the source of truth left
 * `SIGN_STATUS_COLORS` and the drawer's `canCancel` still compiling, still
 * rendering, and quietly wrong:
 *
 *   - `canCancel` tested for `pending` or `otp_sent`. The e-Sign module never
 *     writes `otp_sent`, and an emailed signer sits at `sent` — so the "Cancel
 *     request" button, the only control that stops outstanding signing links
 *     working, would have been hidden for every real request.
 *   - `declined` had no colour, so a party who REFUSED to sign rendered in the
 *     same grey as one whose link merely expired.
 *
 * Neither would have failed a test or thrown. So the check is against the
 * backend source itself: every status that module writes to `sign_signers` has
 * to be a status this module knows how to draw.
 *
 * Comments are stripped before matching. Both status names and both table names
 * appear in prose in those files — including in the paragraphs describing this
 * very bug — and an unstripped scan would be satisfied by the commentary rather
 * than by the code. Four checks in this repo have already been.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { SIGN_STATUS_COLORS, SIGN_OUTSTANDING } from '../_shared';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, '../../../../../backend');

/** Python source with comments and docstrings removed. */
function stripPython(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const three = src.slice(i, i + 3);
    if (three === '"""' || three === "'''") {
      const end = src.indexOf(three, i + 3);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    const c = src[i];
    if (c === '"' || c === "'") {
      // A single-quoted string: keep it, this is where SQL lives.
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') j += 1;
        j += 1;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * Every status literal the backend writes to `staging.sign_signers`.
 *
 * The queries are built by adjacent-string concatenation across several lines,
 * so the table name and the status literal are not on the same line. The window
 * is measured from the table name forward to the end of that statement's
 * string run, which is what `'` … `'` pairs on consecutive lines amount to.
 */
function backendSignerStatuses() {
  const files = ['routers/esign.py', 'services/esign_service.py'];
  const found = new Set();
  for (const f of files) {
    const src = stripPython(readFileSync(resolve(BACKEND, f), 'utf8'));
    const re = /sign_signers[\s\S]{0,500}?/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const window = src.slice(m.index, m.index + 500);
      // Stop at the next statement so a following query's status does not bleed
      // in: every one of these ends with a `)` closing the pool call.
      const stmt = window.split(/\)\s*\n/)[0];
      for (const s of stmt.matchAll(/status\s*=\s*'(\w+)'/g)) found.add(s[1]);
      for (const s of stmt.matchAll(/VALUES[^;]*?'(sent|pending|opened|signed|declined)'/g)) found.add(s[1]);
    }
  }
  return found;
}

describe('the signer statuses the drawer has to render', () => {
  it('finds the statuses in the backend at all', () => {
    // Guards the scanner itself. If a refactor changes how those queries are
    // written, this fails loudly instead of the suite below passing over an
    // empty set and asserting nothing.
    const found = backendSignerStatuses();
    expect(found.size).toBeGreaterThanOrEqual(3);
    expect(found.has('signed')).toBe(true);
  });

  it('gives every status the backend writes a colour', () => {
    const known = new Set(Object.keys(SIGN_STATUS_COLORS));
    const missing = [...backendSignerStatuses()].filter(s => !known.has(s));
    expect(missing).toEqual([]);
  });

  it('treats an emailed-but-unsigned signer as outstanding', () => {
    // `sent` is what a signer sits at from the moment the email leaves until
    // they open the link. If this is not outstanding, the firm cannot withdraw
    // a request that is live in someone's inbox.
    expect(SIGN_OUTSTANDING).toContain('sent');
    expect(SIGN_OUTSTANDING).toContain('opened');
  });

  it('does not treat a finished signer as outstanding', () => {
    for (const done of ['signed', 'declined', 'expired', 'cancelled']) {
      expect(SIGN_OUTSTANDING).not.toContain(done);
    }
  });

  it('gives every outstanding status a colour of its own', () => {
    for (const s of SIGN_OUTSTANDING) {
      expect(SIGN_STATUS_COLORS[s]).toBeTruthy();
    }
  });

  it('does not paint a refusal the same as an expiry', () => {
    // Grey for "the link lapsed" and grey for "this party said no" is one
    // glance away from a firm chasing a signature nobody is going to give.
    expect(SIGN_STATUS_COLORS.declined).not.toBe(SIGN_STATUS_COLORS.expired);
    expect(SIGN_STATUS_COLORS.declined).toBe('var(--danger)');
  });
});
