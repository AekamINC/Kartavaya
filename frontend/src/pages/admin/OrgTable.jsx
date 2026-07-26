import React from 'react';
import { Table, TableHead, TableBody, Row, Cell, HeadCell } from '../../components/ui';
import { inr } from '../../lib/inr';

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
    return [o.name, o.owner_email, o.owner_name, o.plan_name, o.team_id, o.id]
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
  return (
    <Table className="adm-rows">
      <TableHead>
        <HeadCell sortKey="name" sort={sort} onSort={onSort}>Organisation</HeadCell>
        <HeadCell sortKey="plan" sort={sort} onSort={onSort}>Plan</HeadCell>
        <HeadCell sortKey="credits" sort={sort} onSort={onSort} num>Credits</HeadCell>
        <HeadCell sortKey="price" sort={sort} onSort={onSort} num>Monthly</HeadCell>
        <HeadCell sortKey="storage" sort={sort} onSort={onSort} num>Storage</HeadCell>
        {/* 07 §7: Aekam sees the COUNT of Pahchan users per org and nothing
            else. The column appears only when the payload carries the
            aggregate, and there is deliberately no drill-through — the view it
            comes from has no employee_id to drill into. */}
        {showPahchan && <HeadCell sortKey="pahchan" sort={sort} onSort={onSort} num>Pahchan</HeadCell>}
        <HeadCell>Status</HeadCell>
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
            <Cell>
              <span className="adm-name">
                <span className="adm-name__c">
                  <b>{org.name || 'Unnamed'}</b>
                  <i>{org.owner_email || 'No owner'}</i>
                </span>
              </span>
            </Cell>
            <Cell>{org.plan_name || org.plan_code || '—'}</Cell>
            <Cell num>{Number(org.monthly_credits) || 0}</Cell>
            <Cell num>{inr(org.monthly_price || 0)}</Cell>
            <Cell num>{formatBytes(org.storage_used_bytes)}</Cell>
            {showPahchan && <Cell num>{org.pahchan_active_users ?? '—'}</Cell>}
            <Cell>{org.is_active ? 'Active' : 'Suspended'}</Cell>
          </Row>
        ))}
      </TableBody>
    </Table>
  );
}
