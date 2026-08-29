/**
 * verify-bank-fixtures.mjs — run the PRODUCT'S OWN parser over the bank CSVs.
 *
 * Why this exists
 * ───────────────
 * Proposal 93 §5 says the bank statements are "CSV/XLS in the real bank formats
 * the parser expects", and warns that "parsing is positional — a hand-written
 * file with the right headers and wrong column order proves nothing".
 *
 * That warning describes code that no longer exists. `frontend/src/lib/bankCsv.js`
 * replaced the positional reader on 2026-08-09 (commit 1da2883b, "read the bank's
 * CSV, not five fields by position"). Today the importer reads the HEADER ROW and
 * guesses a column map from it — see `guessMapping`. Column ORDER no longer
 * matters; column NAMES are now the whole contract, and a fixture whose headers
 * are not what the bank actually writes proves nothing instead.
 *
 * So this script does not assert a hand-derived expectation. It imports the real
 * module and PRINTS what it does with each file, so the derivation is checkable
 * rather than claimed. Run it and read the output:
 *
 *     node frontend/e2e-real/fixtures/verify-bank-fixtures.mjs
 *
 * Exit code is 1 if any file fails its recorded expectation below, so it is also
 * usable as a check. The expectations were RECORDED FROM A RUN, not predicted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseCsv, guessMapping, looksLikeHeader, toLines, FIELDS,
} from '../../src/lib/bankCsv.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** What each file is meant to demonstrate, and what the parser must do with it. */
const CASES = [
  {
    file: 'bank/hdfc-current-aug2026.csv',
    bank: 'HDFC Bank — current account CSV export',
    // Every field the mapping must resolve, and the column index it must land on.
    expectMapping: { statement_date: 0, description: 1, reference: 2, debit: 4, credit: 5, running_balance: 6 },
    expectUnmapped: ['amount'],
    expectLines: 8,
    expectSkipped: 2,          // opening-balance row + the undated summary row
    expectSigns: [+1, -1, -1, -1, +1, +1, -1, -1],
  },
  {
    file: 'bank/sbi-current-aug2026.csv',
    bank: 'State Bank of India — CSV export (padded headers, "3 Aug 2026" dates)',
    expectMapping: { statement_date: 0, description: 2, reference: 3, debit: 4, credit: 5, running_balance: 6 },
    expectUnmapped: ['amount'],
    expectLines: 8,
    expectSkipped: 0,
    expectSigns: [-1, +1, -1, +1, -1, +1, -1, +1],
  },
  {
    file: 'bank/icici-current-aug2026.csv',
    bank: 'ICICI Bank — CSV export ("Withdrawal Amount (INR )" spelled in full)',
    // ⚠ THIS CASE WAS RECORDED BROKEN, AND THE DEFECT IS NOW FIXED.
    //
    // These expectations used to encode the FAULT — `amount: 5`, `debit`
    // unmapped, 3 lines imported and 5 withdrawals silently skipped — because
    // the fixture build found the bug and recorded what the parser actually
    // did rather than what it should do. That was the right call at the time:
    // an expectation invented from what the code ought to do would have hidden
    // the defect instead of pinning it.
    //
    // `guessMapping` now resolves `debit`/`credit` BEFORE `amount`
    // (`bankCsv.js` GUESS_ORDER), so the withdrawal column is no longer stolen
    // by the signed-amount hint. All eight transactions import and the five
    // withdrawals carry a negative amount.
    //
    // Updated deliberately, with the reason, rather than deleted — 93 §0: a
    // test that fails on a CORRECT fix is a defect in the test, and quietly
    // editing one green is how a real bug gets buried. The regression is now
    // pinned properly in `src/__tests__/bankCsv.test.js`, which asserts the
    // mapping, the row count and the SIGNS, and is proved to bite by mutation.
    expectMapping: { statement_date: 2, description: 4, reference: 3, debit: 5, credit: 6, running_balance: 7 },
    expectUnmapped: ['amount'],
    expectLines: 8,            // every transaction, not just the deposits
    expectSkipped: 0,          // OPENING BALANCE carries a date here, so nothing is dropped
    expectSigns: [-1, +1, -1, +1, -1, -1, +1, -1],
  },
];

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`   ✗ ${msg}`); };

for (const c of CASES) {
  const text = fs.readFileSync(path.join(HERE, c.file), 'utf8');
  const rows = parseCsv(text);
  const header = looksLikeHeader(rows[0]);
  const mapping = guessMapping(header ? rows[0] : []);
  const { lines, skipped } = toLines(rows, mapping, { hasHeader: header });

  console.log(`\n── ${c.file}`);
  console.log(`   ${c.bank}`);
  console.log(`   rows parsed: ${rows.length}   looksLikeHeader: ${header}`);
  console.log(`   header: ${JSON.stringify(rows[0])}`);
  console.log('   mapping guessed by guessMapping():');
  for (const { key, label } of FIELDS) {
    const idx = mapping[key];
    const col = idx == null ? '— not mapped —' : `[${idx}] ${JSON.stringify(rows[0][idx])}`;
    console.log(`     ${key.padEnd(16)} ${label.padEnd(24)} ${col}`);
  }
  console.log(`   imported ${lines.length} lines, skipped ${skipped.length}`);
  for (const l of lines) {
    console.log(`     ${l.statement_date}  ${String(l.amount).padStart(12)}  bal ${String(l.running_balance).padStart(12)}  ${l.description.slice(0, 46)}`);
  }
  for (const s of skipped) console.log(`     SKIPPED: ${s}`);

  if (!header) fail('the first row was not recognised as a header');
  for (const [k, v] of Object.entries(c.expectMapping)) {
    if (mapping[k] !== v) fail(`mapping.${k} is ${mapping[k]}, expected ${v}`);
  }
  for (const k of c.expectUnmapped) {
    if (mapping[k] != null) fail(`mapping.${k} should be unmapped, got ${mapping[k]}`);
  }
  if (lines.length !== c.expectLines) fail(`imported ${lines.length} lines, expected ${c.expectLines}`);
  if (skipped.length !== c.expectSkipped) fail(`skipped ${skipped.length} rows, expected ${c.expectSkipped}`);
  c.expectSigns.forEach((want, i) => {
    const got = Math.sign(lines[i]?.amount ?? 0);
    if (got !== want) fail(`line ${i + 1} sign is ${got}, expected ${want} (amount ${lines[i]?.amount})`);
  });
  // Every imported line must carry a date the server will accept: the import
  // endpoint does `date.fromisoformat` and 400s the row by name otherwise.
  for (const l of lines) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.statement_date)) fail(`bad date ${l.statement_date}`);
  }
}

console.log(failures === 0
  ? '\nAll bank fixtures behave exactly as recorded.\n'
  : `\n${failures} expectation(s) failed — the parser changed, or a fixture did.\n`);
process.exit(failures === 0 ? 0 : 1);
