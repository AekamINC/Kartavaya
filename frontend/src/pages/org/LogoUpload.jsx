import React, { useRef, useState } from 'react';

/**
 * LogoUpload — drop zone, preview, and where the logo actually lands.
 *
 * The "where it appears" list is not decoration. A logo upload with no
 * indication of where the logo goes means the first time anyone sees it at the
 * wrong size is on a customer's invoice — so the destinations are listed, and
 * the ones that are NOT wired yet say so rather than being quietly omitted.
 * Verified against the backend: `logo_url` is read by `services/invoice_pdf.py`
 * and `services/payslip_pdf.py` and by nothing else.
 *
 * The dragover cue changes border-STYLE as well as colour (dashed → solid). A
 * colour-only cue is invisible to a colour-blind user mid-drag, which is the
 * one moment they cannot stop and ask.
 */

const Tick = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const Dash = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
    <path d="M5 12h14" />
  </svg>
);

const WHERE = [
  { label: 'Invoice PDF header (Ganit)', live: true },
  { label: 'Payslip PDF header (Vetana)', live: true },
  { label: 'Client portal', live: false },
  { label: 'Sign-in page and system emails', live: false },
];

export default function LogoUpload({ url, busy, onFile }) {
  const [over, setOver] = useState(false);
  const input = useRef(null);

  const take = (file) => {
    if (!file) return;
    onFile(file);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer?.files?.[0]);
  };

  return (
    <div className="olg">
      {/* A <label> rather than a div with an onClick: the file input keeps its
          own keyboard behaviour and its own accessible name, and Space/Enter
          open the picker without a key handler being written by hand. */}
      <label
        className={`olg__z${over ? ' over' : ''}`}
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <input
          ref={input}
          type="file"
          accept="image/png,image/svg+xml,image/jpeg,image/webp"
          className="k-sr-only"
          disabled={busy}
          onChange={e => { take(e.target.files?.[0]); e.target.value = ''; }}
        />
        {url
          ? <img src={url} alt="Company logo" />
          : <span>{busy ? 'Uploading…' : 'Drop a logo here, or click to choose'}</span>}
      </label>

      <div className="olg__where">
        <p className="olg__hint">
          PNG or SVG, at least 512px on the long edge. It is scaled down for print,
          so a small file will look soft on an invoice rather than sharp.
        </p>
        {WHERE.map(w => (
          <span key={w.label} className={`olg__w${w.live ? '' : ' pending'}`}>
            {w.live ? <Tick /> : <Dash />}
            {w.label}
            {!w.live && ' — not wired yet'}
          </span>
        ))}
      </div>
    </div>
  );
}
