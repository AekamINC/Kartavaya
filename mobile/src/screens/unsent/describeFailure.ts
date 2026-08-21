/**
 * Turning a dead-letter entry into something a person can read.
 * ─────────────────────────────────────────────────────────────
 *
 * `getFailedMutations()` returns the raw write: a method, a URL, and whatever
 * JSON was going to be posted. None of those three is a thing anybody typed.
 * `POST /api/v1/ganit/invoices` is the app talking to itself; the user made an
 * invoice for Sharma & Co, and that is the only description of it they can
 * recognise, act on, or re-enter.
 *
 * So this module answers three questions and the screen renders the answers:
 *
 *   1. WHAT WAS IT?     `describeMutation` — a noun and, where the payload
 *                       actually carries one, a name.
 *   2. WHY IS IT HERE?  `failureReason` — one of the three ways the queue gives
 *                       up, said plainly, with what the person can do.
 *   3. GET IT OUT.      `exportText` — the whole payload as prose, so nothing a
 *                       user typed is trapped behind a Discard button.
 *
 * ── Honesty rules, in order of how easy they are to break ────────────────────
 *
 * NEVER INVENT A NAME. Half these writes carry no name at all — a swipe-to-
 * complete is `{ status: 'done' }` against a task id, and the title of that task
 * lives on a server this device cannot reach. The honest output is "A task
 * marked done", not a guess and not `t_a91f`. `named` says which of the two
 * happened so the screen can style them differently, and so a test can assert
 * that the unnamed case is still a sentence.
 *
 * NEVER RENDER AN ID. `decision_names_not_ids` is an owner ruling and it applies
 * to a recovery screen exactly as it applies to a table. Every UUID-shaped value
 * in a payload is replaced by `(id hidden)`; a list of them becomes a count. The
 * user loses nothing by it, because a UUID was never going to help them re-enter
 * anything, and the field itself is still listed so they can see it existed.
 *
 * NEVER PRINT JSON. Not in the card and not in the export. A brace is the app
 * failing to explain itself. Every key is rendered with a human label — from the
 * table below where there is one, and de-underscored otherwise, so a field added
 * to some payload next year still comes out as words rather than being silently
 * dropped. Dropping is the worse failure of the two: this is the last copy.
 *
 * NEVER READ THE URL OUT LOUD. The route table is how the URL becomes a noun,
 * and the fallback at the end of it is a noun too. If a shape lands here that
 * nothing recognises, the user is told "Something you created" — vague, but true,
 * and the payload underneath it is still fully rendered.
 *
 * ── Why this is a .ts file and not part of the screen ────────────────────────
 *
 * `mobile/`'s suite is `node --test` with type-stripping and no JSX transform,
 * so no `.tsx` can be imported by a test at all — see `src/test/register.mjs`.
 * Every decision worth asserting therefore lives here, where it can be exercised
 * for real, and `UnsentScreen.tsx` is left holding only layout.
 */

import type { FailedMutation, MutationQueueItem } from '../../api/types';

// ── Shapes ────────────────────────────────────────────────────────────────────

/** One `label: value` line, already formatted for display. */
export interface DescribedField {
  label: string;
  value: string;
}

export interface MutationDescription {
  /** The noun. "Task", "Message", "Deal" — never a URL, never a method. */
  kind: string;
  /** One line naming the thing, as close to the user's words as the payload allows. */
  title: string;
  /** True when the payload genuinely named the record, false when `title` is a description of it. */
  named: boolean;
  /** What was being done to it. */
  action: 'Created' | 'Changed' | 'Deleted';
  /** Everything the payload carried, in the order it carried it. */
  fields: DescribedField[];
}

export interface ReasonCopy {
  /** Four or five words, for the pill at the top of the card. */
  badge: string;
  /** The sentence that says what happened. */
  headline: string;
  /** Why it happened, in terms of the mechanism rather than the code. */
  meaning: string;
  /** What the person should do now. */
  whatNow: string;
  /**
   * True when re-sending this exact payload is a thing that could work.
   *
   * NOT the same question as `reason !== 'expired'` — see `canRetryFailed` in
   * `offline/mutationQueue.ts`, which is the single authority and which this
   * mirrors rather than restates. An exhausted POST that has since aged past the
   * six-day ceiling is unretryable for the ceiling's reason, not for its own.
   */
  retryable: boolean;
  /** Present when retry is offered but comes with a warning worth reading first. */
  retryCaveat?: string;
}

// ── Small formatters ──────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `2026-09-05T16:00:00+05:30` → `5 Sep 2026, 16:00`.
 *
 * Hand-rolled rather than `toLocaleString`. Hermes on Android ships without full
 * ICU unless the build opts in, so a locale-aware call is one of the few things
 * that renders differently on a phone than it does anywhere it was tested —
 * `NewTaskSheet` avoids Intl for the same reason when it computes an IST due
 * date. This also makes the output assertable in a test without a timezone
 * making the assertion flaky.
 */
export function formatWhen(iso: string, withTime = true): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  if (!withTime) return date;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${date}, ${hh}:${mm}`;
}

/** A value that is a bare date with no time of day. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_STAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/**
 * UUID, any version.
 *
 * Everything matching this is withheld from the UI. It over-matches on purpose:
 * a task id or a deal id is not a user, member or org id and the owner ruling
 * does not cover it — but it is equally useless to a person trying to retype
 * what they lost, and the cost of hiding it is nothing while the cost of leaking
 * a member id is a rule broken.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cut long prose to something that fits a line, without cutting mid-word. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd() + '…';
}

const quote = (text: string) => `“${text}”`;

// ── Field labels ──────────────────────────────────────────────────────────────

/**
 * Human names for the keys this app actually queues.
 *
 * Deliberately not exhaustive, and the fallback is what makes that safe:
 * anything missing here still gets rendered, as its own key with the underscores
 * taken out. A missing entry costs a slightly clumsy label; a missing FIELD
 * would cost the user the thing they typed.
 */
const FIELD_LABELS: Record<string, string> = {
  amount:            'Amount',
  assignee_user_ids: 'Assigned to',
  attachments:       'Attachments',
  client_id:         'Client',
  close_date:        'Expected close',
  company:           'Company',
  content:           'Message',
  currency:          'Currency',
  description:       'Description',
  designation:       'Designation',
  due_at:            'Due',
  email:             'Email',
  is_primary:        'Primary contact',
  muted:             'Notifications',
  name:              'Name',
  notes:             'Notes',
  parent_message_id: 'Replying to',
  phone:             'Phone',
  priority:          'Priority',
  probability:       'Probability',
  stage:             'Stage',
  status:            'Status',
  team_id:           'Project',
  title:             'Title',
  type:              'Kind',
  value:             'Value',
};

/** `assignee_user_ids` → `Assignee user`. The last resort, never a bare key. */
function humanKey(key: string): string {
  const words = key.replace(/_ids?$/, '').replace(/_/g, ' ').trim();
  if (!words) return key;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? humanKey(key);
}

/**
 * One payload value, as text.
 *
 * The three cases that matter: an id is withheld, a list of ids becomes a count
 * (nobody can act on eight UUIDs, and everybody can act on "8 people"), and a
 * list of attachments gives up its filenames, which are the one part of an
 * upload the user chose.
 */
export function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return 'cleared';

  if (typeof value === 'boolean') {
    if (key === 'muted') return value ? 'muted' : 'unmuted';
    return value ? 'yes' : 'no';
  }

  if (typeof value === 'number') return String(value);

  if (typeof value === 'string') {
    if (value === '') return 'empty';
    if (UUID.test(value)) return '(id hidden)';
    if (DATE_ONLY.test(value)) return formatWhen(value + 'T00:00:00', false);
    if (ISO_STAMP.test(value)) return formatWhen(value);
    return clip(value, 240);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return 'none';
    // Attachments and anything else object-shaped that carries a name.
    const names = value
      .map(v => (v && typeof v === 'object' ? (v as { name?: unknown }).name : undefined))
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
    if (names.length === value.length) {
      return `${value.length} — ${names.map(n => clip(n, 40)).join(', ')}`;
    }
    const noun = key === 'assignee_user_ids' ? 'person' : 'item';
    const plural = key === 'assignee_user_ids' ? 'people' : 'items';
    return value.length === 1 ? `1 ${noun}` : `${value.length} ${plural}`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) return 'nothing';
    return keys.map(fieldLabel).join(', ');
  }

  return String(value);
}

/** Every top-level key of the body, labelled and formatted. Nothing is skipped. */
export function describeFields(body: unknown): DescribedField[] {
  if (body === null || body === undefined) return [];
  if (typeof body !== 'object' || Array.isArray(body)) {
    return [{ label: 'Content', value: formatValue('content', body) }];
  }
  const out: DescribedField[] = [];
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (value === undefined) continue;
    out.push({ label: fieldLabel(key), value: formatValue(key, value) });
  }
  return out;
}

// ── What was it? ──────────────────────────────────────────────────────────────

/** Keys that, when present, hold something the user actually typed. */
const SUBJECT_KEYS = ['title', 'name', 'full_name', 'subject', 'content', 'text', 'message'];

function subjectOf(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const rec = body as Record<string, unknown>;
  for (const key of SUBJECT_KEYS) {
    const v = rec[key];
    if (typeof v === 'string' && v.trim() !== '' && !UUID.test(v)) return clip(v, 80);
  }
  return null;
}

/** Path without a query string, so a route match cannot be defeated by `?x=1`. */
function pathOf(url: string): string {
  const cut = url.split('?')[0].split('#')[0];
  return cut.length > 1 && cut.endsWith('/') ? cut.slice(0, -1) : cut;
}

function defaultAction(method: string): MutationDescription['action'] {
  if (method === 'POST') return 'Created';
  if (method === 'DELETE') return 'Deleted';
  return 'Changed';
}

/**
 * The route table: the one place a URL is allowed to be looked at.
 *
 * Ordered most specific first. Everything falls through to a method-shaped
 * sentence rather than to the URL — a screen that prints a path has given up on
 * explaining itself, and the payload below it is still complete either way.
 */
export function describeMutation(item: MutationQueueItem): MutationDescription {
  const path = pathOf(item.url);
  const method = (item.method ?? '').toUpperCase();
  const subject = subjectOf(item.body);
  const fields = describeFields(item.body);

  const named = (kind: string, title: string, action?: MutationDescription['action']): MutationDescription =>
    ({ kind, title, named: true, action: action ?? defaultAction(method), fields });
  const anon = (kind: string, title: string, action?: MutationDescription['action']): MutationDescription =>
    ({ kind, title, named: false, action: action ?? defaultAction(method), fields });

  // ── Sanvaad ──
  if (/\/messaging\/channels\/[^/]+\/messages$/.test(path) && method === 'POST') {
    return subject
      ? named('Message', `Message you wrote — ${quote(subject)}`)
      : anon('Message', 'A message you wrote');
  }
  if (/\/messaging\/messages\/[^/]+\/pin$/.test(path)) {
    return method === 'DELETE'
      ? anon('Message', 'Unpinning a message', 'Changed')
      : anon('Message', 'Pinning a message', 'Changed');
  }
  if (/\/messaging\/channels\/[^/]+\/mute$/.test(path)) {
    const muted = (item.body as { muted?: unknown } | null)?.muted;
    return anon(
      'Channel',
      muted === false
        ? 'Turning notifications back on for a conversation'
        : 'Muting notifications for a conversation',
      'Changed',
    );
  }

  // ── Graha (CRM) ──
  if (/\/graha\/follow-ups\/[^/]+\/complete$/.test(path)) {
    return anon('Follow-up', 'A follow-up ticked off', 'Changed');
  }
  if (/\/graha\/deals\/[^/]+$/.test(path)) {
    const stage = (item.body as { stage?: unknown } | null)?.stage;
    if (typeof stage === 'string' && Object.keys(item.body as object).length === 1) {
      return anon('Deal', `A deal moved to ${stage}`, 'Changed');
    }
    return subject
      ? named('Deal', `Changes to the deal ${quote(subject)}`, 'Changed')
      : anon('Deal', 'Changes to a deal', 'Changed');
  }
  if (/\/graha\/contacts\/[^/]+$/.test(path)) {
    return subject
      ? named('Contact', `Changes to the contact ${quote(subject)}`, 'Changed')
      : anon('Contact', 'Changes to a contact', 'Changed');
  }

  // ── Vikray (sales) ──
  if (/\/vikray\/orders\/from-deal\/[^/]+$/.test(path)) {
    return anon('Sales order', 'A sales order raised from a won deal', 'Created');
  }

  // ── Tasks ──
  if (/\/client\/tasks\/request$/.test(path) && method === 'POST') {
    return subject
      ? named('Task request', `Task you asked for — ${quote(subject)}`)
      : anon('Task request', 'A task you asked for');
  }
  if (/\/tasks$/.test(path) && method === 'POST') {
    return subject
      ? named('Task', `New task — ${quote(subject)}`)
      : anon('Task', 'A new task');
  }
  if (/\/tasks\/[^/]+$/.test(path)) {
    if (method === 'DELETE') return anon('Task', 'Deleting a task', 'Deleted');
    const body = (item.body ?? {}) as Record<string, unknown>;
    const keys = Object.keys(body);
    if (keys.length === 1 && typeof body.status === 'string') {
      return anon('Task', `A task marked ${body.status}`, 'Changed');
    }
    return subject
      ? named('Task', `Changes to the task ${quote(subject)}`, 'Changed')
      : anon('Task', 'Changes to a task', 'Changed');
  }

  // ── Nothing recognised it ──
  //
  // Still a sentence. The entity_type is used if the caller supplied one,
  // because "A graha deal you created" is worse than "A deal" but far better
  // than a path, and it costs nothing to try.
  const kind = item.entity_type ? humanKey(item.entity_type) : 'Change';
  if (method === 'POST') {
    return subject
      ? named(kind, `Something you created — ${quote(subject)}`)
      : anon(kind, 'Something you created');
  }
  if (method === 'DELETE') return anon(kind, 'Something you deleted', 'Deleted');
  return subject
    ? named(kind, `A change you made — ${quote(subject)}`, 'Changed')
    : anon(kind, 'A change you made', 'Changed');
}

// ── Why is it here? ───────────────────────────────────────────────────────────

/**
 * The three ways the queue gives up, said in the words that tell someone what to
 * do next.
 *
 * `retryable` is passed IN rather than derived from `reason`, because the
 * decision belongs to `offline/mutationQueue.ts` — the six-day ceiling is its
 * constant and its predicate, and a second copy of that rule here would drift
 * from the first one silently. See `canRetryFailed`.
 */
export function failureReason(entry: FailedMutation, retryable: boolean): ReasonCopy {
  const create = entry.item.method === 'POST';

  if (entry.reason === 'expired') {
    return {
      badge: 'Too old to send',
      headline: 'This can no longer be sent safely.',
      meaning:
        'It waited more than six days without getting through. The safeguard that '
        + 'stops one entry becoming two only lasts seven days on the server, and this '
        + 'has outlived it.',
      whatNow:
        'Copy the details out and enter it again in the app, then discard this one. '
        + 'There is no Retry here on purpose: sending it now would go out with no '
        + 'protection, and if the original did reach the server you would end up with two.',
      retryable: false,
    };
  }

  if (entry.reason === 'rejected') {
    return {
      badge: 'Refused by the server',
      headline: 'The server reached a decision, and it was no.',
      meaning:
        'This got through and came back refused — a missing field, a permission, or '
        + 'a record that has since changed. Sending the same thing again unchanged '
        + 'gets the same answer.',
      whatNow: retryable
        ? 'Copy the details out and enter it again with the problem fixed. Try again '
          + 'only if the reason has changed since — you have signed in again, or '
          + 'someone has given you access.'
        : 'Copy the details out and enter it again with the problem fixed.',
      retryable,
      retryCaveat: retryable
        ? 'Unchanged, this will almost certainly be refused a second time.'
        : undefined,
    };
  }

  // exhausted
  return {
    badge: 'Ran out of attempts',
    headline: 'It never reached the server.',
    meaning:
      'Tried four times — once, then three retries — and the connection failed every '
      + 'time. That usually means the network, not anything wrong with what you entered.',
    whatNow: retryable
      ? 'Try again. If it fails again, copy the details out before you discard it.'
      : create
        ? 'It has since passed the six-day limit, so it can no longer be sent. Copy the '
          + 'details out and enter it again.'
        : 'Copy the details out before you discard it.',
    retryable,
  };
}

// ── Get it out ────────────────────────────────────────────────────────────────

/**
 * The whole entry as plain prose, for the clipboard.
 *
 * Prose and not JSON, and that is the deliberate part. The person reaching for
 * this is about to retype what they lost into a form, on a phone, possibly to
 * paste it into WhatsApp for a colleague to enter. Braces and quoted keys serve
 * neither. Every field is present, so nothing is trapped; no id is present, so
 * nothing is leaked.
 */
export function exportText(entry: FailedMutation, retryable: boolean): string {
  const d = describeMutation(entry.item);
  const why = failureReason(entry, retryable);

  const lines: string[] = [];
  lines.push('Kartavaya — a change that could not be sent');
  lines.push('');
  lines.push(`What it was:  ${d.title}`);
  lines.push(`Made:         ${formatWhen(entry.item.created_at)}`);
  lines.push(`Given up on:  ${formatWhen(entry.failed_at)}`);
  lines.push(`Why:          ${why.badge} — ${why.headline}`);
  if (entry.error && entry.error !== why.headline) {
    lines.push(`The server said: ${entry.error}`);
  }

  if (d.fields.length > 0) {
    lines.push('');
    lines.push('What you entered:');
    const width = Math.max(...d.fields.map(f => f.label.length));
    for (const f of d.fields) {
      lines.push(`  ${f.label.padEnd(width)}  ${f.value}`);
    }
  } else {
    lines.push('');
    lines.push('This write carried no details of its own — it was the action itself.');
  }

  return lines.join('\n');
}
