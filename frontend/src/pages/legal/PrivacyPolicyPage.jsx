import React from 'react';
import { Link } from 'react-router-dom';
import LegalPage, { Sec, TK } from './LegalPage';
import {
  ENTITY, GRIEVANCE, HOSTING, RETENTION, RIGHTS, SENSITIVE, CERT_IN,
} from './legalFacts';

/**
 * The privacy policy.
 *
 * TWO ROLES, STATED FIRST. Almost every complaint against a B2B SaaS privacy
 * policy comes from collapsing them: for a firm's own employees and clients we
 * are a Data Processor acting on the firm's instructions, and the firm is the
 * Fiduciary. For the person who signs up, we are the Fiduciary. A reader who
 * cannot tell which paragraph applies to them will assume the worse one.
 *
 * No cookie-consent theatre and no "we may share with partners" clause. Both
 * are the standard filler, and both would be false here.
 */
export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      lede={`How ${ENTITY.name} handles personal data in ${ENTITY.product}, written to the Digital Personal Data Protection Act, 2023.`}
    >
      <div className="lgl__note">
        <p>
          <strong>The short version.</strong> Your firm's data belongs to your
          firm. We process it to run the product and for nothing else — we do
          not sell it, we do not use it to train AI models, and we do not
          advertise against it. Where we send it to another company to do a job
          for us, that company is named on the{' '}
          <Link to="/subprocessors">sub-processors page</Link>.
        </p>
      </div>

      <Sec n={1} h="Who we are">
        <p>
          {ENTITY.product} is operated by {ENTITY.name} (CIN{' '}
          <TK v={ENTITY.cin} />), registered at <TK v={ENTITY.regAddress} />.
          In this policy, "we" and "us" mean {ENTITY.name}, and "the product"
          means {ENTITY.product} at {ENTITY.domain}, including the Android
          application.
        </p>
      </Sec>

      <Sec n={2} h="Two different roles, and which one applies to you">
        <p>
          The Act distinguishes the party who decides why data is processed —
          the <strong>Data Fiduciary</strong> — from the party who processes it
          on their instructions, the <strong>Data Processor</strong>. Which one
          we are depends entirely on whose data it is.
        </p>
        <dl className="lgl__dl">
          <dt>Your firm's clients, employees, invoices and files</dt>
          <dd>
            Your firm is the Data Fiduciary. We are its Processor, and we act
            only on its instructions under the{' '}
            <Link to="/dpa">Data Processing Agreement</Link>. If you are an
            employee or a client of a firm that uses {ENTITY.product} and you
            want your data corrected or erased, ask that firm first — they
            control it, and in most cases they can do it themselves inside the
            product without involving us.
          </dd>
          <dt>The account you personally hold with us</dt>
          <dd>
            Your name, work email, phone number, login history and billing
            details. Here we are the Data Fiduciary, and section 6 applies to
            you directly.
          </dd>
        </dl>
      </Sec>

      <Sec n={3} h="What we collect, and why">
        <p>We collect four things and no others.</p>
        <ul>
          <li>
            <strong>Account data</strong> — the name, work email and phone
            number of each person your firm invites, so they can sign in and be
            addressed by name rather than by an identifier.
          </li>
          <li>
            <strong>Workspace data</strong> — everything your firm enters or
            uploads: clients, projects, tasks, time entries, invoices,
            employees, payroll, documents and messages. We hold it so the
            product can show it back to you.
          </li>
          <li>
            <strong>Technical data</strong> — IP address, browser and device
            type, and timestamps of requests. Used to keep the service running,
            to rate-limit abuse, and to meet the log retention obligation in
            section 8.
          </li>
          <li>
            <strong>Billing data</strong> — the plan, seat count and usage of
            your subscription.
          </li>
        </ul>
        <p>
          We do not run advertising or analytics trackers on the signed-in
          product, and we set no cookies other than those required to keep you
          signed in and to protect the session.
        </p>
      </Sec>

      <Sec n={4} h="Sensitive categories, named explicitly">
        <p>
          Some of what a practice management product holds deserves to be
          called out rather than left inside "workspace data".
        </p>
        <dl className="lgl__dl">
          {SENSITIVE.map(s => (
            <React.Fragment key={s.what}>
              <dt>{s.what}</dt>
              <dd>{s.note}</dd>
            </React.Fragment>
          ))}
        </dl>
      </Sec>

      <Sec n={5} h="Where your data lives">
        <p>{HOSTING.residencyNote}</p>
        <p>
          Files you upload are stored with Cloudflare R2 and transactional email
          is sent through Resend. The full list, with the region and the
          categories of data each one receives, is on the{' '}
          <Link to="/subprocessors">sub-processors page</Link>, which we update
          in the same change that adds the vendor.
        </p>
        <p>
          <strong>We do not use your data to train AI models.</strong> The
          assistant features send the text of a question and the records needed
          to answer it to a model provider, and the provider returns an answer.
          Those features are off unless your firm turns them on, and turning
          them off stops the transmission.
        </p>
      </Sec>

      <Sec n={6} h="Your rights">
        <p>
          Under ss.11–14 of the Act you have the following rights over the
          personal data for which we are the Fiduciary. Where we are only the
          Processor, we will pass your request to the firm that controls the
          data and help them answer it.
        </p>
        <dl className="lgl__dl">
          {RIGHTS.map(([h, p]) => (
            <React.Fragment key={h}>
              <dt>{h}</dt>
              <dd>{p}</dd>
            </React.Fragment>
          ))}
        </dl>
        <p>
          Exercising a right never costs anything and never degrades your
          service. We may ask you to verify your identity first, because
          handing someone else's data to whoever asks for it is the failure
          these rights exist to prevent.
        </p>
      </Sec>

      <Sec n={7} h="How long we keep it">
        <ul>
          <li>
            <strong>While your subscription is active</strong> — for as long as
            your firm keeps the record. Deleting inside the product deletes it.
          </li>
          <li>
            <strong>After termination</strong> — your workspace is retained for{' '}
            {RETENTION.afterTerminationDays} days so you can export it, then
            deleted.
          </li>
          <li>
            <strong>Backups</strong> — deleted records persist in encrypted
            backups for up to {RETENTION.backupRollOffDays} days before the
            backup itself rolls off. They are not restored to the live product.
          </li>
          <li>
            <strong>Audit and financial records</strong> — kept for{' '}
            {RETENTION.auditLogYears} years where the Companies Act or tax law
            requires it, which overrides a deletion request to that extent.
          </li>
          <li>
            <strong>Access logs</strong> — {RETENTION.logDays} days, as
            required by the CERT-In Directions.
          </li>
        </ul>
      </Sec>

      <Sec n={8} h="Security and breach notification">
        <p>
          The controls we operate are described on the{' '}
          <Link to="/security">security page</Link> rather than summarised
          vaguely here.
        </p>
        <p>
          If a personal data breach occurs we will notify the Data Protection
          Board of India and every affected Data Principal, in the form and
          within the period the DPDP Rules require. Separately, we report
          qualifying cyber incidents to CERT-In within{' '}
          {CERT_IN.reportHours} hours of noticing them, as Direction 20(3)/2022
          requires. Where your firm is the Fiduciary, we notify your firm
          without undue delay so that it can meet its own obligation — we do
          not notify your clients on your behalf without being asked to.
        </p>
      </Sec>

      <Sec n={9} h="Children">
        <p>
          {ENTITY.product} is a business product and is not offered to anyone
          under 18. We do not knowingly process a child's personal data. If your
          firm enters data about a child — for example a dependant on an
          employee record — your firm is responsible for the verifiable parental
          consent s.9 of the Act requires.
        </p>
      </Sec>

      <Sec n={10} h="Changes to this policy">
        <p>
          When we change this policy materially we will notify account holders
          by email before the change takes effect, and update the date at the
          top. Past versions are available on request.
        </p>
      </Sec>

      <Sec n={11} h="Grievance Officer">
        <p>
          As required by s.13 of the Act, the following person answers
          questions and complaints about how we handle personal data.
        </p>
        <dl className="lgl__dl">
          <dt>Name</dt>
          <dd><TK v={GRIEVANCE.name} /></dd>
          <dt>Email</dt>
          <dd><TK v={GRIEVANCE.email} /></dd>
          <dt>Postal address</dt>
          <dd><TK v={ENTITY.regAddress} /></dd>
          <dt>Response time</dt>
          <dd>Within {GRIEVANCE.responseDays} days of receipt.</dd>
        </dl>
        <p>
          If you are not satisfied with the answer, you may complain to the Data
          Protection Board of India.
        </p>
      </Sec>
    </LegalPage>
  );
}
