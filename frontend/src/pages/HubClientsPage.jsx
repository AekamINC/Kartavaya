/**
 * HubClientsPage.jsx — brand clients for the Hub / Srijan content pipeline.
 *
 * 31 inline styles across 135 lines, and three structural defects:
 *
 *  · `catch { toast }` with no error state, then `clients.length === 0`
 *    rendering "No clients yet. Create your first client…". A failed request
 *    invited the user to re-create clients that already exist — and the create
 *    call enforces a unique slug, so the second attempt fails too, on a page
 *    that has by then told them twice that they have no clients.
 *
 *  · The whole page returned early — `if (loading) return <div>Loading…</div>`
 *    — so the header and the New Client action vanished on every load and the
 *    layout jumped when they came back.
 *
 *  · Each card was a `<div onClick>` with `onMouseEnter`/`onMouseLeave`
 *    handlers assigning `style.borderColor` imperatively. That is a hover
 *    effect written in JavaScript: no keyboard focus, no :focus-visible ring,
 *    invisible to a screen reader as an interactive element. They are real
 *    buttons now and the hover lives in CSS.
 *
 * `/v1/hub/clients` (routers/hub.py:234) returns `{"data": [...]}` — the
 * envelope, not a bare array. `rows()` reads both, which is why the raw
 * `r.data.data || []` is gone.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, rows as asRows } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader } from '../components/editorial';
import { Card, CardHead, CardBody } from '../components/ui/Card';
import { Field, Input } from '../components/ui/Field';
import Button from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState, errorKind } from '../components/ui/ErrorState';
import { SkeletonCardGrid } from '../components/ui/Skeleton';

const BLANK = {
  name: '', slug: '', industry: '', website: '',
  contact_name: '', contact_email: '', contact_phone: '',
};

const autoSlug = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

export default function HubClientsPage() {
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const r = await api.get('/v1/hub/clients');
      setClients(asRows(r));
    } catch (e) {
      setLoadErr(errorKind(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/hub/clients', form);
      pushToast({ title: 'Client created', type: 'success' });
      setShowCreate(false);
      setForm(BLANK);
      load();
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Failed to create client', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="k-screen">
      <PageHeader
        kicker="HUB"
        title="Hub Clients"
        sanskrit="ग्राहक"
        lede="Brand clients for the content pipeline."
        right={
          <div className="wf-acts">
            <Button variant="fill" size="sm" onClick={() => setShowCreate(v => !v)}>
              {showCreate ? 'Cancel' : '+ New client'}
            </Button>
          </div>
        }
      />

      {showCreate && (
        <Card>
          <CardHead title="New client" sanskrit="नया ग्राहक" />
          <CardBody>
            <form onSubmit={handleCreate}>
              <div className="hcl-form">
                <Field label="Name" required htmlFor="hcl-name">
                  <Input
                    id="hcl-name"
                    required
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: autoSlug(e.target.value) }))}
                  />
                </Field>
                <Field label="Slug" required htmlFor="hcl-slug" hint="Lowercase letters, numbers and hyphens.">
                  <Input
                    id="hcl-slug"
                    required
                    pattern="[a-z0-9][a-z0-9-]{1,48}[a-z0-9]"
                    value={form.slug}
                    onChange={set('slug')}
                  />
                </Field>
                <Field label="Industry" htmlFor="hcl-industry">
                  <Input id="hcl-industry" value={form.industry} onChange={set('industry')} />
                </Field>
                <Field label="Website" htmlFor="hcl-website">
                  <Input id="hcl-website" value={form.website} onChange={set('website')} />
                </Field>
                <Field label="Contact name" htmlFor="hcl-cname">
                  <Input id="hcl-cname" value={form.contact_name} onChange={set('contact_name')} />
                </Field>
                <Field label="Contact email" htmlFor="hcl-cemail">
                  <Input id="hcl-cemail" type="email" value={form.contact_email} onChange={set('contact_email')} />
                </Field>
                <Field label="Contact phone" htmlFor="hcl-cphone">
                  <Input id="hcl-cphone" value={form.contact_phone} onChange={set('contact_phone')} />
                </Field>
              </div>
              <div className="wf-acts">
                <Button type="submit" variant="fill" loading={saving} disabled={!form.name.trim() || !form.slug.trim()}>
                  Create client
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {/* Three states. The header above stays mounted through all of them. */}
      {loading && <SkeletonCardGrid count={3} columns={3} lines={2} />}

      {!loading && loadErr && <ErrorState kind={loadErr} onRetry={load} />}

      {!loading && !loadErr && clients.length === 0 && (
        <EmptyState
          illustration="generic"
          title={{ en: 'No clients yet', hi: 'अभी कोई ग्राहक नहीं' }}
          description="Add a brand client to start planning and publishing content for them."
          action="New client"
          onAction={() => setShowCreate(true)}
        />
      )}

      {!loading && !loadErr && clients.length > 0 && (
        <div className="hcl-grid">
          {clients.map(c => (
            <button
              key={c.id}
              type="button"
              className="hcl-card"
              onClick={() => navigate(`/hub/clients/${c.id}`)}
            >
              <span className="hcl-card__head">
                <span className="hcl-card__mono" aria-hidden="true">
                  {c.name?.[0]?.toUpperCase() || '?'}
                </span>
                <span>
                  <span className="hcl-card__name">{c.name}</span>
                  <span className="hcl-card__slug">{c.slug}</span>
                </span>
              </span>
              <span className="hcl-card__foot">
                <span>{c.industry || '—'}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
