// Hub → Knowledge. The documents the chatbot is allowed to answer from.
//
// The search box previously wrote its results into the same `null`-or-array
// state that a failed search left untouched, so a search that errored showed the
// PREVIOUS search's results with the new query in the box. Search now carries
// its own three states like everything else.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty } from '../../components/editorial';
import { Resource, useList, errText, shortStamp } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';

const SOURCE_LABELS = { text: 'Text', faq: 'FAQ', url: 'URL', file: 'File' };
const BLANK_DOC = { title: '', content: '', source_type: 'text', source_url: '' };
const BLANK_FAQ = { question: '', answer: '' };

export default function KnowledgeTab({ clientId }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change Sahayak content' });
  const { pushToast } = useToast();
  const docs = useList(clientId ? `/v1/hub/clients/${clientId}/kb` : null, [clientId]);

  const [pane, setPane] = useState(null);          // 'doc' | 'faq' | null
  const [docForm, setDocForm] = useState(BLANK_DOC);
  const [faqForm, setFaqForm] = useState(BLANK_FAQ);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);

  const [q, setQ] = useState('');
  const [search, setSearch] = useState(null);      // { loading, error, hits }

  async function addDoc(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/v1/hub/clients/${clientId}/kb`, docForm);
      pushToast({ title: 'Document added and indexed', type: 'success' });
      setDocForm(BLANK_DOC);
      setPane(null);
      docs.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'Could not add the document.'), type: 'error' });
    } finally { setBusy(false); }
  }

  async function addFaq(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/v1/hub/clients/${clientId}/kb/faq`, faqForm);
      pushToast({ title: 'FAQ added', type: 'success' });
      setFaqForm(BLANK_FAQ);
      setPane(null);
      docs.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'Could not add the FAQ.'), type: 'error' });
    } finally { setBusy(false); }
  }

  async function removeDoc(id) {
    try {
      await api.delete(`/v1/hub/clients/${clientId}/kb/${id}`);
      setConfirmDel(null);
      pushToast({ title: 'Document removed', type: 'success' });
      docs.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'Could not remove it.'), type: 'error' });
    }
  }

  async function runSearch(e) {
    e.preventDefault();
    if (!q.trim()) return;
    setSearch({ loading: true, error: '', hits: null });
    try {
      const r = await api.get(`/v1/hub/clients/${clientId}/kb/search`, { params: { q } });
      setSearch({ loading: false, error: '', hits: r.data?.results || [] });
    } catch (err) {
      setSearch({ loading: false, error: errText(err, 'The search failed.'), hits: null });
    }
  }

  return (
    <div className="hb-kb">
      <div className="hb-kb__bar">
        <form className="hb-kb__search" onSubmit={runSearch} role="search">
          <input className="k-input hb-kb__q" placeholder="Search this knowledge base…"
            value={q} onChange={e => setQ(e.target.value)} aria-label="Search the knowledge base" />
          <button type="submit" className="k-btn k-btn--ghost" disabled={!q.trim()}>Search</button>
          {search && (
            <button type="button" className="k-btn k-btn--ghost" onClick={() => { setSearch(null); setQ(''); }}>Clear</button>
          )}
        </form>
        <div className="hb-kb__add">
          <button type="button" className="k-btn k-btn--primary hb-btn--sm"
            onClick={() => setPane(pane === 'doc' ? null : 'doc')}
          disabled={!canWrite} title={denial || undefined}>Add document</button>
          <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
            onClick={() => setPane(pane === 'faq' ? null : 'faq')}>Add FAQ</button>
        </div>
      </div>

      {pane === 'doc' && (
        <form className="hb-card hb-form" onSubmit={addDoc}>
          <h3 className="hb-card__t">Add a knowledge document</h3>
          <label className="hb-field">
            <span className="hb-field__l">Title <span className="hb-req" aria-hidden="true">*</span></span>
            <input className="k-input" required value={docForm.title}
              onChange={e => setDocForm({ ...docForm, title: e.target.value })} />
          </label>
          <div className="hb-grid hb-grid--2">
            <label className="hb-field">
              <span className="hb-field__l">Source type</span>
              <select className="k-input" value={docForm.source_type}
                onChange={e => setDocForm({ ...docForm, source_type: e.target.value })}>
                <option value="text">Text</option>
                <option value="url">URL</option>
                <option value="file">File</option>
              </select>
            </label>
            <label className="hb-field">
              <span className="hb-field__l">Source URL</span>
              <input className="k-input" placeholder="Optional — where this came from"
                value={docForm.source_url} onChange={e => setDocForm({ ...docForm, source_url: e.target.value })} />
            </label>
          </div>
          <label className="hb-field">
            <span className="hb-field__l">Content <span className="hb-req" aria-hidden="true">*</span></span>
            <textarea className="k-input hb-ta" rows={6} required placeholder="Paste the document text here…"
              value={docForm.content} onChange={e => setDocForm({ ...docForm, content: e.target.value })} />
          </label>
          <div className="hb-form__foot hb-form__foot--end">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setPane(null)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={busy || !canWrite} title={denial || undefined}>
              {busy ? 'Indexing…' : 'Add and index'}
            </button>
          </div>
        </form>
      )}

      {pane === 'faq' && (
        <form className="hb-card hb-form" onSubmit={addFaq}>
          <h3 className="hb-card__t">Add an FAQ</h3>
          <label className="hb-field">
            <span className="hb-field__l">Question <span className="hb-req" aria-hidden="true">*</span></span>
            <input className="k-input" required value={faqForm.question}
              onChange={e => setFaqForm({ ...faqForm, question: e.target.value })} />
          </label>
          <label className="hb-field">
            <span className="hb-field__l">Answer <span className="hb-req" aria-hidden="true">*</span></span>
            <textarea className="k-input hb-ta" rows={4} required value={faqForm.answer}
              onChange={e => setFaqForm({ ...faqForm, answer: e.target.value })} />
          </label>
          <div className="hb-form__foot hb-form__foot--end">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setPane(null)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={busy || !canWrite} title={denial || undefined}>
              {busy ? 'Saving…' : 'Add FAQ'}
            </button>
          </div>
        </form>
      )}

      {search && (
        <section className="hb-card hb-card--lit">
          <h3 className="hb-card__t">Search results</h3>
          {search.loading && <p className="hb-cap">Searching…</p>}
          {search.error && (
            <div className="note note--warn hb-err" role="status"><b>The search failed.</b> {search.error}</div>
          )}
          {!search.loading && !search.error && search.hits?.length === 0 && (
            <p className="hb-none">Nothing in this knowledge base matches &ldquo;{q}&rdquo;.</p>
          )}
          {search.hits?.map((r, i) => (
            <div className="hb-hit" key={i}>
              <div className="hb-hit__t">
                {r.doc_title}
                {r.similarity != null && <span className="hb-cap hb-mono"> {Math.round(r.similarity * 100)}% match</span>}
              </div>
              <p className="hb-hit__x">
                {String(r.content || '').slice(0, 300)}{String(r.content || '').length > 300 ? '…' : ''}
              </p>
            </div>
          ))}
        </section>
      )}

      <Resource
        state={docs}
        what="The knowledge base"
        empty={<Empty
          icon="generic"
          title="Nothing indexed yet"
          sub="The chatbot can only answer from what is here. Add a document or an FAQ to give it something to work with."
        />}
      >
        <div className="hb-list">
          {docs.items?.map(d => (
            <div className="hb-card hb-doc" key={d.id}>
              <div className="hb-doc__id">
                <b className="hb-doc__t">{d.title}</b>
                <span className="hb-cap">
                  <span className="hb-tag">{SOURCE_LABELS[d.source_type] || d.source_type}</span>
                  {d.chunk_count != null && <> {d.chunk_count} {d.chunk_count === 1 ? 'chunk' : 'chunks'}</>}
                  {d.created_at && <> · {shortStamp(d.created_at)}</>}
                </span>
              </div>
              {confirmDel === d.id ? (
                <span className="hb-doc__confirm">
                  <span className="hb-cap">Remove from the index?</span>
                  <button type="button" className="k-btn k-btn--ghost hb-btn--sm" onClick={() => setConfirmDel(null)}>Keep</button>
                  <button type="button" className="k-btn k-btn--ghost hb-btn--sm hb-btn--danger" onClick={() => removeDoc(d.id)}
          disabled={!canWrite} title={denial || undefined}>Remove</button>
                </span>
              ) : (
                <button type="button" className="k-btn k-btn--ghost hb-btn--sm hb-btn--danger"
                  onClick={() => setConfirmDel(d.id)}
          disabled={!canWrite} title={denial || undefined}>Remove</button>
              )}
            </div>
          ))}
        </div>
      </Resource>
    </div>
  );
}
