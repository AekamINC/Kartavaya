"""
storage_keys.py — ONE grammar for every object key this product writes.

Proposal 83 §3 catalogued what was there, read off every caller of
`upload_file`, and found FOUR different grammars for one idea:

    esign/originals                module / kind — no document id anywhere
    esign/signatures
    crm/{client_id}/documents      module / id / kind
    pahchan/{org_id}/punch         module / TENANT / kind
    projects/{team_id}             module / id — no kind
    srijan/images                  module / kind
    personal/{user_id}             the default when no folder is passed

A reader cannot predict a key without reading the caller, which is the whole
cost. The specific things that were broken by it:

  · eSIGN HAD NO ENTITY ID AT ALL. Every signature ever captured, for every
    document, sat in one flat prefix. "Show me the files for this agreement"
    could only be answered from the database; the bucket could not answer it.
  · NO DATE, ANYWHERE. So there is no cheap listing, no retention sweep and no
    lifecycle rule — and 1,659 punches today becomes hundreds of thousands with
    one real customer, all under one prefix.
  · THE ORIGINAL FILENAME WAS THROWN AWAY. The key was a bare uuid, so
    "I uploaded Invoice-Mar.pdf" could not be answered from storage.
  · DELETING AN ENTITY COULD NOT DELETE ITS FILES, because its files were not
    gathered anywhere.
  · THE ORG ID APPEARED TWICE. `pahchan` built `pahchan/{org_id}/punch`, and on
    the platform bucket the resolver then prepended `org/{org_id}/`, so the
    stored key named the same organisation twice.

── THE RULE ────────────────────────────────────────────────────────────────

The owner stated the shape as four examples; underneath them is one rule:

    the module owns the top folder, then WHAT the file belongs to, then WHO did
    it, and the acting user is always the last folder before the files.

Plus a date partition, without which retention and listing are not possible at
all:

    esign/{document_id}/{kind}/{user_id}/2026/08/01JQ8…--supply-agreement.pdf
    projects/{team_id}/{user_id}/2026/08/01JQ8…--tb-march.xlsx
    crm/{client_id}/{user_id}/2026/08/01JQ8…--gst-certificate.pdf
    srijan/{content_type}/{user_id}/2026/08/01JQ8…--diwali-post.png
    pahchan/{kind}/{employee_id}/2026/08/01JQ8…--clock-in.jpg
    personal/{user_id}/2026/08/01JQ8…--screenshot.png

`personal` is the one place the user segment appears once rather than twice,
because there the user IS what the file belongs to.

── THE ORG IS NOT IN HERE, AND THAT IS THE POINT ───────────────────────────

The storage layer supplies the tenant itself, and it does so differently
depending on which bucket the org is on:

    own bucket       key_prefix = ""                 the BUCKET is the tenant
    platform bucket  key_prefix = "org/{org_id}/"    the PREFIX is the tenant

So writing the org into a caller's folder is redundant on an org's own bucket
and DUPLICATED on the platform bucket. `build_key` refuses an org id in the
scope for that reason — see `_looks_like_the_org`.

── WHAT MUST NOT BREAK ─────────────────────────────────────────────────────

`_client_for_key` decides the bucket FROM THE KEY: one starting `org/` or
`shared/` is on the platform bucket, anything else is on the org's own. That is
what keeps an org that adds its own credentials later working — its old files
stay signable against the platform bucket instead of 404ing against a new empty
one. No key this module mints may start with either prefix, and none does: they
all start with a module name. `_RESERVED_TOPS` pins it.

Existing keys are stored verbatim and are read verbatim, so nothing already in
a column changes meaning. This grammar applies to what is written from now on.
"""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

#: The tops `_client_for_key` reads as "this is on the platform bucket". A key
#: minted here may never begin with one, or the object would be written to the
#: org's own bucket and looked for on the vendor's.
_RESERVED_TOPS = ("org", "shared")

#: The modules that own a top-level folder. An unknown module is refused rather
#: than admitted, because the failure mode of a typo is a file nobody can find
#: and a retention rule that never matches it.
MODULES = ("esign", "projects", "crm", "srijan", "personal", "pahchan", "procurement")

#: Segments are lower-cased, and anything that is not a letter, digit, dash or
#: underscore becomes a dash. `/` in particular: a scope value containing a
#: slash would silently add a folder level and break every prefix listing.
_SEG_BAD = re.compile(r"[^a-z0-9_-]+")

#: Filenames keep more — dots, for the extension — but lose everything that
#: makes a key ambiguous or a URL awkward.
_NAME_BAD = re.compile(r"[^a-z0-9._-]+")

#: Crockford base32, so a key sorts by time as a string and carries no
#: characters that read as each other in a support ticket (no I, L, O, U).
_B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

#: How much of the original filename survives. Long enough to recognise the
#: file, short enough that a key stays readable and well inside S3's 1024-byte
#: limit once the org prefix and the date are on it.
_NAME_MAX = 60


def _slug(value: str, *, pattern: re.Pattern = _SEG_BAD, limit: int = 80) -> str:
    out = pattern.sub("-", str(value or "").strip().lower()).strip("-._")
    return out[:limit] or "unnamed"


def _sortable_id(now: Optional[datetime] = None) -> str:
    """A time-ordered, URL-safe id — a ULID in all but name.

    Time first so keys under one prefix list in the order they were written,
    which is what makes a retention sweep and a "most recent first" listing
    cheap. Randomness after so two uploads in the same millisecond cannot
    collide. Not `uuid4` alone: a uuid sorts randomly, so a prefix listing has
    no useful order and a lifecycle rule cannot stop early.
    """
    ms = int((now or datetime.now(timezone.utc)).timestamp() * 1000)
    head = ""
    for _ in range(10):
        head = _B32[ms & 31] + head
        ms >>= 5
    rand = uuid.uuid4().int
    tail = ""
    for _ in range(16):
        tail = _B32[rand & 31] + tail
        rand >>= 5
    return head + tail


def _looks_like_the_org(value: str, org_id: Optional[str]) -> bool:
    return bool(org_id) and str(value).strip().lower() == str(org_id).strip().lower()


def build_key(
    module: str,
    *,
    scope: Iterable[str] = (),
    user_id: Optional[str] = None,
    filename: str = "",
    org_id: Optional[str] = None,
    at: Optional[datetime] = None,
) -> str:
    """Mint one object key in the grammar above.

    `scope` is what the file BELONGS to, in order — a document id then a kind
    for eSign, a team id for a project, a client id for CRM, a content type for
    Sahayak, a kind then an employee for Pahchan. `user_id` is who did it and
    is always the last folder before the date.

    `org_id` is taken ONLY so this can refuse to put it in the key. The storage
    layer supplies the tenant, and a caller that adds it as well produces
    `org/{org}/pahchan/{org}/punch/…` — the same organisation named twice in one
    key, which is exactly what proposal 83 calls bug 2.
    """
    module = _slug(module)
    if module not in MODULES:
        raise ValueError(
            f"{module!r} is not a storage module. One of: {', '.join(MODULES)}. "
            "A new module means a new top-level folder and a retention rule to "
            "go with it, so it is declared rather than invented at a call site."
        )
    if module in _RESERVED_TOPS:            # belt and braces; MODULES excludes them
        raise ValueError(f"{module!r} is reserved for the platform-bucket prefix")

    parts = [module]
    for seg in scope:
        if seg is None or str(seg).strip() == "":
            # A missing scope value is DROPPED rather than rendered as an empty
            # segment. `crm/unfiled/documents` is the bucket-of-last-resort
            # proposal 83 complains about, and `crm//documents` would be worse:
            # a double slash is a real, unlistable prefix.
            continue
        if _looks_like_the_org(seg, org_id):
            raise ValueError(
                "the organisation id must not appear in a storage key — the "
                "storage layer supplies the tenant, as the bucket on an org's "
                "own account and as the `org/{id}/` prefix on the platform "
                "bucket. Putting it here names the same org twice."
            )
        parts.append(_slug(seg))

    # `personal` is the one module where the user IS what the file belongs to,
    # so the segment appears once. Everywhere else the acting user is the last
    # folder before the date, whatever the file belongs to.
    if module == "personal":
        if not user_id:
            raise ValueError("a personal key has nowhere to live without a user")
        if not any(p == _slug(user_id) for p in parts[1:]):
            parts.append(_slug(user_id))
    elif user_id:
        parts.append(_slug(user_id))

    when = at or datetime.now(timezone.utc)
    parts.append(f"{when.year:04d}")
    parts.append(f"{when.month:02d}")

    ext = Path(filename or "").suffix.lower()
    stem = _slug(Path(filename or "").stem, pattern=_NAME_BAD, limit=_NAME_MAX)
    parts.append(f"{_sortable_id(when)}--{stem}{ext}")

    return "/".join(parts)


#: Set `KARTAVYA_LEGACY_STORAGE_KEYS=1` to mint keys in the OLD shape.
#:
#: Not a feature flag anybody should leave on. It exists because this grammar
#: changes what every new upload is called, and the one way to find out that a
#: reader somewhere parses a key rather than storing it is to be able to turn
#: the change off in the ninety seconds before anybody notices. Reads are
#: unaffected either way — keys are stored verbatim and `_client_for_key` looks
#: only at the first segment.
LEGACY_KEYS = os.getenv("KARTAVYA_LEGACY_STORAGE_KEYS") == "1"
