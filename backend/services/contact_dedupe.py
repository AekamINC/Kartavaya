"""
contact_dedupe.py — Duplicate detection + merge for Graha contacts.

Shared by the Graha router and by every inbound source that can create a
contact (inbound-leads, web forms, Sanvaad/WhatsApp, enrichment, scan capture).
Call find_duplicates() at write time — do not rely on a cleanup batch.

Match strategy, in confidence order:
  1. email_norm exact   — lower(trim(email))
  2. phone_norm exact   — last 10 digits; the identity key for WhatsApp
  3. name + company     — trigram similarity, review-only, never auto

Merging is non-destructive: the loser keeps its row (is_active=FALSE,
merged_into_id set) and every merge records an undo payload.
"""
import json
import logging
from typing import Optional

import asyncpg

log = logging.getLogger(__name__)

# Trigram thresholds, calibrated against measured pg_trgm similarity rather
# than guessed. Indian names make this unusually sharp — a one-letter change is
# often a DIFFERENT person, while an abbreviation is the SAME one:
#
#   Rajesh Kumar / Ramesh Kumar          0.625   different people
#   Acme Traders / Acme Traders Pvt Ltd  0.619   same company
#   Rajesh Kumar / Rajesh K              0.571   same person
#   Amit Shah    / Amit Sharma           0.571   different people
#   Sunil Mehta  / Anil Mehta            0.533   different people
#
# The true/false bands overlap, so no threshold separates them cleanly.
# NAME 0.75 sits in the one clean gap that exists — above the worst false
# positive (Ramesh/Rajesh 0.625) and below the worst real typo we want to
# catch (Kumaar/Sharmaa 0.786-0.800).
#
# Known, accepted limitation: abbreviations ("Rajesh K" 0.571, "R Kumar" 0.500)
# are NOT caught. They cannot be, without also matching "Ramesh Kumar" — and
# wrongly merging two real people is far worse than leaving a duplicate row.
#
# COMPANY is loose (0.50) on purpose: the "Pvt Ltd"/"& Sons" suffix is near
# universal in India and drags real matches down to ~0.62. Name carries the
# precision; company only has to confirm they are at the same firm.
#
# pg_trgm is already case- and whitespace-insensitive (verified: "rajesh kumar"
# vs "Rajesh Kumar" = 1.000), so no pre-normalization is needed here.
NAME_SIMILARITY_THRESHOLD = 0.75
COMPANY_SIMILARITY_THRESHOLD = 0.50

# Survivor fields backfilled from the loser when the survivor's value is blank.
#
# ── WHY `client_id` IS ON THIS LIST, AND WHY IT IS NOT COSMETIC ─────────────
#
# A CRM client is the COMPANY. `graha_contacts.client_id` is the only column
# that says which company a person belongs to, and since the ICAI gate shipped
# it decides whether that person can be written to at all:
# `prachar._resolve_audience` adds `AND client_id IS NOT NULL` to every audience
# it builds — preview, unsaved-filter preview, `/send`, and the scheduled sender
# — because a chartered accountant soliciting a NON-client is professional
# misconduct under Clause (6), Part I, First Schedule.
#
# The column was missing from this tuple, so merging a person who HAD an
# employer into a survivor who had none carried everything across EXCEPT the one
# field that decides emailability. The loser then became a tombstone
# (`is_active=FALSE`), which every audience already excludes — so the link did
# not move, it was destroyed, and a duplicate cleanup quietly made a contactable
# person uncontactable. Nothing said so at the time and nothing says so after.
#
# BACKFILL ONLY — never an overwrite. The guard below writes the loser's value
# only where the survivor's is blank, so a survivor who already belongs to a
# company keeps it. Contacts come and go; the customer stays.
#
# Measured on the live database on 2026-08-21, SELECT-only:
# `staging.graha_contact_merges` is EMPTY. No merge has ever run, so nothing has
# been destroyed yet and there is nothing to repair — this is a fix landing
# ahead of the first merge rather than after one, which is the only comfortable
# time to make it. Of the 291 live contacts, 126 carry no company; none of them
# got there this way.
#
# The value is NOT re-validated against `graha_clients` on the way across, and
# that is deliberate: both rows were fetched `org_id=$2::uuid` and both were
# live, so the link is moving between two contacts of the same organisation. It
# can neither cross a tenant boundary that was not already crossed nor widen an
# audience — the same human was already in it, under the losing row.
_MERGEABLE_FIELDS = (
    "name", "email", "phone", "company", "designation",
    "gstin", "pan", "notes", "source", "client_id",
)
_JSON_FIELDS = ("billing_address", "shipping_address")

#: Members of `_MERGEABLE_FIELDS` that are `uuid` rather than text.
#:
#: They need a cast going in and, more importantly, coming BACK OUT.
#: `undo_merge` reverts each backfilled field to the value the survivor held
#: before — which for a backfilled `client_id` is ALWAYS NULL, because the
#: backfill only runs when the survivor's was blank. The text branch there binds
#: `""` for a missing value, and an empty string reaching a `::uuid` cast is a
#: parse error that PgBouncer returns as an instant 500. `NULLIF($n,'')::uuid`
#: is the one shape that says both "this company" and "no company" without a
#: second statement, and it is what every other write path in this product uses
#: for a clearable uuid.
_UUID_FIELDS = ("client_id",)

#: Every column `undo_merge` is allowed to write, and the reason it is a set
#: rather than an assumption.
#:
#: `undo_merge` reads its column NAMES out of `graha_contact_merges.field_updates`
#: — a jsonb column — and interpolates them straight into the SET list. Today
#: `merge_contacts` is the only writer of that column and it only ever names
#: what is below, so nothing is wrong. But an identifier taken from stored data
#: and spliced into SQL is a shape that only stays safe by luck, and the two
#: functions are eight hundred lines and one release apart. Filtered here, so
#: the undo can touch exactly the columns the merge can touch and no others —
#: which is also what lets `client_id` be routed to the `NULLIF(…)::uuid` bind
#: with certainty rather than by hoping the key was spelled the expected way.
_UNDOABLE_FIELDS = frozenset(_MERGEABLE_FIELDS) | frozenset(_JSON_FIELDS) | {
    "tags", "lead_score",
}


def normalize_email(email: Optional[str]) -> Optional[str]:
    """Mirror of the email_norm generated column (migration 024)."""
    if not email:
        return None
    return (email.strip().lower() or None)


def normalize_phone(phone: Optional[str]) -> Optional[str]:
    """
    Mirror of the phone_norm generated column (migration 024).
    Strips non-digits and keeps the last 10. Returns None below 10 digits so
    that short/garbage input never matches.
    """
    if not phone:
        return None
    digits = "".join(ch for ch in phone if ch.isdigit())
    return digits[-10:] if len(digits) >= 10 else None


async def find_duplicates(
    pool,
    org_id: str,
    *,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    name: Optional[str] = None,
    company: Optional[str] = None,
    exclude_id: Optional[str] = None,
) -> list[dict]:
    """
    Return candidate duplicates for the given identifiers, best match first.

    Each row carries match_type ('email'|'phone'|'fuzzy') and confidence
    (0..1). Callers decide what to do: inbound paths should attach to an
    exact match; the UI shows fuzzy matches for human review.
    """
    email_norm = normalize_email(email)
    phone_norm = normalize_phone(phone)

    matches: list[dict] = []
    seen: set[str] = set()

    async def _collect(rows, match_type: str, confidence_expr) -> None:
        for r in rows:
            cid = str(r["id"])
            if cid in seen or cid == exclude_id:
                continue
            seen.add(cid)
            d = dict(r)
            d["id"] = cid
            d["match_type"] = match_type
            d["confidence"] = (
                confidence_expr(r) if callable(confidence_expr) else confidence_expr
            )
            matches.append(d)

    base_cols = (
        "id, name, email, phone, company, contact_type, lead_score, created_at"
    )
    # Exclude already-merged rows: they are tombstones pointing at a survivor.
    live = "org_id=$1::uuid AND is_active=TRUE AND merged_into_id IS NULL"

    if email_norm:
        rows = await pool.fetch(
            f"SELECT {base_cols} FROM public.graha_contacts "
            f"WHERE {live} AND email_norm=$2 LIMIT 25",
            org_id, email_norm,
        )
        await _collect(rows, "email", 1.0)

    if phone_norm:
        rows = await pool.fetch(
            f"SELECT {base_cols} FROM public.graha_contacts "
            f"WHERE {live} AND phone_norm=$2 LIMIT 25",
            org_id, phone_norm,
        )
        await _collect(rows, "phone", 1.0)

    # Fuzzy is review-only. Require a company on both sides — name alone is far
    # too weak in India, where common names collide constantly across records.
    if name and company:
        rows = await pool.fetch(
            f"SELECT {base_cols}, "
            f"  similarity(name, $2) AS name_sim, "
            f"  similarity(company, $3) AS company_sim "
            f"FROM public.graha_contacts "
            f"WHERE {live} "
            f"  AND company IS NOT NULL AND company <> '' "
            f"  AND similarity(name, $2) > $4 "
            f"  AND similarity(company, $3) > $5 "
            f"ORDER BY similarity(name, $2) DESC LIMIT 25",
            org_id, name, company,
            NAME_SIMILARITY_THRESHOLD, COMPANY_SIMILARITY_THRESHOLD,
        )
        await _collect(
            rows, "fuzzy",
            lambda r: round(float(r["name_sim"]) * float(r["company_sim"]), 3),
        )

    matches.sort(key=lambda m: m["confidence"], reverse=True)
    return matches


async def _referencing_tables(conn) -> list[tuple[str, str]]:
    """
    Discover every (table, column) with an FK to graha_contacts, from the
    catalog rather than a hardcoded list — Sanvaad and enrichment will add
    more, and a stale list here would silently orphan their rows on merge.
    Self-references (merged_into_id) are excluded.
    """
    rows = await conn.fetch(
        """
        SELECT con.conrelid::regclass::text AS tbl, att.attname AS col
        FROM pg_constraint con
        JOIN pg_attribute att
          ON att.attrelid = con.conrelid
         AND att.attnum   = con.conkey[1]
        WHERE con.contype = 'f'
          AND con.confrelid = 'graha_contacts'::regclass
          AND con.conrelid <> 'graha_contacts'::regclass
        ORDER BY 1
        """
    )
    return [(r["tbl"], r["col"]) for r in rows]


async def _unique_cols(conn, table: str, fk_col: str) -> Optional[list[str]]:
    """
    If `table` has a unique constraint/index containing fk_col, return its full
    column list. Re-pointing rows on such a table can breach it — e.g.
    graha_contact_labels PK is (contact_id, label_id), so merging two contacts
    that share a label would collide.
    """
    rows = await conn.fetch(
        """
        SELECT array_agg(att.attname ORDER BY att.attnum) AS cols
        FROM pg_index idx
        JOIN pg_attribute att
          ON att.attrelid = idx.indrelid
         AND att.attnum = ANY(idx.indkey)
        WHERE idx.indrelid = $1::regclass
          AND idx.indisunique
        GROUP BY idx.indexrelid
        """,
        table,
    )
    for r in rows:
        cols = list(r["cols"] or [])
        if fk_col in cols and len(cols) > 1:
            return cols
    return None


async def merge_contacts(
    pool,
    org_id: str,
    survivor_id: str,
    merged_ids: list[str],
    actor_id: Optional[str] = None,
) -> dict:
    """
    Merge `merged_ids` into `survivor_id`. Runs in one transaction: either the
    whole merge lands or none of it does.

    Steps per loser:
      1. re-point every FK row to the survivor (dropping rows that would breach
         a unique constraint, snapshotting them first for undo)
      2. backfill blank survivor fields from the loser — INCLUDING `client_id`,
         the company the person belongs to and the column the ICAI marketing
         gate reads; union tags; max lead_score
      3. soft-merge the loser (is_active=FALSE, merged_into_id=survivor)
      4. record an undo payload

    Returns {"merge_ids": [...], "moved": {table: count}}.
    """
    if survivor_id in merged_ids:
        raise ValueError("A contact cannot be merged into itself")
    if not merged_ids:
        raise ValueError("No contacts to merge")

    results = {"merge_ids": [], "moved": {}}

    async with pool.acquire() as conn:
        async with conn.transaction():
            # Lock the survivor to serialize concurrent merges of the same target.
            survivor = await conn.fetchrow(
                "SELECT * FROM public.graha_contacts "
                "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE "
                "  AND merged_into_id IS NULL "
                "FOR UPDATE",
                survivor_id, org_id,
            )
            if not survivor:
                raise ValueError("Survivor contact not found or already merged")

            fk_tables = await _referencing_tables(conn)

            for loser_id in merged_ids:
                loser = await conn.fetchrow(
                    "SELECT * FROM public.graha_contacts "
                    "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE "
                    "  AND merged_into_id IS NULL "
                    "FOR UPDATE",
                    loser_id, org_id,
                )
                if not loser:
                    raise ValueError(f"Contact {loser_id} not found or already merged")

                moved_rows: dict[str, list[str]] = {}
                dropped_rows: dict[str, list[dict]] = {}

                # ── 1. Re-point FK rows ────────────────────────────────
                for tbl, col in fk_tables:
                    uniq = await _unique_cols(conn, tbl, col)

                    if uniq:
                        # Drop loser rows whose re-pointed key already exists on
                        # the survivor. Snapshot them first so undo can restore.
                        others = [c for c in uniq if c != col]
                        pred = " AND ".join(
                            f"s.{c} IS NOT DISTINCT FROM l.{c}" for c in others
                        )
                        clashes = await conn.fetch(
                            f"SELECT to_jsonb(l.*) AS row FROM {tbl} l "
                            f"WHERE l.{col}=$1::uuid AND EXISTS ("
                            f"  SELECT 1 FROM {tbl} s "
                            f"  WHERE s.{col}=$2::uuid AND {pred})",
                            loser_id, survivor_id,
                        )
                        if clashes:
                            dropped_rows[tbl] = [json.loads(c["row"]) for c in clashes]
                            await conn.execute(
                                f"DELETE FROM {tbl} l "
                                f"WHERE l.{col}=$1::uuid AND EXISTS ("
                                f"  SELECT 1 FROM {tbl} s "
                                f"  WHERE s.{col}=$2::uuid AND {pred})",
                                loser_id, survivor_id,
                            )

                    try:
                        rows = await conn.fetch(
                            f"UPDATE {tbl} SET {col}=$1::uuid "
                            f"WHERE {col}=$2::uuid RETURNING ctid::text AS rid",
                            survivor_id, loser_id,
                        )
                    except asyncpg.UniqueViolationError as e:
                        # A unique shape we did not anticipate. Abort loudly and
                        # roll back rather than corrupt the graph.
                        raise ValueError(
                            f"Cannot merge: re-pointing {tbl}.{col} breaches a "
                            f"unique constraint ({e}). Resolve manually."
                        ) from e

                    if rows:
                        moved_rows[tbl] = [r["rid"] for r in rows]
                        results["moved"][tbl] = results["moved"].get(tbl, 0) + len(rows)

                # ── 2. Backfill survivor from loser ────────────────────
                field_updates: dict[str, dict] = {}
                sets, params, idx = [], [survivor_id], 2

                for f in _MERGEABLE_FIELDS:
                    s_val, l_val = survivor[f], loser[f]
                    if (not s_val or str(s_val).strip() == "") and l_val:
                        field_updates[f] = {"from": s_val, "to": l_val}
                        if f in _UUID_FIELDS:
                            # Bound through NULLIF for symmetry with the undo,
                            # which has to bind the same column with nothing in
                            # it. asyncpg hands a uuid column back as
                            # `uuid.UUID`; `str()` is what `field_updates` is
                            # serialised with too, so the value that goes in and
                            # the value recorded for the undo are the same text.
                            sets.append(f"{f}=NULLIF(${idx},'')::uuid")
                            params.append(str(l_val))
                        else:
                            sets.append(f"{f}=${idx}")
                            params.append(l_val)
                        idx += 1

                for f in _JSON_FIELDS:
                    s_val = survivor[f]
                    s_parsed = json.loads(s_val) if isinstance(s_val, str) else s_val
                    l_val = loser[f]
                    l_parsed = json.loads(l_val) if isinstance(l_val, str) else l_val
                    if not s_parsed and l_parsed:
                        field_updates[f] = {"from": s_parsed, "to": l_parsed}
                        sets.append(f"{f}=${idx}::jsonb")
                        params.append(json.dumps(l_parsed))
                        idx += 1

                # Tags: union, order-stable.
                s_tags = list(survivor["tags"] or [])
                l_tags = list(loser["tags"] or [])
                union = s_tags + [t for t in l_tags if t not in s_tags]
                if union != s_tags:
                    field_updates["tags"] = {"from": s_tags, "to": union}
                    sets.append(f"tags=${idx}")
                    params.append(union)
                    idx += 1

                # Lead score: keep the higher. The loser may hold the signal
                # that actually scored (e.g. it was the one that replied).
                s_score = survivor["lead_score"] or 0
                l_score = loser["lead_score"] or 0
                if l_score > s_score:
                    field_updates["lead_score"] = {"from": s_score, "to": l_score}
                    sets.append(f"lead_score=${idx}")
                    params.append(l_score)
                    idx += 1

                if sets:
                    sets.append("updated_at=NOW()")
                    await conn.execute(
                        f"UPDATE public.graha_contacts SET {', '.join(sets)} "
                        f"WHERE id=$1::uuid",
                        *params,
                    )
                    survivor = await conn.fetchrow(
                        "SELECT * FROM public.graha_contacts WHERE id=$1::uuid",
                        survivor_id,
                    )

                # ── 3. Soft-merge the loser ────────────────────────────
                await conn.execute(
                    "UPDATE public.graha_contacts "
                    "SET is_active=FALSE, merged_into_id=$1::uuid, updated_at=NOW() "
                    "WHERE id=$2::uuid",
                    survivor_id, loser_id,
                )

                # ── 4. Undo payload ───────────────────────────────────
                merge_row = await conn.fetchrow(
                    "INSERT INTO public.graha_contact_merges "
                    "(org_id, survivor_id, merged_id, moved_rows, field_updates, "
                    " dropped_rows, actor_id) "
                    "VALUES ($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::jsonb, "
                    "        $6::jsonb, NULLIF($7::text,'')) "
                    "RETURNING id",
                    org_id, survivor_id, loser_id,
                    json.dumps({t: len(v) for t, v in moved_rows.items()}),
                    json.dumps(field_updates, default=str),
                    json.dumps(dropped_rows, default=str),
                    actor_id or "",
                )
                results["merge_ids"].append(str(merge_row["id"]))
                log.info(
                    "Merged contact %s into %s (org=%s, tables=%s)",
                    loser_id, survivor_id, org_id, list(moved_rows),
                )

    return results


async def undo_merge(pool, org_id: str, merge_id: str, actor_id: Optional[str] = None) -> dict:
    """
    Reverse a merge: send re-pointed rows back to the loser, revert the
    survivor's backfilled fields, and reactivate the loser.

    Rows created *after* the merge stay with the survivor — we only move back
    what this merge moved. Dropped rows (unique-constraint clashes) are
    restored from their snapshots.

    `client_id` reverts like every other backfilled field: to NULL, because a
    backfill only ever ran where the survivor had none. The company returns to
    the loser, which is reactivated below still holding it — an undo puts the
    state back exactly, and does not leave one company attached to two contacts.
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            m = await conn.fetchrow(
                "SELECT * FROM public.graha_contact_merges "
                "WHERE id=$1::uuid AND org_id=$2::uuid FOR UPDATE",
                merge_id, org_id,
            )
            if not m:
                raise ValueError("Merge record not found")
            if m["undone_at"]:
                raise ValueError("This merge has already been undone")

            survivor_id = str(m["survivor_id"])
            loser_id = str(m["merged_id"])

            # Only rows still pointing at the survivor and older than the merge
            # belong to the loser. Anything newer was created post-merge and
            # legitimately belongs to the survivor.
            merged_at = m["created_at"]
            fk_tables = await _referencing_tables(conn)

            for tbl, col in fk_tables:
                has_created = await conn.fetchval(
                    "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                    "WHERE table_schema=split_part($1,'.',1) "
                    "  AND table_name=split_part($1,'.',2) "
                    "  AND column_name='created_at')",
                    tbl,
                )
                if has_created:
                    await conn.execute(
                        f"UPDATE {tbl} SET {col}=$1::uuid "
                        f"WHERE {col}=$2::uuid AND created_at < $3",
                        loser_id, survivor_id, merged_at,
                    )
                else:
                    await conn.execute(
                        f"UPDATE {tbl} SET {col}=$1::uuid WHERE {col}=$2::uuid",
                        loser_id, survivor_id,
                    )

            # Restore rows dropped as unique-constraint clashes.
            dropped = m["dropped_rows"]
            dropped = json.loads(dropped) if isinstance(dropped, str) else (dropped or {})
            for tbl, rows in dropped.items():
                for row in rows:
                    cols = list(row.keys())
                    ph = ", ".join(f"${i+1}" for i in range(len(cols)))
                    await conn.execute(
                        f"INSERT INTO {tbl} ({', '.join(cols)}) VALUES ({ph}) "
                        f"ON CONFLICT DO NOTHING",
                        *[row[c] for c in cols],
                    )

            # Revert survivor fields this merge backfilled.
            fu = m["field_updates"]
            fu = json.loads(fu) if isinstance(fu, str) else (fu or {})
            if fu:
                sets, params, idx = [], [survivor_id], 2
                for f, change in fu.items():
                    if f not in _UNDOABLE_FIELDS:
                        # A column name this module never wrote. Skipped rather
                        # than interpolated — see `_UNDOABLE_FIELDS`. Logged at
                        # warning because the only ways to get here are a merge
                        # record written by something that is not
                        # `merge_contacts`, or a field dropped from the
                        # allowlist after a merge already recorded it; both are
                        # worth a human reading a line about.
                        log.warning(
                            "undo_merge %s: field_updates names %r, which is "
                            "not a column this module backfills — skipped",
                            merge_id, f,
                        )
                        continue
                    old = change.get("from")
                    if f in _JSON_FIELDS:
                        sets.append(f"{f}=${idx}::jsonb")
                        params.append(json.dumps(old or {}))
                    elif f == "tags":
                        sets.append(f"{f}=${idx}")
                        params.append(old or [])
                    elif f == "lead_score":
                        sets.append(f"{f}=${idx}")
                        params.append(old or 0)
                    elif f in _UUID_FIELDS:
                        # `""` means "the survivor had no company", which is the
                        # ONLY case a backfill of this column can have come from
                        # — `merge_contacts` writes it exclusively where the
                        # survivor's was blank. NULLIF turns that back into a
                        # real NULL; the text branch below would bind `''`
                        # straight at a uuid column, which PgBouncer reports as
                        # an instant 500 rather than as the parse error it is.
                        #
                        # Undoing a merge therefore RE-BREAKS the link, and that
                        # is correct: the loser is reactivated on the next
                        # statement still holding its own `client_id`, so the
                        # company goes back to the row it came from rather than
                        # being held by both. An undo restores the state before
                        # the merge exactly, unemailable survivor included.
                        sets.append(f"{f}=NULLIF(${idx},'')::uuid")
                        params.append(str(old) if old else "")
                    else:
                        sets.append(f"{f}=${idx}")
                        params.append(old if old is not None else "")
                    idx += 1
                sets.append("updated_at=NOW()")
                await conn.execute(
                    f"UPDATE public.graha_contacts SET {', '.join(sets)} "
                    f"WHERE id=$1::uuid",
                    *params,
                )

            await conn.execute(
                "UPDATE public.graha_contacts "
                "SET is_active=TRUE, merged_into_id=NULL, updated_at=NOW() "
                "WHERE id=$1::uuid",
                loser_id,
            )
            await conn.execute(
                "UPDATE public.graha_contact_merges "
                "SET undone_at=NOW(), undone_by=NULLIF($2::text,'') WHERE id=$1::uuid",
                merge_id, actor_id or "",
            )
            log.info("Undid merge %s: restored contact %s", merge_id, loser_id)

    return {"status": "undone", "restored_contact_id": loser_id}
