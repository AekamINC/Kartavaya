/**
 * ConnectorGuidePage — the long form of a connector's setup, one platform at a
 * time.
 *
 * WHY IT IS A PAGE AND NOT MORE CARD
 * ----------------------------------
 * The card holds the short steps, and that is the right place for them: the
 * operator is looking at the boxes those steps fill. But three things do not
 * fit next to a form and are the reason setup fails anyway —
 *
 *   what has to be true FIRST   an Instagram account that is still personal
 *                               cannot be posted to, and no amount of correct
 *                               credentials changes that. Discovered after the
 *                               app is built, it wasted the whole afternoon.
 *   the gate after the tick     App Review, Google's per-project grant, X's
 *                               paid tier. A green Test connection does not
 *                               mean a client can publish, and the page has to
 *                               say so in more than a clause.
 *   what each error means       the networks write these for developers.
 *                               "Invalid Client ID" reads like a permissions
 *                               problem and is not one.
 *
 * All of it comes from `/v1/hub/connectors/guides` — the SAME definition the
 * card's short steps are generated from, so the two cannot drift apart into
 * contradicting each other, which is the failure mode of a docs page kept
 * beside a form.
 *
 * The header carries the date the prose was written, not a claim that it was
 * verified. Consoles get renamed; an operator who can see the sentence is a
 * year old treats a mismatch as our staleness rather than their mistake.
 */
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../components/editorial';
import { ErrorState, useToast } from '../components/ui';
import { api } from '../lib/api';
import '../styles/connectors.css';

export default function ConnectorGuidePage() {
  const { platform } = useParams();
  const { pushToast } = useToast();
  const [state, setState] = useState({ loading: true, error: '', guide: null });

  useEffect(() => {
    let alive = true;
    setState({ loading: true, error: '', guide: null });
    api.get(`/v1/hub/connectors/guides/${platform}`)
      .then(r => alive && setState({ loading: false, error: '', guide: r.data }))
      .catch(e => alive && setState({
        loading: false,
        guide: null,
        error: e?.response?.status === 404
          ? 'There is no setup guide for that platform.'
          : 'The guide could not be loaded.',
      }));
    return () => { alive = false; };
  }, [platform]);

  const g = state.guide;

  return (
    <div className="cg">
      <PageHeader
        title={g ? `Setting up ${g.label}` : 'Connector setup'}
        subtitle="Everything needed before the credentials on the Connectors page will work"
      />

      <Link className="cg__back" to="/settings/connectors">
        &larr; Back to Connectors
      </Link>

      {state.loading && <p className="cg__loading">Loading the guide…</p>}
      {state.error && <ErrorState message={state.error} />}

      {g && (
        <article className="cg__body">
          {/* First, because every one of these is cheaper to discover now than
              after the app has been built against an account that cannot be
              published to. */}
          {!!g.prerequisites.length && (
            <section className="cg__sec">
              <h2 className="cg__h">What has to be true first</h2>
              <ul className="cg__ul">
                {g.prerequisites.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </section>
          )}

          <section className="cg__sec">
            <h2 className="cg__h">Creating the app</h2>
            <ol className="cg__ol">
              {g.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
            {g.redirect_url && (
              <div className="cn__redirect">
                <span className="cn__redirect-l">
                  The redirect URL those steps refer to
                </span>
                <code>{g.redirect_url}</code>
                <button type="button" onClick={() => {
                  navigator.clipboard?.writeText(g.redirect_url);
                  pushToast({ title: 'Redirect URL copied', type: 'success' });
                }}>Copy</button>
              </div>
            )}
            {g.console && (
              <a className="cg__console" href={g.console}
                target="_blank" rel="noopener noreferrer">
                Open {g.label}&rsquo;s console
              </a>
            )}
          </section>

          {/* The distance between a green tick and a client who can actually
              post. Given its own heading because operators promise clients on
              the strength of the tick. */}
          {g.gate && (
            <section className="cg__sec cg__sec--gate">
              <h2 className="cg__h">Between a passing test and a live post</h2>
              <p className="cg__p">{g.gate}</p>
            </section>
          )}

          {!!g.errors.length && (
            <section className="cg__sec">
              <h2 className="cg__h">What the errors mean</h2>
              <dl className="cg__err">
                {g.errors.map((e, i) => (
                  <div className="cg__err-row" key={i}>
                    <dt>{e.says}</dt>
                    <dd>{e.means}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {g.sections.map((s, i) => (
            <section className="cg__sec" key={i}>
              <h2 className="cg__h">{s.title}</h2>
              {s.body.map((para, j) => <p className="cg__p" key={j}>{para}</p>)}
            </section>
          ))}

          {/* Written, not verified — and it says which. */}
          <p className="cg__stamp">
            These steps were written on {g.written} from {g.label}&rsquo;s
            published developer documentation. Consoles are renamed often: if a
            step does not match what is on your screen, this page is out of date
            rather than you being in the wrong place.
          </p>
        </article>
      )}
    </div>
  );
}
