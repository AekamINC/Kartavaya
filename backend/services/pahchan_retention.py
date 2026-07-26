"""
pahchan_retention.py — the three retention deletions Pahchan promises.

07-pahchan.md §5:

    | Reference photos | Employment + 45 days, then deleted |
    | Punch selfies    | 90 days, then deleted              |
    | Punch records    | 3 years, 5 in some states          |

    "Deleted means deleted, not archived to cold storage. A retention promise with
    an archive behind it is not a retention promise."

    "The three classes are independent. Deleting the photo at 90 days must not
    cascade to the record, and expiring the record must not orphan a photo."

That independence is the whole design of this module, and it cuts both ways:

  · Deleting a punch photo NULLs `photo_key` and leaves the row. §8: "The punch
    record outlives the photo, by law" — hours worked is a payroll fact and the
    photo was only ever evidence. A cascade here would destroy pay records to
    honour a photo-retention promise.

  · Deleting a punch record must first delete its photo, if one somehow survives.
    Dropping the row while the object remains leaves a face in a bucket that
    nothing references and no future job can find — an orphan is the one outcome
    that makes a retention promise unkeepable rather than merely late.

Every window is read from the org's own `pahchan_policy` row, because "3 years,
5 in some states" is a per-tenant legal question, not a constant.

Called from `POST /api/internal/cron/pahchan-retention`, daily.
"""
import logging
from typing import Optional

from db import get_pool
from services import storage

log = logging.getLogger(__name__)

# Used when an org has no policy row. Matches PROPOSED_064's column defaults —
# an org that never opened the policy screen still gets the promise kept.
DEFAULTS = {
    "punch_photo_retention_days": 90,
    "reference_photo_grace_days": 45,
    "record_retention_years": 3,
}

# Rows per statement. Keeps each query and each transaction small; it is NOT the
# amount of work a run does — see MAX_PER_RUN.
BATCH = 500

# The ceiling on one pass of one run.
#
# This used to be a single BATCH slice per run, and that quietly could not keep
# up. An employee makes two punches a day, so an org of N employees produces 2N
# photos a day that fall due 90 days later. At 500 deletions per daily run the
# break-even is 250 EMPLOYEES: above that the backlog grows without bound and
# punch selfies are retained past the promised window forever.
#
# The failure was invisible, which is what made it serious. The job completed,
# logged `photos_deleted: 500` and looked healthy every single day while falling
# further behind — a retention job that reports success while not keeping the
# promise is worse than one that fails loudly, because it manufactures a record
# of compliance.
#
# So a run now DRAINS, in BATCH-sized statements, up to this ceiling. The ceiling
# still exists so one very old tenant cannot hold the daily job open indefinitely,
# but it is set where a real workload fits rather than where a small one does.
MAX_PER_RUN = 50_000


async def _delete_object(org_id: str, key: Optional[str]) -> bool:
    """
    Delete one stored object. Returns True only when deletion is CONFIRMED.

    `storage.delete_file` returns False for several different situations — an
    already-missing local file, no R2 credentials for the org, or an S3 exception —
    and does not distinguish them. So False is read here as "not confirmed gone",
    which is the conservative reading and the right one: if we cannot confirm the
    object is deleted, the pointer to it must survive so tomorrow's run can try
    again. Clearing `photo_key` on an unconfirmed delete would strand the object
    permanently, with nothing left that knows where it is.

    A null key is genuinely nothing to delete, so it is a no-op success.
    """
    if not key:
        return True
    try:
        return await storage.delete_file(key, org_id=org_id)
    except Exception:
        log.warning("pahchan retention: could not delete object %s", key, exc_info=True)
        return False


async def purge_punch_photos() -> dict:
    """
    Punch selfies past the org's window. Deletes the OBJECT and NULLs photo_key.
    The punch row itself is untouched.
    """
    pool = await get_pool()

    deleted = 0
    failed = 0
    drained = False

    while deleted + failed < MAX_PER_RUN:
        rows = await pool.fetch(
            f"""SELECT p.id, p.org_id, p.photo_key
                  FROM staging.pahchan_punches p
                  LEFT JOIN staging.pahchan_policy pol ON pol.org_id = p.org_id
                 WHERE p.photo_key IS NOT NULL
                   AND p.captured_at < NOW() - (
                         COALESCE(pol.punch_photo_retention_days, {DEFAULTS['punch_photo_retention_days']})
                         * INTERVAL '1 day')
                 ORDER BY p.captured_at, p.id
                 LIMIT {BATCH} OFFSET {failed}"""
            # OFFSET past the rows this run has already tried and failed to
            # delete. A successful delete NULLs photo_key and so leaves the
            # result set on its own; a failed one does not, and without the
            # offset the next statement would fetch the same failing rows
            # forever. `p.id` breaks ties so the ordering is deterministic and
            # the offset means the same thing between statements.
        )
        if not rows:
            drained = True
            break

        for row in rows:
            ok = await _delete_object(str(row["org_id"]), row["photo_key"])
            if not ok:
                # Leave photo_key in place. Clearing it on a failed delete would
                # lose the only pointer to an object still sitting in the bucket.
                failed += 1
                continue
            await pool.execute(
                "UPDATE staging.pahchan_punches SET photo_key = NULL WHERE id = $1::uuid",
                str(row["id"]),
            )
            deleted += 1

    return {
        "photos_deleted": deleted,
        "photos_failed": failed,
        # False means work was still outstanding when the run stopped. This is the
        # signal that the promise is not being kept, and it has to be visible.
        "photos_drained": drained,
    }


async def purge_reference_photos() -> dict:
    """
    Reference pairs for employees who have left, past employment + the grace
    window. Deletes the object and the row — unlike a punch, a reference photo
    carries no payroll fact worth keeping once the person is gone.

    Keyed on the employee's status and `updated_at` rather than a dedicated exit
    date, because `manav_employees` has no exit-date column. That is honest but
    approximate: it measures 45 days from the last edit to a terminated record,
    which is the best available signal and errs toward keeping slightly longer.
    A real `exited_on` column would tighten it and is worth adding.
    """
    pool = await get_pool()

    deleted = 0
    failed = 0
    drained = False

    while deleted + failed < MAX_PER_RUN:
        rows = await pool.fetch(
            f"""SELECT r.id, r.org_id, r.object_key
                  FROM staging.pahchan_enrollment_photos r
                  JOIN staging.manav_employees e ON e.id = r.employee_id
                  LEFT JOIN staging.pahchan_policy pol ON pol.org_id = r.org_id
                 WHERE e.status IN ('terminated', 'resigned', 'absconding')
                   AND e.updated_at < NOW() - (
                         COALESCE(pol.reference_photo_grace_days, {DEFAULTS['reference_photo_grace_days']})
                         * INTERVAL '1 day')
                 ORDER BY e.updated_at, r.id
                 LIMIT {BATCH} OFFSET {failed}"""
        )
        if not rows:
            drained = True
            break

        for row in rows:
            if not await _delete_object(str(row["org_id"]), row["object_key"]):
                failed += 1
                continue
            await pool.execute(
                "DELETE FROM staging.pahchan_enrollment_photos WHERE id = $1::uuid",
                str(row["id"]),
            )
            deleted += 1

    return {
        "references_deleted": deleted,
        "references_failed": failed,
        "references_drained": drained,
    }


async def purge_punch_records() -> dict:
    """
    Punch records past the org's record-retention window.

    Deletes the photo FIRST, then the row. Doing it the other way leaves an object
    with nothing referencing it — §5's orphan case, and the one failure mode that
    makes the promise permanently unkeepable rather than merely late.

    In practice photo_key is almost always already NULL here, because 90 days
    elapses long before 3 years. The check exists for the case where the photo
    purge has been failing silently, which is exactly when it matters.
    """
    pool = await get_pool()

    deleted = 0
    blocked = 0
    drained = False

    while deleted + blocked < MAX_PER_RUN:
        rows = await pool.fetch(
            f"""SELECT p.id, p.org_id, p.photo_key
                  FROM staging.pahchan_punches p
                  LEFT JOIN staging.pahchan_policy pol ON pol.org_id = p.org_id
                 WHERE p.captured_at < NOW() - (
                         COALESCE(pol.record_retention_years, {DEFAULTS['record_retention_years']})
                         * INTERVAL '1 year')
                 ORDER BY p.captured_at, p.id
                 LIMIT {BATCH} OFFSET {blocked}"""
        )
        if not rows:
            drained = True
            break

        for row in rows:
            if row["photo_key"] and not await _delete_object(str(row["org_id"]), row["photo_key"]):
                # Keep the row. A punch record is cheap; an orphaned photograph of
                # someone's face is not, and the row is the only thing that can
                # find it.
                blocked += 1
                continue
            await pool.execute(
                "DELETE FROM staging.pahchan_punches WHERE id = $1::uuid", str(row["id"])
            )
            deleted += 1

    return {
        "records_deleted": deleted,
        "records_blocked": blocked,
        "records_drained": drained,
    }


async def run_pahchan_retention() -> dict:
    """
    All three passes, in the order that keeps them independent.

    Photos before records: a punch whose photo purge succeeds this run may also be
    past its record window, and deleting the photo first means the record pass
    finds nothing to orphan.

    Each pass is isolated so one failing does not skip the others — a bucket
    outage must not also stop record expiry, which needs no object store at all.
    """
    result: dict = {}
    for name, fn in (
        ("punch_photos", purge_punch_photos),
        ("reference_photos", purge_reference_photos),
        ("punch_records", purge_punch_records),
    ):
        try:
            result.update(await fn())
        except Exception as exc:  # noqa: BLE001 — one pass must not stop the rest
            log.exception("pahchan retention: %s pass failed", name)
            result[f"{name}_error"] = str(exc)

    # A pass that stopped with work outstanding is the case that matters, and it
    # is the one that used to look identical to success. Raised to a warning so it
    # is findable, because the consequence is biometric data retained past the
    # window an organisation promised its employees.
    backlog = [k.rsplit("_", 1)[0] for k, v in result.items()
               if k.endswith("_drained") and v is False]
    if backlog:
        log.warning(
            "pahchan retention: INCOMPLETE — %s still had work outstanding at the "
            "per-run ceiling. Data is being retained past its window. %s",
            ", ".join(backlog), result,
        )
    else:
        log.info("pahchan retention: %s", result)
    return result
