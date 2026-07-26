# Sanvaad messaging frontend — agent report

Branch: `worktree-agent-a71bb3f32e9a4491f`
Scope: `frontend/src/pages/sanvaad/**` + `frontend/src/styles/sanvaad.css`
Governing spec: `design-handover/06-sanvaad-varta.md`, `design-handover/24-bilingual-devanagari.md`
Design source: `design-reference/Kartavaya Redesign/{ScreensSanvaad,ScreensVarta,IxChat}.jsx`

Written incrementally. Every line-number claim below was opened and read at the time of writing.

---

## 0 · Worktree was cut from the wrong base — read this first

The worktree arrived on a branch whose HEAD was `1aa4985`, which is the tip of
**`main`**, not `staging`:

```
ahead of origin/staging:   13
behind origin/staging:    271
merge-base:           294e9e2
```

Neither `frontend/src/pages/sanvaad/` nor `design-handover/` exists at that
commit — the entire module and its whole specification are staging-only. Any
agent that started work without checking would have been writing against a
tree 271 commits stale, or would have concluded the module does not exist.

`git branch -a --contains 1aa4985` lists **`main` plus ~20 sibling
`worktree-agent-*` branches**, so this is not specific to me; the whole swarm
appears to have been cut from `main`. Sibling agents should verify their base
before trusting any "file not found" result.

Resolved by `git reset --hard origin/staging` on my own agent branch. `main`
was not touched.

---

## 1 · Claims: HELD vs STALE

### HELD — Devanagari in input placeholders (FIXED)

`24-bilingual-devanagari.md:199` is the governing line:

> **No:** validation messages, error text, empty-state explanations, tooltips,
> form field labels, table column headers, anything inside a data cell.

Three sites, all confirmed by opening the file:

| File | Was |
|---|---|
| `ChatPane.jsx:79` | `'Write a message…  संदेश लिखें'` |
| `Composer.jsx:114` | `'Write a message…  संदेश लिखें'` (default) |
| `ThreadPanel.jsx:141` | `'Reply…  उत्तर दें'` |

Fixed in `6e233ff`. The editorial argument is the handover's own; the
structural argument is stronger and is recorded in `Composer.jsx`: a
placeholder is a plain string attribute, so Devanagari inside one can **never**
carry `lang` or `--font-indic`. `24` requires both of every Indic run — without
`lang` a screen reader speaks Devanagari in the English voice (`24:113`);
without `--font-indic` an EN+GU user is served Devanagari where they chose
Gujarati (`24:131`). Every other Indic string in this module is a nested
element for exactly that reason. A placeholder cannot be one.

**Deliberately not changed** — correctly marked-up Devanagari that the same
spec permits:

- `ChannelList.jsx:65`, `MessageLog.jsx:81`, `WhatsAppTab.jsx:110` — `.sv__hi`
  spans carrying `lang="hi"`.
- `MessageLog.jsx:55`, `ChannelsTab.jsx:99`, `WhatsAppTab.jsx:198/212/239/268`
  — `EmptyState` `{en, hi}` titles. `EmptyState.jsx:120-127,142-145` splits
  these into a `lang`-tagged `.empty__title-hi` span. These are empty-state
  *titles*; the "No" list names empty-state *explanations*, and every
  `description` prop in this module is English-only.
- `messageUtils.js:107,122,123` — day separators ("Today · आज"), rendered
  through `MessageLog.jsx:22`'s `.sv__hi` span with `lang="hi"`.

---

_(report continues — appended as findings are confirmed)_
