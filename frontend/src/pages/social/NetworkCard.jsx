/**
 * One network, the whole story: the app above, the accounts below.
 *
 * The card's edge and chip carry `state`, which the SERVER computed
 * (`hub_connectors.card_state`) and which counts connected accounts — never
 * saved fields. The word is always beside the colour: a colour is the second
 * signal on this card, never the only one, and `Live` with no number is the
 * same non-answer the old `ON` was.
 */
import React from 'react';
import AppPanel from './AppPanel';
import AccountsPanel from './AccountsPanel';
import { STATE_WORD, stateSentence } from './stateWords';

const KIND_LINE = {
  oauth: 'Connects by consent',
  token: 'Connects by pasted token',
};

export default function NetworkCard({
  card, appCard, can, denials, clientId, clientName, isInternal,
  accountRows, onChanged,
}) {
  return (
    <article className="sa__card" data-state={card.state}>
      <header className="sa__head">
        <div>
          <h3 className="sa__name">{card.label}</h3>
          <span className="sa__kind">{KIND_LINE[card.kind] || 'Connects by consent'}</span>
        </div>
        <span className="sa__state" data-state={card.state}>
          {STATE_WORD[card.state] || card.state}
        </span>
      </header>

      <p className="sa__summary">{stateSentence(card)}</p>

      {card.caution && <p className="sa__caution">{card.caution}</p>}

      <AppPanel
        card={card}
        appCard={appCard}
        canEdit={!!can.edit_app}
        denial={denials.edit_app}
        clientId={clientId}
        clientName={clientName}
        isInternal={isInternal}
        onSaved={onChanged}
      />

      <AccountsPanel
        card={card}
        clientId={clientId}
        canConnect={!!can.connect}
        connectDenial={denials.connect}
        canSend={!!can.send}
        rows={accountRows}
        onChanged={onChanged}
      />
    </article>
  );
}
