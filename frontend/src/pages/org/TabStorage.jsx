import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, EmptyState, Sheet, SkeletonTable, StatTile, useToast } from '../../components/ui';
import { DataTable, Td } from '../../components/editorial';
import '../../styles/storage.css';

/**
 * TabStorage — the Storage tab. Proposal 83 §5, Phase 4.4.
 *
 * `routers/storage_browser.py` shipped 390 lines and 19 tests on 2026-08-25 and
 * **no caller**: `grep -r "v1/org/storage" frontend/src mobile/src` returned
 * nothing. This is the caller. Three endpoints, one screen:
 *
 *     GET  /v1/org/storage           where the files live, how much room is left
 *     GET  /v1/org/storage/browse    one level of the tree
 *     POST /v1/org/storage/resolve   paste a key, be told what it is
 *
 * ── WHY THIS SCREEN IS NOT JUST A FILE LIST ────────────────────────────────
 *
 * The owner's ask was "make a file findable without a developer". What is
 * actually in the two in-scope orgs' buckets, read on 2026-08-26:
 *
 *     E2E Test & Associates    6 objects   0 in the new key grammar
 *     Unicode Group           89 objects   0 in the new key grammar
 *
 * NINETY-FIVE objects, none of them in the grammar `services/storage_keys.py`
 * settled — and the folder names those 95 sit under are `personal/user_…`,
 * `pahchan/{employee uuid}` and `projects/team_…`. So the naive version of this
 * screen — render `folders[].name` — draws a member's user id and an employee's
 * uuid on the org administrator's first click, which is the one rule this
 * product does not bend.
 *
 * Hence the shape of every row here: **the server resolves the id to the name
 * of the thing, and this renders `label` and never `name`.** `is_id` is what
 * says the segment itself may not be drawn; the id still travels, in `prefix`
 * and `key`, as an address the client echoes back and never renders. Same rule
 * in the answer panel: `parsed.display` is drawn, `parsed.relative` and `key`
 * are not, because the grammar puts a user id inside the path.
 *
 * ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────
 *
 * There is no delete and no upload. A file in this product is a POINTER held in
 * a column — `sign_documents.file_key`, `graha_documents.file_key` — and
 * deleting the object without the row produces exactly the failure this tab
 * exists to diagnose. Both belong to the module that owns the row.
 *
 * That decision STANDS, and proposal 93 §B did not soften it: `recycle_bin.py`
 * only ever reads and restores, and the two surfaces that bin a file are the
 * ones that own the row (`TaskDrawer` and `graha/DocumentsTab`). What HAS
 * changed is that a reader who lands here looking for a file somebody deleted
 * is no longer at a dead end — **the Recycle bin tab is where it is**,
 * recoverable for 14 days and in a second-stage bin to 90. The note below the
 * allowance meter says so on screen, because "this tab has no delete" and "this
 * product has no bin" are different sentences and only the first one is true.
 *
 * ── AND ONE THING THIS TAB REPORTS RATHER THAN FIXES ───────────────────────
 *
 * Existing objects are NOT backfilled into the grammar. That is a separate
 * pass with its own risk note, and the notice at the foot of the browser says
 * so rather than letting a browser that lists 0 grammar-shaped keys read as a
 * broken screen.
 *
 * What that notice does NOT say, because it is no longer true: the 32 MB of
 * file bytes that once sat inside six `tasks.attachments` rows. Checked live
 * on 2026-08-27 — the column is `public.tasks.attachments`, not
 * `staging.tasks` (that relation does not exist), and it holds 93 rows
 * totalling 17,923 characters, largest 1,358, with ZERO containing a `data:`
 * URI. The bloat is gone. A screen must not carry a warning about a state the
 * database has left.
 */

const ROOT = { prefix: '', label: 'All files' };

const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** What a row is called. Never the raw segment when the segment is an id. */
const nameOf = (row) => {
  if (row.label) return row.label;
  if (row.is_id) return null;             // rendered as `.sto__id` instead
  return row.name;
};

export default function TabStorage() {
  const { pushToast } = useToast();

  const [overview, setOverview] = useState(null);
  const [overviewFailed, setOverviewFailed] = useState(false);

  // The trail carries the LABEL beside the prefix, because the server only
  // labels the level it is listing — walk two folders down and the crumb for
  // the level above would otherwise have nothing but its id to show.
  const [trail, setTrail] = useState([ROOT]);
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const [paste, setPaste] = useState('');
  const [detail, setDetail] = useState(null);
  const [asking, setAsking] = useState(false);

  const here = trail[trail.length - 1];

  useEffect(() => {
    api.get('/v1/org/storage')
      .then(r => setOverview(r.data))
      .catch(() => setOverviewFailed(true));
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setFailed(false);
    api.get('/v1/org/storage/browse', { params: { prefix: here.prefix } })
      .then((r) => { if (live) setPage(r.data); })
      .catch(() => { if (live) { setFailed(true); setPage(null); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [here.prefix]);

  const identify = useCallback(async (key) => {
    if (!key) return;
    setAsking(true);
    try {
      const { data } = await api.post('/v1/org/storage/resolve', { key });
      setDetail(data);
    } catch (e) {
      pushToast({
        type: 'error',
        title: e?.response?.data?.detail || 'That key could not be looked up.',
      });
    } finally {
      setAsking(false);
    }
  }, [pushToast]);

  const used = overview?.used_pct;

  return (
    <div>
      {/* ── Where the files live ─────────────────────────────────────────── */}
      <section className="st__group">
        <h2 className="st__gt">Where your files live</h2>
        {overviewFailed && (
          <p className="of__h">Storage could not be read just now.</p>
        )}
        {overview && (
          <>
            <div className="ostats ostats--gap">
              <StatTile
                label="Account"
                value={overview.own_account ? 'Your own Cloudflare' : "Aekam's storage"}
                sub={overview.own_account ? overview.bucket : 'Shared bucket, your own prefix'}
              />
              {/* "Recorded as used", not "Used". The figure is a running total
                  kept by two of the upload paths, and the server says so in
                  `used_note` — a tile labelled "Used" over a number that is
                  known to be short is a confident wrong answer. */}
              <StatTile label="Recorded as used" value={overview.used_label} />
              <StatTile
                label="Allowance"
                value={overview.limit_label || 'No limit set'}
                variant={used != null && used >= 90 ? 'danger' : 'neutral'}
              />
            </div>
            {used != null && (
              <>
                <div
                  className="omtr"
                  role="progressbar"
                  aria-valuenow={used}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Storage used"
                >
                  <div
                    className={`omtr__f${used >= 100 ? ' over' : ''}`}
                    style={{ '--pct': `${Math.min(100, used)}%` }}
                  />
                </div>
                <div className="omtr__lg">
                  <span>{overview.used_label} of {overview.limit_label}</span>
                  <span>{used}% recorded</span>
                </div>
              </>
            )}
            {overview.used_note && (
              <p className="of__h of__h--foot">{overview.used_note}</p>
            )}
            {/* WHERE A DELETED FILE WENT. A sentence, not a control: this tab
                is read-only by decision (see the header), and adding a delete
                or a restore here would put the act on the screen that owns
                neither the row nor the record. But a reader standing in front
                of an allowance meter looking for a file a colleague deleted has
                to be told the product HAS a bin — otherwise the honest absence
                of a delete button reads as the absence of any recovery at all,
                and the figure above stops making sense too: binned files count
                against this allowance until they are erased. */}
            <p className="of__h of__h--foot">
              Deleted task attachments and CRM documents are not erased straight
              away — they wait in the Recycle bin tab, restorable for 14 days and
              then in a second-stage bin until day 90. They keep counting towards
              the figure above until they are deleted permanently.
            </p>
          </>
        )}
      </section>

      {/* ── The browser ──────────────────────────────────────────────────── */}
      <section className="st__group">
        <h2 className="st__gt">Browse</h2>

        <nav className="sto__crumbs" aria-label="Storage folders">
          {trail.map((crumb, i) => (
            <React.Fragment key={crumb.prefix || 'root'}>
              {i > 0 && <span className="sto__sep" aria-hidden="true">›</span>}
              <button
                type="button"
                className="sto__crumb"
                aria-current={i === trail.length - 1 ? 'page' : undefined}
                onClick={() => setTrail(t => t.slice(0, i + 1))}
              >
                {crumb.label}
              </button>
            </React.Fragment>
          ))}
        </nav>

        {loading && <SkeletonTable rows={4} columns={4} showAvatar={false} />}

        {!loading && failed && (
          <p className="of__h">This folder could not be listed just now.</p>
        )}

        {!loading && !failed && page && !page.configured && (
          <EmptyState
            illustration="generic"
            title="No storage is set up for this organisation"
            description="Files uploaded here will have nowhere to go until Aekam configures storage for this organisation."
          />
        )}

        {!loading && !failed && page?.configured
          && !page.folders.length && !page.files.length && (
          <EmptyState
            illustration="generic"
            title="Nothing here"
            description="This folder holds no files."
          />
        )}

        {!loading && !failed && page?.configured
          && (page.folders.length > 0 || page.files.length > 0) && (
          <DataTable columns={['Name', 'Size', 'Changed', '']}>
            {page.folders.map(folder => (
              <tr key={folder.prefix}>
                <Td>
                  <div className="sto__row">
                    <button
                      type="button"
                      className="sto__nm"
                      onClick={() => setTrail(t => [...t, {
                        prefix: folder.prefix,
                        label: nameOf(folder) || folder.kind || 'Folder',
                      }])}
                    >
                      {nameOf(folder) || <span className="sto__id">{folder.kind}</span>}
                    </button>
                    <span className="sto__kind">
                      {nameOf(folder) && folder.kind ? folder.kind : 'Folder'}
                    </span>
                  </div>
                </Td>
                <Td>—</Td>
                <Td>—</Td>
                <Td />
              </tr>
            ))}
            {page.files.map(file => (
              <tr key={file.key}>
                <Td>
                  <div className="sto__row">
                    <span className="sto__nm">
                      {nameOf(file) || <span className="sto__id">Unnamed file</span>}
                    </span>
                    <span className="sto__kind">File</span>
                  </div>
                </Td>
                <Td align="right">{file.size_label}</Td>
                <Td>{fmtWhen(file.last_modified)}</Td>
                <Td align="right">
                  <button
                    type="button"
                    className="sto__ask"
                    onClick={() => { setPaste(file.key); identify(file.key); }}
                  >
                    What is this?
                  </button>
                </Td>
              </tr>
            ))}
          </DataTable>
        )}

        {page?.truncated && (
          <p className="of__h of__h--foot">
            Only the first {page.files.length + page.folders.length} entries in this
            folder are shown.
          </p>
        )}

        {/* The open item this tab must state rather than imply. Recorded
            because a browser in which nothing matches the new layout otherwise
            reads as a broken screen, when in fact nothing has been written in
            it yet — 0 of the 95 objects these two organisations hold. */}
        <p className="opend">
          <span>
            Files uploaded before 26 August 2026 keep the folder names they were
            written with, so some folders here are named after a record rather
            than after a person. Moving them into the new layout is a separate
            pass and has not been run.
          </span>
        </p>
      </section>

      {/* ── Paste a key ──────────────────────────────────────────────────── */}
      <section className="st__group">
        <h2 className="st__gt">Identify a file</h2>
        <p className="of__h of__h--lede">
          Paste anything that names a file — a key from a log, from a support
          ticket, or a link that has expired — and this says what it is, whose it
          is, and whether the file is actually there.
        </p>
        <form
          className="sto__find"
          onSubmit={(e) => { e.preventDefault(); identify(paste.trim()); }}
        >
          <input
            className="of__i of__i--mono"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="esign/…/supply-agreement.pdf"
            aria-label="File key"
          />
          <Button type="submit" variant="fill" size="sm" disabled={asking || !paste.trim()}>
            {asking ? 'Looking…' : 'Identify'}
          </Button>
        </form>
      </section>

      <Sheet
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title="What this file is"
      >
        {detail && (
          <div
            className={`sto__res${detail.record && detail.object_present === false ? ' sto__res--bad' : ''}`}
          >
            <p className="sto__sum">{detail.summary}</p>
            {detail.parsed?.display && (
              <p className="sto__path">{detail.parsed.display}</p>
            )}
            <dl className="sto__facts">
              <dt className="sto__k">In the bucket</dt>
              <dd className="sto__v">
                {detail.object_present === true
                  ? `Yes — ${detail.size_label || 'size unknown'}`
                  : detail.object_present === false
                    ? 'No'
                    : 'Could not be checked'}
              </dd>
              <dt className="sto__k">Named by a record</dt>
              <dd className="sto__v">
                {detail.record ? `${detail.record.kind}` : 'No record in this organisation'}
              </dd>
              {detail.parsed?.year && (
                <>
                  <dt className="sto__k">Written</dt>
                  <dd className="sto__v">{detail.parsed.year}-{detail.parsed.month}</dd>
                </>
              )}
            </dl>
          </div>
        )}
      </Sheet>
    </div>
  );
}
