# Implementation handover — target stack

Recorded 25 Jul 2026. The full handover spec (component inventory, token reference,
RBAC enforcement notes) is still to be written; this file pins the stack so the
remaining screens are authored against it.

## Stack
| Layer | Choice |
|---|---|
| Build | Vite |
| UI | React with **JSX** — no TypeScript anywhere |
| Styling | Plain CSS with custom properties, in `editorial.css` |
| Backend | FastAPI |
| Database | Supabase Postgres (schema `staging`) |
| Components | All custom-built. **No component library**, no Tailwind, no CSS-in-JS |

## What this means for the prototype
- `tokens.css` in this folder is the source of truth for the custom properties and
  ports to `editorial.css` as-is. Names do not change.
- Every pattern in `app.css` is hand-written CSS with no utility classes, so it
  transfers directly. Nothing here assumes a library primitive.
- The prototype's `Screens*.jsx` files are already plain JSX with no types — they
  map 1:1 onto Vite components. `Object.assign(window, …)` exports become real
  `export` statements; that is the only mechanical change.
- Appearance state (theme, accent, glass, radius, density, display, platform) is
  set as data attributes and inline custom properties on `documentElement`. Keep
  that approach — it needs no re-render and no context provider.
- Realtime (Sanvaad) uses the Supabase JS client subscribing to
  `staging.samvada_messages`; FastAPI owns writes so RBAC is enforced server-side.

## Still to write
Component inventory, per-module token reference, RBAC enforcement matrix
(route guard + query filter + UI state for each of the 15 modules).
