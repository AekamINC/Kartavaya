/**
 * "…and add all skills onto this related to this."
 *
 * The skills that WRITE the posts, offered on the page where the accounts they
 * post to are connected. Connecting an Instagram account and then having
 * nothing to say on it is the gap this closes.
 *
 * ── READ LIVE, NEVER HARD-CODED ──────────────────────────────────────────────
 *
 * The names are not written here. `hub_skill_templates` carries `module` and
 * `skill_type`, and the social content packs are the rows tagged
 * `module='srijan'` (Sahayak's old name, still the tag on the rows) with
 * `skill_type='content'`. Filtering on the tags means the section follows the
 * catalogue: retag a pack and it appears or disappears here with no deploy.
 *
 * MEASURED LIVE 2026-08-21: there are SIX of them, not the four this work was
 * briefed with — Campaign Launch, Festival Calendar, Weekly Reel Scripts and
 * Weekly Social Media Pack, plus **Product Launch Pack** and **SEO Blog
 * Series**. A hard-coded list of four would have hidden two packs the org
 * already owns, which is exactly why this reads the tags.
 *
 * ── IT OFFERS, IT DOES NOT RUN ───────────────────────────────────────────────
 *
 * A run SPENDS REAL CREDITS out of the org's wallet, and the screen that says
 * what a pack will do, what it will ask for and what it will cost is the Skills
 * tab — `pages/sahayak/SkillsTab.jsx`, built for exactly that decision. A second
 * Run button here would be a second, thinner version of that decision. So each
 * row links into the existing flow and stops there.
 *
 * ── A 403 IS NOT AN EMPTY SHELF ──────────────────────────────────────────────
 *
 * The catalogue is gated `require_module("sahayak")`, and this page also admits
 * a Marketing holder who has no Sahayak grant at all. For them the request is
 * refused, and the honest rendering is NOTHING — they are not missing a shelf,
 * they are looking at a module they do not have. Any OTHER failure gets a
 * sentence, because "no skills" over a failed fetch is a false statement about
 * the account, which is the one rule the Hub tabs are built around.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, rows as unwrapRows } from '../../lib/api';
import { errText } from '../hub/_shared';

/**
 * The module tags that mean "this pack writes social content".
 *
 * `srijan` is what the rows actually carry; `sahayak` is the name the module
 * has now. Both are accepted so that the day the catalogue is retagged — which
 * is a data change, not a deploy — this section follows it rather than emptying
 * out.
 */
export const SOCIAL_SKILL_MODULES = new Set(['srijan', 'sahayak']);

/** The packs worth offering beside a set of social accounts. */
export function socialSkills(templates) {
  return (templates || []).filter(
    t => t?.skill_type === 'content' && SOCIAL_SKILL_MODULES.has(t?.module),
  );
}

export default function SkillsStrip() {
  const [state, setState] = useState({ loading: true, error: '', list: [] });

  useEffect(() => {
    let live = true;
    api.get('/v1/hub/skills/templates')
      .then(r => live && setState({ loading: false, error: '', list: unwrapRows(r) }))
      .catch(err => {
        if (!live) return;
        if (err?.response?.status === 403) {
          setState({ loading: false, error: '', list: [] });
          return;
        }
        setState({ loading: false, error: errText(err), list: [] });
      });
    return () => { live = false; };
  }, []);

  if (state.loading) return null;

  if (state.error) {
    return (
      <section className="sa__skills">
        <h2 className="sa__h2">Write the posts</h2>
        <p className="sa__skills-err">
          The content packs did not load — {state.error}
        </p>
      </section>
    );
  }

  const packs = socialSkills(state.list);
  if (!packs.length) return null;

  return (
    <section className="sa__skills">
      <h2 className="sa__h2">Write the posts</h2>
      <p className="sa__sub">
        Connected accounts need something to publish. These packs write it —
        each one runs from Sahayak, where it says what it will ask you for and
        what it will cost before anything is spent.
      </p>
      <ul className="sa__packs">
        {packs.map(p => (
          <li className="sa__pack" key={p.id}>
            <Link className="sa__pack-l" to="/hub/org?tab=skills">
              <b className="sa__pack-n">{p.name}</b>
              {p.description && <span className="sa__pack-d">{p.description}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
