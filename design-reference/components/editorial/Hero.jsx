import React from 'react';

const WEEK_HI = ['सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि', 'रवि'];

export function Hero({ name, dateLine, lede, weekDates = [], dotsByDay = {}, todayIdx }) {
  return (
    <section className="k-hero">
      <div className="k-hero__watermark" aria-hidden="true">कर्तव्य</div>
      <div className="k-hero__inner">
        {dateLine && (
          <div className="k-hero__meta">
            {dateLine.map((seg, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="k-hero__sep">·</span>}
                <span className={seg.hindi ? 'k-hero__samvat' : 'k-hero__date'}>{seg.label}</span>
              </React.Fragment>
            ))}
          </div>
        )}
        <h1 className="k-hero__h1">
          <span className="k-hero__greet">नमस्ते,</span>
          <span className="k-hero__name"> {name}.</span>
        </h1>
        {lede && <p className="k-hero__lede">{lede}</p>}
        {weekDates.length > 0 && (
          <div className="k-hero__weekstrip">
            {weekDates.map((d, i) => {
              const dots = dotsByDay[d.toDateString ? d.toDateString() : d] || 0;
              return (
                <div key={i} className={'k-wday' + (i === todayIdx ? ' is-today' : '')}>
                  <div className="k-week__hi">{WEEK_HI[i]}</div>
                  <div className="k-week__num">{typeof d === 'object' ? d.getDate() : d}</div>
                  <div className="k-week__dots">
                    {Array.from({ length: Math.min(dots, 4) }).map((_, j) => <i key={j} />)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
