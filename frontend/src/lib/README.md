# frontend/src/lib/

Non-React utilities. No JSX, no hooks, no component imports.
Everything here is imported by components, hooks, and pages — never
the other way around.

## Files

| File | Purpose | Imported by |
|---|---|---|
| `api.js` | Axios instance with base URL + `withCredentials: true`. Single source of truth for the API base URL. | Every hook, every page that calls the API directly |
| `auth.js` | Session check (`getMe()`), login, logout, register. Returns user object or null. | `Protected.jsx`, `AuthShell.jsx`, `LoginPage.jsx` |
| `brand.js` | `KWordmark` React component — the Kartavaya logo using Harabara Mais font. Only place this font is used. | `AppShell.jsx` (mobile topbar), auth pages |
| `tokens.css` | All CSS custom properties (design tokens): colors, spacing, radius, shadow, typography. Imported once in `App.js`. | Every component that uses `var(--...)` |
| `utils.js` | Generic helpers (e.g. `cn()` class merge). | Any component needing utility functions |
| `push.js` | Web Push / VAPID subscription helpers (stub — not active). | Unused currently — do not delete, wired up when push goes live |

## Rules

- `api.js` must be the only file that contains the backend URL.
  Never hardcode `https://Kartavaya-...railway.app` anywhere else.
- `tokens.css` is the only place hex values and spacing numbers live.
  Never use raw hex colours or px values outside of tokens.css and
  the token overrides in `styles/brand.css`.
- `brand.js` (`KWordmark`) uses Harabara Mais — that font must not
  appear anywhere else in the codebase (the design-system typography rules — see design-reference/).
- `auth.js` is not a hook. It is async utility functions. Wrap in a
  hook if you need reactive behaviour (`useAuth`).

## Cross-folder impact

| When you touch… | Also check… |
|---|---|
| `api.js` base URL | `.env.production`, `REACT_APP_API_URL` Vercel env var, Railway CORS origins in `server.py` |
| `tokens.css` | Visually test every page — token changes are global |
| `auth.js` `getMe()` response shape | `Protected.jsx`, `AppShell.jsx` user display, `pages/AdminPage.jsx` role check |
| `brand.js` | `AppShell.jsx` import, `styles/brand.css` |
| `utils.js` | Any component that imports `cn` or other helpers |
