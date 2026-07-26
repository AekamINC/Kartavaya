/**
 * useClientPortal — the portal's one fetch.
 *
 * Three views share it (Overview, Approvals, Files) because they are three
 * readings of the same two payloads, and a client on a phone should not pay for
 * the same round trip three times.
 *
 * Everything crosses `clientShape.js` before it is returned. The hook exposes
 * no raw row.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { currentUser } from '../../lib/auth';
import { errorKind } from '../../components/ui';
import { toClientApprovals, toClientProjects, toClientTasks, toFirm } from './clientShape';

const EMPTY_FIRM = { name: '', logoUrl: '' };

export default function useClientPortal() {
  const me = currentUser();
  const meId = me?.user_id;

  const [firm, setFirm] = useState(EMPTY_FIRM);
  const [tasks, setTasks] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState(null);
  const settled = useRef(false);

  /**
   * `loading` is the FIRST load only. A refresh after an approval must not swap
   * the screen for a spinner: doing so unmounts `ClientApprovals`, and with it
   * the written record of the decision the client just made — which is the one
   * thing 19 says has to stay on screen. Subsequent loads repaint in place.
   */
  const load = useCallback(async () => {
    if (!settled.current) setLoading(true);
    try {
      // The firm's identity is a nicety; the work is the page. A client whose
      // org row is unreachable — /v1/org/profile resolves an org from the
      // caller's membership, and a portal-only account may have none — gets the
      // portal without a wordmark rather than an error screen.
      const [taskRes, apprRes, projRes, firmRes] = await Promise.all([
        api.get('/client/tasks'),
        api.get('/client/approvals'),
        api.get('/client/projects').catch(() => ({ data: [] })),
        api.get('/v1/org/profile').catch(() => ({ data: null })),
      ]);

      const shaped = toClientTasks(taskRes.data, meId);
      const byId = Object.fromEntries(shaped.map(t => [t.taskId, t]));

      setTasks(shaped);
      setApprovals(toClientApprovals(apprRes.data, byId));
      // Through `clientShape` like everything else, rather than mapped inline:
      // the module's thesis is that there is ONE place that decides which keys
      // of a client payload the portal reads, and a second mapping here is
      // exactly the drift it exists to prevent.
      setProjects(toClientProjects(projRes.data));
      setFirm(firmRes.data ? toFirm(firmRes.data) : EMPTY_FIRM);
      setFailure(null);
    } catch (err) {
      setFailure(errorKind(err));
    } finally {
      settled.current = true;
      setLoading(false);
    }
  }, [meId]);

  useEffect(() => { load(); }, [load]);

  return { me, meId, firm, tasks, approvals, projects, loading, failure, reload: load };
}
