#!/usr/bin/env node
/**
 * Every `<DateInput onChange>` must read `.target.value`.
 *
 * ── THE BUG THIS EXISTS FOR ─────────────────────────────────────────────────
 *
 * `DateInput` is deliberately INPUT-SHAPED. `DateInput.jsx`'s `emit()` calls
 * `onChange({ target: { value, name, id, type } })` so it is a drop-in for the
 * native `<input type="date">` this product does not use anywhere.
 *
 * A handler written as `onChange={v => setForm({ ...f, when: v })}` therefore
 * stores THE WHOLE EVENT OBJECT as the value. Nothing complains at the time.
 * On the next render that object is passed back in as `value`, `DateInput` does
 * `(value || '').slice(0, 10)`, and:
 *
 *     TypeError: (w || "").slice is not a function
 *
 * The ErrorBoundary catches it and REPLACES THE WHOLE TAB. Not a broken field —
 * the screen is gone, and the form the person was filling in goes with it.
 *
 * ⚠ FOUND ON 2026-08-29 BY PROPOSAL 93 SUITE 08, in the Vetana PT and IT ladder
 * forms. A sweep then found SIX MORE, every one of them in Ganit —
 * `ServiceLinesTab`, `SLACreditsTab`, `RateCardsTab`, `MeteredUsageTab` — which
 * are precisely the screens §4 drives. Eight crashes, all latent, all shipped.
 *
 * ── WHY A SCRIPT AND NOT A CODE REVIEW NOTE ────────────────────────────────
 *
 * Because the failure is invisible at the call site. Both spellings read
 * naturally, the wrong one is shorter, and the crash happens one render later
 * in a different file. That is the exact shape that comes back — so it gets a
 * check rather than a comment, and the check is cheap because the answer is
 * always in the same element.
 *
 * ⚠ THIS IS STATIC AND POSITIONAL, LIKE EVERY OTHER GATE HERE. It reads source
 * text and cannot see a handler assembled at runtime or passed down as a prop.
 * Three blind spots of that kind were found on the same day this was written —
 * `check-rendered-ids` twice and `check-table-rows` once — so treat a green run
 * as "the common case is clean", never as "the rule holds".
 */
import { readFileSync } from 'fs';
import { globSync } from 'glob';

const files = globSync('src/**/*.jsx', { cwd: process.cwd() });

/**
 * Pull out each `<DateInput …>` element in full.
 *
 * ⚠ NOT `/<DateInput\b[^>]*?>/`. A handler body contains `=>`, and that `>`
 * ends the match early — so the first version of this script truncated every
 * element at the arrow, could not see the `.target` that came after it, and
 * reported 103 violations where there were 8. A regex that stops at the first
 * `>` cannot read JSX. Braces are counted instead.
 */
function dateInputElements(src) {
  const out = [];
  const re = /<DateInput\b/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let i = m.index;
    let depth = 0;
    let inBrace = 0;
    for (; i < src.length; i += 1) {
      const c = src[i];
      if (c === '{') inBrace += 1;
      else if (c === '}') inBrace -= 1;
      else if (c === '<' && i !== m.index) depth += 1;
      else if (c === '>' && inBrace === 0 && depth === 0) break;
    }
    out.push({ text: src.slice(m.index, i + 1), line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

const violations = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  if (!src.includes('<DateInput')) continue;

  for (const el of dateInputElements(src)) {
    if (!/onChange=/.test(el.text)) continue;
    // A handler that forwards a named function is somebody else's contract to
    // keep — only an inline arrow is judged here.
    const arrow = el.text.match(/onChange=\{\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>/);
    if (!arrow) continue;
    const param = arrow[1];
    // The one thing that makes it correct: the handler reads the event's value.
    const readsTarget = new RegExp(`\\b${param}\\.target\\b`).test(el.text);
    if (!readsTarget) {
      violations.push(
        `  ${file}:${el.line}  onChange={${param} => …} never reads ${param}.target.value`,
      );
    }
  }
}

if (violations.length) {
  console.error(
    `\n✗ ${violations.length} <DateInput> handler(s) store the EVENT instead of its value:\n` +
    violations.join('\n') +
    '\n\n  DateInput emits an input-shaped event — `onChange({ target: { value … } })` —\n' +
    '  so a bare `v` is the whole object. Stored and fed back as `value`, it makes\n' +
    "  DateInput's `(value || '').slice(0, 10)` throw, and the ErrorBoundary then\n" +
    '  replaces the ENTIRE TAB. Use `e => …e.target.value`.\n',
  );
  process.exit(1);
}

console.log(
  `check-dateinput-handlers: every <DateInput> onChange reads .target.value ` +
  `(${files.length} files scanned).`,
);
