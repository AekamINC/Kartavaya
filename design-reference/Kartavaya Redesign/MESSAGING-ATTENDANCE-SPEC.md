# Sanvaad + Pahchan — build spec

## Sanvaad (संवाद) — real schema, migration `058_sanvaad_messaging.sql`

Two halves, which matches the `TABS = ['channels','whatsapp']` already in `SanvaadPage.jsx`.

### Samvada — internal messaging
| Table | Fields that drive UI |
|---|---|
| `samvada_channels` | `name`, `description`, `type` **public\|private\|dm**, `is_archived`, `created_by` |
| `samvada_channel_members` | `role` **admin\|member**, `last_read_at`, `muted` |
| `samvada_messages` | `content`, `type` **text\|image\|file\|system**, `parent_message_id` (threads), `metadata` JSONB, `is_edited`, `is_deleted` |
| `samvada_message_attachments` | `file_name`, `file_url`, `file_type`, `file_size` |
| `samvada_message_reactions` | `emoji`, unique per (message, user, emoji) |
| `samvada_read_receipts` | (message, user, `read_at`) |

Realtime: `ALTER PUBLICATION supabase_realtime ADD TABLE staging.samvada_messages`.

**Design consequences**
- `type='system'` already exists — module bot messages (task updates from Kartavya, deals from Graha, invoices from Ganit) are a **message type**, not a new mechanism. Render them with no avatar, a module glyph, and a muted tonal background.
- `is_archived` on channels → archived channels must be visually distinct (the Slack "active vs abandoned" finding).
- `muted` per member + `last_read_at` → per-channel notification prefs and unread counts are both already modelled.
- `parent_message_id` → threads are a self-relation; the thread panel reads one parent + its children.
- `is_edited` / `is_deleted` → need an "edited" marker and a tombstone state.
- Channel `type='dm'` shares the same table — DMs are channels, so one list component handles both.

### Varta — WhatsApp Business
| Table | Fields that drive UI |
|---|---|
| `varta_business_accounts` | `provider` (meta_cloud), `phone_number`, `display_name`, `status` **pending\|active\|suspended** |
| `varta_contacts` | `phone_number`, `opted_in`, `opted_in_at`, `graha_contact_id` → links to CRM |
| `varta_conversations` | `status` **open\|pending\|resolved**, `assigned_to` |
| `varta_messages` | `direction` **inbound\|outbound**, `status` **pending\|sent\|delivered\|read\|failed**, `error_code`, `type` incl. template/interactive |
| `varta_templates` | `category`, `header_type`, `body`, `footer`, `buttons` JSONB, `status` **draft\|pending\|approved\|rejected**, `meta_template_id` |
| `varta_auto_replies` | `trigger_type` **keyword\|first_message\|off_hours\|fallback** |

**Design consequences**
- Template `status` includes Meta's approval round-trip — the template editor needs a submitted/approved/rejected state, not just save.
- `varta_messages.status` has 5 states + `error_code` → per-message delivery ticks and a failed state with the reason.
- `opted_in` is a hard gate — un-opted contacts cannot be messaged; the composer must be disabled with the reason shown.
- `graha_contact_id` → a WhatsApp thread can open the CRM contact.
- Conversation `assigned_to` + `status` → this is a shared inbox, not a personal one.

## Pahchan (पहचान) — new module, no code yet

PWA-first, mobile-primary. face-api.js biometric check-in. Offline with a **72-hour buffer**.

### Employee screens
1. Clock-in — full-screen camera viewfinder, prominent current time, GPS status, offline badge
2. Clock-out — same, plus hours today
3. My attendance — month calendar heat map (present/absent/half-day/holiday), tap for detail
4. Daily detail — in/out times, total, break, overtime, location map pin, face-scan thumbnail
5. Offline banner + unsynced queue count and oldest record timestamp
6. Face registration — 3–5 angles, progress, "your face data stays on this device" trust banner

### Manager/admin screens
7. Team attendance today — in / late / absent / on leave
8. Attendance report — date range, department filter, per-employee totals, CSV/PDF export
9. Shift management — name, start, end, grace period, half-day rules, weekly offs, assignment
10. Regularization requests — employee form + manager approval queue
11. Geo-fencing — map, radius slider, multiple locations
12. Anomaly review — face mismatch, outside geo-fence, unusual hours, duplicate punches
13. Bulk grid — rows = employees, columns = dates, cells P/A/H/L/WO, admin-editable, 100+ employees
14. Flow into Manav leave balances and Vetana payroll

### Constraints
- Camera must feel native, not a web form. Full-bleed, minimal chrome.
- Every screen shows sync state (reuses the toolbar sync chip already built).
- Low-end device support on clock-in: light DOM, minimal animation.
- Biometric privacy banner during registration.

## RBAC integration required for both
- **Sanvaad:** viewer reads channels, editor sends messages, admin manages channels (maps to `samvada_channel_members.role` plus the module-level role).
- **Pahchan:** employee (own records only), manager (team + approvals), admin (shifts, geo-fence, bulk edit).

## Surfaces
Both modules across mobile app, mobile web, desktop Mac, desktop Windows — the existing
`data-platform` + responsive layer in `Kartavaya Redesign/app.css` already covers Mac/Windows and
the mobile breakpoint; these screens must be authored to work within it.
