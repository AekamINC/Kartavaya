# Modules

Twelve modules, registered in `backend/middleware/role_tiers.py`. That file is
the only registry — a module missing from it cannot be granted, whatever else
exists in the codebase.

| Module | Code | Purpose | Routes | Tables | Pages |
|---|---|---|---|---|---|
| [Dristi दृष्टि](modules/dristi.md) | `dristi` | Analytics and reports | 18 | 15 | 10 |
| [E-Sign प्रमाण](modules/esign.md) | `esign` | Electronic signatures | 13 | 3 | 5 |
| [Ganit गणित](modules/ganit.md) | `ganit` | Finance and invoicing | 54 | 17 | 17 |
| [Graha ग्रह](modules/graha.md) | `graha` | CRM | 83 | 23 | 23 |
| [Manav मानव](modules/manav.md) | `manav` | HR / HRMS | 71 | 20 | 19 |
| [Pahchan पहचान](modules/pahchan.md) | `pahchan` | Attendance | 19 | 8 | 9 |
| [Prachar प्रचार](modules/prachar.md) | `prachar` | Marketing | 44 | 16 | 10 |
| [Sanvaad संवाद](modules/sanvaad.md) | `sanvaad` | Messaging | 18 | 6 | 15 |
| [Srijan सृजन](modules/srijan.md) | `srijan` | AI assistant and skills | 70 | 29 | 9 |
| [Varta वार्ता](modules/varta.md) | `varta` | WhatsApp | 13 | 6 | 4 |
| [Vetana वेतन](modules/vetana.md) | `vetana` | Payroll | 19 | 13 | 8 |
| [Vikray विक्रय](modules/vikray.md) | `vikray` | Sales orders | 18 | 8 | 12 |

Each document states what the module is for, how a request flows through it, and
its exact backend, database, frontend and integration surface. Everything except
Purpose and Flow is generated from the source.

**Regenerate:**

```bash
node scripts/module-facts.mjs > module-facts.json
node scripts/gen-module-docs.mjs
```
