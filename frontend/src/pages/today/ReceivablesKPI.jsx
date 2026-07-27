import React from 'react';
import { inr } from '../../lib/inr';

/**
 * "How's my business?" — 05-today-dashboard.md §1 (Receivables KPI).
 *
 * GATED, and the gate is the server's. §4 requires this to appear only when
 * Ganit is active AND the viewer holds a Ganit grant: "a member with no Ganit
 * access should not see org receivables on their home screen". There is no
 * client-side module/grant registry in this build — nothing in `lib/` or
 * `navConfig.js` exposes one — so the only honest gate available is the one
 * `/v1/ganit/stats` already enforces: the caller renders nothing unless the
 * request came back with data, and a 403 or 404 leaves `stats` null.
 *
 * That is correct but it is not free: it still issues the request. A real gate
 * wants `GET /v1/me/modules` returning active modules and the viewer's grants,
 * so the call is never made. Noted for the backend rather than faked here.
 *
 * `tabular-nums` on every rupee figure, always — §1: a receivables number that
 * changes width as it updates reads as unstable. `inr()` carries the Indian
 * 2,2,3 grouping, which the four hand-rolled `toLocaleString('en-IN')` calls
 * this replaces happened to get right and the next one would not have.
 */
export default function ReceivablesKPI({ stats }) {
  if (!stats) return null;

  const unpaid = Number(stats.unpaid_count || 0);

  return (
    <section className="k-hero-kpi" aria-label="Receivables">
      <div className="k-hero-kpi__main">
        <div className="k-hero-kpi__label">
          {/* lang="hi" is load-bearing here, not decoration: this label is
              uppercase AND tracked at 1.68px, and only `[lang="hi"]` in
              editorial.css can zero the tracking that would otherwise split
              the conjuncts in प्राप्य. See the matching rule in today.css. */}
          RECEIVABLES <span className="hi-mute" lang="hi">प्राप्य</span>
        </div>
        <div className="k-hero-kpi__value">{inr(stats.total_outstanding)}</div>
        <div className="k-hero-kpi__sub">
          {unpaid} unpaid invoice{unpaid === 1 ? '' : 's'}
        </div>
      </div>

      <div className="k-hero-kpi__cards">
        <div className="k-hero-kpi__card">
          <div className="k-hero-kpi__card-val k-hero-kpi__card-val--ok">{inr(stats.total_collected)}</div>
          <div className="k-hero-kpi__card-lbl">Collected <span className="hi-mute">वसूला</span></div>
        </div>
        <div className="k-hero-kpi__card">
          <div className="k-hero-kpi__card-val k-hero-kpi__card-val--danger">{Number(stats.overdue_count || 0)}</div>
          <div className="k-hero-kpi__card-lbl">Overdue <span className="hi-mute">विलंबित</span></div>
        </div>
        <div className="k-hero-kpi__card">
          <div className="k-hero-kpi__card-val">{Number(stats.total_invoices || 0)}</div>
          <div className="k-hero-kpi__card-lbl">Invoices <span className="hi-mute">कुल चालान</span></div>
        </div>
      </div>
    </section>
  );
}
