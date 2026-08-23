import React from 'react';
import { Table, TableHead, TableBody, Row, Cell, HeadCell } from '../../components/ui';
import { inr } from '../../lib/inr';
import useColumnPrefs from '../../hooks/useColumnPrefs';
import { ColumnsButton } from '../../components/ui/CustomizeColumns';

/**
 * OrgTable — the cross-org list. 11-platform-admin.md §1 "Cross-org table".
 *
 * DEVIATION, stated: 11 specifies a `.aot` class with its own sticky header,
 * uppercase label row, mono numeric column and row hover. `.tbl` (02 §1)
 * already carries every one of those, so this uses `.tbl` and `styles/admin.css`
 * adds only what `.tbl` lacks — the clickable-row cursor and the suspended-org
 * treatment `.aot__sus` described. Shipping `.aot` would have made it the ninth
 * table implementation in a codebase whose stated problem is that it has eight.
 *
 * Sorting is `Table`'s three-state sort (asc → desc → none), so "the order the
 * server sent" is reachable again — which for orgs is newest-first, the only
 * order that means anything on a list you scan for the account you just made.
 */

export const ORG_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'paid', label: 'Paying' },
  { id: 'free', label: 'Free' },
];

/**
 * What the cross-org table HAS, declared once — the floor `useColumnPrefs`
 * resolves a saved arrangement against.
 *
 * `fixed` on Organisation: it is the only cell that says WHICH org a row is,
 * and every other column is a number that means nothing without it. There is no
 * actions column here — the whole row is the action (click opens the slide-over)
 * — so Organisation is the single pin.
 *
 * Pahchan is gated on the payload rather than declared `defaultHidden`: 07 §7
 * says Aekam sees the count only where the aggregate is actually returned, and
 * that is a permission fact, not a preference. It is filtered out of the base
 * below so a saved arrangement can never resurrect a column the payload has no
 * number for.
 */
export const ORG_COLUMNS = [
  { id: 'name', label: 'Organisation', sortKey: 'name', fixed: true },
  { id: 'plan', label: 'Plan', sortKey: 'plan' },
  { id: 'credits', label: 'Credits', sortKey: 'credits', num: true },
  { id: 'price', label: 'Monthly', sortKey: 'price', num: true },
  { id: 'storage', label: 'Storage', sortKey: 'storage', num: true },
  { id: 'pahchan', label: 'Pahchan', sortKey: 'pahchan', num: true },
  { id: 'status', label: 'Status' },
];

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (!n) return '0 B';
  const gb = n / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = n / 1024 ** 2;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

const val = (org, key) => {
  switch (key) {
    case 'name': return String(org.name || '').toLowerCase();
    case 'plan': return String(org.plan_code || '').toLowerCase();
    case 'price': return Number(org.monthly_price) || 0;
    case 'credits': return Number(org.monthly_credits) || 0;
    case 'storage': return Number(org.storage_used_bytes) || 0;
    case 'pahchan': return Number(org.pahchan_active_users) || 0;
    default: return 0;
  }
};

/** Search, filter and sort in one place so the count under the table is the
 *  count of what is actually rendered rather than of what was fetched. */
export function selectOrgs(orgs, { q = '', filter = 'all', sort = null } = {}) {
  const needle = q.trim().toLowerCase();
  let out = orgs.filter((o) => {
    if (filter === 'active' && !o.is_active) return false;
    if (filter === 'suspended' && o.is_active) return false;
    if (filter === 'free' && o.plan_code && o.plan_code !== 'free') return false;
    if (filter === 'paid' && (!o.plan_code || o.plan_code === 'free')) return false;
    if (!needle) return true;
    // The owner's EMAIL was in this haystack and is no longer returned by the
    // API. The ids stay: this is a search input, not a rendered column, and
    // support pasting an id from a log to find the org is the one place an id
    // is genuinely the fastest handle.
    return [o.name, o.owner_name, o.plan_name, o.team_id, o.id]
      .some(f => String(f || '').toLowerCase().includes(needle));
  });

  if (sort) {
    const dir = sort.dir === 'descending' ? -1 : 1;
    out = [...out].sort((a, b) => {
      const x = val(a, sort.key); const y = val(b, sort.key);
      if (x < y) return -1 * dir;
      if (x > y) return 1 * dir;
      return 0;
    });
  }
  return out;
}

export default function OrgTable({ orgs, sort, onSort, onSelect, showPahchan }) {
  // Filtered, not conditionally declared: the hook keys its reconcile on the id
  // LIST, so dropping Pahchan from the base is enough to keep it out of the
  // arrangement entirely for an org whose payload carries no aggregate.
  const base = React.useMemo(
    () => (showPahchan ? ORG_COLUMNS : ORG_COLUMNS.filter(c => c.id !== 'pahchan')),
    [showPahchan],
  );
  const cols = useColumnPrefs('admin.orgs', base);

  return (
    <>
      {/* This component is handed no toolbar by its caller, so the control goes
          in the trailing action bar directly above the table — the one place a
          user looking at the columns will look for them. */}
      <div className="tbl__abar">
        <ColumnsButton cols={cols} />
      </div>
      <Table className="adm-rows">
        <TableHead>
          {cols.columns.map(c => (
            <HeadCell
              key={c.id}
              sortKey={c.sortKey}
              sort={sort}
              onSort={c.sortKey ? onSort : undefined}
              num={c.num}
              width={c.width}
              onResize={w => cols.setWidth(c.id, w)}
            >
              {c.label}
            </HeadCell>
          ))}
        </TableHead>
        <TableBody>
          {orgs.map(org => (
            <Row
              key={org.id}
              className={org.is_active ? undefined : 'adm-sus'}
              tabIndex={0}
              onClick={() => onSelect?.(org)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(org); } }}
            >
              {cols.cells({
                name: (
                  <Cell>
                    <span className="adm-name">
                      <span className="adm-name__c">
                        <b>{org.name || 'Unnamed'}</b>
                        <i>{org.owner_name || 'No owner'}</i>
                      </span>
                    </span>
                  </Cell>
                ),
                plan: <Cell>{org.plan_name || org.plan_code || '—'}</Cell>,
                credits: <Cell num>{Number(org.monthly_credits) || 0}</Cell>,
                price: <Cell num>{inr(org.monthly_price || 0)}</Cell>,
                storage: <Cell num>{formatBytes(org.storage_used_bytes)}</Cell>,
                /* 07 §7: Aekam sees the COUNT of Pahchan users per org and
                   nothing else, and there is deliberately no drill-through —
                   the view it comes from has no employee_id to drill into. */
                pahchan: <Cell num>{org.pahchan_active_users ?? '—'}</Cell>,
                status: <Cell>{org.is_active ? 'Active' : 'Suspended'}</Cell>,
              })}
            </Row>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
