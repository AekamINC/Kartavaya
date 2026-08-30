import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button } from '../../components/ui';
import { useToast } from '../../components/ui/toast';
import { apiErrorText } from '../../lib/apiError';

/**
 * TabReports — the passphrase scheduled report PDFs are encrypted with.
 * `GET/PUT /api/v1/org/profile/report-passphrase` (`routers/org_profile.py`).
 *
 * ── WHY THIS SCREEN EXISTS ─────────────────────────────────────────────────
 *
 * The scheduled Finance/CRM report used to be mailed as the EMAIL BODY — the
 * firm's turnover and pipeline sitting unencrypted in every recipient's
 * mailbox. The owner's instruction (2026-08-29) was "report email needs to be
 * in pdf as this email is not secure", and, told that a plain PDF attachment is
 * no more private than a body, chose a PASSWORD-PROTECTED PDF.
 *
 * ⚠ THE PASSPHRASE IS NEVER EMAILED, and that is the entire point. A
 * passphrase sent beside the document it protects protects nothing — both land
 * in the same mailbox. So the report email says WHERE the passphrase is and
 * never what it is, and this is the where.
 *
 * ── WHY IT SHOWS THE VALUE IN PLAIN TEXT ───────────────────────────────────
 *
 * Because it has to. This is a DOCUMENT passphrase, not a login credential: the
 * server holds the plaintext in order to encrypt with it, so it cannot be
 * hashed, and an administrator who cannot read it back has no way to tell
 * anybody what it is. "I forgot it" is answered by opening this screen. It is
 * stored encrypted at rest (Fernet) and it is not in `GET /v1/org/profile`, so
 * it is not on the surface an Aekam support operator can reach.
 *
 * That is a real, stated trade rather than a claim of secrecy, and the screen
 * says so in the same words rather than implying a password manager.
 *
 * ── WHY IT IS ITS OWN TAB AND NOT A ROW UNDER SECURITY ─────────────────────
 *
 * `TabSecurity` renders every control gated on `data.storage_ready` — a probe
 * for `staging.org_security`. Putting the passphrase there would make it
 * unreachable whenever that unrelated table is missing, which is the kind of
 * coupling that turns one migration into two broken features. It also needs
 * org_admin READ (an admin has to be able to tell people the value), where
 * TabSecurity's writes are org_owner only.
 *
 * ── CLASSES ────────────────────────────────────────────────────────────────
 *
 * Every class here already exists (`sr`/`sr__l`/`sr__t`/`sr__d`/`sr__c`,
 * `st__group`, `st__gt`, `of__i`, `dz__act`, `opend`), copied from
 * `TabSecurity`. `check-classes.mjs` FAILS the build on a className with no
 * matching rule and `check-orphan-selectors.mjs` FAILS on a selector with no
 * consumer, so adding CSS here would have to be paired with markup in the same
 * commit — and none is needed.
 */

function Row({ title, detail, children }) {
  return (
    <div className="sr">
      <div className="sr__l">
        <div className="sr__t">{title}</div>
        <div className="sr__d">{detail}</div>
      </div>
      <div className="sr__c">{children}</div>
    </div>
  );
}

export default function TabReports() {
  const { pushToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState('');
  const [isSet, setIsSet] = useState(false);
  // Off by default. The value is meant to be readable, but it should not be on
  // screen the moment somebody opens Settings with a room behind them.
  const [reveal, setReveal] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/v1/org/profile/report-passphrase');
      setValue(data?.passphrase || '');
      setIsSet(!!data?.is_set);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.put('/v1/org/profile/report-passphrase',
        { passphrase: value });
      setIsSet(!!data?.is_set);
      pushToast({
        type: 'success',
        title: data?.is_set ? 'Report passphrase saved' : 'Report passphrase cleared',
        message: data?.note,
      });
    } catch (err) {
      // The backend returns the SENTENCE, not a code — it is written for the
      // person typing, so it is shown rather than replaced with a generic.
      pushToast({ type: 'error', title: apiErrorText(err, 'Could not save the passphrase.') });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="st__group"><p className="sr__d">Loading…</p></div>;

  if (failed) {
    return (
      <div className="st__group">
        <p className="sr__d">Could not load the report passphrase.</p>
      </div>
    );
  }

  return (
    <form onSubmit={save}>
      <section className="st__group">
        <h2 className="st__gt">Scheduled report PDFs</h2>

        <Row
          title="Report passphrase"
          detail={
            'Scheduled Finance and CRM reports are delivered as a password-protected PDF, '
            + 'and this is the password that opens them. It is NEVER included in the email — '
            + 'a passphrase sent beside the document it protects protects nothing. Tell '
            + 'recipients yourself, however you would tell them anything else confidential.'
          }
        >
          <input
            className="of__i of__i--mono"
            type={reveal ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="At least 12 characters"
            autoComplete="off"
            aria-label="Report passphrase"
          />
        </Row>

        <Row
          title="Show it"
          detail="Only administrators and the owner can open this screen. Members who receive the report cannot see the passphrase here and have to be told."
        >
          <Button type="button" variant="out" size="sm"
            onClick={() => setReveal(r => !r)}>
            {reveal ? 'Hide' : 'Show'}
          </Button>
        </Row>

        <Row
          title="Status"
          detail={
            isSet
              ? 'Set. The next scheduled report will arrive as an encrypted PDF.'
              : 'Not set. Scheduled reports currently arrive as a link to open the report in Kartavaya — no figures are sent by email at all, and the email says why.'
          }
        >
          <span className="sr__d">{isSet ? 'Encrypted PDF' : 'Link only'}</span>
        </Row>
      </section>

      <section className="st__group">
        <h2 className="st__gt">Before you change it</h2>
        <p className="sr__d">
          Changing the passphrase does not change reports that have already been
          delivered. A PDF sitting in somebody’s mailbox was encrypted with the
          passphrase that was current when it was sent, and it still opens with
          that one. Rotating this is not a way to withdraw a report you have
          already emailed.
        </p>
        <p className="sr__d">
          Clearing it is a real choice, not an error: reports then arrive as a
          link that needs a Kartavaya login, which sends no figures by email at
          all.
        </p>
        <p className="sr__d">
          A very large report — a long period, or a very large organisation logo
          on the letterhead — is sent as a link instead of an attachment, because
          some mail servers reject a big message and this product would never
          hear that it happened. The email says so when it does.
        </p>
      </section>

      <div className="dz__act">
        <Button type="submit" variant="fill" size="sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
