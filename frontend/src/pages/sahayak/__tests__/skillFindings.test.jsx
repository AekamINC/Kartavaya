/**
 * A `check` skill's finding, on a screen.
 *
 * ── What is actually being guarded ───────────────────────────────────────────
 *
 * Not markup. Fifty-nine skills ran, cost nothing and rendered "Finished — 0
 * credits. 0 items are waiting in the Content tab", and the reason a test can
 * be written about that at all is that the failure is a CLAIM, not a layout:
 * the page asserted a count of content items for a skill that produces none,
 * and said nothing about the thing it did produce.
 *
 * So every assertion here is on a sentence a chartered accountant would act on:
 *
 *   · the caveat is in the output, WHOLE, under every one of the five key names
 *     `backend/tests/test_every_skill_states_its_limits.py` pins
 *   · a handler that states NO caveat is called out, because twenty-six of them
 *     do that and a silence reads as an all-clear
 *   · an empty list is rendered as a result, not deleted for being falsy
 *   · our own ids are never drawn, whatever a handler puts in its rows
 *   · "0 items are waiting in the Content tab" is not said about a skill that
 *     cannot have any
 *
 * MUTATION-CHECKED. Each was confirmed to go red by breaking the thing it
 * covers: dropping a key from CAVEAT_KEYS, restoring the `value.length &&`
 * falsy guard on lists, removing the OUR_ID filter, and putting the old
 * content-item sentence back.
 *
 * `createRoot` + `act` rather than @testing-library/react: it is installed and
 * its @testing-library/dom peer is not, so importing it throws. Same constraint
 * `contentTable.test.jsx` and `sahayak.test.jsx` record.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import Findings, { Finding } from '../../../components/skills/findings/Findings';
import {
  CAVEAT_KEYS, caveatsOf, splitFinding, columnsOf, cellText,
} from '../../../components/skills/findings/shape';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const draw = el => { act(() => root.render(el)); return host; };

/* ── The vocabulary ─────────────────────────────────────────────────────── */

describe('the five caveat key names', () => {
  it('knows exactly the five the backend pins, and no sixth', () => {
    // If a handler introduces a sixth name this list is where it has to be
    // added, and the backend suite is what refuses it. Asserting the SET keeps
    // the two files in step.
    expect([...CAVEAT_KEYS].sort()).toEqual(
      ['caveat', 'caveats', 'limitations', 'what_this_is', 'what_this_is_not'],
    );
  });

  it('reads a singular string and a list the same way', () => {
    // `lead_triage` sets `caveat` to a string; `gst_cliffs` sets `caveats` to a
    // list. Both are live today and both have to arrive as lines.
    expect(caveatsOf({ caveat: 'one sentence' })[0].lines).toEqual(['one sentence']);
    expect(caveatsOf({ caveats: ['a', 'b'] })[0].lines).toEqual(['a', 'b']);
  });

  it('drops a caveat key the handler built and never filled', () => {
    // `gst_cliffs` opens `"caveats": []` and appends conditionally. An empty
    // one is not a caveat and must not draw an empty warning box.
    expect(caveatsOf({ caveats: [] })).toEqual([]);
  });

  it('puts what_this_is_not before the numbers, not after them', () => {
    // `brief_advance_tax_reserve` makes "this is not tax advice" the FIRST key
    // of its output on purpose. Reading order, not dict order.
    const out = caveatsOf({ caveats: ['c'], what_this_is_not: 'not advice', what_this_is: 'a reserve' });
    expect(out.map(c => c.key)).toEqual(['what_this_is', 'what_this_is_not', 'caveats']);
  });

  it.each(CAVEAT_KEYS)('renders %s whole, with no clamp and no disclosure', key => {
    const sentence = 'TRUNCATED at 200 findings, ordered by check then department. '
      + 'The counts above are a floor, not the total.';
    const el = draw(<Finding data={{ [key]: sentence, rows: [] }} skillFunction="x" />);

    expect(el.textContent).toContain(sentence);
    // A caveat behind a <details> is a caveat nobody reads. The backend test
    // exists to stop exactly that, and this is the front half of it.
    expect(el.querySelector('details')).toBeNull();
    expect(el.querySelector('.sk-fx__cav')).not.toBeNull();
  });
});

describe('a handler that states nothing', () => {
  it('says so, rather than drawing a silence', () => {
    // Twenty-six handlers are on the backend's WITHOUT_A_CAVEAT debt list,
    // `propose_payment_run` among them — it proposes money leaving the firm.
    const el = draw(<Finding data={{ counts: { rows: 3 } }} skillFunction="propose_payment_run" />);
    expect(el.textContent).toContain('states no limits');
  });
});

/* ── The shape of a finding ─────────────────────────────────────────────── */

describe('splitFinding', () => {
  it('makes a table of a list of rows and a count strip of a dict of numbers', () => {
    const f = splitFinding({
      invoices: [{ invoice_number: 'INV-1', total: 4200 }],
      counts: { blockers: 2, warnings: 1 },
    });
    expect(f.tables).toHaveLength(1);
    expect(f.tables[0].columns).toEqual(['invoice_number', 'total']);
    expect(f.counts[0].entries.map(e => e.key)).toEqual(['blockers', 'warnings']);
  });

  it('keeps an empty list, because an empty list is the answer', () => {
    // `"invoices": []` out of the GSTR-1 readiness check means the month is
    // clean — the most valuable thing that skill can say. A falsy guard here
    // rendered a clean month as a blank page.
    const f = splitFinding({ invoices: [] });
    expect(f.emptyLists.map(e => e.key)).toEqual(['invoices']);
  });

  it('separates `error` from the caveats', () => {
    // The backend names this distinction explicitly: "I failed" is not "here is
    // what I cannot see", and merging them would let a failed step read as a
    // qualified result.
    const f = splitFinding({ error: "'August' is not a period." });
    expect(f.error).toBe("'August' is not a period.");
    expect(f.caveats).toEqual([]);
  });

  it('never draws one of our ids, wherever the handler put it', () => {
    // check-rendered-ids.mjs cannot reach these: the columns are computed at
    // runtime from a dict nobody wrote in JSX, so the positional check has
    // nothing to look at. The rule is enforced in `shape.js` instead.
    const f = splitFinding({
      contact_id: '64e7bea6-0000-0000-0000-000000000000',
      rows: [{ id: 'abc', user_id: 'def', name: 'Rakesh Shah', gstin: '27AAQCR5055K1ZR' }],
    });
    expect(f.facts.map(x => x.key)).not.toContain('contact_id');
    // GSTIN survives: it is the reader's own handle at a portal we do not own,
    // the same exemption check-rendered-ids keeps for a UPI address.
    expect(columnsOf(f.tables[0].rows)).toEqual(['name', 'gstin']);
  });

  it('renders false as "no" and null as an em dash', () => {
    // A false in a compliance row IS a finding. Rendering it as blank is how
    // "PF not enabled" becomes "nothing to report".
    expect(cellText(false)).toBe('no');
    expect(cellText(null)).toBe('—');
    // A year is not a quantity and must not be grouped into "2,026".
    expect(cellText(2026, 'year')).toBe('2026');
    expect(cellText(420000, 'total')).toBe('4,20,000');
  });
});

/* ── The run report ─────────────────────────────────────────────────────── */

describe('Findings — the three states that look alike', () => {
  const steps = [{ order: 1, skill_function: 'check_gstr1_readiness' }];

  it('renders the rows and the caveat of a step that ran', () => {
    const el = draw(<Findings steps={steps} outputs={[{
      step: 1, skill_function: 'check_gstr1_readiness', status: 'ok',
      data: {
        period: '2026-07',
        invoices: [{ invoice_number: 'INV-1', defect: 'place of supply missing' }],
        caveat: 'Only the first 200 invoices in the period were examined.',
      },
    }]} />);
    expect(el.textContent).toContain('INV-1');
    expect(el.textContent).toContain('place of supply missing');
    expect(el.textContent).toContain('Only the first 200 invoices');
  });

  it('says the finding was not recorded, not that nothing was found', () => {
    // A deploy that predates the run response carrying `outputs[].data`. "The
    // finding was not kept" and "there is nothing to find" are different facts
    // and only one of them is about the firm's records.
    const el = draw(<Findings steps={steps} outputs={[{
      step: 1, skill_function: 'check_gstr1_readiness', status: 'ok',
    }]} />);
    expect(el.textContent).toContain('not recorded');
    expect(el.textContent).toContain('not a statement about your records');
  });

  it('says a clipped finding is clipped, and shows what arrived', () => {
    // The server bounds `outputs` at `_MAX_FINDING_CHARS` because it is a jsonb
    // column written on every run. A clipped payload also carries `data: null`,
    // so the ONLY thing separating it from "not recorded" is the `truncated`
    // flag — and getting that wrong turns a stated bound into a shrug while the
    // rows sit in `data_text`. Worse, showing a short list quietly on a
    // compliance check is the failure this whole shelf exists to prevent.
    const el = draw(<Findings steps={steps} outputs={[{
      step: 1, skill_function: 'check_gstr1_readiness', status: 'ok',
      data: null, truncated: true,
      data_text: '{"invoices": [{"invoice_number": "INV-1"}, {"invoice_num',
    }]} />);
    expect(el.textContent).toContain('longer than a run row can hold');
    expect(el.textContent).toContain('DO NOT COUNT THE ROWS');
    expect(el.querySelector('.sk-fx__raw').textContent).toContain('INV-1');
    // And it must NOT take the "not recorded" branch.
    expect(el.textContent).not.toContain('not recorded');
  });

  it('prefers the step label the server now sends over the function name', () => {
    const el = draw(<Findings steps={[]} outputs={[{
      step: 1, skill_function: 'check_gstr1_readiness', status: 'ok',
      label: 'GSTR-1 defects', data: { counts: { rows: 0 } },
    }]} />);
    expect(el.querySelector('.sk-fx__t').textContent).toContain('GSTR-1 defects');
  });

  it('says a failed step read nothing at all', () => {
    const el = draw(<Findings steps={steps} outputs={[{
      step: 1, skill_function: 'check_gstr1_readiness', status: 'failed',
      error: 'UndefinedTableError: relation does not exist',
    }]} />);
    expect(el.textContent).toContain('could not run');
    expect(el.textContent).toContain('UndefinedTableError');
  });

  it('draws nothing at all when a run had no data step', () => {
    // A pure content pack. Its result is the content item, and a "Findings"
    // heading over an empty box would be a second thing to explain.
    expect(draw(<Findings steps={[]} outputs={[{ step: 1, agent_type: 'blog' }]} />).textContent).toBe('');
  });
});
