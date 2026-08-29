import React, { useCallback, useEffect, useState } from 'react';
import { api, rows as asRows } from '../../lib/api';
import {
  Button, ConfirmDialog, EmptyState, ErrorState, errorKind, SkeletonTable, useToast,
} from '../../components/ui';
import { DataTable, Td } from '../../components/editorial';
import { formatBytes, formatDate, relSigned } from '../../components/documents';

/**
 * TabRecycleBin — the customer's own two-stage bin. Proposal 93 · B.
 *
 * `routers/recycle_bin.py` and `services/recycle_bin.py` shipped with the table
 * (migration 239) and **no caller**. This is the caller. Three endpoints, one
 * screen:
 *
 *     GET    /v1/recycle-bin              what can still be recovered
 *     POST   /v1/recycle-bin/{id}/restore put the pointer back on its record
 *     DELETE /v1/recycle-bin/{id}         stage 1 -> stage 2, or stage 2 -> gone
 *
 * ── WHY TWO SECTIONS AND NOT A FILTER ──────────────────────────────────────
 *
 * The route takes `?stage=1|2` and this screen deliberately does not use it.
 * Two reasons, and the second is the load-bearing one:
 *
 *   · One request cannot disagree with itself. Two filtered fetches can — the
 *     stage is DERIVED from `deleted_at` at read time (`recycle_bin.py`
 *     `stage_of`), so a row read at 13.999 days and again at 14.001 days is in
 *     both lists or in neither, and a screen assembled from two requests is
 *     where that shows up as a file that has vanished.
 *   · **The difference between the stages has to be readable, not inferable.**
 *     A single table with a "Stage 2" chip says the two rows differ; it does
 *     not say that deleting one of them destroys the file and deleting the
 *     other does not. That sentence belongs above the rows it governs, which
 *     means two headed sections with their own prose — and it is why the
 *     second-stage delete is the only control on this screen that asks the
 *     reader to type a file name.
 *
 * ── WHO SEES IT ────────────────────────────────────────────────────────────
 *
 * `org_owner` / `org_admin`, which is exactly what `OrgSettingsPage` already
 * gates the whole hub on and exactly what `ORG_MANAGEMENT_ROLES` gates the
 * router on. So there is no tab-level permission to thread through — the same
 * argument the Storage tab records. A bin is org-wide by construction: it holds
 * files from tasks and CRM records the reader may never have been able to open,
 * so a member-visible bin would be a privacy regression achieved by adding a
 * recovery feature.
 *
 * ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────
 *
 * No Ganit invoice and no eSign document can ever appear here. The `source_kind`
 * CHECK in migration 239 and `SOURCE_KINDS` in the service are the guards;
 * `SOURCE_WORDS` below is the third place that list is written down, and it is
 * written as a CLOSED map rather than a prettifier for exactly that reason — a
 * new kind arriving on the wire renders as the neutral "Deleted file" instead
 * of being waved onto the screen with a title-cased version of its own key.
 *
 * Books of account carry an 8-year Income Tax retention and GST records 72
 * months; a customer who deletes a signed invoice finds out at assessment.
 *
 * ── WHO DELETED IT IS A NAME, AND IT ARRIVES AS ONE ────────────────────────
 *
 * This screen used to receive `deleted_by` — a raw `users.user_id` — and
 * resolve it against `GET /v1/org/members`. That was wrong twice over, and the
 * ROUTER was fixed rather than this screen taught to cope:
 *
 *   · the member list misses anybody who has since LEFT the organisation and
 *     every platform account — the commonest reason to open a bin at all, so
 *     the one question it could not answer was the one being asked;
 *   · it put a user id in the browser, where `check-rendered-ids` cannot see
 *     it. That ratchet is positional and reads what a component DRAWS, so an
 *     id passed through a helper is invisible to it. Proved during review:
 *     mutating this file to render the id turned the unit tests red and left
 *     `npm run check` GREEN.
 *
 * `services/recycle_bin.list_bin` now LEFT JOINs `public.users` with the same
 * ladder `services/audit_actors` uses and sends `deleted_by_name` only. No id
 * is transmitted, so the rule holds at the API boundary rather than depending
 * on this component being careful — which is what `/teams/bin` already does
 * for the project bin (`ProjectsPage.jsx:343`).
 */

/* Must stay equal to `STAGE2_AFTER_DAYS` and `PURGE_AFTER_DAYS` in
   `backend/services/recycle_bin.py`, which are what actually enforce the
   windows. These only draw the sentences, and only when the server's own
   `stage1_days` / `purge_days` have not arrived yet — the list response carries
   both, so the rendered copy tracks the backend rather than this file. Same
   contract as `BIN_DAYS` in `ProjectsPage.jsx:50`. */
const STAGE1_DAYS = 14;
const PURGE_DAYS = 90;

/**
 * Where the file came from, IN WORDS.
 *
 * A closed map, never `source_kind.replace('_', ' ')`. The two keys are the
 * whole of `SOURCE_KINDS`, and a third one appearing on the wire is a migration
 * somebody has to make deliberately — until then it renders as a neutral noun
 * rather than as a database enum with the underscores taken out.
 */
const SOURCE_WORDS = {
  task_attachment: 'Task attachment',
  graha_document: 'CRM document',
};
const cameFrom = (kind) => SOURCE_WORDS[kind] || 'Deleted file';

export default function TabRecycleBin() {
  const { pushToast } = useToast();

  const [items, setItems] = useState([]);
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const r = await api.get('/v1/recycle-bin');
      setItems(asRows(r));
      // `stage1_days`, `purge_days` and `quota_note` ride on the same envelope
      // as the rows, so the screen's copy and the server's policy cannot drift.
      setPolicy(r?.data || null);
    } catch (e) {
      // NOT a swallowed catch. A failed load that falls through to the empty
      // state tells a customer their bin is empty when it is unread — which on
      // this screen is a statement that their deleted files are gone.
      setLoadErr(errorKind(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * WHO DELETED IT — a name, and under no circumstance the id.
   *
   * The owner's rule (`frontend/scripts/check-rendered-ids.mjs`): a person is
   * identified by their name, and no user id is ever drawn.
   *
   * There is nothing to resolve here any more. `deleted_by_name` arrives
   * already resolved and `deleted_by` is NOT TRANSMITTED AT ALL, so this
   * function could not draw an id even if it were written carelessly. That is
   * the point of having moved it to the router.
   *
   * Two answers, and they are different facts:
   *
   *   · a name               the server's ladder resolved it.
   *   · 'No longer on file'  the server sent that, because the person is gone
   *                          from `public.users` entirely. A real case — and
   *                          NOT the same as "unknown person".
   *
   * The dash is the third, and it is this file's only contribution: the row
   * arrived without the field at all, which means an older server. Saying a
   * name there would be a claim nothing supports.
   *
   * The id is never a fallback arm, and now it cannot be: `{name ||
   * row.deleted_by}` is precisely the shape `check-rendered-ids` was widened
   * to catch, and the field it would read is no longer sent.
   */
  const whoDeleted = (row) => row.deleted_by_name || '—';

  const stage1Days = policy?.stage1_days ?? STAGE1_DAYS;
  const purgeDays = policy?.purge_days ?? PURGE_DAYS;

  /* EVERY ROW APPEARS EXACTLY ONCE, and an unrecognised stage lands in the
     FIRST section — beside Restore and the harmless Delete, never beside the
     button that erases a file. `stage` is derived by the server and is always
     1 or 2 today; the asymmetry is what makes a future third value a visible
     oddity in the safe half rather than a row that has vanished from a bin, or
     one filed under the irreversible control by default. What DELETE actually
     does is still the server's decision, not this split's. */
  const stage2 = items.filter((r) => r.stage === 2);
  const stage1 = items.filter((r) => r.stage !== 2);

  /* RESTORE IS ONE CLICK AND NO DIALOG — the same decision as
     `ProjectsPage.jsx:199`. Nothing is destroyed, nothing is overwritten (the
     server's append is idempotent), and one click undoes it in the other
     direction. A confirmation on a harmless act is how people learn to click
     past the confirmation on a serious one. */
  const restore = async (row) => {
    try {
      const { data } = await api.post(`/v1/recycle-bin/${row.id}/restore`);
      pushToast({
        type: 'success',
        title: `"${data?.restored || row.file_name}" restored`,
      });
      load();
    } catch (e) {
      pushToast({
        type: 'error',
        // The server's own sentence. 409 means the task or the client record
        // this file belonged to is gone, and "could not restore" does not tell
        // the reader that; the detail does.
        title: e?.response?.data?.detail || 'Could not restore that file',
      });
    }
  };

  /* ONE VERB, TWO OUTCOMES, and the SERVER decides which — `delete_from_bin`
     reads the row's stage rather than taking a flag, so a client that got one
     boolean wrong could not destroy a stage-1 file. The reply says which
     happened, in words, and this renders that rather than guessing from the
     stage it thought the row was in when the button was pressed. */
  const remove = async (row) => {
    try {
      const { data } = await api.delete(`/v1/recycle-bin/${row.id}`);
      pushToast({
        type: 'success',
        title: data?.message
          || (data?.purged
            ? `"${row.file_name}" was permanently deleted`
            : `"${row.file_name}" moved to the second-stage recycle bin`),
      });
      load();
    } catch (e) {
      pushToast({
        type: 'error',
        // 502 here is "the object could not be deleted from storage", which is
        // a different problem from "not found" and sends a person elsewhere.
        title: e?.response?.data?.detail || 'Could not delete that file',
      });
    }
  };

  /* STAGE 1 -> STAGE 2. Confirmed, because it moves a file out of the list
     where people look for it, but **not `intent: 'danger'` and no typed
     confirmation**: nothing is destroyed and restore still works on the far
     side. `warn` renders the outline confirm button, which is the honest weight
     for a step towards destruction that is not itself destruction. The one
     filled red button on this screen belongs to the act that erases a file. */
  const askClear = (row) => setConfirm({
    title: 'Move to the second-stage bin?',
    message: `"${row.file_name}" moves to the second-stage recycle bin. `
      + 'Nothing is destroyed — it can still be restored from there, until it is '
      + `deleted permanently on ${formatDate(row.purges_at)}.`,
    confirmLabel: 'Move to second-stage bin',
    intent: 'warn',
    onConfirm: () => remove(row),
  });

  /* THE ONLY IRREVERSIBLE CONTROL ON THIS SCREEN, and it is dressed as one:
     typed confirmation on the file's own name, a filled danger button, and a
     message that says the file is destroyed rather than "removed". Same shape
     as `ProjectsPage.jsx:210`, which is the house pattern for a purge. */
  const askPurge = (row) => setConfirm({
    title: 'Delete permanently?',
    message: `"${row.file_name}" will be erased from storage. This cannot be `
      + 'undone and there is nothing left to restore afterwards. The space it '
      + 'uses is returned to your allowance.',
    confirmText: row.file_name,
    confirmLabel: 'Delete permanently',
    intent: 'danger',
    onConfirm: () => remove(row),
  });

  /** One row, in whichever section it belongs to. */
  const rowFor = (row, stage) => {
    const next = stage === 1 ? row.leaves_stage1_at : row.purges_at;
    return (
      <tr key={row.id}>
        {/* The file's own name and nothing else. `r2_key` and `file_url` are
            on the row and are NOT drawn: the key carries the org id and, for a
            Pahchan-shaped path, an employee id — see `TabStorage`, which is the
            screen that found that out. Neither is anything a person reads. */}
        <Td><span className="orb__nm">{row.file_name}</span></Td>
        <Td>{cameFrom(row.source_kind)}</Td>
        <Td>{whoDeleted(row)}</Td>
        <Td>
          <div className="orb__stk">
            <span>{formatDate(row.deleted_at)}</span>
            <span className="orb__sub">{relSigned(row.deleted_at)}</span>
          </div>
        </Td>
        <Td align="right">{formatBytes(row.size_bytes) || '—'}</Td>
        <Td>
          <div className="orb__stk">
            <span>
              {stage === 1 ? 'Moves to second-stage bin' : 'Deleted permanently'}
            </span>
            <span className="orb__sub">{formatDate(next)} · {relSigned(next)}</span>
          </div>
        </Td>
        <Td align="right">
          <div className="orb__act">
            {/* An accessible name per row. Twelve buttons all reading
                "Restore" is a screen reader listing twelve identical controls
                and no way to tell which file each one puts back. */}
            <Button
              variant="out"
              size="sm"
              aria-label={`Restore ${row.file_name}`}
              onClick={() => restore(row)}
            >
              Restore
            </Button>
            {stage === 1 ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Move ${row.file_name} to the second-stage bin`}
                onClick={() => askClear(row)}
              >
                Delete
              </Button>
            ) : (
              <Button
                variant="danger"
                size="sm"
                aria-label={`Delete ${row.file_name} permanently`}
                onClick={() => askPurge(row)}
              >
                Delete permanently
              </Button>
            )}
          </div>
        </Td>
      </tr>
    );
  };

  const columns = [
    'File',
    'Where it came from',
    'Deleted by',
    'Deleted',
    { label: 'Size', align: 'right' },
    'What happens next',
    { label: '', align: 'right' },
  ];

  return (
    <div>
      {loading && <SkeletonTable rows={4} columns={7} showAvatar={false} />}

      {!loading && loadErr && (
        <ErrorState
          kind={loadErr}
          grant="org admin or org owner on this organisation"
          onRetry={load}
        />
      )}

      {/* THE EMPTY STATE IS A SENTENCE, not "No data" (93 §1). A bin has two
          things to say when it is empty and only one of them is "nothing is
          here": the other is what would be here, and for how long, which is the
          only reason a person opens this tab before they have deleted anything. */}
      {!loading && !loadErr && items.length === 0 && (
        <EmptyState
          illustration="generic"
          title="The recycle bin is empty"
          description={
            'Nothing is waiting to be recovered. When someone deletes a task '
            + `attachment or a CRM document it lands here for ${stage1Days} days, `
            + 'then moves to the second-stage bin, and is erased from storage on '
            + `day ${purgeDays}. It can be restored from either stage.`
          }
        />
      )}

      {!loading && !loadErr && items.length > 0 && (
        <>
          {/* ── Stage 1 ─────────────────────────────────────────────────── */}
          <section className="st__group">
            <h2 className="st__gt">Recycle bin · {stage1.length}</h2>
            <p className="of__h of__h--lede">
              Deleted in the last {stage1Days} days. <strong>Restore</strong> puts
              the file back on the task or client record it came off.{' '}
              <strong>Delete</strong> moves it to the second-stage bin below — it
              destroys nothing and the file can still be restored from there.
            </p>

            {stage1.length === 0 ? (
              <p className="of__h">
                Nothing has been deleted in the last {stage1Days} days. Everything
                below has already moved on to the second stage.
              </p>
            ) : (
              <DataTable columns={columns}>
                {stage1.map((row) => rowFor(row, 1))}
              </DataTable>
            )}
          </section>

          {/* ── Stage 2 ─────────────────────────────────────────────────── */}
          <section className="st__group">
            <h2 className="st__gt">Second-stage recycle bin · {stage2.length}</h2>
            <p className="of__h of__h--lede">
              Deleted more than {stage1Days} days ago, or cleared out of the bin
              above. <strong>Restore still works here</strong> — a second-stage
              bin you cannot recover from is not a bin, it is a delay. What is
              different is <strong>Delete permanently</strong>: it erases the file
              from storage, and there is nothing to restore afterwards. Anything
              left here is erased automatically {purgeDays} days after it was
              deleted.
            </p>

            {stage2.length === 0 ? (
              <p className="of__h">
                Nothing is in the second-stage bin. Files arrive here {stage1Days}{' '}
                days after they were deleted, or when someone deletes them from
                the bin above.
              </p>
            ) : (
              <DataTable columns={columns}>
                {stage2.map((row) => rowFor(row, 2))}
              </DataTable>
            )}
          </section>
        </>
      )}

      {/* THE SERVER'S SENTENCE, VERBATIM. It is rendered here rather than
          re-worded because the Storage tab has to explain the same rule, and two
          screens paraphrasing one policy is how they end up disagreeing about
          it. `quota_note` is on the list envelope for exactly this. */}
      {!loading && !loadErr && policy?.quota_note && (
        <p className="opend">{policy.quota_note}</p>
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
