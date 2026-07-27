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
 * no code path from this suite to a socket.
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

registerHooks({
  resolve(specifier, context, nextResolve) {
    const native = NATIVE.get(specifier);
    if (native) return { url: native, shortCircuit: true };

    // The one module that must never reach a network. Matched by suffix so it
    // is caught from any depth (`../api/client`, `../../api/client`).
    if (specifier === '../api/client' || specifier.endsWith('/api/client')) {
      return { url: stub('api-client.ts'), shortCircuit: true };
    }

    // Metro-style extension resolution for relative specifiers.
    if (specifier.startsWith('.') && !EXTS.includes(path.extname(specifier))) {
      const parent = context.parentURL
        ? path.dirname(fileURLToPath(context.parentURL))
        : process.cwd();
      const base = path.resolve(parent, specifier);
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

    return nextResolve(specifier, context);
  },
});
