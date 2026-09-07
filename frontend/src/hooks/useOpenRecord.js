import { useCallback, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

/**
 * useOpenRecord — "which record is open on this list", kept in the URL.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * The owner, twice — 2026-09-01 and again on 09-07: "user cannot open anything
 * in new tab ... they cannot work two different module at same time". The shell
 * was made linkable, then the module tab strip. This is what was left, and it
 * is the half a CRM person actually lives in: **seventeen list surfaces opened
 * a record into a drawer that had no address at all.**
 *
 *     const [openId, setOpenId] = useState(null);
 *
 * That line is the whole defect, and it appeared verbatim in twelve files. A
 * record with no URL cannot be opened in a second tab, cannot be linked to a
 * colleague, cannot be bookmarked, and does not survive a refresh — the reader
 * lands back on the list having lost the row they were reading. None of that is
 * visible in a screenshot, because opening the drawer works perfectly.
 *
 * `graha/deals/:dealId` and `vikray/orders/:orderId` solved this by promoting
 * the record to a ROUTE. That is the right answer when the record has its own
 * screen and its own data fetch; it is too much machinery for a drawer that
 * renders over the list it belongs to, and it would need a route entry per tab
 * across nine module pages. A query parameter says the same thing — *this list,
 * with this row open* — and needs no route at all.
 *
 * ── THE HISTORY CONTRACT, WHICH IS THE PART THAT IS EASY TO GET WRONG ──────
 *
 * Opening is a PUSH. That is not incidental: it is what makes Back close the
 * drawer instead of leaving the module, which is what every reader already
 * expects Back to do and what none of these screens did.
 *
 * Closing then has two correct answers, and which one applies depends on how
 * the reader ARRIVED:
 *
 *   · they opened it here → `navigate(-1)`, so the entry we pushed is consumed
 *     rather than left behind. Without this, closing pushes a THIRD entry and
 *     Back re-opens the record the reader just dismissed.
 *   · they arrived cold, on a pasted link or a new tab → there is nothing to go
 *     back to, so the parameter is dropped with `replace`. `navigate(-1)` there
 *     walks out of the app entirely, which is the bug this branch exists to
 *     avoid.
 *
 * `pushed` is a ref rather than state because it must not cause a render, and
 * because the question it answers ("did WE push this?") is about an event, not
 * about the current URL. `graha/DealRoute.jsx:189` reaches the same fork from
 * the other side, using `location.key !== 'default'`; that works for a whole
 * route and cannot work here, because a tab switch also changes the key.
 *
 * ── basePath ───────────────────────────────────────────────────────────────
 *
 * Default is the current pathname, which is correct everywhere except the two
 * modules that render a RECORD ROUTE as a child of the module page. On
 * `/graha/deals/d1` the Clients tab is still mounted underneath (that is the
 * point of `GrahaModule`), so a row link built from `useLocation()` would read
 * `/graha/deals/d1?tab=clients&open=c1` and reopen the deal. Graha's list tabs
 * pass `/graha`; nothing else needs to.
 *
 * ── USAGE ──────────────────────────────────────────────────────────────────
 *
 *     const { openId, open, close, hrefFor } = useOpenRecord();
 *     ...
 *     <Link to={hrefFor(inv.id)}>{inv.invoice_number}</Link>
 *     {openId && <InvoiceDetail invoiceId={openId} onClose={close} />}
 *
 * `open(id)` stays for the callers that are not links — a row's own onClick, a
 * "created, now show it" hand-off, a keyboard shortcut.
 */
export default function useOpenRecord({ basePath, param = 'open' } = {}) {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  /* Whether the entry currently showing a record is one this hook pushed.
     Set on open, cleared on close — see the history contract above. */
  const pushed = useRef(false);

  const openId = params.get(param);

  /** The address of this list with `id` open, keeping every other parameter.
   *  The others are not decoration: `?tab=` decides which list is underneath,
   *  and the filters decide which rows. A link that dropped them would open a
   *  record over a different list than the one the reader is looking at. */
  const hrefFor = useCallback((id) => {
    const p = new URLSearchParams(params);
    p.set(param, String(id));
    return `${basePath ?? pathname}?${p.toString()}`;
  }, [params, basePath, pathname, param]);

  /**
   * `open(id)` pushes; `open(id, { replace: true })` does not.
   *
   * The option exists for one shape of caller and should not be reached for
   * casually: a PICKER, where the id is a choice among peers rather than a
   * record being entered. `TeamsPage`'s project `<select>` is the case —
   * a native select fires `change` on every arrow key, so pushing would put a
   * history entry behind each option the reader passed over and Back would
   * walk the dropdown instead of leaving the page. Replacing keeps the address
   * shareable and refresh-proof, which is the whole benefit there, without
   * pretending each keystroke was a navigation.
   */
  /**
   * `params` sets other keys in the SAME navigation, and that is not a
   * convenience — it is the only correct way to do it.
   *
   * `EsignPage` opens a document and switches to the Documents tab at once. As
   * two calls in one tick that silently loses one: `setParams` is a navigate,
   * not a setState, so the second reads the location the first has not landed
   * yet and overwrites it. One navigation, both keys.
   */
  const open = useCallback((id, { replace = false, params: extra } = {}) => {
    if (id == null || id === '') return;
    // Only a PUSH leaves an entry for `close()` to consume.
    if (!replace) pushed.current = true;
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set(param, String(id));
      // `extra` is this call's own argument, not a closure, so it is not a
      // dependency — and must not be one: an object literal at the call site
      // would change identity on every render and rebuild this callback.
      for (const [k, v] of Object.entries(extra || {})) p.set(k, String(v));
      return p;
    }, replace ? { replace: true } : undefined);
  }, [setParams, param]);

  const close = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      navigate(-1);
      return;
    }
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete(param);
      return p;
    }, { replace: true });
  }, [navigate, setParams, param]);

  return { openId, open, close, hrefFor };
}
