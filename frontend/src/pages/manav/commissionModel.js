// commissionModel.js — the commission rules the SCREEN has to know, and no more.
//
// `backend/services/commission.py` is where the arithmetic lives and it stays
// there. This file exists for one reason: the browser must be able to REFUSE a
// form before it is sent, with the same sentences, because three of the rules
// below are enforced by a DEFERRED CONSTRAINT TRIGGER
// (`manav_commission_terms_stated()`, migration 190). A deferred trigger fires
// at COMMIT, so a user who ticks "on commission", leaves the ladder empty and
// presses Save gets a 400 carrying a database sentence about a constraint —
// after the request, from the server, about something they could have been
// told before they clicked.
//
// ── What is mirrored, and from where ────────────────────────────────────────
//
//   BASES / PERIODS / REVENUE_SCOPES      services/commission.py, same order
//   a band's rate must be > 0 and <= 100  manav_commission_bands_rate_ck
//   a band's floor must be >= 0           manav_commission_bands_from_ck
//   no two bands at one floor             manav_commission_bands_one_per_threshold_uniq
//   eligible => at least one band         manav_commission_terms_stated()
//   eligible => a revenue scope           manav_commission_schemes_eligible_needs_scope_ck
//   effective_to is EXCLUSIVE, and after  Scheme.__post_init__
//
// Mirroring is a risk — two copies of a rule can drift — so this file mirrors
// only rules that a person can violate by typing, and every one of them is
// still enforced twice behind it. Nothing here is the last line of defence and
// nothing here relaxes anything: a form this file accepts may still be refused
// by the server, and that refusal is shown verbatim.
//
// ── NO DEFAULT RATE, AND NO DEFAULT ANYTHING THAT DECIDES MONEY ─────────────
//
// The owner: "no default commission percentage please org decide its own
// commission." So `blankBand()` returns two EMPTY strings, `blankScheme()`
// leaves `revenue_scope` unset, and there is no placeholder text anywhere in
// this module that could be read as a suggested figure. `eligible` defaults to
// false, which is the one kind of default this file allows: one that REFUSES.

/** What a scheme is measured on. Mirrors commission.BASES. */
export const BASES = ['turnover', 'gross_profit'];

/** How often it settles. Mirrors commission.PERIODS. */
export const PERIODS = ['monthly', 'quarterly', 'annual'];

/** Whose revenue it measures. Mirrors commission.REVENUE_SCOPES. */
export const REVENUE_SCOPES = ['own', 'department'];

/** Wording for a person, not a column name. */
export const BASIS_LABEL = {
  turnover: 'Turnover — what they sold',
  gross_profit: 'Gross profit — what they sold, less its direct cost',
};

export const PERIOD_LABEL = {
  monthly: 'Every month',
  quarterly: 'Every financial quarter',
  annual: 'Once a year',
};

export const PERIOD_SHORT = {
  monthly: 'monthly',
  quarterly: 'quarterly',
  annual: 'annual',
};

export const SCOPE_LABEL = {
  own: 'Their own revenue',
  department: "Their department's revenue — everybody in it",
};

export const SCOPE_SHORT = { own: 'own revenue', department: 'department revenue' };

/**
 * A blank rung. BOTH FIELDS EMPTY — see the header. A new function every call
 * so two rows never share one object.
 */
export const blankBand = () => ({ from_amount: '', rate_percent: '' });

/** A blank arrangement. Nothing that decides money is pre-answered. */
export const blankScheme = () => ({
  eligible: false,
  basis: 'turnover',
  period: 'monthly',
  revenue_scope: '',
  effective_from: '',
  effective_to: '',
  notes: '',
  bands: [blankBand()],
});

/**
 * A typed figure as a number, keeping "nothing typed" apart from zero.
 *
 * `Number('')` is 0, and a 0 that came from an empty box is how a blank floor
 * becomes "from the first rupee" without anybody deciding that. Returns:
 *   null  nothing was typed
 *   NaN   something was typed and it is not a number
 *   n     the number, UNROUNDED — the API asks for a number and rounding on
 *         the way in is this screen changing an agreed rate.
 */
export function figure(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** `7.500` → `7.5`, `3` → `3`. Mirrors commission._trim. */
export function trimRate(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return String(v);
}

/**
 * The ladder as RANGES, lowest first, with each rung's upper edge DERIVED.
 *
 * There is no upper-bound field and there must never be one: a band runs to
 * the next band's floor, or to infinity. `to` is null on the highest rung, and
 * a caller renders that as "and above" — never as a blank box somebody might
 * try to fill in.
 *
 * Rows that are not yet complete are carried through with `from === null` so
 * the editor can show them in place rather than silently dropping a half-typed
 * rung out of the preview.
 */
export function ladder(bands) {
  const rows = (bands || []).map((b, i) => ({
    index: i,
    from: figure(b.from_amount),
    rate: figure(b.rate_percent),
  }));
  const ready = rows
    .filter(r => Number.isFinite(r.from))
    .sort((a, b) => a.from - b.from);
  return ready.map((r, i) => ({
    ...r,
    to: i + 1 < ready.length ? ready[i + 1].from : null,
  }));
}

/**
 * The ladder in one sentence. Mirrors commission.describe_bands, including its
 * decision to print RANGES rather than floors: "3% from ₹1,00,000" reads as
 * though the 3% might apply to everything once ₹1L is passed, and it does not.
 *
 * `fmt` is the caller's rupee formatter so this module imports nothing.
 */
export function describeLadder(bands, fmt) {
  const rungs = ladder(bands).filter(r => Number.isFinite(r.rate));
  if (!rungs.length) return '';
  return rungs.map((r) => {
    const rate = `${trimRate(r.rate)}%`;
    if (r.to !== null) return `${rate} on ${fmt(r.from)}–${fmt(r.to)}`;
    if (r.from === 0) return `${rate} on everything`;
    return `${rate} above ${fmt(r.from)}`;
  }).join('; ');
}

/**
 * Everything wrong with the ladder, as sentences. Empty array means it would
 * be accepted — by this file; the server still gets its say.
 *
 * A ROW WITH BOTH FIELDS EMPTY IS NOT AN ERROR HERE. The editor always shows
 * one spare row so there is somewhere to type, and a spare row is not a
 * mistake; `payloadBands` drops it. A HALF-filled row is an error, because a
 * floor with no rate and a rate with no floor are both unfinished forms.
 */
export function bandProblems(bands) {
  const out = [];
  const seen = new Map();
  (bands || []).forEach((b, i) => {
    const from = figure(b.from_amount);
    const rate = figure(b.rate_percent);
    const where = `Rate ${i + 1}`;
    if (from === null && rate === null) return;          // a spare row
    if (from === null) {
      out.push(`${where}: say the amount this rate applies from. A rate with no `
        + 'threshold does not say when it starts paying.');
    } else if (Number.isNaN(from)) {
      out.push(`${where}: the amount is not a number.`);
    } else if (from < 0) {
      out.push(`${where}: a band starts below zero. A negative floor is not an arrangement.`);
    }
    if (rate === null) {
      out.push(`${where}: state a rate. There is no default rate — the firm decides it.`);
    } else if (Number.isNaN(rate)) {
      out.push(`${where}: the rate is not a number.`);
    } else if (rate <= 0) {
      out.push(`${where}: a rate must be above zero. "The first lakh earns nothing" is `
        + 'said by the lowest band starting at one lakh, not by a 0% band.');
    } else if (rate > 100) {
      out.push(`${where}: ${trimRate(rate)}% pays more than was sold. If 500 was meant `
        + 'as 5.00, this is the moment to catch it.');
    }
    if (Number.isFinite(from)) {
      if (seen.has(from)) {
        out.push(`Rate ${seen.get(from) + 1} and ${i + 1} both start at the same amount. `
          + 'Which one pays would depend on which row was read first.');
      } else {
        seen.set(from, i);
      }
    }
  });
  return out;
}

/**
 * Everything wrong with the whole arrangement, ladder included.
 *
 * THE ONE THIS FILE EXISTS FOR is the eligible-with-no-bands case. Migration
 * 190 refuses it at COMMIT, so without this check the user learns about it
 * from a database error after the write was attempted.
 */
export function schemeProblems(form) {
  const out = [];
  if (!form.employee_id) out.push('Choose the person this arrangement is for.');
  if (!BASES.includes(form.basis)) out.push('Choose what the commission is measured on.');
  if (!PERIODS.includes(form.period)) out.push('Choose how often it settles.');
  if (!form.effective_from) {
    out.push('An arrangement needs a start date. Without one it cannot be resolved as '
      + "of any period, and last quarter's commission has to keep computing on last "
      + "quarter's terms.");
  }
  if (form.effective_to && form.effective_from && form.effective_to <= form.effective_from) {
    out.push('The end date is the first day the arrangement is NO LONGER in force, so it '
      + 'must be after the start date. A scheme that ends on the day it starts was in '
      + 'force for no days at all.');
  }
  if (form.revenue_scope && !REVENUE_SCOPES.includes(form.revenue_scope)) {
    out.push('Whose revenue this measures must be their own or their department\'s.');
  }
  out.push(...bandProblems(form.bands));
  if (form.eligible) {
    if (!form.revenue_scope) {
      out.push('Say WHOSE revenue this measures. Their own sales and their whole '
        + "department's are different amounts of money, and there is no default.");
    }
    if (payloadBands(form.bands).length === 0) {
      out.push('This person is marked as on commission but no rate is stated. That reads '
        + 'as configured on every screen, computes nothing every period, and quietly owes '
        + 'somebody money. Add at least one rate, or untick "on commission".');
    }
  }
  return out;
}

/**
 * The bands as the API takes them: complete rows only, lowest first.
 *
 * Numbers, unrounded, exactly as typed — `CommissionBandIn` asks for
 * `from_amount: float` and `rate_percent: float`, and this screen does not
 * round somebody's agreed rate on its way past.
 */
export function payloadBands(bands) {
  return (bands || [])
    .map(b => ({ from_amount: figure(b.from_amount), rate_percent: figure(b.rate_percent) }))
    .filter(b => Number.isFinite(b.from_amount) && Number.isFinite(b.rate_percent))
    .sort((a, b) => a.from_amount - b.from_amount);
}

/** The whole POST body for `POST /v1/manav/commission-schemes`. */
export function schemePayload(form) {
  return {
    employee_id: form.employee_id,
    eligible: !!form.eligible,
    basis: form.basis,
    period: form.period,
    // '' would fail the server's `revenue_scope IN ('own','department')`; the
    // absence is expressed as null, which is what "nobody has said" means.
    revenue_scope: form.revenue_scope || null,
    effective_from: form.effective_from,
    effective_to: form.effective_to || null,
    notes: form.notes || '',
    bands: payloadBands(form.bands),
  };
}

/**
 * Is this version in force on `on` (a `YYYY-MM-DD` string)?
 *
 * Half-open, both ends stated — `effective_to` is the first day it is NOT in
 * force. String comparison is safe and exact for ISO dates and avoids the
 * timezone class of bug entirely: `new Date('2026-04-01')` is UTC midnight,
 * which is 05:30 on 1 April in IST and the previous day everywhere west.
 */
export function coversDate(scheme, on) {
  if (!scheme?.effective_from || !on) return false;
  if (on < scheme.effective_from) return false;
  if (scheme.effective_to && on >= scheme.effective_to) return false;
  return true;
}

/**
 * A person's schemes, split into what is in force now and what is not.
 *
 * `later` is deliberately its own group rather than being folded into
 * "earlier": an arrangement that starts next month is a promise already made,
 * and filing it under history is how somebody misses that a rate is about to
 * change.
 */
export function splitByDate(schemes, on) {
  const current = [];
  const later = [];
  const earlier = [];
  for (const s of schemes || []) {
    if (coversDate(s, on)) current.push(s);
    else if (s.effective_from > on) later.push(s);
    else earlier.push(s);
  }
  const byStart = (a, b) => (a.effective_from < b.effective_from ? 1 : -1);
  return { current: current.sort(byStart), later: later.sort(byStart), earlier: earlier.sort(byStart) };
}

/**
 * The one-line identity of a scheme — what makes two concurrent arrangements
 * read as two arrangements rather than as a duplicate row.
 *
 * A scheme's identity is (period, scope), which is exactly what migration 190
 * keys its uniqueness on. Printing that pair on every row is what stops "3%
 * monthly on own sales" and "2% annually on the department" looking like the
 * same record entered twice.
 */
export function schemeIdentity(scheme) {
  const period = PERIOD_SHORT[scheme?.period] || scheme?.period || 'unknown period';
  if (!scheme?.revenue_scope) return `${period}, scope not stated`;
  return `${period}, ${SCOPE_SHORT[scheme.revenue_scope]}`;
}

/** Today as `YYYY-MM-DD`, local. `toISOString()` is UTC and rolls IST over. */
export function todayISO(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
