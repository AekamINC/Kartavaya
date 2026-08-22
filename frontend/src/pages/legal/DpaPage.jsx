import React from 'react';
import { Link } from 'react-router-dom';
import LegalPage, { Sec, TK } from './LegalPage';
import {
  ENTITY, GRIEVANCE, RETENTION, CERT_IN, HOSTING,
} from './legalFacts';

/**
 * The Data Processing Agreement.
 *
 * PUBLISHED AS A PAGE, NOT A PDF, and incorporated into the terms by
 * reference. The alternative — mailing a PDF for signature per customer — is
 * the model that produces fourteen slightly different DPAs in a shared drive,
 * none of which anyone can prove is current. A page has one version, is dated,
 * and prints to PDF cleanly when a customer's counsel insists on a signed
 * copy; legal.css strips the chrome for exactly that.
 *
 * DRAFTED FOR THE DPDP ACT, which — unlike the GDPR — does not prescribe the
 * clauses a processor contract must contain. The structure follows what an
 * Indian enterprise buyer's counsel will look for anyway, because that is who
 * reads it, and because the s.8(2) liability for an undisclosed sub-processor
 * makes the sub-processor clause the one that actually matters.
 *
 * THIS IS NOT LEGAL ADVICE AND HAS NOT BEEN REVIEWED BY COUNSEL. It is a
 * complete draft for a lawyer to mark up, not a substitute for one.
 */
export default function DpaPage() {
  return (
    <LegalPage
      title="Data Processing Agreement"
      lede={`The terms on which ${ENTITY.name} processes personal data on behalf of your firm. Incorporated into your subscription agreement by reference.`}
    >
      <div className="lgl__note">
        <p>
          <strong>Who this is between.</strong> Your firm (the{' '}
          <strong>Fiduciary</strong>) and {ENTITY.name} (the{' '}
          <strong>Processor</strong>). It applies automatically from the day
          your firm starts using {ENTITY.product} — there is nothing to
          countersign, though we will sign a copy on request.
        </p>
      </div>

      <Sec n={1} h="Definitions">
        <dl className="lgl__dl">
          <dt>The Act</dt>
          <dd>The Digital Personal Data Protection Act, 2023, and the rules made under it.</dd>
          <dt>Personal Data</dt>
          <dd>Data about an identifiable individual that we process on your instructions through {ENTITY.product}.</dd>
          <dt>Data Principal</dt>
          <dd>The individual the Personal Data is about — your client, your employee, your client's contact.</dd>
          <dt>Sub-processor</dt>
          <dd>A third party we engage to process Personal Data on our behalf, listed at <Link to="/subprocessors">/subprocessors</Link>.</dd>
          <dt>Personal Data Breach</dt>
          <dd>Any unauthorised processing, or accidental disclosure, acquisition, sharing, use, alteration, destruction or loss of access, that compromises the confidentiality, integrity or availability of Personal Data.</dd>
        </dl>
      </Sec>

      <Sec n={2} h="Roles, and the scope of processing">
        <p>
          Your firm is the Data Fiduciary and determines the purposes and means
          of processing. We are the Data Processor and process Personal Data
          only on your documented instructions.
        </p>
        <p>
          Your use of the product is the instruction. We will not process
          Personal Data for any other purpose, and specifically we will not:
        </p>
        <ul>
          <li>sell, rent, or disclose Personal Data to a third party except as this agreement permits;</li>
          <li>use Personal Data to train, fine-tune or evaluate any machine learning model, whether ours or a third party's;</li>
          <li>use Personal Data to profile, market to, or contact your clients or employees for our own purposes;</li>
          <li>combine Personal Data from your workspace with that of any other customer.</li>
        </ul>
        <p>
          <strong>Subject matter and duration:</strong> provision of the{' '}
          {ENTITY.product} practice management service, for the term of your
          subscription and the retention period in clause 9.
        </p>
        <p>
          <strong>Categories of Data Principal:</strong> your firm's personnel;
          your clients and their personnel; and any individual whose data your
          firm chooses to enter.
        </p>
        <p>
          <strong>Categories of Personal Data:</strong> identity and contact
          details; employment, attendance, leave and payroll data; financial and
          tax identifiers including GSTIN, PAN and TAN; bank account details;
          documents and correspondence uploaded by your firm; and, where your
          firm enters it, Aadhaar numbers and biometric attendance data.
        </p>
      </Sec>

      <Sec n={3} h="Your obligations as Fiduciary">
        <p>
          The lawful basis for processing sits with you, not with us. You
          confirm that you have obtained any consent or established any other
          lawful ground the Act requires, that you have given your Data
          Principals the notice s.5 requires, and that your instructions to us
          do not cause us to breach the Act.
        </p>
        <p>
          You are responsible for what your firm enters. In particular, do not
          upload Personal Data you have no basis to hold, and do not enter
          Aadhaar numbers where the purpose does not require them.
        </p>
      </Sec>

      <Sec n={4} h="Confidentiality">
        <p>
          We keep Personal Data confidential. Our personnel are bound by
          confidentiality obligations that survive the end of their engagement,
          and access is limited to those who need it to provide, support or
          secure the service. Every such access is recorded in an audit trail
          your administrators can read.
        </p>
      </Sec>

      <Sec n={5} h="Security">
        <p>
          We implement and maintain reasonable security safeguards appropriate
          to the risk, as s.8(5) of the Act requires. The controls in force are
          described at <Link to="/security">/security</Link>, which forms part
          of this agreement, and we will not materially reduce them during your
          subscription.
        </p>
      </Sec>

      <Sec n={6} h="Sub-processors">
        <p>
          You give general authorisation for us to engage the sub-processors
          listed at <Link to="/subprocessors">/subprocessors</Link>. We remain
          fully liable to you for their performance.
        </p>
        <p>
          Before a new sub-processor begins processing Personal Data we will
          update that page and notify your administrators by email at least{' '}
          <strong>thirty days</strong> beforehand. If you reasonably object on
          data protection grounds within that period, tell us; if we cannot
          offer a workaround, you may terminate the affected part of the service
          without penalty and receive a refund of fees paid for the unused
          remainder of the term.
        </p>
        <p>
          Sub-processors engaged with credentials you supply — your own
          messaging and social accounts — are your choice, not our appointment,
          and this clause does not apply to them.
        </p>
      </Sec>

      <Sec n={7} h="Assisting you with Data Principal requests">
        <p>
          The product is built so that your administrators can find, export,
          correct and delete records themselves, which is normally faster than
          asking us.
        </p>
        <p>
          Where a request cannot be satisfied through the product, we will
          assist you at no charge and within a period that lets you meet your
          own deadline. If a Data Principal contacts us directly about data you
          control, we will not answer on your behalf — we will tell them to
          contact you and inform you promptly.
        </p>
      </Sec>

      <Sec n={8} h="Breach notification">
        <p>
          We will notify you of a Personal Data Breach affecting your Personal
          Data <strong>without undue delay</strong> after becoming aware of it,
          and in any event within <strong>48 hours</strong>. The notification
          will describe what happened, the categories and approximate number of
          Data Principals and records affected, the likely consequences, and the
          steps taken.
        </p>
        <p>
          Where the facts are not yet established we will send an initial
          notification within that period rather than wait for a complete one,
          and follow it as the investigation progresses.
        </p>
        <p>
          We separately report qualifying cyber incidents to CERT-In within{' '}
          {CERT_IN.reportHours} hours under Direction 20(3)/2022. Notifying the
          Data Protection Board and your Data Principals is your obligation as
          Fiduciary; we will give you everything you need to discharge it.
        </p>
      </Sec>

      <Sec n={9} h="Return and deletion">
        <p>
          You may export your data at any time during the subscription. On
          termination we retain your workspace for{' '}
          {RETENTION.afterTerminationDays} days so you can export it, and then
          delete it.
        </p>
        <p>
          Encrypted backups roll off within {RETENTION.backupRollOffDays} days
          of deletion and are not restored to the live service. Where a law
          requires us to retain a record — financial records under the Companies
          Act, for up to {RETENTION.auditLogYears} years — we keep only that
          record, and only for that purpose.
        </p>
        <p>We will confirm deletion in writing on request.</p>
      </Sec>

      <Sec n={10} h="Transfers outside India">
        <p>{HOSTING.residencyNote}</p>
        <p>
          Where a sub-processor is located outside India, the transfer is made
          under contractual terms requiring protection at least equivalent to
          this agreement. If the Central Government notifies a country under
          s.16 to which transfer is restricted, we will cease transferring to
          that country and tell you what changed.
        </p>
      </Sec>

      <Sec n={11} h="Audit">
        <p>
          On reasonable written notice, no more than once a year, we will
          provide the information reasonably needed to demonstrate our
          compliance with this agreement, and answer a security questionnaire.
        </p>
        <p>
          Where we hold a current independent audit report or certification, we
          will provide it in place of an on-site inspection. We do not hold one
          today, and say so at <Link to="/security">/security</Link> rather than
          implying otherwise here. An on-site inspection, where genuinely
          required by your regulator, will be arranged at your cost and must not
          give access to another customer's data.
        </p>
      </Sec>

      <Sec n={12} h="Liability, term and law">
        <p>
          This agreement takes effect when your firm starts using{' '}
          {ENTITY.product} and continues while we process Personal Data for you.
          Clauses 4, 8, 9 and 12 survive its end.
        </p>
        <p>
          Liability under this agreement is subject to the limitations in your
          subscription agreement, except that nothing limits liability that
          cannot be limited by law.
        </p>
        <p>
          This agreement is governed by the laws of {ENTITY.jurisdiction}, and
          the courts at <TK v={ENTITY.courts} /> have exclusive jurisdiction. If
          this agreement conflicts with your subscription agreement on the
          processing of Personal Data, this agreement prevails.
        </p>
      </Sec>

      <Sec n={13} h="Contact">
        <p>
          Notices under this agreement go to <TK v={GRIEVANCE.email} />, and to
          the administrator email addresses on your account.
        </p>
      </Sec>
    </LegalPage>
  );
}
