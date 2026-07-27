/**
 * CategoriesPage.jsx — task categories (`/categories`).
 *
 * Small page, three real defects:
 *
 *  · `.catch(() => {})` on the only fetch, then `cats.length === 0` rendering
 *    "No categories yet". A failed request therefore claimed the firm had no
 *    categories — and this page is reached from Settings, where the natural
 *    next action on that sentence is to create duplicates of the ones that are
 *    already there.
 *  · 13 inline styles, several on the retired `--ink` / `--rule-soft` names.
 *  · The colour swatch, the hex field and the row dot each hard-coded their own
 *    geometry inline, so none of them followed the radius or density settings.
 *
 * `/categories` (server.py:2162) is `List[CategoryOut]` — a bare array, which
 * `rows()` handles alongside the `{data:[…]}` envelope used elsewhere.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { api, rows as asRows, body } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader } from '../components/editorial';
import { Card, CardHead, CardBody } from '../components/ui/Card';
import { Input } from '../components/ui/Field';
import Button from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState, errorKind } from '../components/ui/ErrorState';
import { SkeletonText } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ui/ConfirmDialog';

/* The seed colour for a new category. A concrete hex rather than a token
   because <input type="color"> cannot accept a CSS custom property — it needs a
   literal #rrggbb — and because this value is written to the database as the
   category's own colour, i.e. it is DATA the user then edits, not chrome. */
const DEFAULT_COLOR = '#05b7aa';

const TRASH = <path d="M3 4h10M5 4V3h6v1M6 7v5M10 7v5M4 4l1 9h6l1-9" />;

export default function CategoriesPage() {
  const { pushToast } = useToast();
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [creating, setCreating] = useState(false);
  const [confirmState, setConfirmState] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const r = await api.get('/categories');
      setCats(asRows(r));
    } catch (e) {
      setLoadErr(errorKind(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const r = await api.post('/categories', { name: name.trim(), color });
      setCats(p => [body(r), ...p]);
      setName('');
    } catch {
      pushToast({ type: 'error', title: 'Could not create category' });
    } finally {
      setCreating(false);
    }
  };

  const remove = (c) => {
    setConfirmState({
      title: 'Delete category?',
      message: `"${c.name}" will be removed from every task that carries it.`,
      confirmLabel: 'Delete',
      intent: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/categories/${c.category_id}`);
          setCats(p => p.filter(x => x.category_id !== c.category_id));
        } catch {
          pushToast({ type: 'error', title: 'Could not delete category' });
        }
      },
    });
  };

  return (
    <div className="k-screen">
      <PageHeader
        kicker="SETTINGS"
        title="Categories"
        sanskrit="वर्ग"
        lede="Tags you can drop on any task. Used in filters, reports, and automations."
      />

      <Card>
        <CardHead title="New category" sanskrit="नई श्रेणी" />
        <CardBody>
          <div className="wf-row">
            <Input
              className="wf-row__grow"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && create()}
              placeholder="Category name"
              aria-label="Category name"
            />
            <div className="wf-row">
              <input
                type="color"
                className="cat-swatch"
                value={color}
                onChange={e => setColor(e.target.value)}
                aria-label="Category colour"
              />
              <Input
                className="cat-hex"
                value={color}
                aria-label="Category colour hex"
                onChange={e => { if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) setColor(e.target.value); }}
              />
            </div>
            <Button variant="fill" loading={creating} disabled={!name.trim()} onClick={create}>
              Create
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody flush>
          {loading && (
            <div className="cat-row" aria-busy="true" aria-label="Loading categories">
              <SkeletonText width="14px" height={14} />
              <SkeletonText width="40%" height={13} />
            </div>
          )}

          {/* Error outranks empty. "No categories yet" on a failed fetch invites
              the user to recreate categories that already exist. */}
          {!loading && loadErr && <ErrorState kind={loadErr} onRetry={load} />}

          {!loading && !loadErr && cats.length === 0 && (
            <EmptyState
              illustration="generic"
              title={{ en: 'No categories yet', hi: 'अभी कोई वर्ग नहीं' }}
              description="Tag tasks with custom categories to filter and report on them."
            />
          )}

          {!loading && !loadErr && cats.map(c => (
            <div key={c.category_id} className="cat-row">
              <span className="cat-row__dot" style={{ '--c': c.color }} aria-hidden="true" />
              <span className="cat-row__name">{c.name}</span>
              <span className="cat-row__hex">{c.color}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove(c)}
                title={`Delete ${c.name}`}
                aria-label={`Delete ${c.name}`}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                  {TRASH}
                </svg>
              </Button>
            </div>
          ))}
        </CardBody>
      </Card>

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
