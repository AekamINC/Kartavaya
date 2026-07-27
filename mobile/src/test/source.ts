/**
 * Source-contract helpers.
 *
 * ── Read this before adding a test that uses them ─────────────────────────────
 *
 * These read `.tsx` files as TEXT and assert on their structure. That is a
 * weaker instrument than rendering, and it is used here only where rendering is
 * impossible: Node's type-stripping does not transform JSX, so no `.tsx` file in
 * this repo can be imported by `node --test` at all. Every defect that lives in
 * a component body — a missing `isError`, a `fontWeight` on Devanagari, a wrong
 * label — is therefore reachable by reading or not at all.
 *
 * What a source-contract test IS good for: pinning a specific line-level
 * decision so that deleting it turns the suite red. Each one below was verified
 * by reverting the fix and watching it fail; the A/B is recorded in
 * `swarm-reports/mobile-test-coverage.md`.
 *
 * What it is NOT good for, and what nothing here claims: proving the screen
 * actually renders the state it computes, that a touch target is 44pt, that a
 * haptic fires, or that the shutter is on screen. Those need a device.
 *
 * Comments are stripped before every assertion. The codebase documents its own
 * defects in prose — `SrijanScreen` explains why there is no `fontWeight` in a
 * comment that contains the word `fontWeight`, and `TodayScreen` quotes the
 * "All clear!" string it used to wrongly show. Matching raw text would read
 * those as the code they warn about.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Absolute path to `mobile/src`.
 *
 * Found by walking up from the working directory rather than from
 * `import.meta.url`: this file is typechecked by `tsc` under the module setting
 * `expo/tsconfig.base` picks, which rejects `import.meta` outright (TS1343).
 * Walking up also means the suite runs the same whether it is invoked from
 * `mobile/` or from the repository root.
 */
function findSrc(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    for (const candidate of [path.join(dir, 'src'), path.join(dir, 'mobile', 'src')]) {
      if (existsSync(path.join(candidate, 'test', 'source.ts'))) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not locate mobile/src from ${process.cwd()}. Run the suite with "npm test" from mobile/.`,
  );
}

const SRC = findSrc();

/** Absolute path to a file under `mobile/src`. */
export function srcPath(rel: string): string {
  return path.join(SRC, rel);
}

/** Raw file text, comments intact. */
export function readRaw(rel: string): string {
  return readFileSync(srcPath(rel), 'utf8');
}

/**
 * File text with `//` and block comments removed, string and template literals
 * preserved. A hand-rolled scanner rather than a regex because `'https://…'`
 * inside a string is not a comment and `/* ` inside a comment is not a nest.
 */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];
    const next = src[i + 1];

    // Line comment
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    // Block comment — replaced by a space so tokens either side stay separate.
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    // String / template literal — copied verbatim.
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Source with comments stripped. The default input for every assertion here. */
export function readCode(rel: string): string {
  return stripComments(readRaw(rel));
}

/**
 * Comments AND string contents removed, quotes kept as empty literals.
 *
 * For counting language structure rather than matching text. Counting `return`
 * statements over ordinary source finds the one inside `'The camera did not
 * return a photo.'` and reports a third exit path that does not exist — which
 * is a false failure in a test whose job is to notice a new early return.
 */
export function stripStrings(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += quote;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      out += quote;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Source with both comments and string contents removed. */
export function readSkeleton(rel: string): string {
  return stripStrings(stripComments(readRaw(rel)));
}

/**
 * Every `.tsx` under `src/screens`, relative to `src/`.
 *
 * Walked rather than listed, so a screen added next month is covered by the
 * screen-wide contracts without anyone remembering to register it. That is the
 * whole value of the sweep — a hand-maintained list would have missed exactly
 * the three screens that shipped the false-empty defect.
 */
export function screenFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(SRC, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(rel);
      } else if (entry.name.endsWith('.tsx')) {
        out.push(rel);
      }
    }
  };
  walk('screens');
  return out.sort();
}

/**
 * The object literal passed to `fn(` in `src`, as text.
 *
 * Brace-matched rather than regexed — these calls span twenty lines and contain
 * nested objects and ternaries. Returns every occurrence, because a screen may
 * resolve two queries (`BoardScreen` does).
 */
export function callObjects(src: string, fn: string): string[] {
  const out: string[] = [];
  const needle = `${fn}({`;
  let from = 0;
  for (;;) {
    const start = src.indexOf(needle, from);
    if (start === -1) break;
    let i = start + needle.length - 1; // at the '{'
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    out.push(src.slice(start + needle.length - 1, i));
    from = i;
  }
  return out;
}

/**
 * Named object literals inside `StyleSheet.create({ … })`, as `{ name: text }`.
 *
 * Used by the Devanagari rules: the check is about which properties sit in the
 * same style object as the Devanagari font family, so the object has to be
 * isolated rather than the file scanned as a whole.
 */
export function styleObjects(src: string): Record<string, string> {
  const out: Record<string, string> = {};

  // EVERY create() call, not just the first. `BoardScreen` and `MeScreen` have
  // three apiece (screen, row, modal), and reading only the first silently
  // skipped the Devanagari styles that live in the later ones — the sweep
  // reported them as unstyled when they were fine.
  let from = 0;
  for (;;) {
    const start = src.indexOf('StyleSheet.create(', from);
    if (start === -1) break;

    const open = src.indexOf('{', start);
    if (open === -1) break;
    let depth = 0;
    let end = open;
    for (; end < src.length; end++) {
      if (src[end] === '{') depth++;
      else if (src[end] === '}') { depth--; if (depth === 0) break; }
    }
    const body = src.slice(open + 1, end);
    from = end + 1;

    // Top-level `name: { … }` entries within this create() body.
    const re = /(?:^|[,{\s])([A-Za-z_$][\w$]*)\s*:\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const objStart = body.indexOf('{', m.index + m[0].length - 1);
      let d = 0;
      let j = objStart;
      for (; j < body.length; j++) {
        if (body[j] === '{') d++;
        else if (body[j] === '}') { d--; if (d === 0) { j++; break; } }
      }
      // Only entries at the top level — a nested object inside another style
      // has a non-zero depth relative to the body and is skipped.
      let openDepth = 0;
      for (const ch of body.slice(0, m.index)) {
        if (ch === '{') openDepth++;
        else if (ch === '}') openDepth--;
      }
      if (openDepth === 0) out[m[1]] = body.slice(objStart, j);
      re.lastIndex = j;
    }
  }
  return out;
}

/**
 * Does this style object name the one face with Devanagari glyphs?
 *
 * Accepts the `FAMILY.devanagari` constant, a `hindi()` spread, and the raw
 * `'TiroDevanagariHindi'` literal. The literal is accepted because it is
 * correct today (`MyRegister.tsx`) — but it is the form `fonts.ts` warns about,
 * since a typo in a `fontFamily` string is silent and just renders in the
 * system face. See the report for that follow-up.
 */
export function namesDevanagariFace(styleText: string): boolean {
  return /hindi\(|FAMILY\.devanagari|['"]TiroDevanagariHindi['"]/.test(styleText);
}

/**
 * The value of property `name` in an object-literal text, resolved through
 * shorthand.
 *
 * Four of the module screens write `hasData,` rather than `hasData: …`, having
 * computed it on the line above. A naive `name\s*:` match reads that as absent
 * and reports a screen as unwired when it is wired correctly — which is a false
 * failure in a suite whose entire purpose is catching a false success. So
 * shorthand is followed back to its `const` in the enclosing file.
 *
 * Returns `undefined` only when the property genuinely is not there.
 */
export function propValue(
  objectText: string,
  name: string,
  fileCode?: string,
): string | undefined {
  const re = new RegExp(`(^|[,{\\s])${name}\\s*(:|,|\\n|\\})`);
  const m = re.exec(objectText);
  if (!m) return undefined;

  const isShorthand = m[2] !== ':';
  if (isShorthand) {
    if (!fileCode) return name;
    // Follow `const name = <expr>;` back to its definition.
    const def = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*(?::[^=]+)?=\\s*([^;]+);`).exec(fileCode);
    return def ? def[1].trim() : name;
  }

  // Explicit value: read to the comma that closes it, ignoring nested commas.
  let i = m.index + m[0].length;
  let depth = 0;
  let out = '';
  for (; i < objectText.length; i++) {
    const c = objectText[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) break;
      depth--;
    } else if (c === ',' && depth === 0) break;
    out += c;
  }
  return out.trim();
}

/** Devanagari code points, used to spot Hindi string literals. */
export const DEVANAGARI = /[ऀ-ॿ]/;

/** Every Devanagari run in `src`, deduplicated. */
export function devanagariLiterals(src: string): string[] {
  const found = new Set<string>();
  const re = /[ऀ-ॿ][ऀ-ॿ\s‍]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const s = m[0].trim();
    if (s) found.add(s);
  }
  return [...found];
}
