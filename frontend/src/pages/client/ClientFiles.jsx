/**
 * ClientFiles — only attachments marked client-visible.
 *
 * `13-module-pages.md` records Hub's rule: task boards and time entries are off
 * by default and the never-shared list is enforced in the API, not the UI. The
 * same list applies here. The filter itself is `visibleAttachments` in
 * `clientShape.js`, beside the field filter, so there is one definition of what
 * a client may open.
 *
 * **Download, no delete.** A client deleting the firm's working file is not a
 * feature, and `client` never deletes — that prohibition survived the role's
 * promotion from reader to collaborator.
 *
 * 19 asks each row to show "name, size, who shared it, when". Two of those four
 * do not exist in the data. `backend/server.py:464`:
 *
 *     class Attachment(BaseModel):
 *         name:str; url:str; key:Optional[str]=None
 *         is_private:bool=False; visible_to:List[str]=[]
 *
 * There is no byte count and no uploader. `TaskDrawer.jsx:343` collects a
 * `size` at upload time and it is dropped by the model on the way in. Rather
 * than print the task creator's name beside a file they may not have uploaded —
 * a plausible-looking attribution that is sometimes wrong is worse than none —
 * each row names the work it arrived with and when that work last moved. The
 * two missing fields are in the report.
 */
import React from 'react';
import { EmptyState } from '../../components/ui';
import { relTime } from '../../lib/utils';

export default function ClientFiles({ tasks }) {
  const files = tasks.flatMap(t =>
    t.files.map(f => ({ ...f, taskTitle: t.title, taskRef: t.ref, at: t.updatedAt })),
  );

  if (files.length === 0) {
    return (
      <section className="cl-sec">
        <header className="cl-sec__h">
          <h2 className="cl-sec__t">Files</h2>
          <span className="cl-sec__hi" lang="hi">संचिका</span>
        </header>
        <EmptyState
          illustration="generic"
          title={{ en: 'No files shared yet', hi: 'अभी कोई संचिका नहीं' }}
          description="Documents your team shares with you appear here, ready to download."
        />
      </section>
    );
  }

  return (
    <section className="cl-sec">
      <header className="cl-sec__h">
        <h2 className="cl-sec__t">Files</h2>
        <span className="cl-sec__hi" lang="hi">संचिका</span>
        <span className="cl-sec__n">{files.length}</span>
      </header>

      <ul className="cl-list" aria-label="Shared files">
        {files.map(f => (
          <li key={`${f.taskRef}-${f.url}`} className="cl-file">
            <div className="cl-file__b">
              <div className="cl-file__n">{f.name}</div>
              <div className="cl-file__m">
                {f.taskTitle}
                {f.at && ` · ${relTime(f.at)}`}
              </div>
            </div>
            {/* `download` asks the browser to save rather than navigate; the R2
                URL is signed and cross-origin, so the attribute is a hint the
                storage host may decline — the link still works either way. */}
            <a
              className="cl-file__dl"
              href={f.url}
              download={f.name}
              target="_blank"
              rel="noreferrer noopener"
            >
              Download
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
