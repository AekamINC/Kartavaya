# Modules

13 modules, registered in `backend/middleware/role_tiers.py`. That file
is the only registry — a module missing from it cannot be granted, whatever else
exists in the codebase.

This line read "Twelve" until 2026-09-05, hardcoded while the registry moved
underneath it: `srijan` was renamed `sahayak` by
`migrations/108_srijan_to_sahayak.sql` (applied 2026-08-06) and `kray` was
never listed at all. It is counted now rather than stated.

| Module | Code | Purpose | Routes | Tables | Pages |
|---|---|---|---|---|---|
| [Dristi दृष्टि](modules/dristi.md) | `dristi` | Analytics and reports | 19 | 19 | 15 |
| [E-Sign प्रमाण](modules/esign.md) | `esign` | Electronic signatures | 14 | 5 | 6 |
| [Ganit गणित](modules/ganit.md) | `ganit` | Finance and invoicing | 51 | 22 | 27 |
| [Graha ग्रह](modules/graha.md) | `graha` | CRM | 99 | 25 | 35 |
| [Kray क्रय](modules/kray.md) | `kray` | Procurement | 22 | 12 | 5 |
| [Manav मानव](modules/manav.md) | `manav` | HR / HRMS | 85 | 28 | 35 |
| [Pahchan पहचान](modules/pahchan.md) | `pahchan` | Attendance | 32 | 12 | 16 |
| [Prachar प्रचार](modules/prachar.md) | `prachar` | Marketing | 53 | 19 | 11 |
| [Sahayak सहायक](modules/sahayak.md) | `sahayak` | AI assistant and skills | 92 | 32 | 25 |
| [Sanvaad संवाद](modules/sanvaad.md) | `sanvaad` | Messaging | 27 | 11 | 27 |
| [Varta वार्ता](modules/varta.md) | `varta` | WhatsApp | 13 | 7 | 9 |
| [Vetana वेतन](modules/vetana.md) | `vetana` | Payroll | 27 | 21 | 11 |
| [Vikray विक्रय](modules/vikray.md) | `vikray` | Sales orders | 19 | 11 | 21 |

Each document states what the module is for, how a request flows through it, and
its exact backend, database, frontend and integration surface. Everything except
Purpose and Flow is generated from the source.

**Regenerate:**

```bash
node scripts/module-facts.mjs > module-facts.json
node scripts/gen-module-docs.mjs
```
