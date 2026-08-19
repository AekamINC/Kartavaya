"""`/api/health` carries the outbound fence's attestation.

`OUTBOUND_SUPPRESSED_ORGS` on the staging service is the ONLY thing standing
between an e2e payroll re-run and ~60 hard bounces at the verified sender
domain (`frontend/e2e-real/vetana.spec.ts` and `campaign-send.spec.ts` both
name it as their primary fence). But an env var is deployment state, and the
suites run against the DEPLOYED service — a cleared or typo'd Railway variable
is invisible to them unless the process says, at runtime, what it booted with.

So the public meta endpoint reports two fields:

    outbound_mode          — the string THIS process runs with
    suppressed_orgs_digest — sha256 hex, first 16 chars, of the comma-joined
                             SORTED lowercase org ids; empty set -> "0"

A digest and never the ids: the endpoint is unauthenticated and the
names-not-ids rule covers org ids too. A caller that already knows an id (the
e2e suite knows its own org) hashes the set it expects and compares —
attestation without disclosure. `_helpers.ts::assertOutboundFence` is the
consumer; the digest rule pinned here is the rule it computes against, so a
drift on either side fails one of the two suites rather than silently
unshielding the org.

STYLE. `SUPPRESSED_ORGS` and `MODE` are PATCHED on the `outbound` module,
never set in the environment — same seam as `test_outbound_suppressed_orgs.py`,
and the reason the endpoint reads them through the module attribute per call.
"""
import hashlib

import pytest

import health
import outbound

#: The org the fence exists for — the staging E2E org. The literal id, not a
#: placeholder: this is the value the Railway var carries, and the value
#: `frontend/e2e-real/_helpers.ts` hashes on its side of the contract.
E2E_ORG = "64e7bea6-6abe-490c-a2a4-27a60c6be916"

OTHER_ORG = "22222222-2222-2222-2222-222222222222"


# ════════════════════════════════════════════════════════════════════════════
# 1. THE DIGEST RULE — pinned against an independent computation
# ════════════════════════════════════════════════════════════════════════════

def test_digest_of_a_known_set_matches_a_locally_computed_sha256():
    expected = hashlib.sha256(E2E_ORG.encode()).hexdigest()[:16]
    assert health.suppressed_orgs_digest(frozenset({E2E_ORG})) == expected
    # 16 hex chars exactly — the truncation is part of the contract the
    # TypeScript side computes against.
    assert len(expected) == 16


def test_a_multi_org_digest_joins_sorted_with_commas():
    """The digest is a function of the SET: sorted before joining, so the
    operator's ordering of the env var cannot change the attestation."""
    joined = ",".join(sorted([E2E_ORG, OTHER_ORG]))
    expected = hashlib.sha256(joined.encode()).hexdigest()[:16]
    assert health.suppressed_orgs_digest({E2E_ORG, OTHER_ORG}) == expected
    assert health.suppressed_orgs_digest({OTHER_ORG, E2E_ORG}) == expected


def test_the_empty_set_digests_to_the_literal_zero():
    """Not the hash of "" — "0" is unmistakable in a curl, and the e2e fence
    treats anything that is not the expected digest (this included) as
    'the org is not shielded'."""
    assert health.suppressed_orgs_digest(frozenset()) == "0"
    assert health.suppressed_orgs_digest(None) == "0"


def test_case_is_canonicalised_before_hashing():
    """`outbound._parse_suppressed_orgs` already lowercases through
    `uuid.UUID`, but the digest lowercases defensively — a future caller
    handing it raw strings must not mint a second digest for the same org."""
    assert (health.suppressed_orgs_digest({E2E_ORG.upper()})
            == health.suppressed_orgs_digest({E2E_ORG}))


# ════════════════════════════════════════════════════════════════════════════
# 2. THE ENDPOINT CARRIES BOTH FIELDS, READ FROM outbound's PARSED STATE
# ════════════════════════════════════════════════════════════════════════════

async def test_health_reports_mode_and_digest(api_client, monkeypatch):
    monkeypatch.setattr(outbound, "SUPPRESSED_ORGS", frozenset({E2E_ORG}))

    r = await api_client.get("/api/health")
    assert r.status_code == 200
    body = r.json()

    # The string the process runs with — conftest booted this suite dry.
    assert body["outbound_mode"] == outbound.MODE == "dry"
    assert body["suppressed_orgs_digest"] == \
        hashlib.sha256(E2E_ORG.encode()).hexdigest()[:16]


async def test_health_reads_the_module_per_request_not_at_import(
    api_client, monkeypatch,
):
    """The same "read now, so a test may patch it" contract as `begin()`.

    A `from outbound import ...` in health.py would freeze the boot values and
    this pair of requests would answer identically — which is exactly the
    failure the fence exists to catch on the deployed service, where the
    question is what the PROCESS holds, not what the source held at import.
    """
    monkeypatch.setattr(outbound, "SUPPRESSED_ORGS", frozenset())
    monkeypatch.setattr(outbound, "MODE", "live")
    first = (await api_client.get("/api/health")).json()
    assert first["outbound_mode"] == "live"
    assert first["suppressed_orgs_digest"] == "0"

    monkeypatch.setattr(outbound, "SUPPRESSED_ORGS", frozenset({E2E_ORG}))
    second = (await api_client.get("/api/health")).json()
    assert second["suppressed_orgs_digest"] == \
        hashlib.sha256(E2E_ORG.encode()).hexdigest()[:16]


async def test_no_org_id_ever_appears_in_the_health_body(api_client, monkeypatch):
    """The reason it is a digest. Unauthenticated endpoint, names-not-ids:
    the suppression list must be verifiable without a single tenant id —
    whole, hyphenless or fragment — leaking to whoever curls /api/health."""
    monkeypatch.setattr(outbound, "SUPPRESSED_ORGS",
                        frozenset({E2E_ORG, OTHER_ORG}))

    text = (await api_client.get("/api/health")).text.lower()
    for org in (E2E_ORG, OTHER_ORG):
        assert org not in text
        assert org.replace("-", "") not in text
        assert org.split("-")[0] not in text
