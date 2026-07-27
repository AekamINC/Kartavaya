/**
 * useSanvaadAccess.js — the caller's own level on this module.
 *
 * `MESSAGING-ATTENDANCE-SPEC.md:73`: "viewer reads channels, editor sends
 * messages, admin manages channels". `ScreensSanvaad.jsx:286-294` is what that
 * looks like — a composer replaced by a locked bar reading "Your Sanvaad access
 * is **Viewer**: you can read every channel you are a member of, but not send",
 * with a `Request Editor` button.
 *
 * None of it was buildable. `GET /v1/me` returns `module_grants[]`, which is a
 * list of module CODES — it answers whether Messaging belongs in the sidebar and
 * says nothing about depth. There was no other permission feed in `frontend/src`
 * at all: no `usePermissions`, no `can()`, no `my_role`. So the client could not
 * tell a viewer from an editor, and the server did not care either, which is why
 * the level had no effect anywhere.
 *
 * `GET /v1/messaging/me` is the narrow answer: this module's level and the two
 * booleans derived from it.
 *
 * **Fails closed on the module gate, open on everything else.** A 403 here is
 * the subscription/grant gate and means genuinely no access, so posting is
 * refused. Any other failure — offline, 500, a timeout — leaves `canPost` true:
 * the server is the authority and refuses the send itself, and locking the
 * composer because a side request failed would take the module away from an
 * editor over a blip.
 */
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function useSanvaadAccess() {
  const [state, setState] = useState({ level: null, canPost: true, canManage: false, loading: true });

  useEffect(() => {
    let dead = false;
    api.get('/v1/messaging/me')
      .then(r => {
        if (dead) return;
        setState({
          level: r.data?.level || null,
          canPost: r.data?.can_post !== false,
          canManage: !!r.data?.can_manage,
          loading: false,
        });
      })
      .catch(e => {
        if (dead) return;
        const denied = e?.response?.status === 403;
        setState({ level: denied ? 'viewer' : null, canPost: !denied, canManage: false, loading: false });
      });
    return () => { dead = true; };
  }, []);

  return state;
}
