import React from 'react';
import { Link } from 'react-router-dom';
import LegalPage, { Sec, TK } from './LegalPage';
import {
  ENTITY, HOSTING, RETENTION, SECURITY_CONTACT, CERT_IN,
} from './legalFacts';

/**
 * The security page.
 *
 * WRITTEN UNDER THE SAME RULE AS THE LANDING PAGE'S TRUST SECTION: only claims
 * that are true and checkable today. Section 8 exists because of that rule —
 * a security page that lists strengths and omits the gaps is read by a CA firm
 * as a page that is hiding something, and the omission is discovered during
 * diligence rather than disclosed during the sale. Naming the gaps ourselves
 * costs one paragraph and buys the rest of the page its credibility.
 *
 * Nothing here claims a certification we do not hold. In particular there is
 * no SOC 2 badge, and there will not be one until an auditor issues a report.
 */
export default function SecurityPage() {
  return (
    <LegalPage
      title="Security"
      lede={`The controls that protect your firm's data in ${ENTITY.product}, and an honest account of what we have not built yet.`}
    >
      <Sec n={1} h="Isolation between firms">
        <p>
          Every record in {ENTITY.product} belongs to exactly one workspace, and
          every query is scoped to the workspace of the person making it. Client
          accounts see only the projects shared with them, and never see
          internal comments, time entries or rates.
        </p>
        <p>
          Access is granted per person and per module rather than inherited from
          a job title. Payroll, invoicing and HR are marked sensitive and must
          be granted individually. Turning a module off revokes access without
          destroying the history behind it.
        </p>
      </Sec>

      <Sec n={2} h="Encryption">
        <ul>
          <li>
            <strong>In transit</strong> — TLS on every connection, to the web
            application, the API and the mobile application alike.
          </li>
          <li>
            <strong>At rest</strong> — the database and file storage are
            encrypted by the platforms that host them.
          </li>
          <li>
            <strong>Field level</strong> — the categories that would do the most
            damage if a database copy leaked, principally Aadhaar numbers and
            third-party access tokens, carry a second layer of encryption under
            a key held separately from the database. A stolen database dump does
            not yield them.
          </li>
        </ul>
      </Sec>

      <Sec n={3} h="Authentication and access">
        <ul>
          <li>Passwords are stored only as salted hashes. Nobody at {ENTITY.name} can read one.</li>
          <li>Sessions are held in cookies that JavaScript cannot read, and are marked secure in production.</li>
          <li>Authentication endpoints are rate limited — sign-in attempts are capped per minute, per source address — so credential stuffing is throttled rather than merely logged.</li>
          <li>Password reset and invitation links are single-use and expire.</li>
        </ul>
      </Sec>

      <Sec n={4} h="Audit trail">
        <p>
          Who changed what, and when, is recorded — including access by our own
          support staff to a customer workspace. The trail is readable by your
          firm's administrators, not only by us, which is the part that makes it
          worth anything: an audit log only the vendor can read is a log that
          audits nobody.
        </p>
        <p>
          Access logs are retained for {RETENTION.logDays} days, as the CERT-In
          Directions require.
        </p>
      </Sec>

      <Sec n={5} h="Where it runs">
        <p>{HOSTING.residencyNote}</p>
        <p>
          The full list of infrastructure and service providers, with the region
          and the data each receives, is on the{' '}
          <Link to="/subprocessors">sub-processors page</Link>.
        </p>
      </Sec>

      <Sec n={6} h="Backups and recovery">
        <p>
          The database is backed up continuously by the hosting platform, with
          point-in-time recovery. Deleted records persist in those backups for up
          to {RETENTION.backupRollOffDays} days before rolling off. Backups are
          encrypted and are never restored into a customer-facing environment
          except to recover that customer.
        </p>
      </Sec>

      <Sec n={7} h="Reporting a vulnerability">
        <p>
          Send it to <TK v={SECURITY_CONTACT.email} />. We acknowledge within{' '}
          {SECURITY_CONTACT.ackHours} hours and will tell you what we found and
          when it was fixed.
        </p>
        <p>
          If you are testing in good faith, stay within your own workspace, do
          not access another firm's data, do not run denial-of-service or
          automated scanning against production, and give us a reasonable
          period to fix an issue before disclosing it. We will not pursue a
          researcher who follows those rules. We do not currently pay bounties.
        </p>
        <p>
          Qualifying incidents are reported to CERT-In within{' '}
          {CERT_IN.reportHours} hours of being noticed, and affected customers
          are notified without undue delay.
        </p>
      </Sec>

      <Sec n={8} h="What we do not have yet">
        <p>
          The rest of this page describes controls that exist. This section
          describes the ones that do not, because a firm evaluating us will find
          out either way, and would rather find out here.
        </p>
        <ul>
          <li>
            <strong>No SOC 2 report and no ISO 27001 certificate.</strong> We
            hold neither today. We will not display a badge for either until an
            accredited auditor has issued it.
          </li>
          <li>
            <strong>No independent penetration test has been published.</strong>{' '}
            When one is commissioned we will say who performed it and make a
            summary available under NDA.
          </li>
          <li>
            <strong>Multi-factor authentication is not yet available.</strong>{' '}
            Sign-in is password-based today.
          </li>
          <li>
            <strong>No Indian data residency.</strong> Stated plainly in section
            5 rather than left for a questionnaire to uncover.
          </li>
        </ul>
        <p>
          If any of these blocks a decision for your firm, say so — knowing
          which gap is costing us a customer is how it gets prioritised.
        </p>
      </Sec>
    </LegalPage>
  );
}
