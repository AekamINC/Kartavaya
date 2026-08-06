// Hub → Overview. The client's own facts: who to contact, and what the wallet
// holds.
//
// Previously this was a `<StatTile>` row plus a `<div>` of `<strong>Name:</strong>`
// lines at `lineHeight: 1.8`. Two problems the split makes visible: an unset
// contact rendered as a bare em dash with no indication that it is settable, and
// the wallet figures repeated the KPI strip that now sits above the tab bar.
// The figures move to the strip (route file), and this tab keeps the identity
// card — which is what "overview" should mean once the numbers live elsewhere.
import React from 'react';
import { Resource } from './_shared';
import { Secondary } from '../../components/Bilingual';

const FIELDS = [
  ['Contact', 'contact_name'],
  ['Email', 'contact_email'],
  ['Phone', 'contact_phone'],
  ['Website', 'website'],
  ['Industry', 'industry'],
  ['Slug', 'slug'],
];

export default function OverviewTab({ state, client }) {
  return (
    <Resource state={state} what="This client">
      <div className="hb-two">
        <section className="hb-card">
          <h3 className="hb-card__t">
            Contact
            <Secondary className="hb-card__hi" value="संपर्क" />
          </h3>
          <dl className="hb-facts">
            {FIELDS.map(([label, key]) => {
              const v = client?.[key];
              return (
                <div className="hb-facts__row" key={key}>
                  <dt className="hb-facts__k">{label}</dt>
                  <dd className={`hb-facts__v${v ? '' : ' hb-facts__v--none'}`}>
                    {/* "Not set" rather than an em dash. A dash reads as a value
                        the system holds; this is an absence someone can fix. */}
                    {v || 'Not set'}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>

        <section className="hb-card">
          <h3 className="hb-card__t">
            How this workspace is isolated
            <Secondary className="hb-card__hi" value="पृथक्करण" />
          </h3>
          {/* The reference's "Never shared" card (ScreensThin.jsx:335, HubPublish)
              states the boundary in words on the surface that depends on it. The
              build stated it nowhere, so the person assigning a skill pack had no
              way to know what the AI would and would not see. */}
          <ul className="hb-iso">
            {[
              'Generated content is stored against this client only.',
              'The brand profile below is injected into every prompt for this client and no other.',
              'Credits are drawn from this client’s wallet, never the org pool.',
              'Knowledge base documents are searched per client — a chat here cannot retrieve another client’s files.',
            ].map(t => <li className="hb-iso__i" key={t}>{t}</li>)}
          </ul>
          <div className="note note--info hb-note">
            This is enforced in the API by the org and client id on every query,
            not by which tab you are looking at.
          </div>
        </section>
      </div>
    </Resource>
  );
}
