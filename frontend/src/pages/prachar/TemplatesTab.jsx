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
  api, rows, body, Panel, Bar, useResource, useMutate,
  TEMPLATE_CATEGORIES, isMarketingCategory, humanise, fmtDate,
} from './_shared';

/**
 * What the save-time compliance linter found, quoted back.
 *
 * ADVISORY AND NOTHING ELSE. `POST/PATCH /templates` returns `compliance` on a
 * 200 — the template is already saved by the time this renders. That is the
 * whole design: the person writing the template is a chartered accountant
 * reading their own Code of Ethics, and the product's contribution is to notice
 * a phrase at the moment it was written, not to grade professional prose.
 *
 * THE QUOTED PHRASE IS THE FEATURE. "Contains promotional language" is not
 * something anyone can act on; «our award-winning team», with the rule beside
 * it, is a single edit.
 */
function LintReadout({ result }) {
  if (!result || !result.findings?.length) return null;
  const { findings, counts } = result;
  return (
    <div className="note note--warn pr__note" role="status">
      <b>
        {findings.length === 1
          ? 'One phrase reads as advertising'
          : `${findings.length} phrases read as advertising`}
        {counts?.high ? ` (${counts.high} to look at first)` : ''}
      </b>
      {' — this is guidance, not a block. The template is saved.'}
      <ul className="pr__lint">
        {findings.map((f) => (
          <li key={`${f.rule}-${f.where}-${f.phrase}`}>
            <span className="pr__mono">“{f.phrase}”</span>
            {' · '}
            {f.label}
            {f.where === 'subject' ? ' · in the subject line' : ''}
            <div className="pr__step-when">{f.why}</div>
          </li>
        ))}
      </ul>
      <div className="pr__step-when">{findings[0].citation}</div>
    </div>
  );
}

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
  // Survives the return from the form to the grid on purpose: the findings are
  // about the template that was just saved, and hiding them at the moment the
  // form closes would show them only to somebody watching for them.
  const [lint, setLint] = useState(null);

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
      // Empty string means "leave it to the category". Sending '' would be a
      // CHECK violation once migration 183 lands, so it becomes null and the
      // server falls back to `CATEGORY_TO_CLASS`.
      compliance_class: form.compliance_class || null,
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
    if (r.ok) {
      // The linter rides back on the 200. It never fails the save, so this is
      // read from the success and from nowhere else.
      setLint(body(r.out)?.compliance || null);
      setForm(null);
      refresh();
    }
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

      <LintReadout result={lint} />

      {/* The reference's note, restated for the rule this build can actually
          enforce. It is a constraint, stated honestly — 02's `.note` is for
          exactly this and not for decoration.

          The opt-out sentence is kept and the ICAI one added beside it, because
          they are different rules with different owners: the unsubscribe list
          is this product's obligation to a recipient, and Clause (6) is the
          MEMBER'S obligation to the Institute. Aekam is not an ICAI member; the
          partner who presses Send is. */}
      <p className="note note--info pr__note">
        A <b>promotional</b> or <b>newsletter</b> template may only be sent to contacts who have
        not opted out — the unsubscribe list is applied to every send automatically.
        <b> Transactional</b> and <b>general</b> templates carry no such restriction.
      </p>
      <p className="note note--info pr__note">
        Marketing email may only go to <b>existing clients</b>. Under Clause (6),
        Part I, First Schedule of the Chartered Accountants Act 1949, emailing a
        prospect to solicit work is professional misconduct — so a campaign whose
        audience includes anybody without a client record is refused, and clearing
        that refusal takes a written basis recorded against your name.
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
                    {/* The class the SEND PATH enforces, beside the category
                        the firm filed it under. Absent until migration 183 has
                        been applied and until the category maps to one — and
                        the absence is worth showing, because an unclassified
                        template cannot be sent to an audience containing
                        anyone the firm does not act for. */}
                    {t.compliance_class && (
                      <span className="tag" style={{ '--c': 'var(--k-mid)' }}
                        title="The compliance class the send path enforces">
                        {humanise(t.compliance_class)}
                      </span>
                    )}
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
  compliance_class: '',
});

const toForm = (t) => ({
  id: t.id,
  name: t.name || '',
  subject: t.subject || '',
  body_html: t.body_html || '',
  body_text: t.body_text || '',
  category: t.category || 'general',
  // '' rather than null, because a <select> with a null value is uncontrolled
  // and React logs a warning the first time somebody types in the form.
  compliance_class: t.compliance_class || '',
});

function TemplateForm({ form, setForm, onSave, onCancel, busy }) {
  // F32 — this component owns its own write controls, so it asks
  // the same question rather than taking the answer as a prop.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change campaigns' });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const vars = varsIn(form);

  // The classes come from the server, not from a constant here. The send path
  // enforces `TEMPLATE_CLASSES` in `services/prachar_compliance.py`, and a
  // second list on this side would eventually offer a class the enforcer does
  // not know — which is a save the database refuses for a reason nobody can see.
  const classes = useResource(
    () => api.get('/v1/prachar/compliance/classes').then(body), [],
  );
  const options = classes.data?.classes || [];
  const chosen = options.find((c) => c.key === form.compliance_class);
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
        {/* ── The compliance class ────────────────────────────────────────
            Separate from Category on purpose. Category is a filing label the
            firm chose for itself; this is what the send path ENFORCES. Leaving
            it on "From the category" is the ordinary case — the mapping covers
            every category on this database except `general`. */}
        <label className="k-formpanel__label">Compliance class
          <select
            className="k-formpanel__input"
            value={form.compliance_class}
            onChange={set('compliance_class')}
            disabled={!canWrite || options.length === 0}
            title={denial || undefined}
          >
            <option value="">From the category</option>
            {options.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </label>
        {chosen && (
          <p className="pr__step-when">
            {/* `basis` is shown because it is the most important thing on this
                screen. A member relying on the newsletter class deserves to
                know we REASONED it rather than read it in the Code. */}
            <b>{chosen.basis === 'inferred' ? 'Reasoned, not sourced.' : 'Stated in the Code.'}</b>
            {' '}
            {chosen.why}
          </p>
        )}

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
