import React from 'react';
import {
  Cell, EmptyState, HeadCell, Row, Table, TableBody, TableHead, Tabs, Tag,
} from '../../components/ui';
import { grouped, inr } from '../../lib/inr';

/**
 * UsageBySource — one tab per cost source, each holding its own `ref_id` rows.
 *
 * The tab LIST is never written down here. It is `sources[]` exactly as the API
 * returned it, so a source with no spend this month has no tab and nobody has to
 * decide whether an empty "Scrapers" tab means "nothing ran" or "we forgot to
 * add it". What IS written down here is the WORDING for the sources we have
 * something honest to say about — the API supplies data, this file supplies
 * English.
 *
 * ── The three honesty rules this file exists to keep ────────────────────────
 *
 * 1. `unitemised` is not a source. The 171 ledger rows written before migration
 *    095 carry no `kind`, so nothing knows what they were spent on. They get
 *    their own tab, named for what they are, and their free-text descriptions
 *    are shown verbatim rather than pattern-matched into a real source. A
 *    `LIKE 'scraper%'` here would produce a number that looks itemised and is a
 *    guess.
 *
 * 2. WhatsApp is billed by Meta per 24-hour CONVERSATION, not per message. The
 *    ledger records sends, so a per-person split is attributable but is not a
 *    clean division of the invoice Meta raises. The tab says so instead of
 *    quietly dividing.
 *
 * 3. A zero is two different facts and must not render as one. `CreditFigure`
 *    below separates "nothing was recorded here" from "N things were recorded
 *    and each is priced at 0 credits" — the second is what every organic social
 *    publish looks like, and rendering it as a muted dash tells the reader the
 *    integration is broken when it is working exactly as priced.
 */

/**
 * What one credit is sold for. Mirrors `CREDIT_PRICE_INR` in
 * `backend/services/credits.py`, which is the authority — this copy exists only
 * to put an indicative rupee figure beside a credit figure, and every surface
 * that renders it must label it indicative. The ledger holds credits; it does
 * not hold rupees, and inventing a rupee total the ledger cannot support is how
 * a billing screen and an invoice come to disagree.
 *
 * Declared in this file, the leaf, so the section and the person table can both
 * import it without a module cycle.
 */
export const CREDIT_PRICE_INR = 4;

/** Credits → the indicative rupee figure. Never presented as an amount due. */
export const indicativeInr = credits =>
  inr(Math.round((Number(credits) || 0) * CREDIT_PRICE_INR));

/**
 * A credit figure that tells the truth about zero.
 *
 *   no transactions      → an em dash. Nothing happened here.
 *   transactions, 0      → a marked zero. It was metered and it cost nothing.
 *   anything else        → the number, with the indicative rupee value under it.
 */
export function CreditFigure({ credits, txCount, showInr = true }) {
  const c = Number(credits) || 0;
  const n = Number(txCount) || 0;

  if (n === 0 && c === 0) {
    return <span className="bl__none" aria-label="nothing recorded">—</span>;
  }
  if (c === 0) {
    return (
      <span className="bl__zero" title={`${grouped(n)} recorded, priced at 0 credits`}>
        0
        <span className="k-sr-only"> credits — {grouped(n)} transactions recorded, each priced at zero</span>
      </span>
    );
  }
  return (
    <span className="bl__fig">
      <span className="bl__fig-c">{grouped(c)}</span>
      {showInr && <span className="bl__fig-r">{indicativeInr(c)}</span>}
    </span>
  );
}

/**
 * Our wording, where we have wording. Missing keys fall through to the API's
 * `label`, so a source added on the server appears with the server's name
 * rather than not appearing at all.
 */
const LABEL = {
  sahayak: 'Sahayak',
  skills: 'Skills',
  chat: 'Chat',
  whatsapp: 'WhatsApp',
  social: 'Social',
  scrapers: 'Scrapers',
  wallet: 'Wallet',
  unitemised: 'Before spend was itemised',
};

/** The sentence that has to sit above a tab before its numbers can be trusted. */
const NOTE = {
  whatsapp:
    'Meta bills WhatsApp per 24-hour conversation, not per message. The rows below '
    + 'count sends, so a per-person split here is attributable but is not a clean '
    + 'division of what Meta charges — two people messaging the same contact inside '
    + 'one window are one conversation on the bill.',
  social:
    'One row per platform. A platform priced at 0 credits is an organic publish '
    + 'with no AI cost — it is metered, and the zero is the price, not a gap.',
  scrapers:
    'A true-up is the correction posted once a run’s real provider cost is known. '
    + 'It is shown as its own row rather than folded into the run it corrects.',
  wallet:
    'Top-ups and period grants. These are movements of the balance, not usage, and '
    + 'they are never added into a spend total.',
};

const unitemisedNote = n =>
  `These ${grouped(n)} transactions predate the itemised ledger. Their descriptions are `
  + 'free text and are not parsed — nothing here has been guessed into a source.';

export const sourceLabel = s => LABEL[s?.source] || s?.label || s?.source || 'Unknown';

/**
 * `social_send:facebook` → `Facebook`. Only ever a display fallback: when the
 * API sends a `label` that wins, because the server knows the catalogue and this
 * does not.
 */
function itemLabel(item) {
  if (item.label) return item.label;
  const ref = String(item.ref_id || '');
  if (!ref) return 'Unattributed';
  const tail = ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref;
  return tail.charAt(0).toUpperCase() + tail.slice(1).replace(/_/g, ' ');
}

function SourcePanel({ source, isPlatformOrg }) {
  const items = source.items || [];
  const note = source.source === 'unitemised'
    ? unitemisedNote(source.tx_count || 0)
    : NOTE[source.source];

  return (
    <div className="bl__panel">
      {note && <p className="bl__note">{note}</p>}

      {items.length === 0 ? (
        <EmptyState
          title={{ en: 'Nothing itemised in this source', hi: 'कोई विवरण नहीं' }}
          description="The source has a total for the period but no breakdown rows."
        />
      ) : (
        <Table className="bl__tbl">
          <TableHead>
            <HeadCell>Item</HeadCell>
            <HeadCell num>Credits</HeadCell>
            <HeadCell num>Transactions</HeadCell>
            {isPlatformOrg && <HeadCell num>Recorded only</HeadCell>}
          </TableHead>
          <TableBody>
            {items.map(it => (
              <Row key={it.ref_id || itemLabel(it)}>
                <Cell>
                  <span className="bl__item">{itemLabel(it)}</span>
                  {it.ref_id && <span className="bl__ref">{it.ref_id}</span>}
                </Cell>
                <Cell num><CreditFigure credits={it.credits} txCount={it.tx_count} /></Cell>
                <Cell num>{grouped(it.tx_count || 0)}</Cell>
                {isPlatformOrg && (
                  <Cell num>
                    <CreditFigure
                      credits={it.metered_only_credits}
                      txCount={it.metered_only_credits ? it.tx_count : 0}
                      showInr={false}
                    />
                  </Cell>
                )}
              </Row>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export default function UsageBySource({ sources, active, onActive, isPlatformOrg }) {
  const list = sources || [];

  if (list.length === 0) {
    return (
      <EmptyState
        title={{ en: 'No spend recorded this period', hi: 'कोई व्यय नहीं' }}
        description="Nothing has been charged to this organisation in the month selected above."
      />
    );
  }

  const tabs = list.map(s => ({
    value: s.source,
    label: (
      <span className="bl__tabl">
        {sourceLabel(s)}
        {isPlatformOrg && Number(s.metered_only_credits) > 0 && (
          <Tag color="var(--warn)">metered</Tag>
        )}
      </span>
    ),
    count: s.tx_count,
    content: <SourcePanel source={s} isPlatformOrg={isPlatformOrg} />,
  }));

  return (
    <Tabs
      /* The tab set is data, so it changes when the month changes. Keying on the
         set forces a fresh mount rather than leaving the sliding indicator
         measuring a tab that no longer exists. */
      key={list.map(s => s.source).join('|')}
      tabs={tabs}
      defaultTab={list.some(s => s.source === active) ? active : list[0].source}
      onChange={onActive}
    />
  );
}
