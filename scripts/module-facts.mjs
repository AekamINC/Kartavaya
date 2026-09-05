/**
 * module-facts — read the code and report what each module actually is.
 *
 * The per-module documentation has to be generated from the source, not
 * written from memory, or it starts drifting the day after it is committed.
 * This walks the backend routers, the frontend pages and the migrations and
 * reports, per module code:
 *
 *   · which router files serve it, and every route they declare
 *   · which database tables those routers touch
 *   · which frontend pages and components render it
 *   · which external services it reaches
 *
 * The module list is not hardcoded here — it is read from
 * `backend/middleware/role_tiers.py`, which is the registry the RBAC layer
 * enforces. If a module is added there and nowhere else, this reports it as
 * having no implementation rather than silently omitting it.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// ── the registry ───────────────────────────────────────────────────────────
const tiers = readFileSync(join(ROOT, 'backend/middleware/role_tiers.py'), 'utf8');
const block = tiers.match(/ALL_MODULES:\s*frozenset\[str\]\s*=\s*frozenset\(\{([\s\S]*?)\}\)/);
const MODULES = [...block[1].matchAll(/"([a-z_]+)"/g)].map(m => m[1]).sort();

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.includes(extname(p))) out.push(p);
  }
  return out;
}

const routers = walk(join(ROOT, 'backend/routers'), ['.py']);
const services = walk(join(ROOT, 'backend/services'), ['.py']);
const pages = walk(join(ROOT, 'frontend/src/pages'), ['.jsx']);
const components = walk(join(ROOT, 'frontend/src/components'), ['.jsx']);
// Both extensions: tables are created in .py migrations as well as .sql ones,
// and a .sql-only scan finds almost nothing.
const migrations = walk(join(ROOT, 'backend/migrations'), ['.sql', '.py']);

const migText = migrations.map(f => readFileSync(f, 'utf8')).join('\n');

/** Every table the migrations create, so router SQL can be matched against real names. */
const REAL_TABLES = new Set(
  [...migText.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?["`]?(?:public\.)?([a-z_][\w]*)/gi)]
    .map(m => m[1].toLowerCase())
);

const EXTERNALS = [
  ['Anthropic / Claude', /anthropic|claude-/i],
  ['Google Gemini', /gemini|generativelanguage/i],
  ['OpenAI', /openai/i],
  ['Apify', /apify/i],
  ['WhatsApp Cloud API', /graph\.facebook|whatsapp/i],
  ['AWS SES', /ses|boto3/i],
  ['Cloudflare R2', /r2|boto3.*endpoint_url/i],
  ['Razorpay', /razorpay/i],
  ['Supabase', /supabase/i],
];

function routesIn(text) {
  return [...text.matchAll(/@router\.(get|post|put|patch|delete)\(\s*["']([^"']*)["']/gi)]
    .map(m => `${m[1].toUpperCase()} ${m[2] || '/'}`);
}

/**
 * Tables a router's SQL touches.
 *
 * The schema prefix has to be stripped, not just `public.`. Every query in this
 * codebase is written `FROM staging.tasks` — 1300-odd of them — so a pattern
 * that only knows about `public.` captures the word `staging` as the table name
 * for every module. Any `schema.` prefix is dropped, and the result is checked
 * against the tables the migrations actually create so aliases and CTE names do
 * not leak in.
 */
function tablesIn(text) {
  const hits = new Set();
  /*
   * Read the SCHEMA-QUALIFIED name, and do not cross-check it against the
   * migrations.
   *
   * Gating on "tables the migrations create" found almost nothing: most core
   * tables predate `backend/migrations/` and were created directly in Supabase,
   * so the migration folder is not a census of the schema.
   *
   * `staging.<table>` is unambiguous here — every query in the codebase is
   * written that way, about 1300 of them — so the qualifier itself is the
   * signal. That also sidesteps aliases and CTE names, which are never
   * schema-qualified.
   */
  for (const m of text.matchAll(/\b(?:staging|public)\.([a-z_][\w]*)/gi)) {
    hits.add(m[1].toLowerCase());
  }
  return [...hits].sort();
}

/**
 * Modules whose routers neither carry their name nor declare it in `tags`.
 *
 * DATA, not an `if`. This was `mod === 'srijan'` hardcoded in the filter — and
 * `srijan` was renamed to `sahayak` by `migrations/108_srijan_to_sahayak.sql`,
 * applied 2026-08-06, with the alias deliberately deleted (see the long note at
 * `backend/middleware/role_tiers.py`). So the branch fired for nothing:
 * `ALL_MODULES` holds `sahayak`, every `hub*.py` router went unattributed, and
 * `sahayak.md` reported ONE route against a real 92.
 *
 * `kray` is the same shape and was never handled at all — it is served by
 * `procurement.py`, whose tag is `procurement-purchase-orders` and which
 * mentions neither `kray` nor anything else the matcher could find. It scored
 * 19 routes only because the old substring match caught `vikray.py`.
 *
 * Kept here rather than fixed in the routers' tags on purpose: a tag is
 * OpenAPI metadata that groups the published API, and renaming one to satisfy
 * a docs generator is the tail wagging the dog.
 */
const ROUTER_ALIASES = {
  sahayak: /^hub/,
  kray: /^procurement/,
};

const report = {};
for (const mod of MODULES) {
  /*
   * Match a router to its module by the router's OWN declared tags first.
   *
   * Most routers state the answer — `tags=["sanvaad-messaging"]`,
   * `tags=["varta-whatsapp"]`, `tags=["vetana-payroll"]` — so read that, and
   * fall back to the filename. Deriving it from the code keeps this correct
   * when a router is renamed.
   *
   * ⚠ WHOLE WORDS, NOT SUBSTRINGS. This was `new RegExp(mod, 'i')` tested
   * against the basename, which is unanchored: `kray` matched `vikray.py`, and
   * `docs/modules/kray.md` reported Vikray's 19 routes and Vikray's tables as
   * Kray's own. A generated document that is confidently wrong is worse than a
   * missing one, and CLAUDE.md tells people to regenerate these rather than
   * hand-edit them. Splitting on non-letters and testing membership means
   * `vikray` and `kray` can never be confused, while `pahchan_attendance.py`
   * and `vetana-payroll` still match on their first word.
   */
  /* Words, camelCase included: `ManavPage.jsx` has to yield `manav`, or the
     page match breaks the moment it stops being a substring test. */
  const namesModule = (haystack, name) =>
    haystack.replace(/([a-z])([A-Z])/g, '$1 $2')
            .toLowerCase().split(/[^a-z]+/).filter(Boolean)
            .includes(name);

  const myRouters = routers.filter(f => {
    const t = readFileSync(f, 'utf8');
    const tags = t.match(/APIRouter\([^)]*tags\s*=\s*\[([^\]]*)\]/s);
    if (tags && namesModule(tags[1], mod)) return true;
    const alias = ROUTER_ALIASES[mod];
    if (alias && alias.test(basename(f))) return true;
    return namesModule(basename(f), mod);
  });
  const text = myRouters.map(f => readFileSync(f, 'utf8')).join('\n');

  report[mod] = {
    routers: myRouters.map(f => 'backend/routers/' + basename(f)),
    routes: routesIn(text),
    tables: tablesIn(text),
    services: services.filter(f => namesModule(basename(f), mod)).map(f => 'backend/services/' + basename(f)),
    // Whole path, whole words. `rx.test(f)` here was the substring bug's third
    // and widest reach: every file under `frontend/src/pages/vikray/` counted
    // as a `kray` page, which is most of where its inflated page count came
    // from.
    pages: pages.filter(f => namesModule(f, mod)).map(f => f.slice(f.indexOf('frontend'))),
    components: components.filter(f => namesModule(f, mod)).map(f => f.slice(f.indexOf('frontend'))),
    externals: EXTERNALS.filter(([, re]) => re.test(text)).map(([n]) => n),
  };
}

console.log(JSON.stringify(report, null, 1));
