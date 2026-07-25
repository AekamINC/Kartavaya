import React from 'react';

export function PageHeader({ kicker, title, sanskrit, lede, right }) {
  return (
    <header className="k-pageh">
      <div className="k-pageh__txt">
        {kicker && <div className="k-pageh__kicker">{kicker}</div>}
        <h1 className="k-pageh__h1">
          {title}
          {sanskrit && <span className="k-pageh__sans">{sanskrit}</span>}
        </h1>
        {lede && <p className="k-pageh__lede">{lede}</p>}
      </div>
      {right && <div className="k-pageh__right">{right}</div>}
    </header>
  );
}
