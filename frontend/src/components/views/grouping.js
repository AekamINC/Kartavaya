/**
 * Ordered group keys (04-boards-table-views.md §3, "lib/grouping.js").
 *
 * The defect: `TableView` built its groups with `Object.entries(groups)`, so
 * "Group by priority" listed them in whatever order rows happened to arrive.
 * A board where the first row is `low` renders Low above Urgent, which reverses
 * the meaning of the control — and `PRIORITY_ORDER` already existed in the same
 * file for sorting; grouping simply did not use it.
 *
 * Insertion order is not merely arbitrary, it is *unstable*: adding one task can
 * reshuffle the whole page. That is the part that reads as a bug rather than a
 * preference.
 *
 * Lives beside the views rather than in `lib/` because the table is its only
 * consumer today; move it when a second one appears.
 */
import { PRIORITY_LABELS, STATUS_LABELS } from '../../lib/statusColors';

/** Worst first — the order the priority control implies but did not produce. */
export const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'];

/** Lifecycle order, not alphabetical. `rejected` is terminal, so it sits last. */
export const STATUS_ORDER = ['todo', 'in_progress', 'in_review', 'requested', 'done', 'rejected'];

/** Sort comparator input for `priority` — the same ranking, as an index. */
export const PRIORITY_RANK = Object.fromEntries(PRIORITY_ORDER.map((p, i) => [p, i]));

const UNGROUPED = '__none__';

/**
 * Bucket `rows` by `keyOf`, emitting groups in `order` and appending any key
 * the order does not mention. An unknown value is real data — a status the
 * client build has not heard of — so it renders at the end rather than being
 * dropped, which is what filtering to the known set would do.
 *
 * @returns {{ key: string, label: string, rows: any[] }[]}
 */
export function groupRows(rows, keyOf, order = [], labelOf = k => k) {
  const buckets = new Map();
  for (const row of rows) {
    const key = keyOf(row) ?? UNGROUPED;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }

  const seen = new Set();
  const out = [];
  for (const key of order) {
    if (buckets.has(key)) {
      seen.add(key);
      out.push({ key, label: labelOf(key), rows: buckets.get(key) });
    }
  }
  for (const [key, group] of buckets) {
    if (seen.has(key)) continue;
    out.push({
      key,
      label: key === UNGROUPED ? 'Ungrouped' : labelOf(key),
      rows: group,
    });
  }
  return out;
}

/**
 * The four groupings the table offers. `column` takes its order from the board
 * itself — that manual sequence is the only ordering in the product that
 * reflects a deliberate human decision, so it is the one grouping whose order
 * must not be invented here.
 */
export function groupTasks(rows, groupBy, columns = []) {
  if (groupBy === 'none') return [{ key: 'all', label: null, rows }];

  if (groupBy === 'column') {
    const names = Object.fromEntries((columns || []).map(c => [c.column_id, c.name]));
    return groupRows(
      rows,
      t => t.column_id,
      (columns || []).map(c => c.column_id),
      id => names[id] || 'Uncategorised',
    );
  }

  if (groupBy === 'status') {
    return groupRows(rows, t => t.status, STATUS_ORDER, k => STATUS_LABELS[k] || k);
  }

  if (groupBy === 'priority') {
    return groupRows(rows, t => t.priority, PRIORITY_ORDER, k => PRIORITY_LABELS[k] || k);
  }

  return [{ key: 'all', label: null, rows }];
}
