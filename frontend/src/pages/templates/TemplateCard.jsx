import React from 'react';
import Button from '../../components/ui/Button';

/**
 * One template card — project or task.
 *
 * The two variants were written inline in the page's map() with a ternary
 * spanning ninety lines, so the shared parts (head, kicker, name, description)
 * were genuinely shared but the footers had drifted: the project footer used
 * `k-iconbtn` with an inline `color: var(--ink-faint)`, the task footer used the
 * same class with the same inline colour written out a second time.
 */

const TRASH = <path d="M3 4h10M5 4V3h6v1M6 7v5M10 7v5M4 4l1 9h6l1-9" />;

function DeleteBtn({ onClick, name }) {
  return (
    <button
      type="button"
      className="k-iconbtn tpl-card__spacer"
      title={`Delete ${name}`}
      aria-label={`Delete template ${name}`}
      onClick={onClick}
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        {TRASH}
      </svg>
    </button>
  );
}

export default function TemplateCard({
  tmpl, cfg, color, sans, kicker, kind,
  applying, onUse, onPreview, onDelete, onEdit, onSetDefault,
}) {
  const cols = (cfg.columns || []).length;
  const fields = (cfg.fields || []).length;
  const used = tmpl.use_count || 0;

  return (
    <div className="k-tmpl-card">
      <div className="k-tmpl-card__head">
        <div className="k-tmpl-card__body">
          {/* --c, not a raw `color`, so the accent reaches CSS instead of the
              style attribute. Same contract as Tag. */}
          <div className="k-tmpl-card__kicker tpl-card__kick" style={{ '--c': color }}>{kicker}</div>
          <div className="k-tmpl-card__name">{tmpl.name}</div>
          {tmpl.description && <div className="k-tmpl-card__desc">{tmpl.description}</div>}
        </div>
        <div className="k-tmpl-card__sans tpl-card__kick" style={{ '--c': color }} lang="hi" aria-hidden="true">
          {sans}
        </div>
      </div>

      {kind === 'project' && (
        <div className="k-tmpl-card__stats">
          <div className="k-tmpl-card__stat"><b>{cols}</b><span>COLUMNS</span></div>
          <div className="k-tmpl-card__stat"><b>{fields}</b><span>FIELDS</span></div>
          <div className="k-tmpl-card__stat"><b>{used}</b><span>USED</span></div>
        </div>
      )}

      <div className="k-tmpl-card__foot">
        {kind === 'project' ? (
          <div className="tpl-card__row">
            <Button variant="fill" size="sm" disabled={applying} onClick={onUse}>Use template</Button>
            <Button variant="ghost" size="sm" onClick={onPreview}>Preview</Button>
            <DeleteBtn name={tmpl.name} onClick={onDelete} />
          </div>
        ) : (
          <>
            <div className="tpl-card__meta">
              <span>{cfg.priority || 'medium'} priority</span>
              {(cfg.subtasks || []).length > 0 && <span>· {cfg.subtasks.length} subtasks</span>}
              {tmpl.is_default && <span className="tpl-default">DEFAULT</span>}
            </div>
            <div className="tpl-card__row">
              <Button variant="ghost" size="sm" onClick={onEdit}>Edit</Button>
              {!tmpl.is_default && (
                <Button variant="ghost" size="sm" onClick={onSetDefault}>Set default</Button>
              )}
              <DeleteBtn name={tmpl.name} onClick={onDelete} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
