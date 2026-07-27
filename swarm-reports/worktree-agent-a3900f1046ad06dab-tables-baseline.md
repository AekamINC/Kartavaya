### Baseline — the thing that has to be right before any number means anything

| | reference harness | build |
|---|---|---|
| `data-density` on `<html>` | `cozy` | `cozy` |
| `data-display` on `<html>` | `serif` | `null` |
| `data-theme` on `<html>` | `light` | `light` |
| `data-platform` on `<html>` | `mac` | `null` |
| viewport | 1440×900 | 1440×900 |

#### Resolved tokens on `:root`

| token | reference | build | same |
|---|---|---|:--:|
| `--row-h` | 44px | 44px | = |
| `--pad-page` | 28px | 28px | = |
| `--pad-card` | 18px | 18px | = |
| `--gap-section` | 22px | 22px | = |
| `--gap-tight` | 10px | 10px | = |
| `--radius-base` | 12px | 12px | = |
| `--r-sm` | 6.95312px | 6.95312px | = |
| `--r-md` | 12px | 12px | = |
| `--r-lg` | 17.3906px | 17.3906px | = |
| `--t-body` | 14px | 14px | = |
| `--t-body-sm` | 13px | 13.0156px | **≠** |
| `--t-headline` | 28px <br>_(declared `28px` vs `calc(14px * 2)`)_ | 28px | = |
| `--t-title-lg` | 20px | 20.0156px | **≠** |
| `--t-label` | 12px | 12.0312px | **≠** |
| `--font-display` | "Newsreader", Georgia, serif | 'Newsreader', 'Georgia', serif | **≠** |
| `--font-ui` | "Public Sans", ui-sans-serif, system-ui, -apple-system, sans-serif | 'Inter', system-ui, sans-serif | **≠** |
| `--font-hindi` | "Tiro Devanagari Hindi", "Noto Serif Devanagari", serif | 'Tiro Devanagari Hindi', 'Noto Serif Devanagari', 'Nirmala UI', 'Kohinoor Devanagari', serif | **≠** |
| `--font-indic` | "Tiro Devanagari Hindi", "Noto Serif Devanagari", serif | 'Tiro Devanagari Hindi', 'Noto Serif Devanagari', 'Nirmala UI', 'Kohinoor Devanagari', serif | **≠** |
| `--primary` | #04837A | #00897f | **≠** |
| `--primary-text` | #046B64 | #005650 | **≠** |
| `--on-surface` | #1B1D1A | #1B1D1A | = |
| `--on-surface-2` | #4A4E48 | #4A4E48 | = |
| `--on-surface-3` | #666A61 | #666A61 | = |
| `--on-surface-faint` | #666A61 | #666A61 | = |
| `--surface` | #FAF7F0 | #FAF7F0 | = |
| `--bg` | #F3EFE6 | #F3EFE6 | = |
| `--s-container` | #EEE9DC | #EEE9DC | = |
| `--s-low` | #F5F1E7 | #F5F1E7 | = |
| `--outline-variant` | #D8D1BE | #D8D1BE | = |
| `--sp-4` | 16px | 16px | = |
| `--sp-5` | 20px | 20px | = |
| `--sp-6` | 24px | 24px | = |

#### Which face actually renders

A stack whose first entry is not installed resolves silently to the next.
Widths of `Handgloves 0123456789` at 40px, so the declared value is not
taken as evidence of what is on screen — equal width to a known fallback
means the named face never loaded.

| stack | reference width | build width |
|---|---|---|
| `var(--font-ui)` | 435.266px | 471.719px |
| `"Public Sans"` | 401.078px | 401.078px |
| `Inter` | 471.719px | 471.719px |
| `system-ui` | 435.266px | 435.266px |
| `serif` | 401.078px | 401.078px |
| `var(--font-hindi)` | 433.922px | 433.922px |
| `"Tiro Devanagari Hindi"` | 433.922px | 433.922px |
| `serif` | 401.078px | 401.078px |
