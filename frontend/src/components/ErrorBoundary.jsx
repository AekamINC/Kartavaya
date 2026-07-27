import React from 'react';

/**
 * There are two of these, and the second one is the point.
 *
 * `App.jsx:296` wraps the whole tree, which is right for a failure in the
 * providers or the router — there is nothing left to render around it. But it
 * was the ONLY one, so a throw inside any tab panel replaced the sidebar, the
 * nav, the toasts and the whole product with a reload button. One bad panel
 * took down everything, and the only way out was a reload that also lost
 * whatever the user had been doing.
 *
 * `AppShell.jsx` now wraps `<Outlet>` at `scope="page"`, so a page that throws
 * fails inside the content column and the shell survives — the user can move to
 * a module that works instead of losing the session's context.
 *
 * `scope` changes only the fallback's size, copy and recovery:
 *   · `app`  — full viewport, offers a reload, because nothing else is left.
 *   · `page` — sits in the content column, offers a retry that remounts the
 *              page, because the shell around it is still alive and a reload is
 *              a bigger hammer than the failure warrants.
 */
export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // An error caught here never reaches window.onerror, so without this a page
    // that throws leaves no trace anywhere at all.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', this.props.scope || 'app', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const page = this.props.scope === 'page';

    // `.k-err` is `ErrorState`'s vocabulary (`components.css:247`), reused
    // deliberately: a crash and a failed fetch should not look like different
    // products, and this used to be a pile of inline styles and a ⚠️ emoji that
    // ignored the theme, the density control and the type scale.
    return (
      <div className="k-err" data-kind="server" role="alert">
        <div className="k-err__ic" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor"
               strokeWidth="1.5" strokeLinecap="round">
            <circle cx="10" cy="10" r="8" /><path d="M10 6v5" /><path d="M10 14h.01" />
          </svg>
        </div>
        {/* 24-bilingual-devanagari.md, "Where Devanagari appears — and where it
            must not": error text is on the No list. The rule is that Devanagari
            is a recognition cue on things the user already knows the meaning of;
            someone reading an error for the first time is not helped by half of
            it being in a script they may not read, and a bilingual error is
            longer and harder to scan at the moment they are least patient. */}
        <p className="k-err__t">
          {page ? 'This page didn’t load' : 'Something went wrong'}
        </p>
        <p className="k-err__d">
          {page
            ? 'The rest of the app is still working — move to another section, or try this one again.'
            : (this.state.error?.message || 'An unexpected error occurred.')}
        </p>
        <button
          className="k-btn k-btn--primary"
          onClick={() => {
            // A page-scoped failure clears and remounts; an app-scoped one has
            // nothing left to remount into, so it reloads.
            if (page) this.setState({ error: null });
            else window.location.reload();
          }}
        >
          {page ? 'Try again' : 'Reload page'}
        </button>
      </div>
    );
  }
}
