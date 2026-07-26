import React from 'react';
import { Field, Input } from '../../components/ui';
import { OB_TEMPLATES } from './data';
import { Check } from './icons';

/**
 * Step 5 — the first project.
 *
 * A template only seeds columns. It does not create tasks, assign anyone or
 * lock a workflow, and the note under the grid says exactly which columns are
 * about to exist rather than leaving the user to find out.
 */
export default function StepTemplate({ value, onChange }) {
  const chosen = OB_TEMPLATES.find((t) => t.id === value.template);

  return (
    <>
      <div className="ob__head">
        <h2 className="ob__h2">Create your first project</h2>
        <p className="ob__sub">
          A template sets up the columns and nothing else. Rename or delete any of
          them afterwards.
        </p>
      </div>

      <Field label="Project name" sanskrit="परियोजना" htmlFor="ob-proj">
        <Input
          id="ob-proj"
          value={value.project}
          onChange={(e) => onChange({ ...value, project: e.target.value })}
          placeholder="Q1 GST filing"
          autoFocus
        />
      </Field>

      <div className="ob__tpls">
        {OB_TEMPLATES.map((t) => {
          const isOn = value.template === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={isOn}
              className={`ob__tpl ${isOn ? 'on' : ''}`.trim()}
              onClick={() => onChange({ ...value, template: t.id })}
            >
              <span className="ob__tpl-h">
                <span className="ob__tpl-n">{t.name}</span>
                <span className="ob__tpl-hi" lang="hi">{t.hi}</span>
                <span className={`ob__check ${isOn ? 'on' : ''}`.trim()}>
                  <Check width={12} height={12} />
                </span>
              </span>
              <span className="ob__tpl-d">{t.d}</span>
              <span className="ob__tpl-cols">
                {t.cols.map((c) => <span key={c} className="ob__tpl-col">{c}</span>)}
              </span>
            </button>
          );
        })}
      </div>

      {chosen && (
        <div className="ob__note">
          <Check width={13} height={13} />
          <span>
            <strong>{value.project.trim() || 'Untitled project'}</strong> will be created
            with {chosen.cols.length} columns: {chosen.cols.join(' · ')}.
          </span>
        </div>
      )}
    </>
  );
}
