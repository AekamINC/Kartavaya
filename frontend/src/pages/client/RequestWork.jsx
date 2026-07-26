/**
 * RequestWork — a client asking their firm for something.
 *
 * `POST /client/tasks/request` (server.py:892) creates the task at status
 * `requested` with an approval row attached, and notifies the project's owners
 * and admins. It refuses any caller whose role is not `client`, and any project
 * the caller is not assigned to — so this form cannot reach past the client's
 * own projects even if the picker were wrong.
 *
 * ── Why this is not `components/NewTaskModal.jsx`
 *
 * That modal already branches on `isClient` and already posts to this same
 * endpoint, so reusing it was the obvious move. It renders an assignee picker
 * regardless:
 *
 *     const isClient = currentUser()?.role === 'client';        // :38
 *     {!isClient && ( … STATUS select … )}                      // :454
 *     {/* Assignee dropdown *\/}                                // :553 — no guard
 *     .then(r => setMembers(Array.isArray(r.data?.members) …))  // :118
 *
 * `GET /teams/{id}` returns the project's full member list, and the dropdown
 * paints every name in it. 19's never-see list names this case exactly: "Other
 * clients — including in an assignee picker, a mention autocomplete, or an
 * error message." The fix belongs in that file, which is outside this change's
 * ownership; it is in the report. Until then the portal does not open it.
 *
 * Four fields, no status, no assignee, no time estimate. A client describes what
 * they need; the firm decides who does it and how long it takes.
 */
import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Field, Input, Modal, Select, Textarea, useToast } from '../../components/ui';

export default function RequestWork({ open, projects, onClose, onCreated }) {
  const { pushToast } = useToast();
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(''); setDetail(''); setBusy(false);
    setProjectId(projects.length === 1 ? projects[0].projectId : '');
  }, [open, projects]);

  const titleEmpty = title.trim().length === 0;
  const noProject = !projectId;
  const blocked = titleEmpty || noProject;

  async function submit() {
    if (blocked) return;
    setBusy(true);
    try {
      await api.post('/client/tasks/request', {
        title: title.trim(),
        description: detail.trim() || null,
        team_id: projectId,
        priority: 'medium',
      });
      pushToast({ type: 'success', title: 'Request sent', message: 'Your team has been notified.' });
      onCreated?.();
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not send the request', message: 'Please try again.' });
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={v => { if (!v) onClose?.(); }} title="Request work" dataTestId="cl-request">
      <div className="cl-form">
        {/* Field's render-prop form, so the control is wired to its own label
            and hint by real ids rather than by hoping they line up. */}
        <Field label="What do you need?" required>
          {({ id, required }) => (
            <Input
              id={id}
              required={required}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="A short line — the team will come back with questions"
            />
          )}
        </Field>

        <Field label="Project" required>
          {({ id, required }) => (
            <Select id={id} required={required} value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value="">Choose a project…</option>
              {projects.map(p => <option key={p.projectId} value={p.projectId}>{p.name}</option>)}
            </Select>
          )}
        </Field>

        <Field label="Anything else" hint="Optional. Dates, amounts, the reason — whatever saves a phone call.">
          {({ id, 'aria-describedby': describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={4}
              value={detail}
              onChange={e => setDetail(e.target.value)}
            />
          )}
        </Field>

        {/* Same rule as Request changes: a disabled control says why. */}
        {blocked && (
          <p className="cl-why">
            {titleEmpty ? 'Add a line saying what you need.' : 'Choose which project this belongs to.'}
          </p>
        )}

        <div className="cl-form__act">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="fill" onClick={submit} disabled={busy || blocked}>
            {busy ? 'Sending…' : 'Send request'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
