"""
deadline_agent.py — Hourly cron agent for deadline warnings and escalation.

Runs via /cron/agents. Finds tasks due within 48h, sends warnings at
48h / 24h / overdue thresholds. Escalates overdue tasks to the
assignee's manager via manav_employees.reporting_to.
"""
import uuid
import logging
from services.agents.base import BaseAgent

logger = logging.getLogger(__name__)


class DeadlineAgent(BaseAgent):
    name = "deadline_agent"
    description = "Sends deadline warnings and escalates overdue tasks"
    module = "kaam"

    async def run(self, pool, org_id: str, context: dict) -> dict:
        warnings_sent = 0
        escalations = 0

        # Tasks due within 48h that are still open.
        #
        # THE COLUMN IS `due_at`, NOT `due_date`. public.tasks has no due_date and
        # never did; Postgres' own hint said so. Every call raised
        # UndefinedColumnError, so this agent had produced nothing for any
        # organisation up to 2026-08-06 — the first day anything called
        # POST /api/internal/cron/agents. It fails before reaching the model, so
        # the silence cost nothing but also warned nobody about any deadline.
        tasks = await pool.fetch(
            """
            SELECT t.task_id, t.title, t.due_at, t.status,
                   t.assignee_user_ids, t.team_id
            FROM tasks t
            JOIN teams tm ON tm.team_id = t.team_id
            WHERE tm.org_id = $1
              AND t.due_at IS NOT NULL
              AND t.status NOT IN ('done', 'closed', 'cancelled')
              AND t.due_at <= NOW() + INTERVAL '48 hours'
            ORDER BY t.due_at ASC
            LIMIT 500
            """,
            org_id,
        )

        for task in tasks:
            task = dict(task)
            assignees = task.get("assignee_user_ids") or []
            if not assignees:
                continue

            due = task["due_at"]
            # Determine warning level
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            if due.tzinfo is None:
                from datetime import timezone as tz
                due = due.replace(tzinfo=tz.utc)

            hours_left = (due - now).total_seconds() / 3600

            if hours_left < 0:
                level = "overdue"
                msg = f"Task **{task['title']}** is overdue."
            elif hours_left <= 24:
                level = "24h"
                msg = f"Task **{task['title']}** is due within 24 hours."
            else:
                level = "48h"
                msg = f"Task **{task['title']}** is due within 48 hours."

            # THE LEVEL LIVES IN `type`, BECAUSE notifications HAS NO metadata.
            #
            # This block used to write and read metadata->>'level'. The table has
            # notification_id, user_id, team_id, type, title, message, task_id,
            # url, created_at, read_at — in BOTH schemas, checked. So both the
            # dedupe read and the insert raised `column "metadata" does not
            # exist`, which is what this agent failed on once the due_at bug
            # above it was fixed and execution finally reached this far.
            #
            # The level cannot simply be dropped: it is what stops a task being
            # warned about at 48h, then again at 24h, then again on the next
            # hourly tick. Folding it into `type` keeps that guard using a column
            # that exists — 'deadline_warning_48h' / '_24h' / '_overdue' are
            # distinct types, so the 20-hour dedupe still asks the right question.
            notif_type = f"deadline_warning_{level}"

            already = await pool.fetchval(
                """
                SELECT 1 FROM notifications
                WHERE task_id = $1 AND type = $2
                  AND created_at > NOW() - INTERVAL '20 hours'
                LIMIT 1
                """,
                task["task_id"], notif_type,
            )
            if already:
                continue

            # Send notification to each assignee
            for uid in assignees:
                await pool.execute(
                    """
                    INSERT INTO notifications
                        (notification_id, user_id, type, title, message, task_id, url)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    """,
                    f"notif_{uuid.uuid4().hex[:12]}", uid, notif_type,
                    f"Deadline {level}", msg, task["task_id"],
                    f"/tasks/{task['task_id']}",
                )
                warnings_sent += 1

            # Escalate overdue to manager
            if level == "overdue":
                for uid in assignees:
                    # `reporting_to` points at manav_employees.id. There is no
                    # employee_id column on that table — it is id, org_id,
                    # user_id, employee_code, reporting_to — so the old join
                    # predicate could never match and would have raised as soon
                    # as anything overdue reached it. The org filter is on the
                    # REPORT's row; me2 is reached through reporting_to, which is
                    # already org-local.
                    # SCHEMA-QUALIFIED, and that is the fourth bug in this file.
                    #
                    # `db._init_conn` runs `SET search_path TO staging, public`,
                    # but staging connects through PgBouncer on port 6543 in
                    # TRANSACTION pooling mode, where a session-level SET does
                    # not survive being returned to the pool. Unqualified names
                    # therefore resolve to `public` in practice — measured:
                    # public.notifications holds 1,259 rows and staging.
                    # notifications holds 1, from July.
                    #
                    # `tasks`, `teams` and `notifications` all exist in public,
                    # so they resolve. `manav_employees` exists ONLY in staging,
                    # so this raised `relation "manav_employees" does not exist`
                    # on all three organisations — the fourth defect here, and
                    # like the three before it, only reachable once the one above
                    # it was fixed and something overdue finally got this far.
                    manager_id = await pool.fetchval(
                        """
                        SELECT me2.user_id
                        FROM staging.manav_employees me
                        JOIN staging.manav_employees me2 ON me2.id = me.reporting_to
                        WHERE me.user_id = $1 AND me.org_id = $2::uuid
                        """,
                        uid, org_id,
                    )
                    if manager_id and manager_id not in assignees:
                        await pool.execute(
                            """
                            INSERT INTO notifications
                                (notification_id, user_id, type, title, message, task_id, url)
                            VALUES ($1, $2, 'deadline_escalation', $3, $4, $5, $6)
                            """,
                            f"notif_{uuid.uuid4().hex[:12]}", manager_id,
                            "Overdue escalation",
                            f"Task **{task['title']}** assigned to your report is overdue.",
                            task["task_id"],
                            f"/tasks/{task['task_id']}",
                        )
                        escalations += 1

        return {"warnings_sent": warnings_sent, "escalations": escalations}
