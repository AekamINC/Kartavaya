/**
 * addressText.js — the two readings every stored address goes through before it
 * is rendered.
 *
 * Both were declared in `components/ClientLocations.jsx`,
 * `components/ui/AddressBlock.jsx` and (for `text`) `components/VendorForm.jsx`
 * until 2026-09-03. Three copies of "what counts as a value" is three answers
 * to the same question, and the question is not obvious: a stored `0` is a
 * number, is falsy, and is a real house number.
 */
import { GST_STATES } from './validators';

/**
 * A field as a trimmed string, or '' — never `null`, `undefined`, `'0'` by
 * accident, or `[object Object]`.
 *
 * A NUMBER IS KEPT, which is the whole point of the first branch: address
 * columns hold `0` and `12` as numbers often enough, and `String(0)` is a house
 * number while a bare falsiness test drops it. A non-finite number yields ''
 * rather than 'NaN'.
 */
export function text(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v !== 'string') return '';
  return v.trim();
}

/**
 * The state a stored address is in, by name.
 *
 * `state` WINS WHEN BOTH ARE PRESENT. It is what a human typed, and Navrang is
 * the standing proof that two fields describing one place can disagree. An
 * unrecognised `state_code` yields '' rather than its own digits — a number
 * nobody recognises is noise in a place name.
 */
export function stateOf(f) {
  const named = text(f.state);
  if (named) return named;
  const code = text(f.state_code);
  if (!code) return '';
  return GST_STATES[code] || GST_STATES[code.padStart(2, '0')] || '';
}
