# Generated tables — reference vs build, computed styles

Produced by the harness described in `worktree-agent-a3900f1046ad06dab.md` §7.
Every row is `getComputedStyle` output, written by a script. Read that report
first: several of these rows are deliberate divergences (§5) rather than
defects, and 32 of them are one root cause (§6.3).

### UI face — `Public Sans` vs `Inter` — 32 rows

| element | property | reference | build |
|---|---|---|---|
| shell: scroll container | fontFamily | UI(PublicSans) | UI(Inter) |
| page: content stack | fontFamily | UI(PublicSans) | UI(Inter) |
| header: block | fontFamily | UI(PublicSans) | UI(Inter) |
| header: kicker | fontFamily | UI(PublicSans) | UI(Inter) |
| header: sub / lede | fontFamily | UI(PublicSans) | UI(Inter) |
| tabs: strip | fontFamily | UI(PublicSans) | UI(Inter) |
| tabs: button | fontFamily | UI(PublicSans) | UI(Inter) |
| tabs: button selected | fontFamily | UI(PublicSans) | UI(Inter) |
| tabs: english label | fontFamily | UI(PublicSans) | UI(Inter) |
| stats: grid | fontFamily | UI(PublicSans) | UI(Inter) |
| stats: tile | fontFamily | UI(PublicSans) | UI(Inter) |
| stats: tile label | fontFamily | UI(PublicSans) | UI(Inter) |
| stats: tile sub | fontFamily | UI(PublicSans) | UI(Inter) |
| card: shell | fontFamily | UI(PublicSans) | UI(Inter) |
| card: head | fontFamily | UI(PublicSans) | UI(Inter) |
| card: body | fontFamily | UI(PublicSans) | UI(Inter) |
| k-card: shell | fontFamily | UI(PublicSans) | UI(Inter) |
| k-card: head | fontFamily | UI(PublicSans) | UI(Inter) |
| k-card: body | fontFamily | UI(PublicSans) | UI(Inter) |
| table: head row | fontFamily | UI(PublicSans) | UI(Inter) |
| table: head cell | fontFamily | UI(PublicSans) | UI(Inter) |
| table: body row | fontFamily | UI(PublicSans) | UI(Inter) |
| table: cell | fontFamily | UI(PublicSans) | UI(Inter) |
| table: primary text | fontFamily | UI(PublicSans) | UI(Inter) |
| board: track | fontFamily | UI(PublicSans) | UI(Inter) |
| board: column | fontFamily | UI(PublicSans) | UI(Inter) |
| board: column head | fontFamily | UI(PublicSans) | UI(Inter) |
| board: card | fontFamily | UI(PublicSans) | UI(Inter) |
| chip | fontFamily | UI(PublicSans) | UI(Inter) |
| status pill | fontFamily | UI(PublicSans) | UI(Inter) |
| button: fill sm | fontFamily | UI(PublicSans) | UI(Inter) |
| muted text | fontFamily | UI(PublicSans) | UI(Inter) |

_32 differing declarations._

### Accent derivation — `--primary-text` differs — 10 rows

| element | property | reference | build |
|---|---|---|---|
| header: kicker | borderTopColor | #046b64 | #005650 |
| header: kicker | color | #046b64 | #005650 |
| header: devanagari | borderTopColor | #046b64 | #005650 |
| header: devanagari | color | #046b64 | #005650 |
| stats: tile value | borderTopColor | #046b64 | #1b1d1a |
| stats: tile value | color | #046b64 | #1b1d1a |
| card: title devanagari | borderTopColor | #046b64 | #005650 |
| card: title devanagari | color | #046b64 | #005650 |
| k-card: title devanagari | borderTopColor | #046b64 | #666a61 |
| k-card: title devanagari | color | #046b64 | #666a61 |

_10 differing declarations._

### Construction — the element is built a different way — 60 rows

| element | property | reference | build |
|---|---|---|---|
| page: content stack | display | flex | block |
| page: content stack | flexDirection | column | row |
| page: content stack | overflowX | visible | auto |
| header: block | minHeight | auto | 0px |
| header: block | justifyContent | space-between | normal |
| header: kicker | display | flex | block |
| header: kicker | alignItems | center | normal |
| header: english h1 | display | inline-block | block |
| header: english h1 | minHeight | 0px | auto |
| header: display line | minHeight | 0px | auto |
| header: devanagari | display | inline | block |
| header: devanagari | minHeight | 0px | auto |
| tabs: strip | alignItems | stretch | normal |
| tabs: strip | overflowX | visible | auto |
| tabs: button | display | flex | block |
| tabs: button | minHeight | 40px | auto |
| tabs: button | alignItems | center | normal |
| tabs: button selected | display | flex | block |
| tabs: button selected | minHeight | 40px | auto |
| tabs: button selected | alignItems | center | normal |
| tabs: count badge | display | block | inline |
| tabs: count badge | minHeight | auto | 0px |
| stats: grid | minHeight | auto | 0px |
| card: shell | minHeight | auto | 0px |
| k-card: shell | minHeight | auto | 0px |
| k-card: title | display | inline | block |
| k-card: title | minHeight | 0px | auto |
| k-card: title devanagari | display | inline | block |
| k-card: title devanagari | minHeight | 0px | auto |
| table: head row | display | grid | table-row |
| table: head row | alignItems | center | normal |
| table: head cell | display | block | table-cell |
| table: head cell | minHeight | auto | 0px |
| table: head cell | textAlign | start | left |
| table: body row | display | grid | table-row |
| table: body row | minHeight | 44px | 0px |
| table: body row | alignItems | center | normal |
| table: body row | textAlign | left | start |
| table: cell | display | flex | table-cell |
| table: cell | minHeight | auto | 0px |
| table: cell | alignItems | center | normal |
| table: numeric cell | display | flex | table-cell |
| table: numeric cell | minHeight | auto | 0px |
| table: numeric cell | alignItems | center | normal |
| table: numeric cell | justifyContent | flex-end | normal |
| table: primary text | display | block | table-cell |
| table: primary text | minHeight | auto | 0px |
| table: primary text | overflowX | hidden | visible |
| board: track | display | grid | flex |
| board: track | minHeight | auto | 0px |
| board: track | gridAutoColumns | minmax(232px, 1fr) | auto |
| board: track | gridAutoFlow | column | row |
| board: track | alignItems | start | flex-start |
| board: column head | display | block | flex |
| board: column head | alignItems | normal | center |
| status pill | display | flex | inline-flex |
| status pill | minHeight | auto | 0px |
| status pill | textAlign | left | start |
| button: fill sm | display | flex | inline-flex |
| button: fill sm | minHeight | auto | 0px |

_60 differing declarations._

### Geometry — padding, margin, gap, radius, border, shadow, background — 119 rows

| element | property | reference | build |
|---|---|---|---|
| page: content stack | paddingTop | 0px | 24px |
| page: content stack | paddingRight | 0px | 32px |
| page: content stack | paddingBottom | 0px | 24px |
| page: content stack | paddingLeft | 0px | 32px |
| page: content stack | rowGap | 22px | normal |
| page: content stack | columnGap | 22px | normal |
| header: block | paddingBottom | 0px | 15px |
| header: block | marginBottom | 0px | 18px |
| header: block | rowGap | 20px | 16px |
| header: block | columnGap | 20px | 16px |
| header: kicker | marginBottom | 7px | 6px |
| header: kicker | rowGap | 8px | normal |
| header: kicker | columnGap | 8px | normal |
| header: english h1 | borderTopColor | #666a61 | #1b1d1a |
| header: sub / lede | marginTop | 9px | 3px |
| tabs: strip | marginBottom | 0px | 18px |
| tabs: strip | rowGap | normal | 2px |
| tabs: strip | columnGap | normal | 2px |
| tabs: button | paddingRight | 13px | 15px |
| tabs: button | paddingLeft | 13px | 15px |
| tabs: button | rowGap | 7px | normal |
| tabs: button | columnGap | 7px | normal |
| tabs: button | borderTopColor | #666a61 | #1b1d1a |
| tabs: button selected | paddingRight | 13px | 15px |
| tabs: button selected | paddingLeft | 13px | 15px |
| tabs: button selected | rowGap | 7px | normal |
| tabs: button selected | columnGap | 7px | normal |
| tabs: english label | paddingTop | 0px | 9px |
| tabs: english label | paddingRight | 0px | 15px |
| tabs: english label | paddingBottom | 0px | 9px |
| tabs: english label | paddingLeft | 0px | 15px |
| tabs: english label | borderTopColor | #666a61 | #1b1d1a |
| tabs: devanagari label | paddingTop | 0px | 9px |
| tabs: devanagari label | paddingRight | 0px | 15px |
| tabs: devanagari label | paddingBottom | 0px | 9px |
| tabs: devanagari label | paddingLeft | 0px | 15px |
| tabs: devanagari label | borderTopColor | #666a61 | #1b1d1a |
| tabs: count badge | paddingTop | 1px | 0px |
| tabs: count badge | paddingRight | 6px | 0px |
| tabs: count badge | paddingBottom | 1px | 0px |
| tabs: count badge | paddingLeft | 6px | 0px |
| tabs: count badge | borderRadius | 999px | 0px |
| tabs: count badge | backgroundColor | #666a61@0.14 | #000000@0 |
| stats: tile | borderTopWidth | 0px | 1px |
| stats: tile | borderTopStyle | none | solid |
| stats: tile | borderTopColor | #1b1d1a | #d8d1be |
| stats: tile | backgroundColor | #eee9dc | #faf7f0 |
| stats: tile devanagari | borderTopColor | #666a61 | #005650 |
| card: shell | boxShadow | none | #1e1c16@0.07 0px 1px 2px 0px |
| k-card: head | marginBottom | 0px | 16px |
| k-card: body | paddingTop | 0px | 12.6px |
| k-card: body | paddingRight | 0px | 18px |
| k-card: body | paddingBottom | 0px | 18px |
| k-card: body | paddingLeft | 0px | 18px |
| table: head row | paddingRight | 16px | 0px |
| table: head row | paddingLeft | 16px | 0px |
| table: head row | rowGap | 14px | normal |
| table: head row | columnGap | 14px | normal |
| table: head row | borderTopColor | #666a61 | #808080 |
| table: head row | backgroundColor | #f5f1e7 | #000000@0 |
| table: head cell | paddingRight | 0px | 12px |
| table: head cell | paddingLeft | 0px | 12px |
| table: head cell | backgroundColor | #000000@0 | #f5f1e7 |
| table: body row | paddingRight | 16px | 0px |
| table: body row | paddingLeft | 16px | 0px |
| table: body row | rowGap | 14px | normal |
| table: body row | columnGap | 14px | normal |
| table: body row | borderTopColor | #1b1d1a | #808080 |
| table: body row | backgroundColor | #f5f1e7@0.5 | #000000@0 |
| table: cell | paddingRight | 0px | 12px |
| table: cell | paddingLeft | 0px | 12px |
| table: cell | rowGap | 9px | normal |
| table: cell | columnGap | 9px | normal |
| table: numeric cell | paddingRight | 0px | 12px |
| table: numeric cell | paddingLeft | 0px | 12px |
| table: numeric cell | rowGap | 9px | normal |
| table: numeric cell | columnGap | 9px | normal |
| table: primary text | paddingRight | 0px | 12px |
| table: primary text | paddingLeft | 0px | 12px |
| board: track | paddingBottom | 6px | 10px |
| board: track | rowGap | 10px | 12px |
| board: track | columnGap | 10px | 12px |
| board: column | paddingTop | 0px | 10px |
| board: column | paddingRight | 0px | 10px |
| board: column | paddingBottom | 0px | 10px |
| board: column | paddingLeft | 0px | 10px |
| board: column | borderTopWidth | 0px | 1px |
| board: column | borderTopStyle | none | dashed |
| board: column | borderTopColor | #1b1d1a | #000000@0 |
| board: column | borderRadius | 0px | 12px |
| board: column | backgroundColor | #000000@0 | #f5f1e7 |
| board: column head | paddingTop | 10px | 2px |
| board: column head | paddingRight | 12px | 4px |
| board: column head | paddingBottom | 10px | 8px |
| board: column head | paddingLeft | 12px | 4px |
| board: column head | rowGap | normal | 8px |
| board: column head | columnGap | normal | 8px |
| board: column head | borderTopWidth | 3px | 0px |
| board: column head | borderTopStyle | solid | none |
| board: column head | borderTopColor | #8e8d87 | #1b1d1a |
| board: column head | borderRadius | 12px | 0px |
| board: column head | backgroundColor | #eee9dc | #000000@0 |
| board: card | rowGap | 8px | 7px |
| board: card | columnGap | 8px | 7px |
| board: card | borderRadius | 12px | 6.96px |
| board: card | boxShadow | none | #1e1c16@0.07 0px 1px 2px 0px |
| status pill | borderTopWidth | 0px | 1px |
| status pill | borderTopStyle | none | solid |
| status pill | borderTopColor | #0a665f | #adb0af |
| status pill | borderRadius | 999px | 99px |
| status pill | backgroundColor | #04837a@0.15 | #e7e7e6 |
| button: fill sm | backgroundColor | #04837a | #00897f |
| keycap | paddingTop | 2px | 0px |
| keycap | paddingRight | 5px | 0px |
| keycap | paddingBottom | 2px | 0px |
| keycap | paddingLeft | 5px | 0px |
| keycap | borderTopColor | #666a61 | #1b1d1a |
| keycap | borderRadius | 4.08px | 0px |
| keycap | backgroundColor | #e7e1d1 | #000000@0 |

_119 differing declarations._

### Type — size, weight, leading, tracking, case, figures — 73 rows

| element | property | reference | build |
|---|---|---|---|
| header: kicker | fontSize | 10.5px | 11px |
| header: kicker | lineHeight | 15.75px | 16.5px |
| header: kicker | letterSpacing | 2.1px | 2.42px |
| header: english h1 | color | #666a61 | #1b1d1a |
| header: english h1 | fontFamily | UI(PublicSans) | DISPLAY(Newsreader) |
| header: english h1 | fontSize | 15.68px | 25px |
| header: english h1 | fontWeight | 600 | 400 |
| header: english h1 | lineHeight | 20.384px | 37.5px |
| header: english h1 | letterSpacing | 0.6272px | -0.6px |
| header: english h1 | textTransform | uppercase | none |
| header: display line | fontSize | 28px | 25px |
| header: display line | lineHeight | 36.4px | 37.5px |
| header: display line | letterSpacing | -0.56px | -0.6px |
| header: devanagari | fontSize | 28px | 15px |
| header: devanagari | lineHeight | 36.4px | 26.55px |
| header: devanagari | letterSpacing | -0.56px | normal |
| header: sub / lede | fontSize | 14px | 12.5px |
| header: sub / lede | lineHeight | 21px | 18.75px |
| tabs: button | color | #666a61 | #1b1d1a |
| tabs: button | fontSize | 12.5px | 13px |
| tabs: button selected | fontSize | 12.5px | 13px |
| tabs: english label | color | #666a61 | #1b1d1a |
| tabs: english label | fontSize | 12.5px | 13px |
| tabs: english label | textTransform | capitalize | none |
| tabs: devanagari label | color | #666a61 | #1b1d1a |
| tabs: devanagari label | fontFamily | HINDI(Tiro) | UI(Inter) |
| tabs: devanagari label | fontSize | 12px | 13px |
| tabs: devanagari label | fontWeight | 400 | 600 |
| tabs: count badge | fontSize | 10.5px | 11.06px |
| tabs: count badge | fontWeight | 600 | 400 |
| tabs: count badge | fontVariantNumeric | normal | tabular-nums |
| stats: tile devanagari | color | #666a61 | #005650 |
| stats: tile devanagari | lineHeight | 18px | 21.24px |
| stats: tile value | fontVariantNumeric | normal | tabular-nums |
| card: title | fontSize | 20px | 20.02px |
| card: title | lineHeight | 28px | 28.028px |
| card: title | letterSpacing | -0.2px | -0.2002px |
| card: title devanagari | lineHeight | 21px | 24.78px |
| k-card: title | fontSize | 20px | 20.02px |
| k-card: title | lineHeight | 28px | 28.028px |
| k-card: title | letterSpacing | -0.2px | -0.2002px |
| k-card: title devanagari | lineHeight | 21px | 24.78px |
| table: head row | color | #666a61 | #1b1d1a |
| table: head row | fontSize | 10px | 13.02px |
| table: head row | fontWeight | 700 | 400 |
| table: head row | lineHeight | 15px | 19.53px |
| table: head row | letterSpacing | 1.4px | normal |
| table: head row | textTransform | uppercase | none |
| table: head cell | fontSize | 10px | 12.04px |
| table: head cell | fontWeight | 700 | 600 |
| table: head cell | lineHeight | 15px | 18.06px |
| table: head cell | letterSpacing | 1.4px | 0.4816px |
| table: body row | fontSize | 13.3333px | 13.02px |
| table: body row | lineHeight | normal | 19.53px |
| table: cell | fontSize | 13.3333px | 13.02px |
| table: cell | lineHeight | normal | 19.53px |
| table: numeric cell | fontSize | 13.3333px | 13.02px |
| table: numeric cell | lineHeight | normal | 19.53px |
| table: primary text | fontSize | 13px | 13.02px |
| table: primary text | fontWeight | 500 | 400 |
| table: primary text | lineHeight | normal | 19.53px |
| board: card | fontSize | 13.3333px | 14px |
| board: card | lineHeight | normal | 21px |
| status pill | color | #0a665f | #3e5c8a |
| status pill | fontSize | 11.5px | 12px |
| status pill | fontWeight | 600 | 500 |
| status pill | lineHeight | normal | 18px |
| muted text | fontSize | 14px | 12px |
| muted text | lineHeight | 21px | 18px |
| keycap | color | #666a61 | #1b1d1a |
| keycap | fontFamily | MONO(JetBrains) | monospace |
| keycap | fontSize | 10px | 14px |
| keycap | lineHeight | 15px | 21px |

_73 differing declarations._
