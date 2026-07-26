# frontend/src/styles/

Global CSS files. All imported at the top of `App.js` in this order:

```js
import './App.css';              // legacy — being phased out
import './lib/tokens.css';       // design tokens (CSS vars) — must be first
import './styles/layout.css';
import './styles/dark-theme.css';
import './styles/animations.css';
import './styles/mobile-responsive.css';
```

**Order matters.** `tokens.css` must load before everything else
because all other files reference its `var(--)` values.

## Files

| File | Purpose | Touch when… |
|---|---|---|
| `layout.css` | Page grid, sidebar width, content area, scroll behaviour | Changing the overall page structure or sidebar dimensions |
| `dark-theme.css` | Dark mode overrides via `[data-theme="dark"]` selector | Adding a new token that needs a dark-mode value |
| `animations.css` | Keyframe animations and transition utilities (`fade-in`, `slide-up`, etc.) | Adding or changing a shared animation |
| `mobile-responsive.css` | Media query overrides for `md` (768px) and below | Fixing mobile layout issues |
| `brand.css` | Harabara Mais `@font-face` + `.Kartavaya-wordmark` scoped styles | Changing the wordmark font or its sizing |

## Rules

- **No hex values here.** Use `var(--token-name)` from `lib/tokens.css`.
- **No component-specific styles here** unless they truly need to be global
  (e.g. a reset or a third-party library override). Component styles go
  inline or in the component file.
- `brand.css` is the only CSS file allowed to reference Harabara Mais.
  All other typography uses Inter via `var(--font-sans)`.
- When adding a new media breakpoint, add it to `mobile-responsive.css`
  only — don't scatter breakpoints across multiple files.

## Cross-folder impact

| When you touch… | Also check… |
|---|---|
| `layout.css` sidebar width | `components/layout/Sidebar.jsx` width classes, `components/layout/AppShell.jsx` grid columns |
| `dark-theme.css` | `lib/tokens.css` — make sure the token you're overriding exists |
| `mobile-responsive.css` | `components/layout/AppShell.jsx` mobile nav, all pages on narrow viewport |
| `animations.css` | Any component that uses the class names defined here |
| `brand.css` | `lib/brand.js` `KWordmark` component |
| Adding a new CSS file | Import it in `App.js` in the correct order and add a row to this table |
