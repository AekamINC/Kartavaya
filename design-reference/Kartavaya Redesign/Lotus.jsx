// Lotus — ported from frontend/src/components/brand/Lotus.jsx on staging.
//
// The COURSES table, the lobe() geometry and the r32 eye are verbatim from the
// shipped component; nothing here is reinterpreted. Its three rules are the
// whole style and they are load-bearing:
//
//   ONE PEN.    Every stroke the same width. Weight hierarchy is standard
//               ornament advice and it is wrong here — uniform weight is what
//               makes the figure read as drawn rather than as designed.
//   ONE COLOUR. Full strength, no opacity ramp. Fading the outer courses greys
//               the figure and kills the crispness.
//   IT DRAWS.   Every stroke trims on, holds, then trims off. Same mechanism as
//               the Lottie reference it came from, so this is the motion itself
//               rather than an impression of it.
//
// There are no rays: a ray sweeping 18° crosses its neighbouring petal's edge
// on the way out, and the two courses collide however they are phased. Twenty
// petals at r76–120 sit a quarter open, so their tips read as a scalloped
// boundary — an ornament that stops on a hard circle looks cut off.

function lotusLobe(r0, r1, w) {
  const s = r1 - r0;
  const f = n => n.toFixed(2);
  return `M0,${f(-r0)}`
    + `C${f(w)},${f(-r0 - s * 0.30)} ${f(w)},${f(-r1 + s * 0.26)} 0,${f(-r1)}`
    + `C${f(-w)},${f(-r1 + s * 0.26)} ${f(-w)},${f(-r0 - s * 0.30)} 0,${f(-r0)}Z`;
}

// [count, r0, r1, halfWidth, rotationOffset]
const LOTUS_COURSES = [
  [10, 34, 70, 12, 0],     // the rosette
  [10, 35, 56, 7, 18],     // smaller lobes nesting in its gaps
  [20, 76, 120, 11.5, 0],  // the outer petals
  [20, 82, 96, 4.2, 0],    // a bead in each throat
];

const lotusLen = (r0, r1, w) => 2 * Math.hypot(r1 - r0, w) * 1.06;

function Lotus({ size = 168, className = '', style }) {
  const parts = React.useMemo(() => {
    const out = [];
    let step = 0;
    // Rings first, so the eye and the collar draw before what hangs off them.
    out.push({ kind: 'ring', r: 32, len: 2 * Math.PI * 32, d: 0 });
    LOTUS_COURSES.forEach(([n, r0, r1, w, off], ci) => {
      if (ci === 2) out.push({ kind: 'ring', r: 74, len: 2 * Math.PI * 74, d: (step += 2) * 0.035 });
      const d = lotusLobe(r0, r1, w);
      const len = lotusLen(r0, r1, w);
      for (let i = 0; i < n; i++) out.push({ kind: 'petal', d, len, rot: off + (360 / n) * i, delay: (step++) * 0.035 });
    });
    return out;
  }, []);

  return (
    <svg className={'lotus' + (className ? ' ' + className : '')} width={size} height={size}
      viewBox="0 0 260 260" style={style} aria-hidden="true" focusable="false">
      {/* The slow counter-turn under the draw, so the figure is never wholly
          still even while it holds at full. */}
      <g className="lotus__turn" transform="translate(130,130)">
        {parts.map((p, i) => (p.kind === 'ring' ? (
          <circle key={i} className="lotus__s" r={p.r} fill="none"
            /* Each stroke carries its OWN length. A large petal and a throat
               bead differ by three times; one shared dasharray would draw them
               at different rates and the figure would assemble raggedly. */
            style={{ '--len': Math.round(p.len), '--d': (p.d || 0).toFixed(2) + 's' }} />
        ) : (
          <path key={i} className="lotus__s" d={p.d} fill="none" transform={`rotate(${p.rot.toFixed(2)})`}
            style={{ '--len': Math.round(p.len), '--d': p.delay.toFixed(2) + 's' }} />
        )))}
      </g>
    </svg>
  );
}

// BrandLoader — क in the eye of a lotus that draws itself. The product's only
// waiting state; there is no second spinner. `full` gives it the viewport for
// the two moments the mark is the only thing on screen (the boot gate, and the
// hold after sign-in); everywhere else it sits inside a shell already painted.
function BrandLoader({ label = 'Loading', size = 168, full = false }) {
  return (
    <div className={'bl' + (full ? ' bl--full' : '')} role="status" aria-live="polite">
      <div className="bl__mark">
        <Lotus size={size} />
        {/* Sized off the eye — r32 of a 260 box, so 0.179 of the mark. Hard-coding
            30px put the letter through the ring at any size but 168. */}
        <span className="bl__ka" lang="hi" aria-hidden="true"
          style={size === 168 ? undefined : { fontSize: Math.round(size * 0.179) + 'px' }}>क</span>
      </div>
      {/* Announced, never drawn. A screen reader user gets the word; everyone
          else gets the mark, which needs no caption. */}
      <span className="sr-only">{label}</span>
    </div>
  );
}

Object.assign(window, { Lotus, BrandLoader, LOTUS_COURSES, lotusLobe });
