"""Upload the five demo agreements and repoint the demo documents at them.

RUN THIS WHERE R2 AND THE DATABASE ARE BOTH REACHABLE — a Railway shell on the
staging service, or any machine with the platform R2 variables and DATABASE_URL.
It cannot run from the authoring machine: there are no R2 credentials there and
asyncpg cannot reach the database from it.

    python backend/scripts/make_demo_esign_pdfs.py     # generate (run anywhere)
    python backend/scripts/place_demo_esign_pdfs.py    # upload + repoint

WHAT IT FIXES. Measured 2026-08-06 against the live database: the Unicode Group
demo organisation holds 20 e-sign documents, and **six of them share one PDF** —
`esign/originals/3ff1ede5f1274441b4e88eb8b4cb66d1.pdf`. The Engagement Letter, the
NDA, the Virtual CFO agreement, the ERP statement of work and the payroll
agreement are the same file under five titles. Open two in a demo and the illusion
is gone.

WHY IT IS NOT A .sql FILE. `storage.upload_file` mints a uuid4 key per upload, so
the key cannot be known before the upload happens and cannot be written into a
seed in advance. Upload and repoint therefore have to be one operation.

IDEMPOTENT. A document whose `file_hash` already matches the generated PDF is
skipped — no re-upload, no orphaned object. Nothing is ever deleted: the old
shared PDF stays in the bucket, because other organisations' rows may point at it
and this script has no way to know that they do not.

WHAT IT DELIBERATELY DOES NOT DO. Two rows in the same organisation hold the
literal string `pending` in `file_key` and `file_url` ("Cancel Test Document",
"QA Test Agreement"), and eleven more are titled "E2E Test Contract #1".."#10".
That is test debris sitting in the organisation used for buyer demos. Removing it
is a deletion, and deletions get counted and approved separately — see the report
this script shipped with.
"""
import asyncio
import hashlib
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ORG_ID = "fae87907-2f99-4b35-a241-c94d9e1e4a17"   # Unicode Group

#: slug -> the exact `sign_documents.title` values that should point at it.
#: Titles rather than ids, because the ids differ per environment and a title
#: that has been edited SHOULD fail to match rather than repoint the wrong row.
TARGETS = {
    "engagement-letter-statutory-audit": [
        "Engagement Letter — FY 2026-27 Statutory Audit",
        "Engagement Letter — FY 2026-27 Statutory Audit — Aarna Textile Mills",
    ],
    "non-disclosure-agreement": [
        "Non-Disclosure Agreement — Kaveri Chemicals due diligence",
    ],
    "virtual-cfo-services-agreement": [
        "Virtual CFO Services Agreement — Bhavya Infra Projects",
    ],
    "erp-support-statement-of-work": [
        "ERP Support Statement of Work — Indira Software Labs",
    ],
    "payroll-outsourcing-agreement": [
        "Payroll Outsourcing Agreement — Gokul Dairy Foods (draft)",
    ],
}

ASSETS = Path(__file__).resolve().parent / "demo_assets" / "esign"


async def main() -> int:
    from db import get_pool
    from services.storage import upload_file

    missing = [s for s in TARGETS if not (ASSETS / f"{s}.pdf").exists()]
    if missing:
        print(f"generate them first — missing: {', '.join(sorted(missing))}")
        print("    python backend/scripts/make_demo_esign_pdfs.py")
        return 1

    pool = await get_pool()
    uploaded = repointed = skipped = 0

    for slug, titles in TARGETS.items():
        pdf = (ASSETS / f"{slug}.pdf").read_bytes()
        digest = hashlib.sha256(pdf).hexdigest()

        rows = await pool.fetch(
            """
            SELECT id, title, file_hash FROM public.sign_documents
            WHERE org_id = $1::uuid AND title = ANY($2::text[])
            """,
            ORG_ID, titles,
        )
        if not rows:
            print(f"  !  {slug}: no document matches {titles}")
            continue

        todo = [r for r in rows if r["file_hash"] != digest]
        for r in rows:
            if r["file_hash"] == digest:
                skipped += 1
                print(f"  =  {r['title'][:60]} already current")
        if not todo:
            continue

        result = await upload_file(
            pdf, f"{slug}.pdf", "application/pdf",
            user_id="system", folder="esign/originals", org_id=ORG_ID,
        )
        uploaded += 1
        print(f"  ^  uploaded {slug}.pdf -> {result['key']}")

        for r in todo:
            await pool.execute(
                """
                UPDATE public.sign_documents
                SET file_key = $1, file_url = $2, file_hash = $3, updated_at = NOW()
                WHERE id = $4
                """,
                result["key"], result["url"], digest, r["id"],
            )
            repointed += 1
            print(f"  ->  {r['title'][:60]}")

    print(f"\nuploaded {uploaded} · repointed {repointed} · already current {skipped}")

    # The claim this script exists to make, checked rather than asserted.
    dupes = await pool.fetchval(
        """
        SELECT count(*) FROM (
            SELECT file_key FROM public.sign_documents
            WHERE org_id = $1::uuid AND file_key <> 'pending'
            GROUP BY file_key HAVING count(*) > 1
        ) q
        """,
        ORG_ID,
    )
    print(f"file_keys still shared by more than one document: {dupes}")
    return 0


if __name__ == "__main__":
    if not os.getenv("DATABASE_URL"):
        print("DATABASE_URL is not set — run this on the server, not locally.")
        raise SystemExit(2)
    raise SystemExit(asyncio.run(main()))
