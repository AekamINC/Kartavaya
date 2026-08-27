// @vitest-environment node
//
// NODE, not jsdom, and it is load-bearing rather than a preference: this file
// parses source with esbuild, and esbuild refuses to start under jsdom. Under
// jsdom `import.meta.url` is also not a file URL, so `fileURLToPath` throws
// before a single assertion runs. There is no DOM here to want jsdom for.
/**
 * REPORTS PAGE MUST NOT CALL THE RETIRED SCHEDULER.
 *
 * `public.report_schedules` was retired on the owner's decision (2026-08-27)
 * and its three endpoints were deleted from `backend/routers/reports.py`:
 *
 *     GET    /api/reports/schedules/{team_id}
 *     POST   /api/reports/schedules/{team_id}
 *     DELETE /api/reports/schedules/{id}
 *
 * ReportsPage called all three. The list call ran on mount of the "Manage
 * schedules" panel, so the panel could only ever render its error state and
 * "Create schedule" could only ever fail — a screen rendering a control that
 * cannot work, which is the fault this file exists to stop coming back.
 *
 * ── Why the source is parsed rather than grepped ────────────────────────────
 *
 * The removal is explained in prose in `ReportsPage.jsx`, and that prose names
 * the dead paths — as it must, or the next reader deletes the only record of
 * why the panel went. A grep over the raw file would be satisfied by its own
 * commentary and would stay green with the calls restored underneath it.
 * `esbuild.transformSync` is a real parser and drops comments, so what is
 * searched here is only what runs.
 *
 * ── Why not a render test ───────────────────────────────────────────────────
 *
 * A render test proves the panel is not mounted TODAY. The call could return
 * behind a flag, a lazy tab, or an effect that fires only after a fetch
 * resolves, and the mounted-render assertion would still pass. The fault is the
 * presence of the call, so the presence of the call is what is asserted.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { transformSync } from 'esbuild';
import { describe, it, expect } from 'vitest';

const SRC = fileURLToPath(new URL('../pages/ReportsPage.jsx', import.meta.url));

/** The page with comments and JSX removed — only what executes. */
const CODE = transformSync(readFileSync(SRC, 'utf8'), { loader: 'jsx' }).code;

/** Every `api.<verb>("<url>" …)` call site, with its URL literal. */
function apiCallUrls(code) {
  const out = [];
  const re = /\bapi\s*\.\s*(get|post|put|patch|delete)\s*\(\s*([`'"])([^`'"]*)\2/g;
  let m;
  while ((m = re.exec(code)) !== null) out.push({ verb: m[1], url: m[3] });
  return out;
}

describe('ReportsPage and the retired report_schedules endpoints', () => {
  it('makes no API call to /reports/schedules', () => {
    const offenders = apiCallUrls(CODE).filter(c => /reports\/schedules/.test(c.url));
    expect(
      offenders.map(c => `api.${c.verb}('${c.url}')`),
      'ReportsPage.jsx calls an endpoint that no longer exists. Scheduling now '
        + 'lives on staging.dristi_scheduled_reports, reached from Dristi → '
        + 'Reports (/dristi?tab=reports). Do not rebuild it on this page.',
    ).toEqual([]);
  });

  /* `hits` rather than `expect(CODE).not.toMatch(…)`: a failed toMatch prints
     the whole subject, and the subject here is a transpiled page. The first run
     of this file against a deliberately reintroduced call buried its own
     message under 1,200 lines of React.createElement. A check nobody can read
     the output of is a check people learn to ignore. */
  const hits = pattern => CODE.match(pattern) || [];

  it('does not name the retired path or table anywhere in executable code', () => {
    // Catches the call that hides behind a const, a helper or a template.
    expect(hits(/reports\/schedules/g)).toEqual([]);
    expect(hits(/report_schedules/g)).toEqual([]);
  });

  it('keeps no leftover state or component from the schedules panel', () => {
    expect(hits(/SchedulesPanel/g)).toEqual([]);
    expect(hits(/showSchedules/g)).toEqual([]);
    // A field unique to the retired create payload.
    expect(hits(/send_hour_utc/g)).toEqual([]);
  });

  /* The other half of the contract. Removing the scheduler must not take the
     on-demand report with it: `/reports/data/{team_id}` feeds the live preview
     and `/reports/download/{team_id}` is the export door behind both buttons.
     Both endpoints remain on the backend, and a "cleanup" that dropped either
     would leave this page with nothing that works at all. */
  it('still calls the on-demand endpoints that were kept', () => {
    const urls = apiCallUrls(CODE).map(c => c.url);
    expect(urls.some(u => u.includes('/reports/data/'))).toBe(true);
    expect(urls.some(u => u.includes('/reports/download/'))).toBe(true);
  });

  /* A feature somebody came looking for must not vanish in silence. The page is
     allowed to say nothing about how the Dristi scheduler works — it holds no
     endpoint that could — but it must point at it, and the pointer has to be in
     the markup rather than in a comment, which is why this runs on parsed code
     like the rest. */
  it('points the reader at where scheduling now lives', () => {
    expect(CODE).toMatch(/\/dristi\?tab=reports/);
  });
});
