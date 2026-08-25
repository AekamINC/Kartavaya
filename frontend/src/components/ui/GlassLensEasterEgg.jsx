import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

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

function createLens(container) {
  const WIDTH = 260, HEIGHT = 170;
  const id = 'glass-lens-' + Math.random().toString(36).slice(2, 7);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none';

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.setAttribute('id', id);
  filter.setAttribute('filterUnits', 'userSpaceOnUse');
  filter.setAttribute('colorInterpolationFilters', 'sRGB');
  filter.setAttribute('x', '0');
  filter.setAttribute('y', '0');
  filter.setAttribute('width', String(WIDTH));
  filter.setAttribute('height', String(HEIGHT));

  const feImage = document.createElementNS('http://www.w3.org/2000/svg', 'feImage');
  feImage.setAttribute('width', String(WIDTH));
  feImage.setAttribute('height', String(HEIGHT));

  const feDisp = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
  feDisp.setAttribute('in', 'SourceGraphic');
  feDisp.setAttribute('in2', feImage.getAttribute('result') || '');
  feDisp.setAttribute('xChannelSelector', 'R');
  feDisp.setAttribute('yChannelSelector', 'G');

  filter.appendChild(feImage);
  filter.appendChild(feDisp);
  defs.appendChild(filter);
  svg.appendChild(defs);

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  const raw = [];
  let maxScale = 0;

  for (let i = 0; i < data.length; i += 4) {
    const px = (i / 4) % WIDTH, py = Math.floor(i / 4 / WIDTH);
    const ux = px / WIDTH, uy = py / HEIGHT;
    const ix = ux - 0.5, iy = uy - 0.5;
    const dist = roundedRectSDF(ix, iy, 0.3, 0.2, 0.6);
    const disp = smoothStep(0.8, 0, dist - 0.15);
    const scaled = smoothStep(0, 1, disp);
    const tx = ix * scaled + 0.5, ty = iy * scaled + 0.5;
    const dx = tx * WIDTH - px, dy = ty * HEIGHT - py;
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
  ctx.putImageData(new ImageData(data, WIDTH, HEIGHT), 0, 0);
  feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', canvas.toDataURL());
  feDisp.setAttribute('scale', String(maxScale));

  const lens = document.createElement('div');
  lens.style.cssText = `
    position: fixed; bottom: 80px; right: 24px; z-index: 9999;
    width: ${WIDTH}px; height: ${HEIGHT}px;
    overflow: hidden; border-radius: 28px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25), 0 -8px 20px inset rgba(0,0,0,0.12);
    cursor: grab;
    backdrop-filter: url(#${id}) blur(0.25px) contrast(1.15) brightness(1.05) saturate(1.1);
    -webkit-backdrop-filter: url(#${id}) blur(0.25px) contrast(1.15) brightness(1.05) saturate(1.1);
    pointer-events: auto;
    border: 1px solid rgba(255,255,255,0.2);
  `;

  let isDragging = false, startX, startY, initialX, initialY;
  const onDown = e => {
    isDragging = true;
    lens.style.cursor = 'grabbing';
    startX = e.clientX; startY = e.clientY;
    const r = lens.getBoundingClientRect();
    initialX = r.left; initialY = r.top;
    e.preventDefault();
  };
  const onMove = e => {
    if (!isDragging) return;
    lens.style.left = (initialX + e.clientX - startX) + 'px';
    lens.style.top = (initialY + e.clientY - startY) + 'px';
    lens.style.bottom = 'auto';
    lens.style.right = 'auto';
  };
  const onUp = () => { isDragging = false; lens.style.cursor = 'grab'; };

  lens.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);

  container.appendChild(svg);
  container.appendChild(lens);

  return () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    svg.remove();
    lens.remove();
  };
}

export default function GlassLensEasterEgg() {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    return createLens(containerRef.current);
  }, []);

  return createPortal(
    <div ref={containerRef} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }} />,
    document.body,
  );
}
