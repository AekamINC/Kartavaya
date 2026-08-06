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
 * 19 asks each row to show "name, size, who shared it, when". Two of the four
 * used not to exist: `Attachment` was `name / url / key / is_private /
 * visible_to`, with no byte count and no uploader — `TaskDrawer.jsx` had been
 * sending `size` at upload all along and the model discarded it. It now carries
 * `size`, `uploaded_by_name` and `uploaded_at` (server.py:498-510) and
 * `_client_files` maps them to `size` / `sharedBy` / `sharedAt`.
 *
 * All four are OPTIONAL here regardless, and each is printed only when it is
 * really there. Those fields live in the `tasks.attachments` JSONB blob, so
 * every file uploaded before that change has none of them — and a row that
 * invented "shared by <the task's creator>" would be a plausible-looking
 * attribution that is sometimes simply wrong. When a file has no `sharedAt` the
 * row falls back to when its work last moved, which is a statement about the
 * task and is labelled as one.
 */
import React from 'react';
import { EmptyState } from '../../components/ui';
import { relTime } from '../../lib/utils';
import { sizeLabel } from './clientShape';
import { Secondary } from '../../components/Bilingual';

export default function ClientFiles({ tasks }) {
  const files = tasks.flatMap(t =>
    // Built key by key, not spread: `f` crossed the boundary in
    // `clientShape.js` and this is the second place that decides what a row
    // renders. A spread here would quietly re-open it.
    t.files.map(f => ({
      name: f.name,
      url: f.url,
      size: f.size ?? null,
      sharedBy: f.sharedBy || null,
      sharedAt: f.sharedAt || null,
      taskTitle: t.title,
      taskRef: t.ref,
      at: t.updatedAt,
    })),
  );

  if (files.length === 0) {
    return (
      <section className="cl-sec">
        <header className="cl-sec__h">
          <h2 className="cl-sec__t">Files</h2>
          <Secondary className="cl-sec__hi" value="संचिका" />
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
        <Secondary className="cl-sec__hi" value="संचिका" />
        <span className="cl-sec__n">{files.length}</span>
      </header>

      <ul className="cl-list" aria-label="Shared files">
        {files.map(f => {
          // Name · size · who shared it · when — each part dropped rather than
          // faked when the data for it is not there.
          const parts = [f.taskTitle];
          const size = sizeLabel(f.size);
          if (size) parts.push(size);
          if (f.sharedBy) parts.push(`Shared by ${f.sharedBy}`);
          if (f.sharedAt) parts.push(`Shared ${relTime(f.sharedAt)}`);
          else if (f.at) parts.push(`Updated ${relTime(f.at)}`);
          return (
          <li key={`${f.taskRef}-${f.url}`} className="cl-file">
            <div className="cl-file__b">
              <div className="cl-file__n">{f.name}</div>
              <div className="cl-file__m">
                {parts.map((p, i) => (
                  <React.Fragment key={p + i}>
                    {i > 0 && <span className="cl-item__sep" aria-hidden="true"> · </span>}
                    <span>{p}</span>
                  </React.Fragment>
                ))}
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
          );
        })}
      </ul>
    </section>
  );
}
