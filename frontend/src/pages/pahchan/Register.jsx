import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Section, DataTable, Td, StatusChip } from '../../components/editorial';
import Seg from '../../components/customize/Seg';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState, { errorKind, OfflineBanner } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonTable } from '../../components/ui/Skeleton';
import DateInput from '../../components/ui/DateInput';
import AddressBlock, { coordinate } from '../../components/ui/AddressBlock';

/**
 * The attendance register — 07-pahchan.md §3, "the surface that decides whether
 * this works".
 *
 * Human comparison is the only verification in v1, so the reviewer's throughput
 * IS the feature. §3 names the failure mode precisely: "Twelve punches at three
 * clicks each is thirty-six interactions before anyone has looked at a face, and a
 * reviewer who cannot keep up confirms everything without looking — which is worse
 * than no review, because it manufactures a record of verification that did not
 * happen."
 *
 * Hence: the punch selfie and BOTH references inline on every row at 50×62, and a
 * keyboard path. J/K to move, ↵ to confirm, F to flag, O to open. Mouse-only is
 * one row at a time however dense the layout.
 *
 * THE TWO KEYBOARD TRAPS §3 DOCUMENTS, both reproduced from the prototype:
 *
 * 1. A handler closing over `cursor` reads a stale value for every press in a
 *    burst. Five fast confirms wrote the verdict against the SAME row five times
 *    while the cursor advanced five times — the counter said one row reviewed and
 *    four people were silently skipped, in the queue whose entire purpose is not
 *    skipping anyone. Functional setState does not help: the value read from the
 *    closure is stale, not the state being written. So the cursor lives in a ref
 *    that mutates synchronously and every write goes through seek().
 *
 * 2. The listener is bound only when rows are on screen. Gating inside the
 *    handler is not enough — ↵ during a fetch would record a verdict against a
 *    row nobody can see, and that is exactly when it happens, because someone
 *    mid-burst keeps pressing while the next page loads. No binding means no path.
 */

const PHOTO_W = 50;
const PHOTO_H = 62;

/**
 * How long a face may say "still loading" before it is called a failure.
 *
 * `lib/api.js` creates the axios instance with no `timeout`, so its default is
 * 0 — never. Its response interceptor then RETRIES a network error three times
 * with backoff before rejecting. Between those two facts a request against a
 * socket that accepts and never answers has no terminal state at all: the slot
 * sits at 'load' for as long as the tab is open.
 *
 * That is the failure this screen already had. Three permanent ellipses read as
 * "nearly there", not as "these never arrived", and a reviewer clearing a day
 * confirmed against them — which is the one outcome the register exists to
 * prevent, because it manufactures a record of a verification that did not
 * happen. A loading state that cannot become a failed state is indistinguishable
 * from a slow one, so this one is given a deadline and a word.
 *
 * 12s: past the p99 of a signed-URL round trip on a bad connection, well inside
 * the patience of someone holding J down.
 */
export const PHOTO_DEADLINE_MS = 12000;

/** A row's comparison, as one word. Slots are 'load' | 'ok' | 'gone' | 'err'. */
export const COMPARE = { PENDING: 'pending', READY: 'ready', BROKEN: 'broken' };

/**
 *   pending — at least one image is still in flight. Nothing can be judged yet.
 *   ready   — punch AND both references are on screen. The only state in which
 *             confirming means anything.
 *   broken  — something resolved to nothing: retention deleted it, the fetch
 *             failed, the deadline passed. There is a row, but there is no
 *             comparison, and confirming it would be trust with a checkmark on
 *             it — the same thing `noref` already suppresses, reached from a
 *             different direction.
 */
function compareStatus(slots) {
  if (slots.some(s => s.st === 'load')) return COMPARE.PENDING;
  if (slots.every(s => s.st === 'ok'))  return COMPARE.READY;
  return COMPARE.BROKEN;
}

/** Which flags mean "a human needs to look at this". */
const NEEDS_LOOK = new Set(['geo', 'accuracy', 'noref', 'mock', 'offline', 'late', 'reuse']);

/* The flag labels and colours used to live here as two private maps, and the
   labels never reached the screen: `StatusChip` takes no `label` prop, so
   `<StatusChip status="requested" label="Outside site" />` rendered the word
   "Requested". Both maps are now `PUNCH_LABELS` / `PUNCH_COLORS` in
   `lib/statusColors.js` — the sixth map 07 §"Attendance states are not in
   statusColors.js" asks for — and the raw flag is passed straight through. */

function timeOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function dateOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * One signed URL, per image, on demand.
 *
 * Shared by the row triple and the detail. Each slot is its own little state
 * machine — 'load' | 'ok' | 'gone' | 'err' — because a single nullable URL
 * cannot express the difference between "still fetching" and "the retention job
 * deleted this three weeks ago", and those must not look alike: a permanent
 * spinner reads as a broken page, and a reviewer who thinks the page is broken
 * stops reviewing.
 *
 * And 'load' is NOT one of the terminal states. See PHOTO_DEADLINE_MS.
 */
function usePhotoUrl(path, enabled = true) {
  const [s, setS] = useState(() => (enabled && path ? { st: 'load' } : { st: 'gone' }));
  useEffect(() => {
    let alive = true;
    if (!enabled || !path) { setS({ st: 'gone' }); return undefined; }
    setS({ st: 'load' });

    // The clock starts with the request, and whichever settles first clears the
    // other — so a slow-but-successful fetch is never overwritten by its own
    // deadline, and a request that simply never answers still ends somewhere.
    const deadline = setTimeout(() => { if (alive) setS({ st: 'err' }); }, PHOTO_DEADLINE_MS);
    const settle = (next) => { if (!alive) return; clearTimeout(deadline); setS(next); };

    api.get(path)
      .then(r => settle({ st: 'ok', url: body(r).url }))
      // 404 is the retention case and is not an error: the punch record outlives
      // the photo by law (07 §5/§8), so a missing photo on an old row is expected.
      .catch(err => settle({ st: err?.response?.status === 404 ? 'gone' : 'err' }));

    return () => { alive = false; clearTimeout(deadline); };
  }, [path, enabled]);
  return s;
}

function PhotoSlot({ state, alt, emptyWord }) {
  const failed = state?.st === 'err';
  const word = failed ? 'failed to load' : state?.st === 'load' ? 'loading' : emptyWord;
  const resolved = state?.st === 'ok';
  return (
    <div
      /* No style attribute at all. The mount colour, the failure border and the
         clip are classes; the SIZE is inherited from `.rv__trip`, which is the
         only place it varies — the row renders at 50×62 and the detail at
         132×164, and those two are the same component. It has to be set on the
         container rather than here because the divider between the claim and
         the evidence is a sibling of these slots and sizes off the same value. */
      className={`rv__slot${resolved ? '' : ' rv__slot--pending'}${failed ? ' rv__slot--err' : ''}`}
      /* Labelled, not a live region. Three slots per row across a dozen rows is
         thirty-six nodes; `role="status"` on each would fire thirty-six
         announcements as the page settles and bury the one sentence that
         matters. The verdict cell carries the row's state as text. */
      aria-label={resolved ? undefined : `${alt} — ${word}`}
    >
      {resolved
        ? <img src={state.url} alt={alt} />
        : state?.st === 'load'
          /* `.ix-skeleton`, not `.k-skeleton`: its sweep is a translated overlay
             rather than an animated `background-position`, and this is the one
             screen in the app that paints three dozen of them at once. Both stop
             under reduced motion; only this one is free per frame while running.
             The SHAPE is the loading signal, so it survives the sweep being off —
             which an ellipsis, being a glyph that means "nearly there", did not. */
          ? <span className="ix-skeleton rv__sk" aria-hidden="true" />
          : (
            // The state colour from MOTION-SPEC §6's meaning table. This is the
            // word that has to stop a reviewer and it is the only signal here
            // that does not move; it must not read as another grey caption.
            <span className={`rv__word${failed ? ' rv__word--err' : ''}`}>
              {failed ? 'failed' : emptyWord}
            </span>
          )}
    </div>
  );
}

/**
 * The punch-and-two-references comparison. Genuinely new — §3's "Reuse before you
 * create" table lists `.rv__trip` as one of four things no primitive covers.
 *
 * Keys, not URLs. A signed URL is fetched per image actually rendered, so
 * scrolling past a row never mints a link to that person's face.
 */
function Triple({ hasPhoto, referenceIds, punchId, name, w = PHOTO_W, h = PHOTO_H, onStatus }) {
  const ids = (referenceIds || []).slice(0, 2);
  // Two APPROVED references are what makes a row verifiable. One is not half a
  // comparison — 07 §0 is explicit that the pair exists because a single frontal
  // photo fails on anyone who turns their head.
  const hasRefs = ids.length >= 2;

  const punch = usePhotoUrl(`/v1/pahchan/punches/${punchId}/photo`, !!punchId && !!hasPhoto);
  const ref1 = usePhotoUrl(hasRefs ? `/v1/pahchan/enrollment/photos/${ids[0]}/url` : null, hasRefs);
  const ref2 = usePhotoUrl(hasRefs ? `/v1/pahchan/enrollment/photos/${ids[1]}/url` : null, hasRefs);

  // Reported upward because the row's approve path depends on it: a comparison
  // nobody can see is not a comparison. Optional — the detail renders a second
  // Triple for the same punch and has no business speaking for the row.
  const status = compareStatus([punch, ref1, ref2]);
  useEffect(() => { if (onStatus) onStatus(punchId, status); }, [onStatus, punchId, status]);

  return (
    /* The size lands here, once, and the three slots and the divider all inherit
       it. Two custom properties instead of the eight declarations that used to
       be retyped across four elements. */
    <div
      className="rv__trip"
      style={(w !== PHOTO_W || h !== PHOTO_H) ? { '--slot-w': `${w}px`, '--slot-h': `${h}px` } : undefined}
    >
      <PhotoSlot state={punch} alt={`Clock-in photo for ${name}`} emptyWord="deleted" />
      {/* A divider, not a gap: the left image is the claim and the right two are
          the evidence, and the reviewer is comparing across that line. */}
      <span className="rv__div" aria-hidden="true" />
      <PhotoSlot state={ref1} alt={`Reference 1 for ${name}`} emptyWord="none" />
      <PhotoSlot state={ref2} alt={`Reference 2 for ${name}`} emptyWord="none" />
    </div>
  );
}

/**
 * Accuracy drawn as a RADIUS, not a dot — 07 §3's one non-negotiable about the
 * detail: "a dot makes a ±184m fix look like proof of presence, which is the one
 * thing it is not".
 *
 * The prototype used a Leaflet map on OpenStreetMap tiles. This does not, and
 * the reason is not that the dependency was inconvenient. A tile request carries
 * the employee's punch coordinates in the URL path to a third-party host on
 * every detail open. §7 will not let Aekam — who runs the product — see a
 * location; shipping those same coordinates to a public tile server would be a
 * strictly worse leak than the one the spec forbids. So the geometry is drawn
 * locally: no tiles, no third-party request, nothing leaves the page.
 *
 * What survives from the map is what the map was FOR — the reviewer seeing that
 * a ±184m circle at 412m from the site overlaps the site, and that this fix
 * therefore proves nothing either way.
 */
function AccuracyScale({ distanceM, accuracyM, siteName }) {
  if (distanceM == null) {
    return (
      <p className="rv__nogeo">
        No location was recorded for this punch, so there is no distance to draw. The
        punch still counts — §2 — but there is nothing here to place it.
      </p>
    );
  }

  const acc = accuracyM == null ? 0 : Number(accuracyM);
  const dist = Number(distanceM);
  const span = Math.max(dist + acc, 60) * 1.12;
  const X0 = 34;
  const RUN = 250;
  const px = m => (m / span) * RUN;
  const cx = X0 + px(dist);
  const r = Math.max(3, Math.min(px(acc), 150));

  return (
    <figure className="rv__fig">
      <svg viewBox="0 0 320 108" width="100%" height="108" role="img"
        aria-label={
          `The punch was recorded ${Math.round(dist)} metres from ${siteName || 'the site'}, `
          + (acc ? `with an accuracy of plus or minus ${Math.round(acc)} metres.` : 'with no accuracy figure.')
        }
      >
        {/* The uncertainty first, underneath everything, so the marker sits IN it
            rather than on top of it looking definitive. */}
        {acc > 0 && (
          <circle
            cx={cx} cy={54} r={r}
            fill="var(--tertiary)" fillOpacity="0.18"
            stroke="var(--tertiary)" strokeWidth="1"
          />
        )}
        <line x1={X0} y1={54} x2={X0 + RUN} y2={54} stroke="var(--outline-variant)" strokeWidth="1" />
        <circle cx={X0} cy={54} r="5" fill="var(--primary)" />
        <circle cx={cx} cy={54} r="4" fill="var(--surface)" stroke="var(--on-surface)" strokeWidth="2" />
        <text x={X0} y={78} fontSize="10" fill="var(--on-surface-3)" textAnchor="middle">site</text>
        <text x={cx} y={30} fontSize="10" fill="var(--on-surface-2)" textAnchor="middle">
          {dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`}
        </text>
      </svg>
      <figcaption className="rv__figc">
        {acc > 0
          ? `The shaded circle is the ±${Math.round(acc)}m the device reported. Anywhere inside it is consistent with this fix.`
          : 'No accuracy figure was reported, so the position cannot be bounded at all.'}
      </figcaption>
    </figure>
  );
}

function MetaRow({ k, v, tone }) {
  return (
    <div className="rv-meta__r">
      <span className="rv-meta__k">{k}</span>
      {/* The tone is genuinely per-row — an unbounded accuracy figure and a
          detected mock location are the two that must not read as ordinary
          metadata — so it arrives as `--c` and the rule picks it up. */}
      <span className="rv-meta__v" style={tone ? { '--c': tone } : undefined}>{v}</span>
    </div>
  );
}

/**
 * The detail — 07 §3, "opens inline, for outliers only".
 *
 * It did not exist. `openId` was set by the O key and by a row click and then
 * read by nothing, so the shortcut the hint bar advertises did nothing at all
 * and the three photos were only ever available at 50×62. The whole point of
 * having a detail is the outlier the thumbnail cannot settle.
 */
function Detail({ row, photoRetentionDays }) {
  const acc = row.accuracy_m == null ? null : Number(row.accuracy_m);
  const outside = row.distance_m != null && (row.flags || []).includes('geo');
  const refCount = (row.reference_ids || []).length;

  /* ── The vertical half of a "geo" flag ─────────────────────────────────────
     A `geo` flag on a multi-storey site was unreadable. The distance said
     fifteen metres, the horizontal test plainly passed, and the reviewer had no
     way at all to see that the punch was flagged for being four floors up —
     `altitude_m` and `altitude_tolerance_m` reached the database in migration
     193 and no screen has ever shown either.

     Rendered ONLY where the site actually checks altitude. `site_altitude_tolerance_m`
     is null for every site that does not, which is most of them and is the
     correct default: an extra "Vertical · not checked" row on every punch in the
     product would be six hundred lines of noise to make one line readable.

     `altitude_gap_m` is computed by the server (`abs(punch − site)`), so it is
     present only when the DEVICE reported an altitude too. A phone that reports
     none is ordinary — indoors, and permanently on some Android hardware — and
     that is a third state, said in words rather than shown as a missing row. */
  const vTol = row.site_altitude_tolerance_m == null ? null : Number(row.site_altitude_tolerance_m);
  const vGap = row.altitude_gap_m == null ? null : Number(row.altitude_gap_m);
  const checksAltitude = vTol != null && row.site_altitude_m != null;
  const vOutside = checksAltitude && vGap != null && vGap > vTol;
  const vAcc = row.altitude_accuracy_m == null ? null : Number(row.altitude_accuracy_m);

  const deleteOn = (() => {
    if (!photoRetentionDays || !row.has_photo) return null;
    const d = new Date(row.captured_at);
    if (Number.isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + Number(photoRetentionDays));
    return dateOf(d.toISOString());
  })();

  return (
    <div className="rv-det">
      <div>
        <Triple
          punchId={row.id}
          hasPhoto={row.has_photo}
          referenceIds={row.reference_ids}
          name={row.employee_name}
          w={132}
          h={164}
        />
        {/* The captions sit under the three photographs, and the empty span
            holds the divider's column so they do not drift one gap left. Below
            520px they wrap and that spacer is hidden — see pahchan.css. */}
        <div className="rv-det__labels">
          <span className="rv-det__lbl">
            Punch<br /><b>{timeOf(row.captured_at)}</b>
          </span>
          <span className="rv-det__gap" aria-hidden="true" />
          <span className="rv-det__lbl">
            Reference 1<br /><b>{refCount > 0 ? 'Straight on' : 'Not captured'}</b>
          </span>
          <span className="rv-det__lbl">
            Reference 2<br /><b>{refCount > 1 ? 'Three-quarter' : 'Not captured'}</b>
          </span>
        </div>

        {refCount < 2 && (
          <div className="note note--warn rv-det__note">
            <b>{refCount === 0 ? 'No reference pair.' : 'Only one reference.'}</b> There is
            nothing to compare against, so this punch cannot be verified — only accepted on
            trust. Send an enrollment request rather than confirming it.
          </div>
        )}
      </div>

      <div>
        <AccuracyScale distanceM={row.distance_m} accuracyM={acc} siteName={row.site_name} />
        <div className="rv-meta">
          {/* 8.0 · the coordinate is now openable. This is the one consumer of
              `AddressBlock` that has no address at all — a punch is a `lat` and
              a `lng`, which is the accurate half of §8.0's rule that a stored
              coordinate beats an Indian address string, and 699 of the 700
              punches on file carry both (measured 2026-08-27).

              The four decimals are unchanged: the component prints exactly what
              this row printed before, and puts the FULL precision in the href.
              What a reviewer gains is the ability to see where a flagged punch
              actually was, which until 8.1 draws the site circle is the only
              way to answer that question at all.

              `coordinate()` for the guard rather than `!= null`, because
              `Number(null)` and `Number('')` are both 0 and 0,0 is a place in
              the Gulf of Guinea. It is the same reader the component uses, so
              the row and its contents cannot disagree. */}
          {coordinate(row.lat, row.lng) && (
            <MetaRow k="Coordinates" v={<AddressBlock lat={row.lat} lng={row.lng} inline />} />
          )}
          <MetaRow
            k="Accuracy"
            v={acc == null ? 'Not reported' : `±${Math.round(acc)} m`}
            tone={acc == null || acc > 100 ? 'var(--tertiary)' : undefined}
          />
          <MetaRow
            k="From site"
            v={row.distance_m == null
              ? 'No location'
              : (row.distance_m >= 1000 ? `${(row.distance_m / 1000).toFixed(1)} km` : `${Math.round(row.distance_m)} m`)}
            tone={outside ? 'var(--danger)' : undefined}
          />
          <MetaRow k="Site" v={row.site_name || 'None matched'} />
          {/* Same register as Accuracy and From site above: a number, and the
              number it was judged against. */}
          {checksAltitude && (
            <MetaRow
              k="Height vs site"
              v={vGap == null
                ? 'No altitude reported'
                : `${Math.round(vGap)} m out of ±${Math.round(vTol)} m`}
              tone={vOutside ? 'var(--danger)' : undefined}
            />
          )}
          {checksAltitude && vGap != null && vAcc != null && (
            <MetaRow
              k="Height accuracy"
              v={`±${Math.round(vAcc)} m`}
              // An uncertainty as large as the window means the gap decided
              // nothing. Toned like an unbounded horizontal accuracy, for the
              // same reason: it must not read as ordinary metadata.
              tone={vAcc >= vTol ? 'var(--tertiary)' : undefined}
            />
          )}
          <MetaRow k="Captured" v="In-app camera" />
          <MetaRow
            k="Delivery"
            v={row.source === 'offline'
              ? `Offline · received ${timeOf(row.received_at)}`
              : 'Live'}
          />
          {/* null is not false. 07 §4: `mock_location: null` means the platform
              could not check, and a reviewer must be able to tell that from a
              check that ran and came back clean. */}
          <MetaRow
            k="Mock location"
            v={row.mock_location == null ? 'Not checked' : row.mock_location ? 'DETECTED' : 'Not detected'}
            tone={row.mock_location ? 'var(--danger)' : undefined}
          />
          <MetaRow k="Photo deleted" v={deleteOn || (row.has_photo ? '—' : 'Already deleted')} />
        </div>

        {/* THE SENTENCE THAT MAKES THE FLAG ANSWERABLE.
            A punch inside the radius and outside the vertical window carries the
            same `geo` flag as one two streets away — deliberately, because 07 §2
            keeps the flag vocabulary fixed. Without this line the reviewer reads
            "Outside site · 15 m" and has no way to reconcile the two. */}
        {vOutside && (
          <div className="note note--warn rv-det__note">
            <b>Flagged on height, not distance.</b> This punch was {Math.round(Number(row.distance_m ?? 0))}m from
            {' '}{row.site_name || 'the site'} — inside its area — but {Math.round(vGap)}m above or below the
            height it is set to, which allows ±{Math.round(vTol)}m. Both tests share the
            <b> Outside site</b> flag.
            {vAcc != null && vAcc >= vTol && (
              <> The phone reported its height to ±{Math.round(vAcc)}m, which is as wide as the
              window itself — this gap is inside the device’s own uncertainty and settles nothing.</>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Register() {
  const { pushToast } = useToast();
  const [state, setState] = useState('loading');   // loading | ready | error
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('needs');   // §3: default is "needs a look"
  const [cursor, setCursor] = useState(0);
  const [verdict, setVerdict] = useState({});
  const [openId, setOpenId] = useState(null);

  // Trap 1. The cursor must mutate synchronously; React state alone is read
  // stale by every handler in a burst.
  const curRef = useRef(0);

  // Which rows have a comparison the reviewer can actually see, reported up by
  // each row's Triple. A ref for the same reason the cursor is one, plus a
  // second: a photo resolving must not rebuild `record`, or the keydown listener
  // is torn down and rebound three dozen times while the page loads — and a
  // keypress landing in that window has no handler at all.
  const compareRef = useRef({});
  // The mirror exists only to re-render the verdict cell when a row becomes
  // judgable. Nothing reads it to make a decision.
  const [compare, setCompare] = useState({});
  const onCompareStatus = useCallback((id, st) => {
    if (compareRef.current[id] === st) return;
    compareRef.current = { ...compareRef.current, [id]: st };
    setCompare(compareRef.current);
  }, []);

  // Which KIND of failure, not just that there was one. A reviewer in a basement
  // and a reviewer hitting a 500 need different words and different actions, and
  // `errorKind` already draws that line — it treats a rejection with no response
  // as offline rather than blaming us for the user's train tunnel.
  const [errKind, setErrKind] = useState('server');

  /**
   * Which day. `GET /register` has always taken `?on=`, and nothing sent it, so
   * the register was today or nothing — a reviewer who was away on Friday had no
   * way back to Friday, and the punches sat unreviewed until the 7-day
   * auto-accept swallowed them. The reference header names the day for the same
   * reason, and its empty state offers "View yesterday".
   */
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const isToday = day === new Date().toISOString().slice(0, 10);

  const load = useCallback(async (on) => {
    setState('loading');
    try {
      const r = await api.get('/v1/pahchan/register', { params: on ? { on } : undefined });
      // `{punches: [...]}` — a bespoke key, so `body()` rather than `rows()`.
      const list = body(r).punches;
      setRows(Array.isArray(list) ? list : []);
      setState('ready');
    } catch (err) {
      setErrKind(errorKind(err));
      setState('error');
    }
  }, []);

  useEffect(() => { load(day); }, [load, day]);

  // Just the retention window, for the detail's "photo deleted on" row. Failing
  // to read it must not break the register — the whole page is not worth losing
  // over one derived date, so it stays null and the row reads "—".
  const [photoRetentionDays, setPhotoRetentionDays] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get('/v1/pahchan/policy')
      .then(r => { if (alive) setPhotoRetentionDays(body(r).punch_photo_retention_days ?? null); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const flaggedCount = useMemo(
    () => rows.filter(p => (p.flags || []).some(f => NEEDS_LOOK.has(f)) && !p.review_verdict).length,
    [rows],
  );

  const visible = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter(p => (p.flags || []).some(f => NEEDS_LOOK.has(f)) && !p.review_verdict);
  }, [rows, filter]);

  /** Every cursor move goes through here, so the ref and the highlight cannot
   *  drift apart — including row clicks and filter changes. */
  const seek = useCallback((n) => {
    const clamped = Math.max(0, Math.min(n, visible.length - 1));
    curRef.current = clamped;
    setCursor(clamped);
  }, [visible.length]);

  const record = useCallback(async (val) => {
    const row = visible[curRef.current];
    if (!row) return;

    // ── Confirming requires something to have been compared ──────────────────
    //
    // Flagging never does, and neither gate below touches it. A reviewer who
    // cannot see the faces still has an opinion worth recording, and refusing F
    // as well would strand the queue on exactly the rows that most need a human.

    // No reference pair means there is nothing to compare against, so confirming
    // is not verification — §3: "it is trust with a checkmark on it". The
    // affordance is suppressed rather than silently doing nothing, so the
    // keyboard path refuses too and says why.
    if (val === 'ok' && (row.flags || []).includes('noref')) {
      pushToast({
        type: 'warning',
        title: 'Nothing to compare against',
        message: `${row.employee_name} has no approved reference photos. Send an enrollment request instead.`,
      });
      return;
    }

    // The photographs themselves. `noref` above is the SERVER's word for an
    // employee with no approved pair; this is the client's word for a pair that
    // exists and is not on screen — a fetch still in flight, a retention
    // deletion, a signing endpoint that stopped answering. The reviewer sees the
    // same three rectangles either way, and ↵ against three rectangles is how a
    // day gets cleared without anyone looking at a face. It is the failure this
    // screen was actually observed committing.
    if (val === 'ok') {
      const cmp = compareRef.current[row.id];
      if (cmp !== COMPARE.READY) {
        pushToast(cmp === COMPARE.BROKEN
          ? {
            type: 'warning',
            title: 'The photos did not load — nothing to compare',
            message: `${row.employee_name}'s comparison is incomplete, so confirming would record a check that did not happen. Reload, or flag the row.`,
          }
          : {
            type: 'info',
            title: 'Still loading the photos',
            message: `Wait for ${row.employee_name}'s three photos before confirming.`,
          });
        // Deliberately no seek(): the cursor stays put so the next ↵ lands here
        // once the faces arrive. Advancing would walk a burst straight past the
        // people whose photos are slowest — the same silent skip the cursor ref
        // exists to prevent.
        return;
      }
    }

    setVerdict(v => ({ ...v, [row.id]: val }));
    seek(curRef.current + 1);
    try {
      await api.patch(`/v1/pahchan/punches/${row.id}/review`, { verdict: val });
      setRows(rs => rs.map(p => (p.id === row.id ? { ...p, review_verdict: val } : p)));
    } catch (err) {
      // Roll the optimistic mark back. A verdict that failed to save must not
      // look recorded — this queue's whole value is that it is accurate.
      setVerdict(v => { const next = { ...v }; delete next[row.id]; return next; });
      // Offline is the likely case mid-burst and it needs different words: there
      // is nothing to try again until the connection returns, and a reviewer who
      // keeps pressing ↵ through a dead network is advancing the cursor past
      // people whose verdicts are not being saved.
      pushToast(
        errorKind(err) === 'offline'
          ? {
            type: 'warning',
            title: 'You are offline — that verdict was not saved',
            message: 'Stop here. Verdicts need a connection, and the rows you pass while offline stay unreviewed.',
          }
          : { type: 'error', title: 'Could not save that verdict', message: 'Try again.' },
      );
    }
  }, [visible, seek, pushToast]);

  // Trap 2. Bound only while rows are on screen, so there is no path by which a
  // keypress during a fetch can write against a row the reviewer cannot see.
  useEffect(() => {
    if (state !== 'ready' || !visible.length) return undefined;

    const onKey = (e) => {
      // Never steal a key from a field. A reviewer typing a decline reason must
      // not have F flag the row underneath.
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const k = e.key.toLowerCase();
      if (k === 'j' || e.key === 'ArrowDown')      { e.preventDefault(); seek(curRef.current + 1); }
      else if (k === 'k' || e.key === 'ArrowUp')   { e.preventDefault(); seek(curRef.current - 1); }
      else if (e.key === 'Enter')                  { e.preventDefault(); record('ok'); }
      else if (k === 'f')                          { e.preventDefault(); record('flagged'); }
      else if (k === 'o')                          {
        e.preventDefault();
        const row = visible[curRef.current];
        if (row) setOpenId(id => (id === row.id ? null : row.id));
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, visible, seek, record]);

  // A filter change re-slices the list, so the ref has to be brought back in
  // range or the next keypress writes against the wrong row.
  useEffect(() => { seek(0); }, [filter, seek]);

  const hasTable = state === 'loading' || (state === 'ready' && visible.length > 0);

  return (
    <Section
      title="Register"
      hi="उपस्थिति पंजी"
      right={(
        <span className="rv__tools">
          <label className="rv__day">
            <span className="k-sr-only">Which day&rsquo;s register</span>
            <DateInput
              className="inp"
              type="date"
              value={day}
              // Not into the future. A register for tomorrow is always empty and
              // the empty state would tell a reviewer that nobody has clocked in,
              // which would be true and useless.
              max={new Date().toISOString().slice(0, 10)}
              onChange={e => { if (e.target.value) setDay(e.target.value); }}
            />
          </label>
          {!isToday && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setDay(new Date().toISOString().slice(0, 10))}
            >
              Today
            </button>
          )}
          <Seg
            label="Which punches to show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'needs', label: 'Needs a look', count: flaggedCount },
              { value: 'all',   label: 'All',          count: rows.length },
            ]}
          />
        </span>
      )}
    >
      {/* Persistent while the connection is down, not just on the failed request
          that revealed it. A reviewer clearing a day needs to know saves are not
          landing BEFORE they burst through twelve rows, not after. */}
      <OfflineBanner />

      {/* §3: the column header labels the table, so it belongs to any state where
          a table is present OR arriving — bound to hasTable, not to ready. Not
          shown for empty or error, where column labels would sit over nothing. */}
      {state === 'loading' && (
        <SkeletonRegion label="Loading the register…">
          {/* `columns`, not `cols`. The prop is `columns` (Skeleton.jsx:75), so
              `cols` was silently dropped and the skeleton fell back to its default
              of 5 for a 6-column table — a column-count jump at exactly the moment
              this state exists to avoid one. */}
          <SkeletonTable rows={6} columns={6} />
        </SkeletonRegion>
      )}

      {state === 'error' && (
        <ErrorState
          // Classified, not hardcoded. A reviewer in a basement was being told
          // "something broke on our side" — which is untrue, unactionable, and
          // sends them to report a bug that is their own signal.
          kind={errKind}
          // `detail`, not `title`/`message`. ErrorState takes neither of those
          // (its signature is kind/grant/detail/onRetry/backTo/backLabel), so
          // §3's exact reassurance was being dropped on the floor and the generic
          // server copy rendered in its place.
          detail={
            errKind === 'offline'
              ? 'The register needs a connection to load. Punches already recorded are safe, and anything queued on a phone will still sync.'
              // §3's exact words. A read failure that reads like data loss sends an
              // HR admin into a panic about attendance records that are perfectly safe.
              : 'Punches are safe — this is a read failure, not data loss.'
          }
          onRetry={() => load(day)}
        />
      )}

      {state === 'ready' && visible.length === 0 && (
        filter === 'needs' && rows.length > 0
          ? (
            // §3 distinguishes these two empties, and the distinction matters:
            // reaching zero flagged is the GOAL, so it gets --ok and a check
            // rather than the neutral treatment of a day that has not started.
            <EmptyState
              icon="check"
              tone="ok"
              title={{ en: 'Nothing needs a look', hi: 'सब ठीक है' }}
              description={`Every punch ${isToday ? 'today' : 'that day'} cleared the checks.`}
              action="Show all"
              onAction={() => setFilter('all')}
            />
          )
          : isToday ? (
            <EmptyState
              icon="clock"
              title={{ en: 'Nobody has clocked in yet', hi: 'अभी कोई नहीं' }}
              description="On a normal weekday the first punches land between 9:00 and 9:40."
              // §3's own empty state offers this, and it is only offerable now
              // that the register can be pointed at a day other than today.
              action="View yesterday"
              onAction={() => {
                const d = new Date();
                d.setDate(d.getDate() - 1);
                setDay(d.toISOString().slice(0, 10));
              }}
            />
          ) : (
            // A past day with no punches is not "nobody has clocked in YET" —
            // nobody is going to. Saying "yet" to a reviewer looking at last
            // Tuesday reads as a page that has not finished loading.
            <EmptyState
              icon="clock"
              title={{ en: 'No punches on this day', hi: 'कोई उपस्थिति नहीं' }}
              description="Nothing was recorded. A holiday, a weekly off, or a day the team was not on the clock."
              action="Back to today"
              onAction={() => setDay(new Date().toISOString().slice(0, 10))}
            />
          )
      )}

      {state === 'ready' && visible.length > 0 && (
        <>
          <p className="rv__hint">
            <kbd>J</kbd>/<kbd>K</kbd> move · <kbd>↵</kbd> confirm · <kbd>F</kbd> flag · <kbd>O</kbd> detail
          </p>

          <DataTable arrange="pahchan.register"
            columns={[
              '', 'Person', 'Compare', 'Time',
              { label: 'Where', className: 'rv__loc' },
              { label: 'Verdict', className: 'rv__v' },
            ]}
          >
            {visible.map((p, i) => {
              const mine = verdict[p.id] || p.review_verdict;
              const noRef = (p.flags || []).includes('noref');
              return (
                <React.Fragment key={p.id}>
                <tr
                  className={`rv__r${i === cursor ? ' is-cursor' : ''}`}
                  /* A click both moves the cursor and toggles the detail, which is
                     what the prototype does. `seek` is what keeps the ref and the
                     highlight from drifting — a row click that set state directly
                     is exactly the desync trap §3 warns about. */
                  onClick={() => { seek(i); setOpenId(id => (id === p.id ? null : p.id)); }}
                  /* aria-current, not aria-selected. `aria-selected` on a row
                     is only supported inside a grid or treegrid; DataTable
                     renders a plain <table>, where `row` does not support it
                     and the state is dropped silently. J/K move a review
                     cursor rather than building a selection, which is what
                     aria-current means and where it is valid. */
                  aria-current={i === cursor ? 'true' : undefined}
                >
                  <Td className="rv__n">{i + 1}</Td>

                  <Td className="rv__who">
                    <div className="rv__who-b">
                      <strong className="rv__name">{p.employee_name}</strong>
                      <div className="rv__flags">
                        {(p.flags || []).map(f => <StatusChip key={f} status={f} />)}
                      </div>
                    </div>
                  </Td>

                  <Td className="rv__trip-cell">
                    <Triple
                      punchId={p.id}
                      hasPhoto={p.has_photo}
                      referenceIds={p.reference_ids}
                      name={p.employee_name}
                      onStatus={onCompareStatus}
                    />
                  </Td>

                  <Td className="rv__t">
                    {/* `.rv__t` already carries the mono face and tabular
                        figures for the whole cell — module.css sets it so a
                        column of times scans without walking. */}
                    <div className="rv__tb">
                      <span>{timeOf(p.captured_at)}</span>
                      <span className="rv__dir">
                        {p.direction === 'in' ? 'in' : 'out'}
                      </span>
                    </div>
                  </Td>

                  <Td className="rv__loc">
                    {p.site_name || '—'}
                    {p.accuracy_m != null && (
                      <span className="rv__acc">
                        ±{Math.round(p.accuracy_m)}m
                      </span>
                    )}
                  </Td>

                  <Td className="rv__v">
                    {mine
                      /* `key` on the flash wrapper so the one-shot RESTARTS when
                         the verdict changes, rather than being a class already on
                         the node that never fires again. The flash is the polish;
                         the chip appearing where a dash was is the signal, and
                         that difference is static — `--dur-slow` collapses to
                         ~0.5ms under `prefers-reduced-motion`, so the animation
                         goes, and it must not take the confirmation with it. */
                      ? (
                        <span key={mine} className="ix-flash rv__flash">
                          {/* The tone comes from `status`; the WORD is named,
                              because the affordance and its result have to agree.
                              The help line above this table says "↵ confirm · F
                              flag", and the bare STATUS_MAP words are "Done" and
                              "Rejected" — so pressing F on a punch that needs a
                              second look reported it as REJECTED, which is a
                              different decision about a person's attendance than
                              the one the reviewer made. */}
                          <StatusChip
                            status={mine === 'ok' ? 'done' : 'rejected'}
                            label={mine === 'ok' ? 'Confirmed' : 'Flagged'}
                          />
                        </span>
                      )
                      : noRef
                        // §3: no reference pair suppresses the confirm affordance
                        // and offers enrollment instead. Confirming here would be
                        // trust with a checkmark on it.
                        ? <button className="btn btn--ghost btn--sm"
                            onClick={(e) => { e.stopPropagation(); pushToast({
                              type: 'info',
                              title: 'Enrollment request',
                              message: `${p.employee_name} needs two reference photos before their punches can be verified.`,
                            }); }}>
                            Send enrollment request
                          </button>
                        /* Not an em-dash. This is the cell a reviewer looks at to
                           know whether the row is theirs to judge, and ↵ now
                           refuses on two of these three states — so it names the
                           one it is in rather than letting the refusal arrive as
                           an unexplained toast. */
                        : (
                          /* The reference (`PahchanReview.jsx:184`) puts a
                             confirm and a flag control on every row. The build
                             had the keyboard path only, so a reviewer who
                             reaches for a mouse — or a touch device, where there
                             is no ↵ at all — could read the queue and decide
                             nothing.

                             Both buttons seek to this row and then call the SAME
                             `record()` the keyboard calls. That is the point: the
                             gate that refuses a confirm against photos which have
                             not loaded lives inside `record`, and duplicating the
                             decision here is how the two paths drift until one of
                             them will clear a day nobody looked at.

                             Confirm is disabled while the comparison is not
                             READY, so the refusal is visible before the click
                             rather than arriving as a toast afterwards. Flag is
                             never disabled — §3's reasoning, and the same reason
                             F is ungated: a reviewer who cannot see the faces
                             still has an opinion, and gating it strands the queue
                             on exactly the rows that need a person. */
                          <div className="rv__acts">
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              disabled={compare[p.id] !== COMPARE.READY}
                              title={compare[p.id] === COMPARE.BROKEN
                                ? 'The photos did not load, so there is nothing to compare'
                                : compare[p.id] === COMPARE.READY
                                  ? `Confirm ${p.employee_name}'s punch`
                                  : 'Still loading the photos'}
                              onClick={(e) => { e.stopPropagation(); seek(i); record('ok'); }}
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              title={`Flag ${p.employee_name}'s punch for a second look`}
                              onClick={(e) => { e.stopPropagation(); seek(i); record('flagged'); }}
                            >
                              Flag
                            </button>
                            {compare[p.id] !== COMPARE.READY && (
                              /* BROKEN and PENDING must not read alike — one is
                                 "wait" and the other is "this will never
                                 arrive". The tone is the per-row difference, so
                                 it rides `--c`. */
                              <span
                                className="rv__cmp"
                                style={compare[p.id] === COMPARE.BROKEN ? { '--c': 'var(--danger)' } : undefined}
                              >
                                {compare[p.id] === COMPARE.BROKEN ? 'Cannot compare' : 'Loading photos'}
                              </span>
                            )}
                          </div>
                        )}
                  </Td>
                </tr>

                {/* §3: "opens inline, for outliers only". A colSpan row rather
                    than a modal — the reviewer is comparing this punch against
                    the ones above and below it, and a dialog takes those away. */}
                {openId === p.id && (
                  <tr className="rv-det__row">
                    <td colSpan={6}>
                      <Detail row={p} photoRetentionDays={photoRetentionDays} />
                    </td>
                  </tr>
                )}
                </React.Fragment>
              );
            })}
          </DataTable>
        </>
      )}
    </Section>
  );
}
