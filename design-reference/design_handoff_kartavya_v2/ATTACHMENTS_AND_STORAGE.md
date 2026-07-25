# Attachment audit + R2 storage verification

The repo already has a complete object-storage abstraction
(`backend/storage.py`) that supports inline base64, AWS S3, **Cloudflare R2**,
and Backblaze B2 via the same S3 API. A FilesField component
(`frontend/src/components/fields/FilesField.jsx`) already handles upload via
`POST /upload`. **The plumbing is there.** This audit lists every place the
editorial UI must surface that upload affordance, so nothing gets missed
during commits 4–8.

---

## 1. Attachment surfaces — where users upload files

| # | Surface | File | Affordance | Current state on `main` |
|---|---|---|---|---|
| 1 | Task drawer → **Files** tab | `components/TaskDrawer.jsx` | "Attach file" CTA below the file list — drag-drop OR click → file picker | Files render but **no upload button** in the editorial design — fix in commit 5 |
| 2 | Task drawer → **Comments** compose | `components/TaskDrawer.jsx` | Paperclip icon inside the compose textarea row | **No paperclip in current chrome** — fix in commit 5 |
| 3 | New Task modal | `components/NewTaskModal.jsx` | "Attach files" dashed button under Description | **No attachment field in modal today** — fix in commit 5 |
| 4 | Inline Task Editor (table view quick-edit) | `components/TaskEditor.jsx` | Same paperclip pattern as comments compose | Check + add if missing |
| 5 | Client request modal (same component as New Task, different label) | `components/NewTaskModal.jsx` (re-used) | Same "Attach files" affordance | Same fix as #3 covers this |
| 6 | Approval landing `/approve` | New `pages/ApprovePage.jsx` | Read-only — show any attachments on the request, **no upload** | Designed read-only |
| 7 | Approve email (#3 to admin), Task-done email (#5 to client) | `email_service.py` templates | List attachment names with a "Open task to download" link — **never inline attachments via SMTP** | Already excluded by design |

### What the prototype now shows (this commit)

- Task drawer **Files tab** has a dashed "Attach file फ़ाइल जोड़ें" button
  below the existing files, with file-type + size hint
  (`PDF, DOCX, XLSX, PNG · max 5 MB`)
- Task drawer **Comments compose** has a paperclip icon in a small action
  row below the textarea, plus a `↵ to post · ⇧↵ for newline` hint
- **New Task modal** has an "Attachments संलग्न" row with a dashed
  "Attach files" button under Description
- Each file row in the Files tab has a download icon button on the right

Open `prototype/Kartavya App.html` and click any task to verify.

---

## 2. R2 storage verification — what to test in step 12 of the prompt

The E2E test (step 12 in `CLAUDE_CODE_PROMPT.md`) must exercise the storage
backend with the **R2 backend enabled**, not just inline. Add this to the
seeded-data smoke test:

### 2a. Configuration check

```bash
# In Railway env (or wherever backend runs in staging):
STORAGE_BACKEND=s3
STORAGE_BUCKET=kartavya-attachments
STORAGE_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
STORAGE_REGION=auto
STORAGE_ACCESS_KEY_ID=<R2-token-access-key>
STORAGE_SECRET_ACCESS_KEY=<R2-token-secret>
STORAGE_PUBLIC_BASE_URL=          # leave empty to use signed URLs
```

Verify in the backend logs at startup that `is_object_storage()` returns
`True`. If it's still inline, the env vars didn't take.

### 2b. Upload test matrix — run every row

| Step | Action | Pass condition |
|---|---|---|
| U1 | Sign in as admin · open KAR-104 · drawer → Files tab · click "Attach file" · pick a 1.2 MB PDF | Toast confirms. File appears in the list with size "1.2 MB" + uploader name. Activity tab shows "you attached <filename>" with timestamp. |
| U2 | Refresh the page. Re-open the same task. | File still there. Click it → opens in new tab, renders the PDF (signed URL works). |
| U3 | Inspect the file URL in DevTools. | Either `https://<r2-account>.r2.cloudflarestorage.com/...` (signed) OR `<STORAGE_PUBLIC_BASE_URL>/attachments/<key>` if public base configured. **Never** a `data:` URL. |
| U4 | Try uploading a 6 MB file. | Backend returns 400, frontend shows toast "File exceeds 5 MB limit." File is NOT added to the list. |
| U5 | Comment composer → click paperclip → upload a PNG → submit comment. | Comment appears with the image attached. Image renders inline (or as a clickable thumb). |
| U6 | Create a new task via New Task modal · add 2 attachments before submitting · click Create. | Task is created with both files. Drawer → Files tab shows both. |
| U7 | Sign in as client (Arjun) · `/client` · "+ New request" modal · attach 1 file · submit. | Request is created in `requested` status with the attachment. Email #3 to admin mentions the attachment by name. |
| U8 | In admin's email inbox (Gmail Android) · open email #3 (approval request) · the attachment name is listed but NOT embedded. | Email body says e.g. "Arjun attached: <code>requirements.pdf</code>". No actual file blob in the email. (Privacy + size + spam-filter safety.) |
| U9 | Click "Approve & queue" magic link in the email · land on `/approve` · the request card shows the same attachment with a download icon. | Download icon issues a fresh signed URL valid for 7 days. |
| U10 | Delete the attachment from a task. | R2 object is also deleted (`storage.delete_object(key)` called). Verify in the R2 dashboard: object count decreased. |

### 2c. Edge cases

- **CORS** — R2 bucket must allow `GET, PUT, POST, DELETE, HEAD` from
  the frontend origin (Vercel preview + production). Set this in the R2
  dashboard → Bucket → Settings → CORS Policy:

  ```json
  [
    {
      "AllowedOrigins": [
        "https://kartavya.app",
        "https://kartavya-*.vercel.app",
        "http://localhost:3000"
      ],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
      "MaxAgeSeconds": 3600
    }
  ]
  ```

- **Filename encoding** — test with a Devanagari filename
  (`प्रोजेक्ट_योजना.pdf`). The `safe_name` field in `store_upload()`
  preserves the original, but R2's `Content-Disposition` header must
  RFC-5987-encode it. If filenames come down as garbled bytes in Gmail,
  the encoding is missing.

- **Signed URL expiry** — the default in `storage.py` is 7 days. After
  expiry the file 403s. If users hit "Download" on a 10-day-old task,
  the frontend should call `GET /api/files/:key/reissue` to get a fresh
  URL. Confirm this endpoint exists (or add it during commit 5).

- **Cost guardrail** — set a Cloudflare R2 monthly budget alert in the
  dashboard. R2 egress is free, but storage is $0.015/GB/month. 5MB max
  per file × 5,000 tasks × 3 avg attachments ≈ 75 GB ≈ $1.13/month at
  cap. Cheap, but worth alerting.

---

## 3. Files in the live repo that change

| File | Change | Commit |
|---|---|---|
| `frontend/src/components/TaskDrawer.jsx` | Files tab gets "Attach file" button + per-file download icon; Comments compose gets paperclip | 5 |
| `frontend/src/components/NewTaskModal.jsx` | Add "Attachments" field with dashed button under Description | 5 |
| `frontend/src/components/TaskEditor.jsx` | Verify paperclip exists; add if missing | 5 |
| `frontend/src/components/fields/FilesField.jsx` | Restyle to match editorial paper-canvas + dashed border | 5 |
| `backend/storage.py` | **No code change.** Just env var flip from `inline` to `s3` with R2 endpoint. | configuration, not commit |
| `frontend/src/lib/api.js` | Confirm `POST /upload` returns `{url, name, size, key}` — should already work since `FilesField.jsx` uses this shape | sanity |

---

## 4. Bhagavad Gita verse — where it appears + how to fetch dynamically

The brand uses one Sanskrit citation in two places:

| Surface | Current value | Source |
|---|---|---|
| Dashboard hero (right column) | `कर्तव्ये अधिकारस्ते मा फलेषु कदाचन।` (Gita 2.47) | Hardcoded in prototype |
| Welcome email (#2) | Same verse | Hardcoded in prototype |

**Fixing it to be dynamic.** Pick **one** of these free APIs — both are
maintained, ship Sanskrit + Hindi + English translations, and require no
auth:

### Option A — `vedicscriptures.github.io` (recommended)

```
GET https://vedicscriptures.github.io/slok/<chapter>/<verse>

Example:
  GET https://vedicscriptures.github.io/slok/2/47
  →
  {
    "_id": "...",
    "chapter": 2,
    "verse": 47,
    "slok": "कर्मण्येवाधिकारस्ते मा फलेषु कदाचन। मा कर्मफलहेतुर्भू...",
    "transliteration": "karmaṇy-evādhikāras te mā phaleṣu kadāchana...",
    "tej": { "ht": "कर्म पर ही तेरा अधिकार है...", "et": "You have the right..." },
    "siva": { "et": "..." },
    "purohit": { "et": "..." },
    "chinmay": { "hc": "..." },
    "san": { "et": "..." },
    "adi": { "et": "..." },
    "gambir": { "et": "..." }
  }
```

- No API key. CORS-enabled. Hosted on GitHub Pages.
- Chapter 1–18, verses 1–78 per chapter (varies)
- Source: <https://github.com/vedicscriptures/bhagavad-gita-api>

### Option B — `bhagavadgita.io` API v2

```
POST https://bhagavadgita.io/api/v2/oauth/token   (one-time, get bearer)
GET  https://bhagavadgita.io/api/v2/chapters/2/verses/47
  Header: Authorization: Bearer <token>
```

- Free tier (10k requests / month) — overkill for one verse per page load
- Better-curated commentaries (Swami Sivananda, Swami Ramsukhdas, etc.)
- Source: <https://bhagavadgita.io/api>

### How to wire it

**Backend (recommended — caches the verse server-side):**

```python
# backend/services/gita.py
import httpx
from datetime import date

_CACHE = {}

# Curated rotation — verses that match Kartavya's "do your duty" theme.
# (chapter, verse, label) — the label is what surfaces in the kicker/footer.
DUTY_VERSES = [
    (2, 47,  "Do your duty, not the fruit"),
    (3, 19,  "Act without attachment"),
    (2, 48,  "Equanimity in action"),
    (18, 47, "One's own dharma"),
    (3, 35,  "Better one's own duty imperfectly"),
    (6, 5,   "Lift yourself by yourself"),
    (4, 18,  "Action in inaction"),
]

async def daily_verse() -> dict:
    """Returns today's verse — same one all day for a workspace, rotated daily."""
    key = date.today().isoformat()
    if key in _CACHE:
        return _CACHE[key]
    idx = date.today().toordinal() % len(DUTY_VERSES)
    ch, vs, label = DUTY_VERSES[idx]
    async with httpx.AsyncClient(timeout=5.0) as c:
        r = await c.get(f"https://vedicscriptures.github.io/slok/{ch}/{vs}")
        data = r.json()
    out = {
        "sanskrit": data["slok"],
        "translation": data.get("tej", {}).get("et") or data.get("siva", {}).get("et"),
        "hindi": data.get("tej", {}).get("ht"),
        "ref": f"Bhagavad Gita {ch}.{vs}",
        "label": label,
    }
    _CACHE[key] = out
    return out
```

Expose it at `GET /api/verse-of-the-day`. The dashboard and welcome
email both read from here. Cache for the calendar day so every user in a
workspace sees the same verse — feels intentional, like a shared
opening prayer.

**Frontend (dashboard):**

```jsx
// in DashboardPage.jsx — right column
const [verse, setVerse] = React.useState(null);
React.useEffect(() => { api.get('/verse-of-the-day').then(r => setVerse(r.data)); }, []);
return verse && (
  <Citation sanskrit={verse.sanskrit} hindi={verse.hindi} source={verse.ref + ' — ' + verse.label} />
);
```

**Welcome email (#2):** the email template generator on the backend reads
`daily_verse()` inline when it's about to send. Embed sanskrit + ref into
the template at render time.

### Fallback

If the API is unreachable (`vedicscriptures.github.io` does have rare
outages), fall back to the hardcoded 2.47:

```python
FALLBACK = {
    "sanskrit": "कर्मण्येवाधिकारस्ते मा फलेषु कदाचन।",
    "translation": "You have the right to action alone, never to its fruits.",
    "ref": "Bhagavad Gita 2.47",
    "label": "Do your duty, not the fruit",
}
```

This is the canonical Kartavya verse — the brand is literally named after
the Sanskrit word in this shloka. It's a safe, on-brand default.

---

## 5. Files in this folder

This audit doc + the updated prototype (`prototype/src/task-drawer.jsx`,
`modals.jsx`, `styles.css`, `styles-modals.css`) showing the editorial
attachment affordances.
