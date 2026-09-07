import { useCallback } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

/** The clicks a single-page app must NOT swallow — the same set react-router's
 *  own `<Link>` checks before it calls preventDefault. A modified click and a
 *  middle click are the reader asking the BROWSER for a second tab. */
const browserHandles = (e) =>
  e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

/**
 * useUrlView — a segmented view switch that lives in the URL.
 *
 * ── WHAT THIS IS FOR, AND WHAT IT IS NOT ───────────────────────────────────
 *
 * Three URL concerns now exist in this app and they are different things:
 *
 *   ?tab=    which module section (the fourteen module pages, `ModuleTabs`)
 *   ?open=   which RECORD is open on a list (`useOpenRecord`)
 *   ?view=   which SHAPE the same content is being shown in — this hook
 *
 * The third is the one that was left. "Board / Table / Calendar / Timeline"
 * on a project, "Register / Expiring" on DSCs, "Open / Closed" on notices,
 * "Project / Task" on templates: every one held in `useState`, so a person
 * could not open the timeline of a project in a second tab beside its board,
 * and a refresh threw them back to whichever view shipped as the default.
 *
 * ── WHY `replace` AND NOT A PUSH ───────────────────────────────────────────
 *
 * `useOpenRecord` pushes, because opening a record is entering something and
 * Back should leave it. A view switch is not: these are segmented controls
 * with roving tabindex, so ←/→ moves between them, and a push would leave one
 * history entry per ARROW KEY. Back would then walk the strip instead of
 * leaving the page — the same fault that keeps `pahchan/Register` out of
 * `useOpenRecord`. Replacing is also what the module pages' own `setTab`
 * already does, so the whole app agrees about what a tab switch costs.
 *
 * ── `linkProps` RATHER THAN A BARE href ────────────────────────────────────
 *
 * An href alone would leave the link decorative: a plain left click has to
 * stay inside the app, and only ctrl/cmd/shift/middle may fall through to the
 * browser. `role="tab"` also owes Space, which an anchor does not answer by
 * itself. All three belong together, and spreading one object onto the anchor
 * is how eight call sites cannot drift from each other.
 *
 *     const v = useUrlView('view', VIEWS, 'kanban');
 *     <a {...v.linkProps(id)} role="tab" aria-selected={v.value === id}>…</a>
 *
 * `values` is the allow-list, and it is not decoration: a URL is user input,
 * and an unknown value must fall back to the default rather than render an
 * empty panel.
 */
export default function useUrlView(param, values, fallback) {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();

  const raw = params.get(param);
  const value = values.includes(raw) ? raw : fallback;

  /* Every other parameter is carried. On `/manav` alone this address holds the
     module tab and possibly an open record, and a link that dropped them would
     switch view on a different tab than the reader is looking at. */
  const hrefFor = useCallback((next) => {
    const p = new URLSearchParams(params);
    p.set(param, String(next));
    return `${pathname}?${p.toString()}`;
  }, [params, pathname, param]);

  const select = useCallback((next) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set(param, String(next));
      return p;
    }, { replace: true });
  }, [setParams, param]);

  const linkProps = useCallback((next) => ({
    href: hrefFor(next),
    onClick: (e) => {
      if (browserHandles(e)) return;
      e.preventDefault();
      select(next);
    },
    // An anchor activates on Enter for free; Space scrolls the page instead.
    // The button this replaces answered both (APG · Tabs).
    onKeyDown: (e) => {
      if (e.key !== ' ') return;
      e.preventDefault();
      select(next);
    },
  }), [hrefFor, select]);

  return { value, hrefFor, select, linkProps };
}
