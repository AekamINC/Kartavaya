/**
 * The task state machine, mirrored for the client.
 *
 * The authority is `backend/services/task_transitions.py`. This file exists so
 * the UI can stop OFFERING a value the server refuses, not so it can decide
 * anything — every rule here is enforced again on the server, and where the two
 * disagree the server wins and this file is the bug.
 *
 * THE MIRROR IS CHECKED, NOT TRUSTED.
 * `backend/tests/test_task_transitions.py::TestVocabulary
 * ::test_the_frontend_mirror_lists_the_same_five` parses the TASK_STATUSES array
 * below and asserts it equals the Python tuple. A status added on one side and
 * forgotten on the other fails pytest rather than shipping a menu whose options
 * 400. Keep the array a flat list of single-quoted literals — that is what the
 * check reads.
 *
 * WHO IMPORTS THIS. `SETTABLE_STATUSES` is the vocabulary of every menu that
 * WRITES a status — `components/views/BulkBar.jsx` and
 * `components/drawer/DrawerMeta.jsx` — and `GATED_STATUS` names the state
 * `PolicyPanel` describes. That was not true when this file was written: it was
 * imported by its own test and by nothing that offered a status, so the mirror
 * was correct and connected to nothing while BulkBar built its "Set status" menu
 * from all six keys of `STATUS_LABELS` and DrawerMeta from a hand-written three
 * that omitted `in_review`. `__tests__/statusMenus.test.jsx` opens the menu and
 * reads the rows, so the wiring cannot quietly come undone again.
 *
 * FIVE, NOT SIX. `statusColors.js` still carries a sixth key, `rejected`, with
 * a colour and the label "Declined", and it KEEPS them: that map is for DISPLAY,
 * and a row already carrying an odd value must render as a word rather than as a
 * raw enum. What no menu may do is offer it as something to set. Measured
 * against the live database on 2026-08-06: `rejected` 0 rows, and the only four
 * statuses in existence are done 319 / todo 193 / in_progress 67 / in_review 54.
 *
 * `rejected` as a TASK status is retired. Rejection is real, but it lives on
 * `approval_status`, which is a different field with its own colour map
 * (APPROVAL_COLORS) and its own mandatory-reason dialog.
 *
 * `requested` is real and is NOT on the line. It means "a client asked for this
 * task to exist and nobody has approved it into being" — the request form
 * inserts it, and DECLINING THE REQUEST DELETES THE ROW. It is not the
 * blueprint's "changes requested"; that is an approver bouncing work back, and
 * it is `approval_status='rejected'`. Two meanings, one word, and only one of
 * them is in this build.
 */

/** Every value `tasks.status` may hold. Checked against Python — see docblock. */
export const TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'done', 'requested'];

/** The ordered pipeline. Every edge between two of these is legal both ways. */
export const LINE = ['todo', 'in_progress', 'in_review', 'done'];

/**
 * What a person may put a task into — the ONLY list a status menu may be built
 * from. `requested` is absent deliberately: it is written only by the client
 * request form and cleared only by an approval decision, and declining that
 * decision runs `DELETE FROM tasks WHERE task_id=$1 AND status='requested'`, so
 * a task set to it by hand is destroyed by an unrelated approval.
 */
export const SETTABLE_STATUSES = LINE;

/** The state the approval requirement guards. */
export const GATED_STATUS = 'done';

/** True if the server would accept this as a caller-set status. */
export const isSettableStatus = (s) => SETTABLE_STATUSES.includes(s);

/**
 * Would this move need an approver on a project that requires approval?
 *
 * The gate is on the DESTINATION, not on one edge: `todo → done` skips the
 * review just as thoroughly as `in_review → done` does, so both are gated and
 * everything below `done` is free.
 */
export const needsApproval = (from, to) => to === GATED_STATUS && from !== GATED_STATUS;
