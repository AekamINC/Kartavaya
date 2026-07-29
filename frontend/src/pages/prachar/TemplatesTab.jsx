// Templates — `PracharTemplates` in the reference's ScreensThin.jsx.
//
// The reference draws a card grid: mono template name, an approval tag, the
// category and language beside a send count, then the body in a recessed well,
// then the actions. The build drew a flat one-line row per template with a bare
// "Delete" link and no body preview at all — so the one thing you need to know
// about a template before using it, what it actually says, was invisible.
//
// ── Where this build and the reference genuinely differ ───────────────────
// The reference's cards are WhatsApp templates awaiting Meta approval, with an
// `ok | pending | no` state and a rejection reason. `staging.prachar_templates`
// has no approval column — these are the org's own email templates and there is
// nobody to approve them. Inventing an "Approved" tag for a row that carries no
// such field would be a lie in the UI, so the tag position carries the
// distinction that IS real and IS consequential: 24-bilingual aside, a
// promotional template may only go to contacts who opted in, and a
// transactional one may go to anyone. That is the same fact the reference's
// note states, sourced from a column that exists.
import React, { useState } from 'react';
import { BackButton } from '../../components/editorial';
import { useToast } from '../../components/ui/toast';
import useModuleWrite from '../../hooks/useModuleWrite';
import {
  api, rows, Panel, Bar, useResource, useMutate,
  TEMPLATE_CATEGORIES, isMarketingCategory, humanise, fmtDate,
} from './_shared';

/** `{{name}}` / `{{1}}` — the merge fields a template declares by using them. */
const VARS = /\{\{\s*([\w.]+)\s*\}\}/g;
const varsIn = (t) => {
  const found = new Set();
  for (const src of [t.subject || '', t.body_html || '', t.body_text || '']) {
    for (const m of src.matchAll(VARS)) found.add(m[1]);
  }
  return [...found];
};

export default function TemplatesTab({ onChanged }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change campaigns' });
  const { pushToast } = useToast();
  const { busy, go } = useMutate(pushToast);
  const [form, setForm] = useState(null);
  const [category, setCategory] = useState('');

  const { data, loading, error, reload } = useResource(
    () => api.get('/v1/prachar/templates').then(rows), [],
  );
  const all = data || [];
  const list = category ? all.filter((t) => t.category === category) : all;

  const refresh = () => { reload(); onChanged?.(); };

  const save = async () => {
    if (!form.name.trim()) return pushToast({ type: 'error', title: 'A template needs a name.' });
    if (!form.subject.trim()) return pushToast({ type: 'error', title: 'A template needs a subject line.' });
    const payload = {
      name: form.name.trim(),
      subject: form.subject.trim(),
      body_html: form.body_html,
      body_text: form.body_text,
      category: form.category,
      // Derived from the body rather than typed. The old form sent `variables:
      // []` always, so the column was written empty on every template and the
      // merge fields a template actually used were recorded nowhere.
      variables: varsIn(form),
    };
    const r = await go(
      () => (form.id
        ? api.patch(`/v1/prachar/templates/${form.id}`, payload)
        : api.post('/v1/prachar/templates', payload)),
      form.id ? 'Template saved' : 'Template created',
    );
    if (r.ok) { setForm(null); refresh(); }
    return undefined;
  };

  const remove = async (t) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete the template "${t.name}"? Campaigns already sent are unaffected.`)) return;
    const r = await go(() => api.delete(`/v1/prachar/templates/${t.id}`), 'Template deleted');
    if (r.ok) refresh();
  };

  const duplicate = async (t) => {
    const r = await go(
      () => api.post('/v1/prachar/templates', {
        name: `${t.name} copy`,
        subject: t.subject || '',
        body_html: t.body_html || '',
        body_text: t.body_text || '',
        category: t.category || 'general',
        variables: varsIn(t),
      }),
      `Duplicated as "${t.name} copy"`,
    );
    if (r.ok) refresh();
  };

  if (form) {
    return <TemplateForm form={form} setForm={setForm} onSave={save} onCancel={() => setForm(null)} busy={busy} />;
  }

  return (
    <div>
      <Bar title="Email templates" hi="साँचा">
        <select
          className="k-formpanel__input"
          aria-label="Filter by category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {TEMPLATE_CATEGORIES.map((c) => <option key={c} value={c}>{humanise(c)}</option>)}
        </select>
        <button type="button" className="k-btn k-btn--primary k-btn--sm" onClick={() => setForm(blank())}
          disabled={!canWrite} title={denial || undefined}>
          + New template
        </button>
      </Bar>

      {/* The reference's note, restated for the rule this build can actually
          enforce. It is a constraint, stated honestly — 02's `.note` is for
          exactly this and not for decoration. */}
      <p className="note note--info pr__note">
        A <b>promotional</b> or <b>newsletter</b> template may only be sent to contacts who have
        not opted out — the unsubscribe list is applied to every send automatically.
        <b> Transactional</b> and <b>general</b> templates carry no such restriction.
      </p>

      <Panel
        loading={loading}
        error={error}
        onRetry={reload}
        empty={all.length === 0}
        emptyProps={{
          icon: '✉️',
          title: 'No templates yet',
          sub: 'A template is a subject and a body you can reuse across campaigns, with {{merge}} fields filled per contact.',
          // F32. A CTA in an object literal rather than a JSX attribute, which
          // is why the static sweep walked past it and only the browser found it.
          cta: canWrite ? '+ New template' : undefined,
          onCta: canWrite ? () => setForm(blank()) : undefined,
        }}
        count={3}
      >
        {list.length === 0 ? (
          <p className="pr__step-when">No templates in that category.</p>
        ) : (
          <div className="pr__grid">
            {list.map((t) => {
              const vars = varsIn(t);
              const marketing = isMarketingCategory(t.category);
              return (
                <article className="pr__tpl" key={t.id}>
                  <div className="pr__tpl-head">
                    <span className="pr__tpl-n">{t.name}</span>
                    <span
                      className="tag"
                      style={{ '--c': marketing ? 'var(--warn)' : 'var(--ok)' }}
                      title={marketing
                        ? 'Marketing content — only goes to contacts who have not opted out'
                        : 'Utility content — no opt-in requirement'}
                    >
                      {marketing ? 'Needs opt-in' : 'Utility'}
                    </span>
                  </div>

                  <div className="pr__meta">
                    <span className="tag" style={{ '--c': 'var(--st-in-progress)' }}>{humanise(t.category)}</span>
                    {vars.length > 0 && (
                      <span className="pr__mono" title={vars.map((v) => `{{${v}}}`).join(' ')}>
                        {vars.length} {vars.length === 1 ? 'field' : 'fields'}
                      </span>
                    )}
                    <span className="pr__meta-end">{fmtDate(t.updated_at || t.created_at)}</span>
                  </div>

                  <p className="pr__tpl-sub">{t.subject || 'No subject line'}</p>
                  <div className="pr__tpl-body">{t.body_text || stripTags(t.body_html) || 'This template has no body yet.'}</div>

                  <div className="pr__tpl-act">
                    <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setForm(toForm(t))}>Edit</button>
                    <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => duplicate(t)} disabled={busy}>Duplicate</button>
                    <button type="button" className="pr__del" onClick={() => remove(t)} disabled={busy}>Delete</button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

/** A readable preview from an HTML body. Not a sanitiser and not rendered as
 *  HTML anywhere — the string goes into a text node, so this is only about the
 *  preview reading as prose instead of as markup. */
function stripTags(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

const blank = () => ({
  name: '', subject: '', body_html: '', body_text: '', category: 'general',
});

const toForm = (t) => ({
  id: t.id,
  name: t.name || '',
  subject: t.subject || '',
  body_html: t.body_html || '',
  body_text: t.body_text || '',
  category: t.category || 'general',
});

function TemplateForm({ form, setForm, onSave, onCancel, busy }) {
  // F32 — this component owns its own write controls, so it asks
  // the same question rather than taking the answer as a prop.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change campaigns' });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const vars = varsIn(form);
  return (
    <div>
      <BackButton onClick={onCancel} label="Back to templates" />
      <div className="k-formpanel">
        <h3 className="pr__form-t">{form.id ? 'Edit template' : 'New template'}</h3>
        <div className="k-formpanel__grid k-formpanel__grid--2">
          <label className="k-formpanel__label">Template name
            <input className="k-formpanel__input" placeholder="e.g. Welcome email" value={form.name} onChange={set('name')} />
          </label>
          <label className="k-formpanel__label">Category
            <select className="k-formpanel__input" value={form.category} onChange={set('category')}>
              {TEMPLATE_CATEGORIES.map((c) => <option key={c} value={c}>{humanise(c)}</option>)}
            </select>
          </label>
        </div>
        <label className="k-formpanel__label">Subject
          <input className="k-formpanel__input" placeholder="e.g. Welcome to {{company}}" value={form.subject} onChange={set('subject')} />
        </label>
        <label className="k-formpanel__label">Body
          <textarea className="k-formpanel__input" rows={10} placeholder="Template body…" value={form.body_html} onChange={set('body_html')} />
        </label>
        <label className="k-formpanel__label">Plain-text fallback
          <textarea className="k-formpanel__input" rows={4} placeholder="Optional. Sent to clients that cannot show HTML." value={form.body_text} onChange={set('body_text')} />
        </label>

        {/* Live, because a merge field is easy to typo and a typo means the
            literal `{{frist_name}}` lands in somebody's inbox. */}
        <p className="pr__step-when">
          {vars.length === 0
            ? 'No merge fields yet. Write {{name}} anywhere in the subject or body to insert a contact’s details.'
            : `Merge fields detected: ${vars.map((v) => `{{${v}}}`).join(', ')}`}
        </p>

        <div className="k-formpanel__actions">
          <button type="button" className="k-btn k-btn--primary k-btn--sm" onClick={onSave} disabled={busy || !canWrite} title={denial || undefined}>
            {busy ? 'Saving…' : (form.id ? 'Save template' : 'Create template')}
          </button>
          <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
