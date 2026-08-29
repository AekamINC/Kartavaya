/**
 * bankCsv.js — reading a bank statement CSV the way banks actually write them.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
 *
 * `csvText.split('\n')` then `line.split(',')`, with the five fields taken by
 * POSITION. Three things were wrong with that and all three are ordinary:
 *
 *   · The HEADER ROW was imported as a transaction. Its date is the word
 *     "Date", which the server rejects with a 400 naming the row — so the first
 *     thing a user saw was an error about their own column titles.
 *   · No Indian bank writes the columns in that order. HDFC, ICICI, SBI and Axis
 *     each write their own, and none of them is
 *     date/description/reference/amount/balance.
 *   · Almost none of them writes a SIGNED amount. They write two columns —
 *     Withdrawal and Deposit, or Debit and Credit — and money out is a positive
 *     number in the first. Read positionally, every payment out was imported as
 *     money in.
 *
 * ── AND `split(',')` IS NOT A CSV PARSER ────────────────────────────────────
 *
 * A description containing a comma — "PAYMENT, INV 12" — shifts every later
 * field by one. Quoted fields are the norm in bank exports, so this parses
 * quotes properly, including the doubled-quote escape.
 */

/** Parse CSV text into an array of string arrays. Handles quotes, escaped
 *  quotes, CRLF, and a trailing newline. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const s = String(text ?? '');

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') { quoted = true; i += 1; continue; }
    if (c === ',') { endField(); i += 1; continue; }
    if (c === '\r') { i += 1; continue; }
    if (c === '\n') { endRow(); i += 1; continue; }
    field += c; i += 1;
  }
  if (field !== '' || row.length) endRow();
  // Statements carry blank separator rows and a trailing newline.
  return rows.filter(r => r.some(cell => String(cell).trim() !== ''));
}

/** The fields the importer needs. `debit`/`credit` are the two-column shape;
 *  `amount` is the signed single-column shape. One or the other. */
export const FIELDS = [
  { key: 'statement_date',  label: 'Date',        required: true },
  { key: 'description',     label: 'Description', required: false },
  { key: 'reference',       label: 'Reference',   required: false },
  { key: 'amount',          label: 'Amount (signed)', required: false },
  { key: 'debit',           label: 'Withdrawal / Debit', required: false },
  { key: 'credit',          label: 'Deposit / Credit',   required: false },
  { key: 'running_balance', label: 'Balance',     required: false },
];

// What the four big Indian banks actually call these columns, lowercased.
const HINTS = {
  statement_date:  ['date', 'txn date', 'transaction date', 'value date', 'tran date', 'post date'],
  description:     ['narration', 'description', 'particulars', 'remarks', 'transaction remarks', 'details'],
  reference:       ['chq', 'cheque', 'ref no', 'reference', 'chq./ref.no.', 'ref no./cheque no', 'utr'],
  debit:           ['withdrawal', 'withdrawal amt', 'debit', 'debit amount', 'dr', 'withdrawal amount'],
  credit:          ['deposit', 'deposit amt', 'credit', 'credit amount', 'cr', 'deposit amount'],
  amount:          ['amount', 'txn amount', 'transaction amount'],
  running_balance: ['balance', 'closing balance', 'running balance', 'balance amt'],
};

const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ').trim();

/**
 * Guess which column is which from the header row.
 *
 * A guess, and presented as one: the mapping screen shows what was guessed and
 * lets it be changed before anything is imported. An importer that guesses
 * silently is how a statement gets loaded with the debits reversed.
 */
/**
 * The order the COLUMNS are guessed in, which is deliberately not the order
 * `FIELDS` lists them in — `FIELDS` drives the mapping screen, where "Amount
 * (signed)" belongs above the two-column pair because that is how a person
 * reads it.
 *
 * ⚠ WHY THE TWO-COLUMN PAIR MUST BE GUESSED FIRST. ICICI names its columns
 * `Withdrawal Amount (INR )` and `Deposit Amount (INR )`. Guessing `amount`
 * first, its substring hint `'amount'` matched the WITHDRAWAL column and
 * marked it used; `debit` then found nothing. `credit` still mapped, so
 * `toLines` took the two-column branch with `debit` unmapped — `out` was
 * always 0, a withdrawal row's deposit cell is empty, and `amount` came out
 * 0. **Every withdrawal was dropped and counted as a skipped row.**
 *
 * Five of eight rows vanished from a real statement shape, and the skip
 * counter is designed for subtotal and opening-balance lines, so the loss read
 * as the importer working correctly. Reproduced independently by renaming a
 * plain `Debit` column to `Withdrawal Amount` — the trigger is the column
 * NAME, not the bank.
 *
 * That matters more here than in most importers: this product has no payment
 * gateway and never will, so bank reconciliation is the only path to "paid".
 * A statement that silently drops its payments out corrupts the one ledger
 * that decides whether an invoice is settled.
 *
 * This is the same failure the function already guards against one notch down
 * — "Balance" stealing "Balance Amt", "Debit" matching "Debit Card" — just
 * between field groups rather than within one.
 */
const GUESS_ORDER = [
  'statement_date', 'description', 'reference',
  // The pair before the signed column, always.
  'debit', 'credit',
  'amount',
  'running_balance',
];

export function guessMapping(header) {
  const cols = header.map(norm);
  const used = new Set();
  const map = {};
  const ordered = GUESS_ORDER.map(k => FIELDS.find(f => f.key === k)).filter(Boolean);
  // Anything FIELDS gains later still gets guessed, just last — a new field
  // that nobody adds to GUESS_ORDER must not silently stop being mapped.
  for (const f of FIELDS) if (!ordered.includes(f)) ordered.push(f);
  for (const { key } of ordered) {
    const hints = HINTS[key] || [];
    let found = -1;
    // Exact first, so "Balance" does not steal the column called "Balance Amt"
    // from a better match, and "Debit" does not match "Debit Card".
    for (const h of hints) {
      found = cols.findIndex((c, i) => !used.has(i) && c === h);
      if (found >= 0) break;
    }
    if (found < 0) {
      for (const h of hints) {
        found = cols.findIndex((c, i) => !used.has(i) && c.includes(h));
        if (found >= 0) break;
      }
    }
    if (found >= 0) { map[key] = found; used.add(found); }
  }
  return map;
}

/**
 * Does the first row look like titles rather than a transaction?
 *
 * Asked rather than assumed, because a few exports have no header at all.
 */
export function looksLikeHeader(row) {
  if (!row) return false;
  const numeric = row.filter(c => /^-?[\d,.\s]+$/.test(String(c).trim()) && /\d/.test(c));
  const datey = row.filter(c => parseStatementDate(c));
  return numeric.length === 0 && datey.length === 0;
}

/**
 * Bank dates, to YYYY-MM-DD.
 *
 * DD/MM/YYYY is the Indian norm and DD-MM-YY is common in exports. **Ambiguity
 * is resolved to DAY FIRST**, not month first: 03/04/2026 is 3 April here, and
 * reading it as 3 March would silently misdate a month of transactions. ISO
 * input is passed through, since that is unambiguous.
 */
export function parseStatementDate(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const m = /^(\d{1,2})[/\-. ](\d{1,2}|[A-Za-z]{3,})[/\-. ](\d{2}|\d{4})$/.exec(v);
  if (!m) return null;
  const day = Number(m[1]);
  let month;
  if (/^\d+$/.test(m[2])) {
    month = Number(m[2]);
  } else {
    const names = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                   'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    month = names.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
  }
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (!day || !month || day > 31 || month > 12) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "1,23,456.78" / "1,234.56 Cr" / "(500)" → a number. */
export function parseAmount(value) {
  const v = String(value ?? '').trim();
  if (!v) return 0;
  const negative = /^\(.*\)$/.test(v) || /\bdr\b/i.test(v);
  const n = parseFloat(v.replace(/[(),\s]/g, '').replace(/[^\d.\-]/g, ''));
  if (Number.isNaN(n)) return 0;
  return negative ? -Math.abs(n) : n;
}

/**
 * Apply a mapping to the rows and return `{ lines, skipped }`.
 *
 * A row whose date cannot be read is SKIPPED and counted, not guessed at and
 * not sent. Statements carry subtotal and "opening balance" rows, and importing
 * those as transactions is worse than dropping them — which is why the count
 * comes back and gets shown.
 */
export function toLines(rows, mapping, { hasHeader = true } = {}) {
  const body = hasHeader ? rows.slice(1) : rows;
  const at = (row, key) => (mapping[key] >= 0 && mapping[key] != null
    ? row[mapping[key]] : undefined);
  const lines = [];
  const skipped = [];

  for (const row of body) {
    const date = parseStatementDate(at(row, 'statement_date'));
    if (!date) { skipped.push(row.join(', ').slice(0, 80)); continue; }

    let amount;
    if (mapping.debit != null || mapping.credit != null) {
      // Two columns. Money OUT is a positive number in the withdrawal column,
      // and has to become a negative amount — this is the reversal that made
      // the positional reader import every payment as income.
      const out = Math.abs(parseAmount(at(row, 'debit')));
      const inn = Math.abs(parseAmount(at(row, 'credit')));
      amount = inn - out;
    } else {
      amount = parseAmount(at(row, 'amount'));
    }
    if (!amount) { skipped.push(row.join(', ').slice(0, 80)); continue; }

    lines.push({
      statement_date: date,
      description: String(at(row, 'description') ?? '').trim(),
      reference: String(at(row, 'reference') ?? '').trim(),
      amount,
      running_balance: parseAmount(at(row, 'running_balance')),
    });
  }
  return { lines, skipped };
}
