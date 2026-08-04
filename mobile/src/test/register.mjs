/**
 * The test harness for `mobile/`. Loaded via `--import` before anything else, so
 * the hooks are in place before the first module under test is linked.
 *
 *     npm test    →  node --import ./src/test/register.mjs --test "src/**\/*.test.ts"
 *
 * ── Why this file exists at all ───────────────────────────────────────────────
 *
 * `mobile/` has no bundler in the test path and deliberately no test framework —
 * the first test here (`components/__tests__/screenStatus.test.ts`) was written
 * against `node:test` specifically to avoid adding a dependency, and this keeps
 * that bargain. But `node --test` alone can only reach modules that import
 * nothing, which is why that first test could only cover a module that had been
 * split out to have no imports.
 *
 * Two things stop Node loading the rest of `src/`, and both are resolution
 * problems rather than anything about the code:
 *
 *  1. **Extensionless relative imports.** `punchQueue.ts` says
 *     `import { storage } from '../lib/storage'`. Metro resolves that; Node's
 *     ESM resolver requires the explicit `.ts`. The `resolve` hook below adds
 *     it, which is the one piece of Metro this harness reimplements.
 *
 *  2. **Native modules.** `react-native-mmkv`, `expo-crypto` and
 *     `expo-file-system` are all JSI/native bindings that throw the moment they
 *     are constructed off-device. They are mapped to in-memory stubs in
 *     `./stubs/`.
 *
 * `api/client` is stubbed for a different and non-negotiable reason: it is a
 * configured axios instance pointed at the STAGING deployment, and staging
 * shares a Supabase database with production. A test that accidentally reached
 * it would write real rows. The stub has no transport of any kind, so there is
 * no code path from this suite to a socket. That sentence was not true of
 * `src/api/*` until the matcher below started deciding on the resolved path —
 * see `API_CLIENT`.
 *
 * ── What this harness does NOT do ─────────────────────────────────────────────
 *
 * It does not render. Node's type-stripping removes TypeScript syntax but does
 * not transform JSX, so no `.tsx` file can be loaded here — not a screen, not a
 * component, not `BiLabel.tsx`. Everything render-shaped is therefore covered by
 * source-contract assertions or is listed as untestable in
 * `swarm-reports/mobile-test-coverage.md`. Adding real render tests means
 * adding babel + a renderer, which is a dependency decision, not an oversight.
 */

import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const stub = (name) => pathToFileURL(path.join(HERE, 'stubs', name)).href;

/**
 * The real `src/api/client.ts`, extensionless — the one module in the tree that
 * is compared by RESOLVED PATH rather than by the text of the specifier.
 *
 * It was matched by text: `specifier === '../api/client' || endsWith('/api/client')`.
 * That covers `src/offline/*`, which is where the stub was first needed, and it
 * covers nothing in `src/api/` — every module there imports its sibling as
 * `'./client'`, which is neither. So `src/api/messages.ts` loaded the REAL axios
 * instance, whose base URL falls back to the staging deployment, and staging
 * shares a Supabase database with production. Importing it opens no socket, but
 * the first test to call through `apiClient` would have written a real row.
 * `src/api/__tests__/` now exists, so that was one `await` away.
 *
 * Resolving both sides to an absolute path is what makes the guard hold for a
 * specifier nobody has written yet — `'./client'`, `'../api/client'`,
 * `'../../api/client'`, with or without the extension — while still refusing to
 * stub some other directory's `./client`, which a suffix match would swallow.
 */
const API_CLIENT = path.resolve(HERE, '..', 'api', 'client');

/** Bare specifiers that are native on a device and cannot load in Node. */
const NATIVE = new Map([
  ['react-native-mmkv', stub('react-native-mmkv.ts')],
  ['expo-crypto', stub('expo-crypto.ts')],
  ['expo-file-system', stub('expo-file-system.ts')],
  ['react-native', stub('react-native.ts')],
  ['@expo-google-fonts/newsreader', stub('expo-google-fonts.ts')],
  ['@expo-google-fonts/tiro-devanagari-hindi', stub('expo-google-fonts.ts')],
  ['@expo-google-fonts/space-mono', stub('expo-google-fonts.ts')],
]);

/** Extensions Metro would try, in Metro's order. */
const EXTS = ['.ts', '.tsx', '.mjs', '.js', '.json'];

/** `foo/bar.ts` → `foo/bar`. Only for extensions Metro would have resolved. */
function stripExt(p) {
  const ext = path.extname(p);
  return EXTS.includes(ext) ? p.slice(0, -ext.length) : p;
}

/**
 * Same file? `path.relative` already carries the platform's casing rule —
 * case-insensitive on win32, case-sensitive on posix — so this asks the
 * filesystem's own question rather than one about strings. It matters here: the
 * two paths compared below come from different sources (`import.meta.url` and
 * `context.parentURL`) and a drive letter that differs only in case would make
 * a `===` say "not the client" about the client.
 */
const samePath = (a, b) => path.relative(a, b) === '';

registerHooks({
  resolve(specifier, context, nextResolve) {
    const native = NATIVE.get(specifier);
    if (native) return { url: native, shortCircuit: true };

    if (specifier.startsWith('.')) {
      const parent = context.parentURL?.startsWith('file:')
        ? path.dirname(fileURLToPath(context.parentURL))
        : process.cwd();
      const base = path.resolve(parent, specifier);

      // The one module that must never reach a network. Decided on the resolved
      // path, so it holds for `'./client'` from inside `src/api/` exactly as it
      // does for `'../api/client'` from anywhere else. See API_CLIENT above.
      if (samePath(stripExt(base), API_CLIENT)) {
        return { url: stub('api-client.ts'), shortCircuit: true };
      }

      // Metro-style extension resolution.
      if (!EXTS.includes(path.extname(specifier))) {
        for (const ext of EXTS) {
          if (existsSync(base + ext)) {
            return { url: pathToFileURL(base + ext).href, shortCircuit: true };
          }
        }
        // A directory import — Metro would take its index file.
        for (const ext of EXTS) {
          const idx = path.join(base, `index${ext}`);
          if (existsSync(idx)) return { url: pathToFileURL(idx).href, shortCircuit: true };
        }
      }
    }

    return nextResolve(specifier, context);
  },
});
