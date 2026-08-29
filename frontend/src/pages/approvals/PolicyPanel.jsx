import React, { useCallback, useEffect, useState } from 'react';
import { api, body as asBody } from '../../lib/api';
import { Card, CardHead, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonText } from '../../components/ui/Skeleton';
import { Toggle } from '../../components/ui/Toggle';
import { useToast } from '../../components/ui/toast';
import { GATED_STATUS } from './transitions';
import { apiErrorText } from '../../lib/apiError';

/**
 * WHICH PROJECTS REQUIRE AN APPROVER BEFORE WORK IS MARKED DONE.
 *
 * This is the switch behind `services/task_transitions.assert_transition`. It
 * exists because the alternative was shipping the gate with no way to turn it
 * on — the column would be added by migration 117, read on every task write,
 * and left FALSE forever. `tasks.requires_approval`, the thing being replaced,
 * was exactly that: a column four code paths read, no code path wrote, and no
 * screen could change, reporting `false` to every client since 2024.
 *
 * THREE STATES, AND TWO OF THEM ARE THE POINT (the `TabSenders` precedent):
 *
 *  · MIGRATION NOT APPLIED. There is one database and production writes to it,
 *    so nothing in this repo applies its own DDL — `available:false` is the
 *    state this panel will be in on the day it ships. It names the migration
 *    and renders NO switch. A toggle that flips and changes nothing is the
 *    defect this whole change exists to stop repeating.
 *
 *  · THE FETCH FAILED. Recorded in state and rendered by ErrorState, not
 *    swallowed into a toast that leaves an empty list behind. An empty list
 *    here reads as "no project requires approval", which is a statement about
 *    policy — the most expensive kind of thing to guess at.
 *
 * OPTIMISTIC, WITH A REAL ROLLBACK. The switch moves immediately because a
 * control that lags feels broken, but a failed PATCH puts it back and says why.
 * The server's sentence is shown verbatim: `assert_transition`, this route and
 * the approve/reject routes all answer with a plain-string `detail` precisely so
 * the client needs ONE refusal path instead of two.
 */
export default function PolicyPanel() {
  const { pushToast } = useToast();
  const [projects, setProjects] = useState([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/approvals/policy');
      const data = asBody(r) || {};
      setAvailable(data.available !== false);
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch (e) {
      setError(errorKind(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setPolicy = async (teamId, next) => {
    const before = projects;
    setProjects(p => p.map(x => (x.team_id === teamId ? { ...x, requires_approval: next } : x)));
    setSaving(s => ({ ...s, [teamId]: true }));
    try {
      await api.patch(`/approvals/policy/${teamId}`, { requires_approval: next });
      pushToast({
        type: 'success',
        title: next ? 'Approval now required' : 'Approval no longer required',
      });
    } catch (e) {
      setProjects(before);
      pushToast({
        type: 'error',
        title: 'Could not change the setting',
        message: apiErrorText(e, 'Nothing was changed. Try again.'),
      });
    } finally {
      setSaving(s => { const n = { ...s }; delete n[teamId]; return n; });
    }
  };

  return (
    <Card>
      <CardHead
        title="Projects that require approval"
        sanskrit="अनुमोदन आवश्यक"
      />
      <CardBody flush>
        <p className="apv-policy__lede">
          With this on, only a project owner or admin can move a task to{' '}
          <strong>{GATED_STATUS === 'done' ? 'Done' : GATED_STATUS}</strong>. Everyone
          keeps working the board as normal up to that point — To do, In progress
          and In review are unaffected.
        </p>

        {loading && (
          <div className="apv-row" aria-busy="true" aria-label="Loading approval settings">
            <div className="apv-row__main">
              <div className="apv-row__body">
                <SkeletonText width="45%" height={14} />
                <SkeletonText width="70%" height={11} />
              </div>
            </div>
          </div>
        )}

        {!loading && error && <ErrorState kind={error} onRetry={load} />}

        {/* Not applied yet. Say which migration, the way TabSenders does, so
            this reads as a deployment step and not as a broken screen. */}
        {!loading && !error && !available && (
          <div className="note note--warn" role="status">
            <b>This setting is not switched on for this database yet.</b>{' '}
            Migration <code>117_project_requires_approval.sql</code> adds it. Until it
            is applied, every project behaves exactly as it does today and no task
            is gated.
          </div>
        )}

        {!loading && !error && available && projects.length === 0 && (
          <EmptyState
            title={{ en: 'No projects you can set this on', hi: 'कोई परियोजना नहीं' }}
            description="You need to be an owner or admin of a project to change its approval requirement."
          />
        )}

        {!loading && !error && available && projects.map(p => (
          <div className="apv-row apv-policy__row" key={p.team_id}>
            <div className="apv-row__main">
              <div className="apv-row__body">
                <div className="apv-row__t">{p.name || 'An unnamed project'}</div>
                <div className="apv-row__meta">
                  {p.requires_approval
                    ? 'An owner or admin must approve before a task is done.'
                    : 'Anyone on the project can mark a task done.'}
                </div>
              </div>
            </div>
            <div className="apv-row__actions">
              <Toggle
                checked={!!p.requires_approval}
                disabled={!!saving[p.team_id]}
                label={`Require approval on ${p.name || 'An unnamed project'}`}
                onChange={next => setPolicy(p.team_id, next)}
              />
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
