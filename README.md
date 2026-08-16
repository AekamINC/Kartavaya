# Kartavaya — कर्तव्य
**Do what must be done.**

Team task management built for Indian businesses — by [Aekam Inc](https://www.aekaminc.com)

---

## Stack

| Layer | Tech | Platform |
|---|---|---|
| Frontend | React 18 + Tailwind | Vercel |
| Backend | FastAPI / Python 3.11 | Railway |
| Database | PostgreSQL | Railway |
| Auth | Email/password + JWT (httpOnly cookie) | — |
| File storage | Cloudflare R2 (boto3 API) | — |
| Email | AWS SES | — |
| Mobile | Expo + React Native | Android (separate effort) |

## Brand

- Accent: `#1AB8B0` (teal) · gradient trail `#0082c6 → #03a1b6 → #05b7aa`
- Wordmark font: Harabara Mais (used **only** in `KWordmark` component)
- UI font: Inter (all other text)
- Sidebar background: `#050e1a`

## Repo structure

```
Kartavaya/
├── backend/          ← FastAPI app (see backend/README.md)
│   ├── server.py     ← entry point: app factory + router mounts
│   ├── routers/      ← one file per feature domain
│   ├── services/     ← shared business logic
│   └── migrations/   ← SQL schema changes
│
├── frontend/
│   └── src/          ← React app (see frontend/src/README.md)
│       ├── App.js    ← route tree + lazy imports
│       ├── pages/    ← one file per route
│       ├── components/ ← shared UI + layout
│       ├── hooks/    ← data-fetching hooks
│       ├── lib/      ← api client, auth, tokens, brand
│       └── styles/   ← global CSS (imported by App.js)
│
├── mobile/           ← Expo app (separate effort, not in active development)
└── docs/             ← deployment guides
```

Each folder has its own `README.md` with a file map, rules, and a
cross-folder impact table so you always know what else to update
when you touch a file.

## Quick start (local)

```bash
# Backend
cd backend
pip install -r requirements.txt
cp .env.example .env     # fill in DATABASE_URL, JWT_SECRET, SES vars, R2 vars
uvicorn server:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
# create .env.local with: REACT_APP_API_URL=http://localhost:8000
npm start
```

## Deployment

- **Frontend** → Vercel, auto-deploys on push to `main`
- **Backend** → Railway, auto-deploys on push to `main`
- See `backend/railway.toml` for start command

## Branches

- `main` → live production (Vercel + Railway auto-deploy)
- Feature work → `cursor/description` branches, PR into main

## Key planning documents

- `TASKS.md` — the live tracker (the v2 plan doc it used to cite was never committed)
- `backend/migrations/README.md` — migration status table
- `backend/README.md` — backend folder map + cross-folder rules
- `frontend/src/README.md` — frontend folder map + import rules

---

*Kartavaya (कर्तव्य) — Sanskrit for "duty" or "that which must be done"*
