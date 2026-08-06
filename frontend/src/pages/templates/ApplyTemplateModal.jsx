import React from 'react';
import { Modal } from '../../components/ui/modal';
import Button from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Secondary } from '../../components/Bilingual';

/**
 * "Apply this template to which project?"
 *
 * Was a hand-rolled fixed-position div — 73 lines, ~15 inline styles, its own
 * scrim, its own close glyph, `width: 420` in pixels, `rgba(0,0,0,.45)` and
 * `box-shadow: 0 24px 64px rgba(0,0,0,.22)` written literally. No focus trap,
 * no Escape handler, no `role="dialog"`, no scroll lock, and the only way out
 * by keyboard was Tab-ing through every project button to reach Cancel.
 *
 * `Modal` supplies all of that. The project list is a radio group rather than a
 * row of buttons that merely LOOK selected: the previous version set a border
 * colour on the chosen one and told assistive technology nothing at all, so the
 * selected project was conveyed by colour alone — 00 §12 forbids exactly that.
 */
export default function ApplyTemplateModal({
  open, onClose, tmplName, projects, value, onChange, applying, onApply,
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      dataTestId="apply-template-modal"
      size="sm"
      title={<>Use template <Secondary className="apv-modal__hi" value="साँचा" /></>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="fill" loading={applying} disabled={!value} onClick={onApply}>
            Apply template
          </Button>
        </>
      }
    >
      <div className="tpl-form">
        <p className="pub__lede">
          <strong>{tmplName}</strong> adds its columns and custom fields to the project you pick.
          Existing tasks are not changed.
        </p>

        {projects.length === 0 ? (
          <EmptyState
            illustration="projects"
            title={{ en: 'No projects to apply to', hi: 'कोई परियोजना नहीं' }}
            description="Create a project first, then apply this template to it."
          />
        ) : (
          <fieldset className="tpl-stack">
            <legend className="fldx__lbl"><span>Apply to project</span></legend>
            {projects.map((p) => (
              <label key={p.team_id} className="tpl-item">
                <input
                  type="radio"
                  name="apply-target"
                  value={p.team_id}
                  checked={value === p.team_id}
                  onChange={() => onChange(p.team_id)}
                />
                <span className="tpl-item__t">{p.name}</span>
              </label>
            ))}
          </fieldset>
        )}
      </div>
    </Modal>
  );
}
