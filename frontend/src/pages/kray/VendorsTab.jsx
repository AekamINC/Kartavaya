// Kray · vendors — the master list of suppliers this org buys from.
//
// Vendor records live in ganit_vendors (the table name is not a module code)
// and are shared between Ganit and Kray via the payables gate.
//
// The FORM is `components/VendorForm.jsx` and is shared with
// `ganit/PayablesTab.jsx` — owner decision 0.20. It used to live inline here,
// which is how the payables screen came to carry a stripped four-field copy
// that created suppliers with all six MSME/TDS columns NULL. One component,
// two callers; this tab owns the list, the search and what happens after a
// save, and nothing about the fields.
import React, { useCallback, useEffect, useState } from 'react';
import { api, rows } from '../../lib/api';
import { DataTable, Td } from '../../components/editorial';
import { EmptyState } from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList } from '../../components/ui/Skeleton';
import useModuleWrite from '../../hooks/useModuleWrite';
import VendorForm from '../../components/VendorForm';

const COLUMNS = ['Name', 'GSTIN', 'MSME', 'Terms', 'Email', 'Phone', ''];

export default function VendorsTab() {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'manage vendors' });
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const params = search ? { search } : undefined;
      const r = await api.get('/v1/ganit/vendors', { params });
      setVendors(rows(r));
    } catch (e) { setErr(e); setVendors([]); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  function startEdit(v) {
    setEditing(v);
    setShowForm(true);
  }

  function startNew() {
    setEditing(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
  }

  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  return (
    <div>
      <div className="gn-bar" style={{ marginBottom: '1rem' }}>
        <input
          className="gn-search"
          type="text"
          placeholder="Search vendors…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {canWrite && (
          <button type="button" className="btn btn--fill btn--sm" onClick={startNew}>
            + Vendor
          </button>
        )}
        {!canWrite && denial && (
          <span className="gn-denial">{denial}</span>
        )}
      </div>

      {showForm && canWrite && (
        <VendorForm
          vendor={editing}
          onSaved={() => { closeForm(); load(); }}
          onCancel={closeForm}
        />
      )}

      {loading ? <SkeletonList rows={6} /> : vendors.length === 0 ? (
        <EmptyState
          icon="kray"
          title="No vendors yet"
          description="Add your first supplier to start raising purchase orders."
          action={canWrite ? '+ Vendor' : undefined}
          onAction={canWrite ? startNew : undefined}
        />
      ) : (
        <DataTable columns={COLUMNS} label="Vendors">
          {vendors.map(v => (
            <tr key={v.id}>
              <Td bold>{v.name}</Td>
              <Td mono>{v.gstin || '—'}</Td>
              {/* The CLASS, not the is_msme flag: a medium enterprise is
                  Udyam-registered and still outside the 45-day rule, so the
                  class is the fact that decides whether the clock runs. */}
              <Td>{v.enterprise_class ? v.enterprise_class[0].toUpperCase() + v.enterprise_class.slice(1) : '—'}</Td>
              <Td>{v.payment_terms_days === null || v.payment_terms_days === undefined ? '—' : `${v.payment_terms_days}d`}</Td>
              <Td>{v.email || '—'}</Td>
              <Td>{v.phone || '—'}</Td>
              <Td>
                {canWrite && (
                  <button type="button" className="btn btn--ghost btn--xs" onClick={() => startEdit(v)}>
                    Edit
                  </button>
                )}
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
