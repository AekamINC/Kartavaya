// Skill Packs → Guide. What a pack is, and what a run costs.
//
// The cost table used to be a hard-coded array in this file with a worked
// example that added up to a number the server no longer charged. It now reads
// the server's own `credit_costs`, and when that request fails it says so rather
// than printing figures nobody can vouch for.
import React from 'react';
import { AGENT_TYPES } from './_shared';

function Block({ title, hi, children }) {
  return (
    <section className="hb-card sk-guide">
      <h3 className="hb-card__t">
        {title}
        {hi && <span className="hb-card__hi" lang="hi">{hi}</span>}
      </h3>
      <div className="sk-guide__b">{children}</div>
    </section>
  );
}

export default function GuideTab({ costs, costsError }) {
  return (
    <div className="sk-guides">
      <Block title="What a skill pack is" hi="कौशल">
        <p>
          A skill pack is a saved sequence of AI steps. Instead of writing one brief at a time,
          you run the pack once and it produces the whole set — a blog post, the social teaser,
          the announcement, the email — each one shaped by the client&rsquo;s brand profile.
        </p>
        <p>
          Everything it makes lands in that client&rsquo;s <b>Content</b> tab as a draft. Nothing is
          published, sent or approved automatically.
        </p>
      </Block>

      <Block title="Template and assignment are different things" hi="साँचा">
        <p>
          A <b>template</b> is the blueprint and belongs to the organisation. An <b>assignment</b> is
          one client&rsquo;s copy of it.
        </p>
        <ul className="sk-guide__l">
          <li>Create a template once, assign it to as many clients as you like.</li>
          <li>Each assignment runs against that client&rsquo;s brand profile, so the same template
            produces different words for every client.</li>
          <li>Credits come out of that client&rsquo;s wallet, and the run history is kept per client.</li>
          <li>Deactivating a template affects every client. Removing an assignment affects one.</li>
        </ul>
      </Block>

      <Block title="Variables" hi="चर">
        <p>
          Anything in braces inside a prompt becomes a question asked at run time.
          <code className="hb-code">{'{festival_name}'}</code> and <code className="hb-code">{'{date}'}</code> in
          a prompt produce two input boxes before the pack runs.
        </p>
        <p className="hb-cap">
          Three names are reserved and are filled in for you rather than asked for:
          <code className="hb-code">{'{platform}'}</code>, <code className="hb-code">{'{brief}'}</code> and
          <code className="hb-code">{'{extra}'}</code>.
        </p>
      </Block>

      <Block title="What each step costs" hi="व्यय">
        {costsError ? (
          <div className="note note--warn hb-err" role="status">
            <b>The credit cost table did not load.</b> {costsError} Figures are not shown rather
            than guessed — a stale price here is worse than none.
          </div>
        ) : !costs ? (
          <p className="hb-cap">Loading the current cost table…</p>
        ) : (
          <>
            <dl className="sk-costs">
              {AGENT_TYPES.map(([k, label]) => (
                <div className="sk-costs__r" key={k}>
                  <dt>{label}</dt>
                  <dd className="hb-mono">{costs[k] != null ? `${costs[k]} cr` : '—'}</dd>
                </div>
              ))}
            </dl>
            <p className="hb-cap">
              A pack costs the sum of its steps. The figure shown on each pack is that sum,
              computed from this table at the moment you look at it.
            </p>
          </>
        )}
      </Block>
    </div>
  );
}
