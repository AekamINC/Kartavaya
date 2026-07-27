import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { ErrorState, SkeletonCardGrid } from '../../components/ui';
import ModuleCard from './ModuleCard';
import { ORG_MODULES, isModuleActive, moduleEntry } from './catalogue';

/**
 * TabModules — which modules this organisation has.
 *
 * ── Why the toggles are disabled ────────────────────────────────────────────
 * `10-org-settings.md` §4 specifies `GET/PATCH /v1/org/modules` as new work, and
 * it has not been built. What exists is `staging.module_subscriptions`, written
 * by `POST /v1/subscription/modules/activate|deactivate`, which is
 * platform-staff only — module availability is a term of the subscription, not
 * a switch inside the customer's own settings.
 *
 * So the grid reads, and does not write. A switch that accepts a click and
 * stores nothing is worse than one that is absent: it reports success for work
 * that did not happen, and the customer finds out when someone cannot open
 * Vetana on Monday.
 *
 * ── The rule that has to survive whoever builds the endpoint ────────────────
 * Turning a module off must REVOKE grants without deleting data, and turning it
 * back on must restore the previous grants — a soft flag on the module row,
 * never a cascade delete on `org_member_modules`. An admin who switches Vetana
 * off to tidy up and back on ten seconds later must not have destroyed the
 * payroll history or every grant that referenced it.
 */

const Info = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6v.1" />
  </svg>
);

export default function TabModules({ onCount }) {
  const [active, setActive] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    return api.get('/v1/subscription/current')
      .then(r => setActive(r.data.active_modules || []))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // The tab bar's count is how many modules are ACTIVE, which is the list this
  // panel already fetched. Through a ref and keyed on the number: the parent
  // passes an inline arrow, so depending on the callback itself would re-run
  // this on every render of the shell it is reporting to.
  const onCountRef = useRef(onCount);
  onCountRef.current = onCount;
  useEffect(() => { onCountRef.current?.(active.length); }, [active.length]);

  // The twelve grantable modules, plus anything the subscription carries that
  // this catalogue does not list. A module the customer is paying for that
  // renders as nothing is the worst way to be incomplete.
  //
  // A bare `m.code === code` test is enough now. It used to need a
  // `subscriptionCode` comparison beside it, because the catalogue spelled
  // messaging `samvada` and the subscription returned `sanvaad`, so the test
  // found no match and added a second, blurb-less card for the same module.
  // Both say `sanvaad`; the extra comparison is gone with the split.
  const cards = useMemo(() => ([
    ...ORG_MODULES,
    ...active
      .filter(code => !ORG_MODULES.some(m => m.code === code))
      .map(moduleEntry),
  ]), [active]);

  if (loading) return <SkeletonCardGrid count={8} columns={4} />;
  if (failed) {
    return <ErrorState kind="server" detail="Couldn’t load your module subscription." onRetry={() => { setLoading(true); load(); }} />;
  }

  return (
    <div>
      <section className="st__group">
        <p className="opend">
          {Info}
          <span>
            Modules are part of your subscription, so they are switched on by your
            account manager at Aekam rather than here. The switches show what you
            have; they are read-only until <code>PATCH /v1/org/modules</code> exists.
            Granting people access to an active module is on the Members tab.
          </span>
        </p>
      </section>

      <section className="st__group">
        <div className="omod">
          {cards.map(mod => (
            <ModuleCard key={mod.code} mod={mod} active={isModuleActive(mod.code, active)} disabled />
          ))}
        </div>
      </section>

      <section className="st__group">
        <h2 className="st__gt">Sensitive modules</h2>
        <p className="of__h">
          Vetana, Ganit and Manav hold salaries, the organisation’s finances and
          personnel files. They default to no access for everyone, by role rather
          than by opt-out, and every grant on them is deliberate and audited. On
          Vetana and Ganit an <strong>admin</strong> grant does not include
          approval — releasing a payment or closing a period needs its own
          approver grant, so that whoever sets what people are paid is not also
          the one who releases the money.
        </p>
      </section>
    </div>
  );
}
