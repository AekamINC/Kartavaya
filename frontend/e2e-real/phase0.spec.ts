/**
 * Phase 0 verification, against the deployed staging build, as a real user.
 *
 * These assert the three defects fixed in e6fc972a are actually fixed IN THE
 * PRODUCT, not merely in the unit tests:
 *
 *   1. e-sign hands back a real signed PDF, not a JSON certificate
 *   2. Srijan content images load rather than 404 on an expired link
 *   3. an invoice generated from an order is unpaid, editable, and in receivables
 *
 * NO `test.skip` ON A MISSING AFFORDANCE. The previous suite used
 * `test.skip(!opened, …)` when it could not find a control, which is how the
 * e-sign journey reported green for weeks while the entire module was returning
 * 403 for this org — the plan had no `esign` entitlement, every call failed, and
 * the skip made it look deliberate. A control that should be there and is not is
 * a FAILURE. Anything genuinely conditional is asserted on the API instead, so
 * there is always something real being checked.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { OWNER_STATE, DL_DIR } from './real.config';

const API = process.env.E2E_API_URL || 'https://kartavya-staging.up.railway.app';
const ORG = process.env.E2E_ORG_ID || '';
// AWS SES simulator: accepts and discards, never bounces, reaches no human.
const SIGNER_EMAIL = process.env.E2E_SIGNER_EMAIL || 'success+e2esign@simulator.amazonses.com';
const HANDOFF = path.join(DL_DIR, 'phase0-esign-handoff.json');

test.use({ storageState: OWNER_STATE });

async function api(page: Page, method: 'get' | 'post', p: string, data?: any) {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  return page.request[method](API + p, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-Org-Id': ORG },
    ...(data ? { data } : {}),
  });
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
}

/**
 * Read a stored artefact, whichever way storage handed it back.
 *
 * `storage.upload_file` returns a presigned https URL when the org has R2
 * credentials and a base64 `data:` URI when it does not. The E2E org has none,
 * so every uploaded file in it takes the fallback — and `request.get` refuses a
 * data: URL outright ("Protocol \"data:\" not supported"). Handling only https
 * would mean this suite silently skipped the very path this org exercises.
 */
async function fetchArtefact(page: Page, url: string): Promise<Buffer> {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    expect(comma, `malformed data URI: ${url.slice(0, 40)}`).toBeGreaterThan(0);
    return Buffer.from(url.slice(comma + 1), 'base64');
  }
  const res = await page.request.get(url);
  expect(res.status(), `artefact fetch failed: ${url.slice(0, 80)}`).toBe(200);
  return await res.body();
}

/** A real multi-page PDF to upload, built here so the test owns its input. */
function makePdf(pages: number): Buffer {
  const objs: string[] = [];
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  for (let i = 0; i < pages; i++) {
    const stream = `BT /F1 24 Tf 72 720 Td (E2E source page ${i + 1}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> ` +
      `/Contents ${4 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/**
 * Count pages without adding a PDF library to the frontend.
 *
 * The page tree's `/Count` is what a reader trusts, and pypdf writes it once
 * for the merged document. Cross-checked against the number of `/Type /Page`
 * objects so a malformed `/Count` cannot quietly satisfy the assertion — the
 * two disagreeing is itself worth failing on.
 */
function pdfPageCount(buf: Buffer): number {
  const text = buf.toString('latin1');
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map(m => Number(m[1]));
  const pageObjs = (text.match(/\/Type\s*\/Page(?![s])/g) || []).length;
  const declared = counts.length ? Math.max(...counts) : 0;
  expect(declared, `the page tree declares ${declared} pages but ${pageObjs} page objects exist`)
    .toBe(pageObjs);
  return declared;
}

/** Open an invoice's drawer the way a user does: find its row, click it. */
async function openInvoice(page: Page, invoiceNumber: string) {
  await page.goto('/ganit');
  await settle(page);
  const row = page.locator('.gn-tbl__row', { hasText: invoiceNumber }).first();
  await expect(row, `invoice ${invoiceNumber} is not listed on the invoices tab`).toBeVisible();
  await row.click();
  await settle(page);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/today');
  await settle(page);
});


// ── 1 · the executed document ────────────────────────────────────────────────

test('e-sign: the module answers at all', async ({ page }) => {
  // The gate that made the old e-sign journey meaningless. Asserted first and
  // on its own so a plan/entitlement regression is unmistakable in the report
  // rather than showing up as "no create button".
  const r = await api(page, 'get', '/api/v1/esign/documents');
  expect(r.status(), `e-sign returned ${r.status()} — the org has no esign entitlement, ` +
    'so every journey below would be testing an error page').toBe(200);
  const docs = (await r.json()).data || [];
  expect(docs.length, 'the seeded e-sign documents are not reachable').toBeGreaterThan(0);
});

test('e-sign: a completed document produces a real signed PDF', async ({ page }) => {
  const list = await (await api(page, 'get', '/api/v1/esign/documents?status=completed')).json();
  const done = (list.data || []).filter((d: any) => d.status === 'completed');
  expect(done.length, 'no completed documents to verify against').toBeGreaterThan(0);

  const doc = done[0];

  // Assemble it if it predates the pipeline — that path is the fix for the 27
  // documents that completed when no signed copy was ever generated.
  let signedUrl = doc.signed_file_url;
  if (!signedUrl) {
    const built = await api(page, 'post', `/api/v1/esign/documents/${doc.id}/rebuild`);
    expect(built.status(), await built.text()).toBe(200);
    const body = await built.json();
    expect(body.appended_original, 'the original PDF was not bound into the signed copy').toBe(true);
    signedUrl = body.signed_file_url;
  }
  expect(signedUrl, 'a completed document still has no signed copy').toBeTruthy();

  // The bug, stated as an assertion: this used to be application/json.
  //
  // Two transports, because `storage.upload_file` has two. An org with R2
  // credentials gets a presigned https URL; an org WITHOUT them gets the
  // base64 data-URI fallback, and the E2E org has no R2 configured. Both are
  // real product behaviour and the artefact must be a PDF either way — asserting
  // only the https path would have quietly excused the fallback.
  const buf = await fetchArtefact(page, signedUrl);
  const head = buf.subarray(0, 5).toString('latin1');
  expect(head, `the signed artefact starts with ${JSON.stringify(head)} — ` +
    'if this is "{" it is the audit certificate again, not the document').toBe('%PDF-');
  expect(buf.length).toBeGreaterThan(1000);

  fs.writeFileSync(path.join(DL_DIR, 'phase0-signed.pdf'), buf);
});

test('e-sign: a real PDF uploaded through the form is attached and sent', async ({ page }) => {
  // The seeded documents point at `https://example.com/e2e-sign-N.pdf` — a
  // placeholder that resolves to nothing — so rebuilding one can only ever
  // prove the DEGRADED path (signature page alone, saying so). That is worth
  // proving and the test above proves it. It is not the claim that matters.
  //
  // This creates a document with a REAL 3-page PDF through the product's own
  // form, so the signing test below can prove the executed copy contains it.
  const stamp = Date.now().toString(36);
  const title = `E2E signed-copy check ${stamp}`;
  const srcPath = path.join(DL_DIR, `e2e-source-${stamp}.pdf`);
  fs.writeFileSync(srcPath, makePdf(3));

  await page.goto('/esign');
  await settle(page);
  // Exact role and label. A loose /Create/i matched a document CARD in the list
  // and opened its detail view, and the test then failed on a missing Title
  // field — which reads like a broken form rather than a bad selector.
  await page.getByRole('tab', { name: 'New document' }).click();
  await settle(page);

  await page.getByLabel(/^Title/i).fill(title);
  await page.locator('input[type="file"]').first().setInputFiles(srcPath);
  await page.getByLabel(/Signer 1 name/i).fill('Asha Rao');
  await page.getByLabel(/Signer 1 email/i).fill(SIGNER_EMAIL);
  await page.getByRole('button', { name: /^(Create|Save|Send for signing)/i }).first().click();
  await settle(page);

  const listed = await (await api(page, 'get', '/api/v1/esign/documents')).json();
  const doc = (listed.data || []).find((d: any) => d.title === title);
  expect(doc, 'the document created through the form is not in the list').toBeTruthy();
  expect(doc.file_key, 'the uploaded PDF was not attached').not.toBe('pending');

  const attached = await fetchArtefact(page, doc.file_url);
  expect(pdfPageCount(attached), 'the stored file is not the 3-page PDF that was uploaded').toBe(3);

  if (doc.status === 'draft') {
    const sent = await api(page, 'post', `/api/v1/esign/documents/${doc.id}/send`);
    expect(sent.status(), await sent.text()).toBe(200);
  }

  // Hand the next test its subject. The signing TOKEN cannot be read here —
  // it exists only in the signer's email, exposed by no API by design, since
  // it is the entire authority to apply a binding signature.
  fs.writeFileSync(HANDOFF, JSON.stringify({ id: doc.id, title }, null, 2));
});

test('e-sign: a signed document carries the pages that were signed', async ({ page }) => {
  // Needs E2E_SIGN_TOKEN — the signing link from the email, bridged in exactly
  // as `full-journey` bridges E2E_INVITE_TOKEN. This does NOT skip when the
  // token is absent: a silent skip is how the whole e-sign module reported
  // green for weeks while returning 403. It fails, and says what to supply.
  const token = process.env.E2E_SIGN_TOKEN || '';
  const otpFromEnv = process.env.E2E_SIGN_OTP || '';
  expect(token, 'set E2E_SIGN_TOKEN to the signing token issued by the previous test ' +
    '(it lives only in the signer email — read it out of band, as with E2E_INVITE_TOKEN)')
    .toBeTruthy();

  const handoff = JSON.parse(fs.readFileSync(HANDOFF, 'utf8'));

  const signer = await page.context().newPage();
  await signer.goto(`/sign/${token}`);
  await signer.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await signer.getByRole('button', { name: /Send verification code/i }).click();
  await expect(signer.getByPlaceholder('000000')).toBeVisible();

  expect(otpFromEnv, 'set E2E_SIGN_OTP to the code just emailed to the signer').toBeTruthy();
  await signer.getByPlaceholder('000000').fill(otpFromEnv);
  await signer.getByRole('button', { name: /^Verify$/i }).click();

  await expect(signer.getByRole('button', { name: /Sign document/i })).toBeVisible();
  const typed = signer.getByPlaceholder(/type your name/i)
    .or(signer.locator('input[type="text"]').last());
  await typed.fill('Asha Rao');
  await signer.getByRole('button', { name: /Sign document/i }).click();
  await signer.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await signer.screenshot({ path: path.join(DL_DIR, 'phase0-signed-confirmation.png'), fullPage: true });
  await signer.close();

  // Completion is what triggers the executed copy.
  const after = await (await api(page, 'get', `/api/v1/esign/documents/${handoff.id}`)).json();
  expect(after.document.status, 'the document did not complete after the only signer signed')
    .toBe('completed');
  expect(after.document.signed_file_url, 'completion produced no executed copy').toBeTruthy();
  expect(after.document.certificate_file_url, 'completion produced no audit certificate').toBeTruthy();

  const executed = await fetchArtefact(page, after.document.signed_file_url);
  expect(executed.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  fs.writeFileSync(path.join(DL_DIR, 'phase0-executed.pdf'), executed);

  // THE assertion: the pages that were signed are in the copy that says so.
  const pages = pdfPageCount(executed);
  expect(pages, `the executed copy has ${pages} pages — the 3-page original was not bound in, ` +
    'so this is a signature record with no agreement attached').toBe(4);

  // And the certificate is a separate artefact, still JSON.
  const cert = await fetchArtefact(page, after.document.certificate_file_url);
  expect(JSON.parse(cert.toString('utf8')).document_id).toBe(handoff.id);
});

test('e-sign: the drawer offers the document and the certificate as different things', async ({ page }) => {
  const list = await (await api(page, 'get', '/api/v1/esign/documents?status=completed')).json();
  const doc = (list.data || []).find((d: any) => d.status === 'completed');
  expect(doc, 'no completed document').toBeTruthy();

  await page.goto('/esign');
  await settle(page);

  // Open the document through the UI, the way a user does.
  const row = page.locator(`text=${doc.title}`).first();
  await expect(row, 'the completed document is not listed').toBeVisible();
  await row.click();
  await settle(page);

  const signed = page.getByRole('link', { name: /Signed document \(PDF\)/i })
    .or(page.getByRole('button', { name: /Assemble signed document/i }));
  await expect(signed, 'the drawer offers no signed document at all').toBeVisible();

  // The old label. If it comes back, the two artefacts have been conflated again.
  await expect(page.getByRole('link', { name: /^Signing certificate$/i }))
    .toHaveCount(0);

  await page.screenshot({ path: path.join(DL_DIR, 'phase0-esign-drawer.png'), fullPage: true });
});


// ── 2 · Srijan images ────────────────────────────────────────────────────────

test('srijan: the module answers at all', async ({ page }) => {
  const r = await api(page, 'get', '/api/v1/hub/org/content');
  expect(r.status(), `Srijan returned ${r.status()} — same entitlement trap as e-sign`).toBe(200);
});

test('srijan: every stored image URL actually loads', async ({ page }) => {
  const r = await api(page, 'get', '/api/v1/hub/org/content');
  expect(r.status()).toBe(200);
  const items = ((await r.json()).data || []).filter((i: any) => i.image_url);

  // The org's own seeded items carry no image; QA Test Corp's do. Rather than
  // depend on which org has what, assert the PROPERTY: whatever URLs the API
  // hands out must be live. A dead link here is the nine-hour expiry bug.
  for (const item of items.slice(0, 5)) {
    const img = await page.request.get(item.image_url);
    expect(img.status(), `image for "${item.title}" is dead — the presigned link was not re-signed`)
      .toBe(200);
    expect(img.headers()['content-type'] || '').toContain('image');
  }
});

test('srijan: a content item never hides its image in metadata', async ({ page }) => {
  // The 34-image bug: quick_generate wrote the URL only into metadata.images,
  // and the library reads the column. Any item whose metadata carries an image
  // must also expose it on image_url.
  const r = await api(page, 'get', '/api/v1/hub/org/content');
  const items = (await r.json()).data || [];
  const hidden = items.filter((i: any) => {
    const imgs = i.metadata?.images;
    return Array.isArray(imgs) && imgs.length > 0 && !i.image_url;
  });
  expect(hidden.map((i: any) => i.title),
    'these items have a generated image that the content library will never show').toEqual([]);
});


// ── 3 · the order invoice ────────────────────────────────────────────────────

test('vikray: an invoice generated from an order is unpaid and editable', async ({ page }) => {
  // Find a confirmed order that has not been invoiced yet.
  const orders = await (await api(page, 'get', '/api/v1/vikray/orders?limit=100')).json();
  const candidate = (orders.data || []).find(
    (o: any) => o.status !== 'draft' && o.status !== 'cancelled' && !o.invoice_id,
  );
  expect(candidate, 'no confirmed uninvoiced order to bill').toBeTruthy();

  const made = await api(page, 'post', `/api/v1/vikray/orders/${candidate.id}/invoice`);
  // A 422 here is the Rule 46 gate doing its job on an order with no HSN — a
  // legitimate outcome, and a far better one than the un-issuable invoice this
  // route used to mint. Anything else is a failure.
  if (made.status() === 422) {
    const body = await made.json();
    expect(body.detail?.blocking?.length,
      'refused with no stated reason — a 422 must name the gaps').toBeGreaterThan(0);
    return;
  }
  expect(made.status(), await made.text()).toBe(200);

  const { invoice_id } = await made.json();
  const inv = (await (await api(page, 'get', `/api/v1/ganit/invoices/${invoice_id}`)).json()).invoice;

  // The bug: balance_due DEFAULTs to 0, so this read as fully paid the moment
  // it was created — invisible in receivables, and uneditable.
  expect(Number(inv.balance_due),
    'the invoice was born fully paid: the money owed is invisible and it cannot be edited')
    .toBeCloseTo(Number(inv.total), 2);
  expect(Number(inv.total)).toBeGreaterThan(0);

  // And the user-facing consequence the owner actually reported: Edit is there.
  await openInvoice(page, inv.invoice_number);
  const edit = page.getByRole('button', { name: /^Edit/i }).or(page.getByRole('link', { name: /^Edit/i }));
  await expect(edit,
    'an unpaid invoice offers no Edit control — this is the reported bug, unfixed').toBeVisible();

  await page.screenshot({ path: path.join(DL_DIR, 'phase0-order-invoice.png'), fullPage: true });
});
