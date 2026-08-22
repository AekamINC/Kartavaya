import React from 'react';
import { Link } from 'react-router-dom';
import LegalPage, { Sec, TK } from './LegalPage';
import { SUB_PROCESSORS, TIERS, ENTITY, GRIEVANCE } from './legalFacts';

/**
 * The sub-processor list.
 *
 * Grouped by tier rather than alphabetically, because the question a reader
 * actually arrives with is "who sees my data if I do nothing?" — and an
 * alphabetical list answers it only after they have read every row. The three
 * tiers answer it in the first block.
 *
 * The rows come from legalFacts.SUB_PROCESSORS, which was built by reading the
 * outbound hosts in the backend rather than from memory. That is the only way
 * this page stays true: a list assembled from recollection is wrong within a
 * quarter and nobody notices until a due-diligence questionnaire catches it.
 */

const ORDER = ['core', 'optional', 'yours'];

function Table({ rows }) {
  return (
    <div className="lgl__tablewrap">
      <table className="lgl__table">
        <thead>
          <tr>
            <th scope="col">Sub-processor</th>
            <th scope="col">What it does</th>
            <th scope="col">Data it receives</th>
            <th scope="col">Location</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.name}>
              <th scope="row">{r.name}</th>
              <td>{r.purpose}</td>
              <td>{r.data}</td>
              <td><TK v={r.region} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SubProcessorsPage() {
  return (
    <LegalPage
      title="Sub-processors"
      lede={`Every company that may receive personal data in the course of running ${ENTITY.product}, what it does with it, and where it sits.`}
    >
      <Sec n={1} h="How to read this page">
        <p>
          A sub-processor is a company we engage to help deliver the product,
          and which may handle personal data your firm has entrusted to us. They
          are grouped by when they come into play, because that is the question
          worth answering first.
        </p>
        <ul>
          <li><strong>Always</strong> — engaged for every customer. There is no configuration that avoids them.</li>
          <li><strong>Feature-dependent</strong> — engaged only if your firm switches the relevant feature on, and disengaged when you switch it off.</li>
          <li><strong>Your own connections</strong> — reached using credentials your firm supplies. You have a direct relationship with these companies; we pass data to them because you told us to.</li>
        </ul>
      </Sec>

      <Sec n={2} h="Always">
        <p className="lgl__tier">{TIERS.core}</p>
        <Table rows={SUB_PROCESSORS.filter(s => s.tier === 'core')} />
      </Sec>

      <Sec n={3} h="Feature-dependent">
        <p className="lgl__tier">{TIERS.optional}</p>
        <Table rows={SUB_PROCESSORS.filter(s => s.tier === 'optional')} />
        <p>
          The assistant and lead-research features are off by default. No
          request reaches a model provider or a search provider until an
          administrator in your firm enables the module.
        </p>
      </Sec>

      <Sec n={4} h="Your own connections">
        <p className="lgl__tier">{TIERS.yours}</p>
        <Table rows={SUB_PROCESSORS.filter(s => s.tier === 'yours')} />
        <p>
          These platforms bill you directly and hold their own terms with you.
          For WhatsApp in particular, Meta charges your firm for conversations —
          we do not resell messaging, and we never send on a connection your
          firm has not authorised.
        </p>
      </Sec>

      <Sec n={5} h="Who is not on this list">
        <p>
          Stating the absences matters as much as the entries, because these are
          the categories a reader assumes are present.
        </p>
        <ul>
          <li>
            <strong>No payment gateway.</strong> {ENTITY.product} does not
            process card or UPI payments and holds no cardholder data. An
            invoice is marked paid only when your firm reconciles it against a
            bank statement.
          </li>
          <li>
            <strong>No advertising or analytics networks.</strong> There is no
            third-party tracker on the signed-in product.
          </li>
          <li>
            <strong>No data brokers.</strong> We do not sell, rent or share
            personal data for anyone else's purposes.
          </li>
        </ul>
      </Sec>

      <Sec n={6} h="Notice of change">
        <p>
          When we add or replace a sub-processor that handles customer personal
          data, we update this page and email account administrators before the
          change takes effect. Clause 6 of the{' '}
          <Link to="/dpa">Data Processing Agreement</Link> sets out how to
          object.
        </p>
        <p>
          Questions about anything on this page go to{' '}
          <TK v={GRIEVANCE.email} />.
        </p>
      </Sec>
    </LegalPage>
  );
}
