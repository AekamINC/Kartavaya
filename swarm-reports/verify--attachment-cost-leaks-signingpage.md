# verify/attachment-cost-leaks-signingpage

Verification and completion of the recovered, never-verified commit `611e982`
("salvage(security): attachment leak, cost basis, SigningPage — recovered from a
killed agent"). Branch: `verify/attachment-cost-leaks-signingpage`, cut from
`611e982`, which itself sits on `2a2a27b` (staging).

Written incrementally. Everything below was confirmed by opening the file at the
time of writing, not from the brief.

---

## 0 · Provenance

`fix/attachment-cost-leaks-signingpage` is checked out and **locked** in another
worktree (`agent-afa75797aea8cccf7`), so it could not be checked out here. I
branched from the same commit instead — same tree, different ref. Nothing on the
original branch was touched.

Diffstat of the recovered commit against staging:

```
 backend/routers/hub.py             |  14 +++-
 backend/routers/scrapers.py        |  11 ++-
 backend/routers/subscription.py    |  16 +++-
 backend/server.py                  |  78 +++++++++++++++++---
 frontend/src/pages/SigningPage.jsx | 145 +++++++++++++++++++++++++------------
```

---

## 1 · The attachment leak

### Every call site, found by grep, not by the brief's line numbers

`grep -rn "_refresh_task_attachments\|_filter_private_attachments" backend/`

`_refresh_task_attachments` is **defined once** (`backend/server.py:684`) and
called at **four** sites after the fix, **three** before it. It is called
nowhere outside `server.py` (`backend/routers/search.py:425` only names it in a
comment).

| # | site | pre-fix | post-fix |
|---|------|---------|----------|
| 1 | `client_tasks` — `GET /api/client/tasks`, server.py:1008 | filtered first (already correct) | unchanged |
| 2 | `client_request_task` — `POST /api/client/tasks/request`, server.py:1238 | **did not call it at all**; returned `row_to_task(row)` under `response_model=TaskOut` | filter → re-sign → `_to_client_task` |
| 3 | `list_tasks` — `GET /api/tasks`, server.py:2080 | **NO FILTER** | filter → re-sign, per row |
| 4 | `_fetch_enriched_task`, server.py:2302 | no filter inside; one of its four callers filtered *after* it returned | filter inside, before re-sign |

`sign_key` (`backend/services/storage.py:181`) mints a **presigned R2 URL with
`ExpiresIn=32400` — nine hours**. So "re-signed" means a working, downloadable,
nine-hour URL. That is the measurement that makes this a leak rather than a
metadata disclosure.

### CLAIM: `GET /api/tasks` exposed private attachments with live signed URLs — **HELD**

Pre-fix `list_tasks` (confirmed from `git show 611e982`'s `-` side):

```python
tasks = [row_to_task(r) for r in rows]
tasks = [await _refresh_task_attachments(pool, t) for t in tasks]
```

No `_filter_private_attachments` anywhere in the function. `GET /api/tasks` is
the org-wide read — its WHERE clause admits `t.team_id=ANY($2::text[])` for every
visible team — so a file the uploader marked `is_private` went to every member of
every team the caller can see, each with a fresh nine-hour download URL. The
recovered diff closes it, and closes it in the right order (filter, then sign).

### The brief's "roughly three sites, two already filtered" is **STALE in the caller's favour** — there were more leaks than briefed

Only site 1 was correct pre-fix. Site 2 did not re-sign at all (a different bug —
it returned the internal `TaskOut` shape to an external client user). And site 4
was leaking through **three of its four callers**:

- `create_task` (`POST /api/tasks`, server.py:2189) — no filter pre-fix
- `get_task` (`GET /api/tasks/{id}`, server.py:2329) — filtered, but **after**
  `_refresh_task_attachments` had already minted the URL
- `update_task` (`PUT /api/tasks/{id}`, server.py:2461) — **no filter at all**
- `move_task` (`PATCH /api/tasks/{id}/move`, server.py:2683) — **no filter at all**

`PUT /api/tasks/{id}` and `PATCH /api/tasks/{id}/move` were therefore full,
unfiltered private-attachment leaks with live signed URLs, exactly like
`GET /api/tasks`. `PATCH /api/tasks/{id}` (server.py:2464) delegates to
`update_task`, so it leaked too. The brief named one endpoint; there were four.
All are closed by the recovered diff.

### Correctness of the fix as written — verified line by line

- `_filter_private_attachments` (server.py:2306) keeps an attachment when
  `not a.is_private or is_creator or user_id in (a.visible_to or [])`. The third
  arm is why the `visible_to` allow-list still works.
- `list_tasks` resolves `is_org_admin` **at most once per request** and only when
  a private attachment actually exists (server.py:2073-2078). Verified the guard:
  `_admin` starts `None`, is only computed under `not is_creator`, and `bool(None)`
  is `False`, so an uncomputed `_admin` cannot grant access.
- `is_org_admin(user_id, org_id=None)` (`backend/middleware/roles.py:114`) reads
  `staging.user_roles`, not the JWT claim. Calling it with one positional arg is
  correct.
- The `list_tasks` SELECT does project `t.created_by_user_id` (server.py:2034), so
  `r["created_by_user_id"]` is real, not a KeyError waiting to happen.
- `_fetch_enriched_task`'s SELECT is `t.*`, so `row["created_by_user_id"]` is
  present there too.
- `get_task` passes `viewer_is_admin=is_creator or _is_admin` into a function that
  recomputes `is_creator` itself; the two agree, and passing the already-resolved
  admin flag keeps it to the same single `user_roles` lookup it did before. No
  extra query.

---

## 2 · SigningPage.jsx

(section written below as it was confirmed — see §2 in the committed file)

---

## 3 · Cost basis

(section written below as it was confirmed)
