import React, { useEffect, useRef, useState } from 'react';
import { Glass } from '@samasante/liquid-glass';

const SAMPLE_CARDS = [
  { title: 'Invoices',   count: 142, color: '#3987e5' },
  { title: 'Tasks',      count: 87,  color: '#1baf7a' },
  { title: 'Clients',    count: 36,  color: '#eb6834' },
  { title: 'Projects',   count: 12,  color: '#e87ba4' },
];

function Background() {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 0,
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
    }}>
      <div style={{
        position: 'absolute', top: '15%', left: '10%',
        width: 300, height: 300, borderRadius: '50%',
        background: 'rgba(255,255,255,0.15)', filter: 'blur(60px)',
      }} />
      <div style={{
        position: 'absolute', bottom: '20%', right: '15%',
        width: 400, height: 250, borderRadius: '50%',
        background: 'rgba(255,100,100,0.2)', filter: 'blur(80px)',
      }} />
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        width: 200, height: 200, borderRadius: '50%',
        background: 'rgba(100,255,200,0.15)', filter: 'blur(50px)',
        transform: 'translate(-50%, -50%)',
      }} />
    </div>
  );
}

function SamasanteDemo() {
  const [strength, setStrength] = useState(0.5);
  const [dispersion, setDispersion] = useState(0.3);
  const [frost, setFrost] = useState(0.15);
  const [brightness, setBrightness] = useState(0.08);

  const optics = { strength, dispersion, frost, brightness };

  return (
    <div>
      <h3 style={{ color: '#fff', marginBottom: 8, fontSize: 16, fontWeight: 500 }}>
        samasante/liquid-glass — Live DOM refraction
      </h3>
      <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, marginBottom: 16 }}>
        SVG feDisplacementMap · Zero deps · All browsers
      </p>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        {SAMPLE_CARDS.map(c => (
          <Glass key={c.title} optics={optics} radius={16}>
            <div style={{
              padding: '20px 24px', minWidth: 140,
              background: 'rgba(255,255,255,0.08)',
              borderRadius: 16,
              border: '1px solid rgba(255,255,255,0.15)',
            }}>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 4 }}>
                {c.title}
              </div>
              <div style={{ fontSize: 28, fontWeight: 500, color: '#fff' }}>
                {c.count}
              </div>
            </div>
          </Glass>
        ))}
      </div>

      <Glass optics={optics} radius={20}>
        <div style={{
          padding: '24px 28px', maxWidth: 480,
          background: 'rgba(255,255,255,0.06)',
          borderRadius: 20,
          border: '1px solid rgba(255,255,255,0.12)',
        }}>
          <h4 style={{ color: '#fff', margin: '0 0 12px', fontSize: 15, fontWeight: 500 }}>
            Glass panel
          </h4>
          <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, margin: 0, lineHeight: 1.6 }}>
            This panel refracts the live DOM behind it. Move your mouse — the content
            behind bends through the glass with chromatic aberration and frost.
            Works in Chrome, Safari, and Firefox.
          </p>
        </div>
      </Glass>

      <div style={{
        marginTop: 24, display: 'grid', gap: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        maxWidth: 480,
      }}>
        <label style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>
          Strength: {strength.toFixed(2)}
          <input type="range" min="0" max="1" step="0.01" value={strength}
            onChange={e => setStrength(+e.target.value)}
            style={{ width: '100%', marginTop: 4 }} />
        </label>
        <label style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>
          Dispersion: {dispersion.toFixed(2)}
          <input type="range" min="0" max="1" step="0.01" value={dispersion}
            onChange={e => setDispersion(+e.target.value)}
            style={{ width: '100%', marginTop: 4 }} />
        </label>
        <label style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>
          Frost: {frost.toFixed(2)}
          <input type="range" min="0" max="1" step="0.01" value={frost}
            onChange={e => setFrost(+e.target.value)}
            style={{ width: '100%', marginTop: 4 }} />
        </label>
        <label style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>
          Brightness: {brightness.toFixed(2)}
          <input type="range" min="-0.5" max="0.5" step="0.01" value={brightness}
            onChange={e => setBrightness(+e.target.value)}
            style={{ width: '100%', marginTop: 4 }} />
        </label>
      </div>
    </div>
  );
}

function ShudingDemo() {
  const containerRef = useRef(null);
  const instanceRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || instanceRef.current) return;

    function smoothStep(a, b, t) {
      t = Math.max(0, Math.min(1, (t - a) / (b - a)));
      return t * t * (3 - 2 * t);
    }
    function roundedRectSDF(x, y, w, h, r) {
      const qx = Math.abs(x) - w + r;
      const qy = Math.abs(y) - h + r;
      return Math.min(Math.max(qx, qy), 0) +
        Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2) - r;
    }

    const WIDTH = 280;
    const HEIGHT = 180;
    const id = 'shuding-glass-' + Math.random().toString(36).slice(2, 9);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none';

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', id + '_filter');
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('colorInterpolationFilters', 'sRGB');
    filter.setAttribute('x', '0');
    filter.setAttribute('y', '0');
    filter.setAttribute('width', String(WIDTH));
    filter.setAttribute('height', String(HEIGHT));

    const feImage = document.createElementNS('http://www.w3.org/2000/svg', 'feImage');
    feImage.setAttribute('id', id + '_map');
    feImage.setAttribute('width', String(WIDTH));
    feImage.setAttribute('height', String(HEIGHT));

    const feDisp = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
    feDisp.setAttribute('in', 'SourceGraphic');
    feDisp.setAttribute('in2', id + '_map');
    feDisp.setAttribute('xChannelSelector', 'R');
    feDisp.setAttribute('yChannelSelector', 'G');

    filter.appendChild(feImage);
    filter.appendChild(feDisp);
    defs.appendChild(filter);
    svg.appendChild(defs);

    const lens = document.createElement('div');
    lens.style.cssText = `
      width: ${WIDTH}px; height: ${HEIGHT}px;
      overflow: hidden; border-radius: 32px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25), 0 -8px 20px inset rgba(0,0,0,0.12);
      cursor: grab;
      backdrop-filter: url(#${id}_filter) blur(0.25px) contrast(1.15) brightness(1.05) saturate(1.1);
      -webkit-backdrop-filter: url(#${id}_filter) blur(0.25px) contrast(1.15) brightness(1.05) saturate(1.1);
      pointer-events: auto; position: relative;
      border: 1px solid rgba(255,255,255,0.2);
    `;

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');

    const w = WIDTH, h = HEIGHT;
    const data = new Uint8ClampedArray(w * h * 4);
    let maxScale = 0;
    const raw = [];

    for (let i = 0; i < data.length; i += 4) {
      const px = (i / 4) % w;
      const py = Math.floor(i / 4 / w);
      const ux = px / w, uy = py / h;
      const ix = ux - 0.5, iy = uy - 0.5;
      const dist = roundedRectSDF(ix, iy, 0.3, 0.2, 0.6);
      const disp = smoothStep(0.8, 0, dist - 0.15);
      const scaled = smoothStep(0, 1, disp);
      const tx = ix * scaled + 0.5, ty = iy * scaled + 0.5;
      const dx = tx * w - px, dy = ty * h - py;
      maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy));
      raw.push(dx, dy);
    }
    maxScale *= 0.5;

    let ri = 0;
    for (let i = 0; i < data.length; i += 4) {
      data[i]     = (raw[ri++] / maxScale + 0.5) * 255;
      data[i + 1] = (raw[ri++] / maxScale + 0.5) * 255;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
    ctx.putImageData(new ImageData(data, w, h), 0, 0);
    feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', canvas.toDataURL());
    feDisp.setAttribute('scale', String(maxScale));

    let isDragging = false, startX, startY, initialX, initialY;
    lens.addEventListener('mousedown', e => {
      isDragging = true;
      lens.style.cursor = 'grabbing';
      startX = e.clientX; startY = e.clientY;
      const r = lens.getBoundingClientRect();
      initialX = r.left; initialY = r.top;
      e.preventDefault();
    });
    const onMove = e => {
      if (!isDragging) return;
      lens.style.position = 'fixed';
      lens.style.left = (initialX + e.clientX - startX) + 'px';
      lens.style.top = (initialY + e.clientY - startY) + 'px';
      lens.style.transform = 'none';
    };
    const onUp = () => { isDragging = false; lens.style.cursor = 'grab'; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    containerRef.current.appendChild(svg);
    containerRef.current.appendChild(lens);

    instanceRef.current = { svg, lens, onMove, onUp };

    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      svg.remove();
      lens.remove();
      instanceRef.current = null;
    };
  }, []);

  return (
    <div>
      <h3 style={{ color: '#fff', marginBottom: 8, fontSize: 16, fontWeight: 500 }}>
        shuding/liquid-glass — Draggable lens
      </h3>
      <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, marginBottom: 16 }}>
        SVG displacement map · Zero deps · Drag the glass pane around
      </p>
      <div ref={containerRef} style={{
        position: 'relative', width: 480, height: 280,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          color: 'rgba(255,255,255,0.5)', fontSize: 13,
          position: 'absolute', bottom: 8, textAlign: 'center', width: '100%',
        }}>
          Drag the glass pane to see the refraction effect
        </div>
      </div>
    </div>
  );
}

function CurrentGlassDemo() {
  return (
    <div>
      <h3 style={{ color: '#fff', marginBottom: 8, fontSize: 16, fontWeight: 500 }}>
        Current Kartavya glass — backdrop-filter
      </h3>
      <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, marginBottom: 16 }}>
        CSS backdrop-filter blur + saturate · Your existing --glass-* tokens
      </p>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        {SAMPLE_CARDS.map(c => (
          <div key={c.title} style={{
            padding: '20px 24px', minWidth: 140,
            background: 'rgba(255,255,255,0.08)',
            borderRadius: 16,
            border: '1px solid rgba(255,255,255,0.15)',
            backdropFilter: 'blur(22px) saturate(1.5)',
            WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
          }}>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 4 }}>
              {c.title}
            </div>
            <div style={{ fontSize: 28, fontWeight: 500, color: '#fff' }}>
              {c.count}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        padding: '24px 28px', maxWidth: 480,
        background: 'rgba(255,255,255,0.06)',
        borderRadius: 20,
        border: '1px solid rgba(255,255,255,0.12)',
        backdropFilter: 'blur(22px) saturate(1.5)',
        WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
      }}>
        <h4 style={{ color: '#fff', margin: '0 0 12px', fontSize: 15, fontWeight: 500 }}>
          Standard glass panel
        </h4>
        <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, margin: 0, lineHeight: 1.6 }}>
          This is your current glassmorphism — CSS backdrop-filter with blur and
          saturate. No refraction, no chromatic aberration, no displacement.
          Compare this with the panels above.
        </p>
      </div>
    </div>
  );
}

export default function GlassDemoPage() {
  return (
    <div style={{ minHeight: '100vh', position: 'relative' }}>
      <Background />
      <div style={{
        position: 'relative', zIndex: 1,
        padding: '48px 32px', maxWidth: 960, margin: '0 auto',
      }}>
        <h1 style={{ color: '#fff', fontSize: 24, fontWeight: 500, marginBottom: 4 }}>
          Liquid glass comparison
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, marginBottom: 48 }}>
          Three approaches side by side — pick what looks best for Kartavya
        </p>

        <div style={{ display: 'grid', gap: 48 }}>
          <section><SamasanteDemo /></section>
          <section><ShudingDemo /></section>
          <section><CurrentGlassDemo /></section>
        </div>
      </div>
    </div>
  );
}
