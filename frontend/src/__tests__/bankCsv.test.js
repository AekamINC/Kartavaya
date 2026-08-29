/**
 * Reading a bank statement CSV.
 *
 * The importer used to be `split(',')` with the five fields taken by position.
 * Every test here is a way that failed on a real Indian bank export.
 */
import { describe, it, expect } from 'vitest';
import {
  parseCsv, guessMapping, looksLikeHeader, parseStatementDate, parseAmount, toLines,
} from '../lib/bankCsv';

// A trimmed HDFC export — the real column names, the real date format, and the
// withdrawal/deposit pair rather than a signed amount.
const HDFC = `Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
01/07/26,OPENING BALANCE,,01/07/26,,,475000.00
02/07/26,"NEFT DR-HDFC0000123-OFFICE RENT, JULY",N123456789,02/07/26,25000.00,,450000.00
05/07/26,NEFT CR-SHARMA TEXTILES,N987654321,05/07/26,,150000.00,598749.50
`;

describe('parseCsv', () => {
  it('keeps a quoted comma inside its own field', () => {
    const rows = parseCsv(HDFC);
    expect(rows[2][1]).toBe('NEFT DR-HDFC0000123-OFFICE RENT, JULY');
    expect(rows[2]).toHaveLength(7);
  });

  it('unescapes a doubled quote', () => {
    expect(parseCsv('a,"say ""hi""",b')[0][1]).toBe('say "hi"');
  });

  it('drops blank rows rather than importing them', () => {
    expect(parseCsv('a,b\n\n\nc,d')).toHaveLength(2);
  });
});

describe('guessMapping', () => {
  it('finds the real HDFC column names', () => {
    const m = guessMapping(parseCsv(HDFC)[0]);
    expect(m.statement_date).toBe(0);
    expect(m.description).toBe(1);
    expect(m.reference).toBe(2);
    expect(m.debit).toBe(4);
    expect(m.credit).toBe(5);
    expect(m.running_balance).toBe(6);
  });

  it('handles the Debit/Credit naming other banks use', () => {
    const m = guessMapping(['Txn Date', 'Particulars', 'Debit', 'Credit', 'Balance']);
    expect(m.statement_date).toBe(0);
    expect(m.debit).toBe(2);
    expect(m.credit).toBe(3);
  });

  it('does not hand one column to two fields', () => {
    const m = guessMapping(['Date', 'Value Date', 'Description', 'Amount', 'Balance']);
    const used = Object.values(m);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe('looksLikeHeader', () => {
  it('is true for titles and false for a transaction', () => {
    expect(looksLikeHeader(['Date', 'Narration', 'Withdrawal Amt.'])).toBe(true);
    expect(looksLikeHeader(['02/07/26', 'OFFICE RENT', '25000.00'])).toBe(false);
  });
});

describe('parseStatementDate', () => {
  it('reads DD/MM/YY as DAY first', () => {
    // 03/04/2026 is 3 April. Read month-first it is 3 March, which silently
    // misdates a month of transactions.
    expect(parseStatementDate('03/04/2026')).toBe('2026-04-03');
    expect(parseStatementDate('02/07/26')).toBe('2026-07-02');
  });

  it('passes ISO through', () => {
    expect(parseStatementDate('2026-07-02')).toBe('2026-07-02');
  });

  it('reads a month name', () => {
    expect(parseStatementDate('02-Jul-2026')).toBe('2026-07-02');
  });

  it('returns null for the word Date, so a header cannot be imported', () => {
    expect(parseStatementDate('Date')).toBeNull();
    expect(parseStatementDate('')).toBeNull();
  });
});

describe('parseAmount', () => {
  it('reads Indian grouping', () => {
    expect(parseAmount('1,23,456.78')).toBeCloseTo(123456.78);
  });
  it('reads brackets as negative', () => {
    expect(parseAmount('(500)')).toBe(-500);
  });
  it('is zero for an empty cell', () => {
    expect(parseAmount('')).toBe(0);
  });
});

describe('toLines', () => {
  const rows = parseCsv(HDFC);
  const mapping = guessMapping(rows[0]);

  it('makes a withdrawal NEGATIVE', () => {
    // THE bug the positional reader had: money out is a POSITIVE number in the
    // withdrawal column, so every payment imported as income.
    const { lines } = toLines(rows, mapping);
    const rent = lines.find(l => l.description.includes('OFFICE RENT'));
    expect(rent.amount).toBe(-25000);
  });

  it('makes a deposit positive', () => {
    const { lines } = toLines(rows, mapping);
    const receipt = lines.find(l => l.description.includes('SHARMA'));
    expect(receipt.amount).toBe(150000);
  });

  it('skips the opening-balance row instead of importing it as a transaction', () => {
    const { lines, skipped } = toLines(rows, mapping);
    expect(lines).toHaveLength(2);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain('OPENING BALANCE');
  });

  it('never imports the header row', () => {
    const { lines } = toLines(rows, mapping);
    expect(lines.every(l => l.statement_date !== 'Date')).toBe(true);
  });

  it('reads a signed single-column amount when that is the shape', () => {
    const csv = parseCsv('Date,Description,Amount\n02/07/26,Rent,-25000\n');
    const m = guessMapping(csv[0]);
    const { lines } = toLines(csv, m);
    expect(lines[0].amount).toBe(-25000);
  });
});

/**
 * ICICI — where a column NAME cost every withdrawal in the statement.
 *
 * ⚠ THIS IS A REGRESSION TEST FOR SILENT DATA LOSS, found on 2026-08-29 while
 * building proposal 93 §5's fixtures, and reproduced from the code before a
 * word was written about it.
 *
 * ICICI writes `Withdrawal Amount (INR )` and `Deposit Amount (INR )`.
 * `guessMapping` used to resolve `amount` before `debit`, so `amount`'s
 * substring hint matched the WITHDRAWAL column and marked it used; `debit`
 * then found nothing. `credit` still mapped, so `toLines` took the two-column
 * branch with `debit` unmapped, `out` was always 0, and a withdrawal row —
 * whose deposit cell is empty — produced `amount === 0` and was pushed onto
 * `skipped`.
 *
 * Five of these eight rows vanished. And the loss did not look like a bug: the
 * skip counter exists for subtotal and opening-balance lines, so the screen
 * reported "3 imported, 5 skipped" and a person would read that as the
 * importer doing its job.
 *
 * It matters more here than in most importers. This product has no payment
 * gateway and never will — bank reconciliation is the ONLY path to "paid" — so
 * a statement that drops its payments out corrupts the one ledger that decides
 * whether an invoice is settled.
 *
 * The trigger is the column NAME, not the bank: the second test renames a
 * plain `Debit` column and watches the same thing happen.
 */
const ICICI = `S No.,Value Date,Transaction Date,Cheque Number,Transaction Remarks,Withdrawal Amount (INR ),Deposit Amount (INR ),Balance (INR )
1,01/08/2026,01/08/2026,,OPENING BALANCE,,,312500.00
2,03/08/2026,03/08/2026,,UPI/312345678901/PAYMENT/OFFICE SUPPLIES,4750.00,,307750.00
3,05/08/2026,05/08/2026,000123,CHQ PAID - VENDOR SETTLEMENT,68000.00,,239750.00
4,08/08/2026,08/08/2026,,NEFT-INFOSYS BPM LTD-CONSULTING FEE,,225000.00,464750.00
5,12/08/2026,12/08/2026,,GST PAYMENT-JULY 2026,40500.00,,424250.00
6,18/08/2026,18/08/2026,,SALARY DISBURSEMENT AUG 2026,187000.00,,237250.00
7,22/08/2026,22/08/2026,,IMPS-KUMAR ENTERPRISES-INV 2026-0184,,96500.00,333750.00
8,28/08/2026,28/08/2026,,ELECTRICITY BILL-TORRENT POWER,9840.00,,323910.00
`;

describe('ICICI — the withdrawal column that was read as a signed amount', () => {
  it('maps the withdrawal column to debit, not to amount', () => {
    const m = guessMapping(parseCsv(ICICI)[0]);
    expect(m.debit, 'the withdrawal column was not mapped to debit').toBe(5);
    expect(m.credit).toBe(6);
    // `amount` must find nothing: both candidates are legitimately taken, and
    // an `amount` mapping here is what sends `toLines` down the wrong branch.
    expect(m.amount, 'amount stole a column belonging to the two-column pair').toBeUndefined();
  });

  it('imports every transaction — all five withdrawals and both deposits', () => {
    const rows = parseCsv(ICICI);
    const { lines, skipped } = toLines(rows, guessMapping(rows[0]));
    expect(lines).toHaveLength(7);
    // Only OPENING BALANCE is skipped, which is what the skip counter is for.
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain('OPENING BALANCE');
  });

  it('gives money out a NEGATIVE amount and money in a positive one', () => {
    const rows = parseCsv(ICICI);
    const { lines } = toLines(rows, guessMapping(rows[0]));
    const out = lines.filter(l => l.amount < 0);
    const inn = lines.filter(l => l.amount > 0);
    expect(out).toHaveLength(5);
    expect(inn).toHaveLength(2);
    // The salary run, by value rather than by position, so a re-order of the
    // fixture cannot make this pass for the wrong reason.
    expect(lines.find(l => l.description.includes('SALARY')).amount).toBe(-187000);
    expect(lines.find(l => l.description.includes('INFOSYS')).amount).toBe(225000);
  });

  it('is triggered by the column NAME, on any bank', () => {
    // A plain two-column statement, with one word changed.
    const renamed = parseCsv(
      'Date,Narration,Withdrawal Amount,Deposit Amount,Balance\n'
      + '02/07/26,Rent,25000.00,,450000.00\n',
    );
    const m = guessMapping(renamed[0]);
    expect(m.debit).toBe(2);
    expect(m.amount).toBeUndefined();
    expect(toLines(renamed, m).lines[0].amount).toBe(-25000);
  });

  it('still reads a genuinely signed Amount column', () => {
    // The guard must not have been bought by breaking the single-column shape.
    const csv = parseCsv('Date,Description,Amount\n02/07/26,Rent,-25000\n');
    const m = guessMapping(csv[0]);
    expect(m.amount).toBe(2);
    expect(m.debit).toBeUndefined();
    expect(toLines(csv, m).lines[0].amount).toBe(-25000);
  });
});
