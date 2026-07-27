import React from "react";
import { relTime } from "../lib/utils";

const TYPE_META = {
  created:         { icon: "✨", verb: "created this task" },
  status_changed:  { icon: "🔄", verb: "changed status" },
  assigned:        { icon: "👤", verb: "updated assignees" },
  commented:       { icon: "💬", verb: "commented" },
  comment_edited:  { icon: "✏️", verb: "edited a comment" },
  comment_deleted: { icon: "🗑️", verb: "deleted a comment" },
  field_changed:   { icon: "✏️", verb: "updated a field" },
  approved:        { icon: "✅", verb: "approved" },
  rejected:        { icon: "❌", verb: "rejected" },
  mention:         { icon: "📣", verb: "mentioned someone" },
  time_logged:     { icon: "⏱", verb: "logged time" },
  subtask_added:   { icon: "☑️", verb: "added a subtask" },
  subtask_deleted: { icon: "🗑️", verb: "removed a subtask" },
  default:         { icon: "📋", verb: "" },
};


/*
 * The two badges below carried HARDCODED backgrounds — #fee2e2 and #dcfce7 —
 * with #16a34a as the "to" ink. None of the three flips with the theme, and
 * #16a34a is on the retired literal list in lib/tokens.css. Measured:
 *
 *   dark   var(--danger) #F2867A on #fee2e2   2.03:1   (needs 4.5)
 *   both   #16a34a       on #dcfce7           3.00:1   (needs 4.5)
 *
 * The light-pink and light-green grounds stayed light in dark mode while the
 * ink moved, which is why the "from" badge is worst in dark specifically.
 * --danger-container / --ok-container are the theme-flipping equivalents and
 * each already has a measured `on-` half (10.45:1 and 11.02:1 light, 10.00:1
 * and 8.94:1 dark), so the pairs are correct in both themes with no second rule.
 */
function DiffBadge({ from, to }) {
  if (from == null && to == null) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, marginLeft: 6 }}>
      {from !== null && from !== undefined && <span style={{ background: "var(--danger-container)", color: "var(--on-danger-container)", borderRadius: 4, padding: "1px 5px" }}>{String(from)}</span>}
      {from !== null && from !== undefined && to !== null && to !== undefined && <span style={{ color: "var(--ink-3)" }}>→</span>}
      {to   !== null && to !== undefined && <span style={{ background: "var(--ok-container)", color: "var(--on-ok-container)", borderRadius: 4, padding: "1px 5px" }}>{String(to)}</span>}
    </span>
  );
}

function FieldDiff({ data }) {
  if (!data) return null;
  if (data.field) {
    return (
      <span style={{ color: "var(--ink-3)", fontSize: 12 }}>
        {" "}<em>{data.field}</em>
        <DiffBadge from={data.from} to={data.to} />
      </span>
    );
  }
  if (data.from !== undefined || data.to !== undefined) {
    return <DiffBadge from={data.from} to={data.to} />;
  }
  if (data.added?.length || data.removed?.length) {
    return (
      <span style={{ color: "var(--ink-3)", fontSize: 12, marginLeft: 4 }}>
        {data.added?.length  > 0 && <span style={{ background: "var(--ok-container)", color: "var(--on-ok-container)", borderRadius: 4, padding: "1px 5px", marginRight: 4 }}>+{data.added.length}</span>}
        {data.removed?.length > 0 && <span style={{ background: "var(--danger-container)", color: "var(--on-danger-container)", borderRadius: 4, padding: "1px 5px" }}>-{data.removed.length}</span>}
      </span>
    );
  }
  return null;
}

export default function ActivityList({ events = [], loading = false, showTask = false }) {
  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" }}>
        {[1,2,3].map(i => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--bg-soft)" }} />
            <div style={{ flex: 1 }}>
              <div style={{ height: 12, background: "var(--bg-soft)", borderRadius: 4, width: "60%", marginBottom: 6 }} />
              <div style={{ height: 10, background: "var(--bg-soft)", borderRadius: 4, width: "35%" }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 32, color: "var(--ink-faint)", fontSize: 13 }}>
        No activity yet.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {events.map(evt => {
        const meta = TYPE_META[evt.type] || TYPE_META.default;
        return (
          <div key={evt.event_id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid var(--rule-soft)" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--bg-soft)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>
              {meta.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink)" }}>
                <strong>{evt.actor_name || "System"}</strong>
                {" "}
                <span style={{ color: "var(--ink-3)" }}>{meta.verb}</span>
                {showTask && evt.task_title && (
                  <span> on <strong style={{ color: "var(--k-primary)" }}>{evt.task_title}</strong></span>
                )}
                <FieldDiff data={evt.data} />
              </div>
              <div style={{ color: "var(--ink-faint)", fontSize: 11, marginTop: 2 }}>
                {relTime(evt.created_at)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
