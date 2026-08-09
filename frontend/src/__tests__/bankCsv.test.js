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
