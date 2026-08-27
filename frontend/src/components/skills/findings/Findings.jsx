/**
 * What a skill FOUND, on the screen of the person who ran it.
 *
 * ── The defect ───────────────────────────────────────────────────────────────
 *
 * Fifty-nine of the seventy-eight skills are `skill_function`-only. They read
 * the org's own records, cost nothing, and — from a user's seat — did nothing:
 * the run finished and the page said
 *
 *     Finished — 1 steps, 0 credits. 0 items are waiting in the Content tab.
 *
 * That sentence was true and useless. A function step's return went into an
 * in-memory `prior_facts` list, was used to ground a LATER AI step's prompt,
 * and was then garbage-collected — so on a skill with no AI step after it, the
 * finding was computed, paid for in database time, and thrown away before
 * anything could draw it. The run response carried `run_id`, `status`,
 * `steps_completed`, `credits_used` and `content_ids`, and nothing else.
 *
 * The server now records each data step's actual return into `outputs[].data`.
 * This is the half that puts it in front of a human.
 *
 * ── THE CAVEAT IS THE POINT ──────────────────────────────────────────────────
 *
 * `backend/tests/test_every_skill_states_its_limits.py` exists because these
 * outputs go to chartered accountants, and because a caveat the reader does not
 * see is the whole failure mode. So the caveat block here is:
 *
 *   · FIRST — above the counts and above the rows, because a reader who acts on
 *     row three has already missed a warning that arrives after row two hundred
 *   · WHOLE — no clamp, no ellipsis, no "show more", no `<details>`. Every one
 *     of those is a way for the sentence to be technically present and actually
 *     unread, and that is precisely what the backend test is written against
 *   · NAMED — the five key names mean five different things and keep their own
 *     headings; see `CAVEAT_LABELS` in ./shape
 *
 * And when a handler states nothing — twenty-six of them do, the pre-contract
 * registry listed as a DEBT in that same test — the block says so out loud. A
 * silence where a limitation should be reads as an all-clear, and on
 * `propose_payment_run` that silence is in front of money leaving the firm.
 *
 * ── AND THE ONE THING A READER CAN DO ABOUT IT ───────────────────────────────
 *
 * A skill reports the world as it is and has no idea what anyone has done about
 * it: `propose_payment_run` returns the same overdue bills every run until
 * somebody pays a vendor, and it cannot record a payment. Without a way to say
 * "yes, I know, it is handled", the list only grows — read in week one, skimmed
 * in month two, wallpaper by month three, and wallpaper that still looks like
 * coverage is worse than no list at all.
 *
 * The whole mechanism for closing a finding has existed on the server since
 * proposal 70 and `staging.skill_finding_ack` still held ZERO rows on
 * 2026-08-27, because nothing here called it. `FindingTable` now carries a
 * Dismiss control on every row whose finding arrived with an `_ack_key`, and
 * `Acknowledged` says what a later run is therefore NOT showing. See
 * `useFindingAck.js` for why the row is marked rather than removed, and
 * `backend/routers/hub.py` for why the key is never the client's to invent.
 *
 * ── Degrading ────────────────────────────────────────────────────────────────
 *
 * Three states that look alike and are not, and this file keeps them apart:
 *
 *   no `outputs` key at all    the server did not report per-step detail. Says
 *                              so. NOT "the skill found nothing".
 *   `outputs` with no `data`   the step ran and its return was not recorded.
 *   `truncated: true`          the finding was too long for the run row, so it
 *                              arrives as `data_text` — clipped JSON. Rendered
 *                              AS TEXT, under a warning that says the list is
 *                              short. `outputs` is a jsonb column written on
 *                              every run, so the server bounds it at
 *                              `_MAX_FINDING_CHARS`; the one thing the page must
 *                              never do is show a short list quietly, which on a
 *                              compliance check is the failure the whole shelf
 *                              exists to prevent.
 *   `data` with empty lists    the skill LOOKED and found nothing wrong. That is
 *                              the most valuable answer a check can give and it
 *                              is rendered as a finding, not as a blank.
 */
import React from 'react';
import { words, stamp } from '../../../pages/hub/_shared';
import {
  splitFinding, dataOutputs, cellText, ackHandle, label as humanise,
} from './shape';
import useFindingAck from './useFindingAck';

/** Does the run response carry per-step data at all? */
export function hasStepData(outputs) {
  return dataOutputs(outputs).some(
    o => (o.data !== undefined && o.data !== null) || !!o.data_text,
  );
}

/**
 * The caveat block. Never collapsed, never truncated — see the header.
 *
 * `role="note"` rather than `alert` or `status`: it is present on first paint
 * and belongs to the document, and a live region would make a screen reader
 * announce every caveat of every step in one burst the moment a run lands.
 */
function Caveats({ caveats, skillFunction }) {
  if (!caveats.length) {
    return (
      <div className="note note--warn sk-fx__cav sk-fx__cav--none" role="note">
        <b className="sk-fx__cav-t">This skill states no limits.</b>
        <p className="sk-fx__cav-p">
          {words(skillFunction) || 'It'} does not say what it could not see, so nothing
          below tells you where it stops. Treat the figures as a starting point and
          not as a complete answer.
        </p>
      </div>
    );
  }
  return (
    <div className="sk-fx__cavs">
      {caveats.map(c => (
        <div
          key={c.key}
          className={`note ${c.tone === 'scope' ? 'note--info' : 'note--warn'} sk-fx__cav`}
          role="note"
        >
          <b className="sk-fx__cav-t">{c.label}</b>
          {c.lines.map((line, i) => (
            // `white-space: pre-line` on this class, so a handler that wrote a
            // multi-line limitation keeps its line breaks rather than having
            // them collapsed into one wall.
            <p className="sk-fx__cav-p" key={i}>{line}</p>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * One list-of-rows.
 *
 * `.tbl` and not a private table class: the row-height contract is one
 * contract, `check-table-rows.mjs` enforces it off the JSX, and a findings
 * table is a list of records like every other. `--row-h` is dropped to the
 * compact 48px tier on the wrapper — a defect list runs to two hundred rows and
 * nothing in it is clickable, which is the same reason the analytics grid takes
 * that tier.
 *
 * EVERY ROW IS DRAWN. The handlers cap themselves (`limit`, and they say so in
 * their own caveat when they hit it); a second silent cap here would drop rows
 * a firm is being told exist, which is the same failure as hiding the caveat.
 */
function FindingTable({ table, skillFunction, ack }) {
  const { label: title, rows, columns } = table;
  if (!columns.length) return null;

  /* The column appears only where it works. 32 of the 93 skill functions are
     wired for acknowledgement; a row from one of the other 61 carries no
     handle, and the honest treatment of that is no control — not a disabled
     one, which reads as "you are not allowed to" and is a different, untrue
     sentence. */
  const handles = ack ? rows.map(ackHandle) : rows.map(() => null);
  const dismissible = handles.some(Boolean);

  return (
    <div className="sk-fx__sec">
      <h5 className="sk-fx__h">
        {title}
        <span className="sk-fx__n">{rows.length}</span>
      </h5>
      <div className="tbl__wrap sk-fx__wrap">
        <table className="tbl sk-fx__tbl">
          <thead>
            <tr>
              {columns.map(c => <th key={c} scope="col">{humanise(c)}</th>)}
              {dismissible && (
                <th scope="col" className="sk-fx__ack-h">
                  <span className="k-sr-only">Acknowledge</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const handle = handles[i];
              const gone = !!handle && ack.isDismissed(skillFunction, handle.key);
              return (
                <tr key={i} className={gone ? 'sk-fx__row--ack' : undefined}>
                  {columns.map(c => (
                    <td key={c} className={typeof row[c] === 'number' ? 'sk-fx__num' : undefined}>
                      {cellText(row[c], c)}
                    </td>
                  ))}
                  {dismissible && (
                    <td className="sk-fx__ack-c">
                      {handle && (
                        <AckControl ack={ack} handle={handle} skillFunction={skillFunction} />
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Dismiss one finding, and take it back.
 *
 * The wording is the whole design of this control. "Dismiss" does not delete
 * anything and does not mean the underlying bill is paid — it says *I know
 * about this one*, and the row it hides comes straight back if the amount
 * moves, which is what makes the mechanism trustworthy rather than a way of
 * permanently hiding bad news. So neither state is left to be inferred: both
 * carry the CONDITION out loud ("until it changes"), because a control the
 * reader believes is permanent is one they will not use on anything that
 * matters — or worse, will use on something that does.
 *
 * The row is struck, not removed: the totals beside it were computed by the
 * handler over the whole list and only the next run rebuilds them. See
 * `useFindingAck.js`.
 */
function AckControl({ ack, handle, skillFunction }) {
  const gone = ack.isDismissed(skillFunction, handle.key);
  const busy = ack.isBusy(skillFunction, handle.key);
  const error = ack.errorFor(skillFunction, handle.key);

  return (
    <div className="sk-fx__ack">
      {gone ? (
        <>
          <span
            className="sk-fx__ack-said"
            title="It will not be listed again until this figure changes"
          >
            Acknowledged
          </span>
          <button
            type="button" className="k-btn k-btn--ghost k-btn--sm"
            disabled={busy}
            onClick={() => ack.restore(skillFunction, handle)}
          >
            {busy ? 'Undoing…' : 'Undo'}
          </button>
        </>
      ) : (
        <button
          type="button" className="k-btn k-btn--ghost k-btn--sm"
          disabled={busy}
          onClick={() => ack.dismiss(skillFunction, handle)}
          title="Stop listing this one until the figure behind it changes"
        >
          {busy ? 'Saving…' : 'Dismiss'}
        </button>
      )}
      {/* THE CONSEQUENCE IS STATED, NOT INFERRED. `errText` answers with what
          went wrong — "No response from the server" — which leaves the reader
          to work out whether the acknowledgement landed. Believing a finding is
          closed when it is not is the one failure this whole module is written
          against, so the outcome is said in the product's own words first and
          the server's reason follows it. */}
      {error && (
        <span className="sk-fx__ack-err" role="alert">
          {gone ? 'Still acknowledged — it has not been brought back. ' : 'Not acknowledged. '}
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * What this run is NOT showing, because somebody said they knew about it.
 *
 * A list that silently shrinks is indistinguishable from a query that broke, so
 * the count is stated and every hidden finding is named. `by` is on the payload
 * and is not drawn: it is a `user_id`, and no user handle is ever rendered.
 */
function Acknowledged({ block }) {
  return (
    <div className="sk-fx__sec sk-fx__ackd">
      <h5 className="sk-fx__h">
        Acknowledged, and not listed above
        <span className="sk-fx__n">{block.count}</span>
      </h5>
      <p className="sk-fx__note">
        {block.count === 1
          ? 'This finding was acknowledged in your organisation, so it is left out of the '
            + 'list above and out of the totals. It comes back on its own if the underlying '
            + 'figure changes.'
          : 'These findings were acknowledged in your organisation, so they are left out of '
            + 'the list above and out of the totals. Each comes back on its own if the '
            + 'underlying figure changes.'}
      </p>
      {block.items.length > 0 && (
        <ul className="sk-fx__list">
          {block.items.map((it, i) => (
            <li key={i}>
              {it.label}
              {it.at && <span className="sk-fx__ack-when"> · {stamp(it.at)}</span>}
              {it.note && <span className="sk-fx__ack-when"> · {it.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One handler's dict.
 *
 * `ack` is OPTIONAL and absent means presentational: no dismiss control is
 * drawn. `Findings` below supplies one; a caller rendering a single finding on
 * its own gets the finding and nothing that writes.
 */
export function Finding({ data, skillFunction, ack }) {
  const f = splitFinding(data);

  return (
    <div className="sk-fx__body">
      {/* `error` is not a caveat — the backend test names that distinction —
          so it is its own block and it comes before everything, including the
          caveats, because if this is set there is nothing else to read. */}
      {f.error && (
        <div className="note note--warn sk-fx__cav" role="note">
          <b className="sk-fx__cav-t">This step could not run.</b>
          <p className="sk-fx__cav-p">{f.error}</p>
        </div>
      )}

      <Caveats caveats={f.caveats} skillFunction={skillFunction} />

      {f.counts.map(c => (
        <div className="sk-fx__sec" key={c.key}>
          <h5 className="sk-fx__h">{c.label}</h5>
          <div className="sk-fx__counts">
            {c.entries.map(e => (
              <div className="sk-fx__count" key={e.key}>
                <b className="sk-fx__count-v">{e.text}</b>
                <span className="sk-fx__count-k">{e.label}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {f.facts.length > 0 && (
        <dl className="sk-fx__facts">
          {f.facts.map(x => (
            <div className="sk-fx__fact" key={x.key}>
              <dt>{x.label}</dt>
              <dd>{x.text}</dd>
            </div>
          ))}
        </dl>
      )}

      {f.tables.map(t => (
        <FindingTable table={t} key={t.key} skillFunction={skillFunction} ack={ack} />
      ))}

      {f.lists.map(l => (
        <div className="sk-fx__sec" key={l.key}>
          <h5 className="sk-fx__h">
            {l.label}
            <span className="sk-fx__n">{l.items.length}</span>
          </h5>
          <ul className="sk-fx__list">
            {l.items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </div>
      ))}

      {/* THE CLEAN RESULT. A check that looked and found nothing is the answer a
          firm most wants and the one a falsy-check silently deletes. */}
      {f.emptyLists.length > 0 && (
        <p className="sk-fx__clean">
          Nothing found under {f.emptyLists.map(e => e.label.toLowerCase()).join(', ')}.
          {' '}That is a result — the check ran and the list is empty — not a check that
          was skipped.
        </p>
      )}

      {f.notes.map(n => (
        <div className="sk-fx__sec" key={n.key}>
          <h5 className="sk-fx__h">{n.label}</h5>
          <p className="sk-fx__note">{n.text}</p>
        </div>
      ))}

      {/* LAST, and that is the order it belongs in: everything above is what
          the firm has to deal with, and this is the part somebody has already
          dealt with. It is present at all because a list that silently shrinks
          is indistinguishable from a query that broke. */}
      {f.acknowledged && <Acknowledged block={f.acknowledged} />}
    </div>
  );
}

/**
 * Every data step of one run.
 *
 * `steps` is the template's own step list and is used only for a step's
 * authored `label`; a run that reports a step the template no longer has still
 * renders, under the function's own name.
 */
export default function Findings({ outputs, steps }) {
  // Hooks run before any early return — one controller for the whole run, so a
  // skill that reports the same fact in two steps marks both.
  const ack = useFindingAck();
  const found = dataOutputs(outputs);
  if (!found.length) return null;

  /* The server sends the step's authored `label` on the output row now. The
     template's own step list is the fallback for a run recorded before it did,
     and the function name is the fallback for a step the template no longer
     has — a finding is never drawn under a blank heading. */
  const labelFor = (o, i) => {
    if (o.label) return words(o.label);
    const s = (steps || []).find(x => (x.order ?? null) === o.step);
    return s?.label ? words(s.label) : (words(o.skill_function) || `Step ${i + 1}`);
  };

  return (
    <div className="sk-fx">
      {found.map((o, i) => {
        const title = labelFor(o, i);
        const failed = o.status === 'failed';
        // `truncated` is checked BEFORE `missing`. A clipped finding also has
        // `data: null`, and reporting it as "not recorded" would turn a
        // deliberate, stated bound into a shrug — with the rows sitting right
        // there in `data_text`.
        const clipped = !failed && !!o.truncated && !!o.data_text;
        const missing = !failed && !clipped && (o.data === undefined || o.data === null);
        return (
          <section className="sk-fx__step" key={`${o.step}-${o.skill_function}-${i}`}>
            <h4 className="sk-fx__t">
              <span className="sk-fx__step-n">{o.step ?? i + 1}</span>
              <span>{title}</span>
              <span className="sk-fx__free">read your records · free</span>
            </h4>

            {failed ? (
              <div className="note note--warn sk-fx__cav" role="note">
                <b className="sk-fx__cav-t">This step could not run.</b>
                <p className="sk-fx__cav-p">
                  {o.error || 'The server did not say why.'} Nothing here is a claim that
                  there was nothing to find — the records were not read at all.
                </p>
              </div>
            ) : clipped ? (
              /* TOO LONG FOR THE RUN ROW. The bound is the server's
                 (`_MAX_FINDING_CHARS`) and it is deliberate: `outputs` is jsonb
                 written on every run, so an unbounded ageing report would go
                 into the database each time. What must never happen is a short
                 list shown quietly — on a compliance finding that is worse than
                 showing nothing, because the reader counts the rows. The
                 warning leads and the payload follows as text, unstyled and
                 complete as far as it goes. */
              <>
                <div className="note note--warn sk-fx__cav" role="note">
                  <b className="sk-fx__cav-t">This finding is longer than a run row can hold.</b>
                  <p className="sk-fx__cav-p">
                    Everything below is the start of it, exactly as the skill returned it —
                    and it stops partway. DO NOT COUNT THE ROWS: there are more than are
                    shown. Narrow the skill’s period or threshold and run it again to get a
                    list you can rely on.
                  </p>
                </div>
                <pre className="sk-fx__raw">{o.data_text}</pre>
              </>
            ) : missing ? (
              /* The server ran the step and did not record what it returned.
                 Said plainly rather than drawn as an empty result: "no finding"
                 and "the finding was not kept" are different facts and only one
                 of them is about the firm's records. */
              <p className="sk-fx__none">
                This step ran and its findings were not recorded, so there is nothing to
                show. That is not a statement about your records.
              </p>
            ) : (
              <Finding data={o.data} skillFunction={o.skill_function} ack={ack} />
            )}
          </section>
        );
      })}
    </div>
  );
}
