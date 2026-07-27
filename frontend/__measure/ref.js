/* ref.js — drives the reference harness in a same-origin iframe: Boards, the
 * task drawer, then the Table view. Every number is read off the render. */
import { probe, P, tokens, TOKEN_NAMES, rootAttrs, devanagari, classInventory } from './measure.js';

const out = document.getElementById('out');
const say = (o) => { out.textContent = JSON.stringify(o, null, 1); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function until(fn, ms = 25000) {
  const t0 = Date.now();
  for (;;) {
    try { const v = fn(); if (v) return v; } catch (e) { /* not ready */ }
    if (Date.now() - t0 > ms) return null;
    await sleep(100);
  }
}

(async () => {
  const f = document.getElementById('f');
  await until(() => f.contentDocument && f.contentDocument.readyState === 'complete');
  const doc = f.contentDocument;

  const side = await until(() => doc.querySelectorAll('.side__item').length ? doc.querySelectorAll('.side__item') : null);
  if (!side) { say({ ERROR: 'sidebar never rendered' }); return; }

  [...side].find(e => e.innerText.trim().startsWith('Boards')).click();
  await until(() => doc.querySelector('.bcard'));
  await sleep(300);

  const M = {};
  M._side = 'reference';
  M.rootAttrs = rootAttrs(doc);
  M.tokens = tokens(doc, TOKEN_NAMES);
  M.viewport = { w: f.clientWidth, h: f.clientHeight };

  /* ── Board ─────────────────────────────────────────────────────────── */
  M.board       = probe(doc, '.board', P.LAYOUT, 'board container');
  M.column      = probe(doc, '.bcol', P.BOX.concat(['flex-direction']), 'column');
  M.columnHead  = probe(doc, '.bcol__head', P.BOX.concat(['border-bottom-width', 'border-bottom-color']), 'column head');
  M.columnBar   = probe(doc, '.bcol__bar', ['width', 'height', 'border-radius'], 'column colour bar');
  M.columnTitle = probe(doc, '.bcol__t', P.TYPE, 'column title');
  M.columnHi    = probe(doc, '.bcol__hi', P.TYPE, 'column title (Devanagari)');
  M.columnCount = probe(doc, '.bcol__n', P.TYPE.concat(['padding-left', 'padding-right', 'border-radius', 'background-color']), 'column count');
  M.card        = probe(doc, '.bcard', P.BOX.concat(['transition']), 'card');
  M.cardTop     = probe(doc, '.bcard__top', ['gap', 'align-items'], 'card top row');
  M.cardId      = probe(doc, '.bcard__id', P.TYPE, 'card id');
  M.cardTitle   = probe(doc, '.bcard__t', P.TYPE, 'card title');
  M.cardFoot    = probe(doc, '.bcard__foot', ['gap', 'align-items', 'font-size'], 'card foot');
  M.cardPdot    = probe(doc, '.bcard .pdot', ['width', 'height', 'border-radius', 'background-color'], 'card priority dot');
  M.avatar      = probe(doc, '.bcard .av', P.SIZE, 'card avatar');
  M.avatarStack = probe(doc, '.bcard .avs', ['display', 'align-items'], 'card avatar stack');
  M.avatarNth   = probe(doc, '.bcard .avs > * + *', ['margin-left', 'box-shadow', 'width', 'height'], 'avatar overlap');
  M.tag         = probe(doc, '.bcard .tag', P.TYPE.concat(['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-radius', 'background-color', 'gap']), 'card chip/tag');
  M.chip        = probe(doc, '.chip', P.TYPE.concat(['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-radius', 'background-color', 'gap', 'height']), 'header chip');

  /* ── Toolbar ───────────────────────────────────────────────────────── */
  M.tabs        = probe(doc, '.tabs', ['display', 'gap', 'border-bottom-width', 'border-bottom-color', 'background-color', 'align-items'], 'view toolbar');
  M.tabsBtn     = probe(doc, '.tabs__b', P.TYPE.concat(['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'gap', 'min-height', 'border-bottom-width']), 'toolbar button');
  M.tabsBtnOn   = probe(doc, '.tabs__b.on', ['color', 'border-bottom-color', 'background-color'], 'toolbar button (active)');
  M.tabsHi      = probe(doc, '.tabs__b .tabs__hi', P.TYPE, 'toolbar button (Devanagari)');
  M.tabsEn      = probe(doc, '.tabs__b .tabs__en', P.TYPE, 'toolbar button (Latin)');

  /* ── Page header ───────────────────────────────────────────────────── */
  M.phKick  = probe(doc, '.ph__kick', P.TYPE, 'page header kicker');
  M.phH1    = probe(doc, '.ph__h1', P.TYPE, 'page header title');
  M.phHi    = probe(doc, '.ph__hi', P.TYPE, 'page header (Devanagari)');
  M.phLede  = probe(doc, '.ph__lede', P.TYPE, 'page header lede');

  /* ── Drawer ────────────────────────────────────────────────────────── */
  doc.querySelector('.bcard').click();
  await until(() => doc.querySelector('.drawer'));
  await sleep(600);

  M.drawerClasses = classInventory(doc, '.drawer');
  M.drawer      = probe(doc, '.drawer', ['width', 'max-width', 'box-shadow', 'background-color', 'border-left-width', 'border-left-color', 'border-radius', 'animation-duration', 'animation-timing-function', 'animation-name'], 'drawer shell');
  M.drawerHead  = probe(doc, '.drawer__head', P.BOX, 'drawer head');
  M.drawerBody  = probe(doc, '.drawer__body', P.BOX.concat(['overflow-y']), 'drawer body');
  M.drawerH1    = probe(doc, '.drawer__head h2, .drawer__head h3, .drawer__head .ph__h1, .drawer__head [class*="t"]', P.TYPE, 'drawer head title (first heading-ish)');
  M.scrim       = probe(doc, '.scrim', ['background-color', 'animation-duration', 'animation-timing-function'], 'drawer scrim');
  M.props       = probe(doc, '.drawer .props, .props', ['display', 'gap', 'row-gap', 'column-gap', 'grid-template-columns', 'padding-top', 'padding-bottom'], 'drawer props grid');
  M.prop        = probe(doc, '.drawer .prop, .prop', ['display', 'gap', 'align-items', 'padding-top', 'padding-bottom', 'min-height', 'flex-direction'], 'drawer prop row');
  M.propL       = probe(doc, '.drawer .prop__l, .prop__l', P.TYPE.concat(['width', 'min-width']), 'drawer prop label');
  M.propHi      = probe(doc, '.drawer .prop__hi, .prop__hi', P.TYPE, 'drawer prop label (Devanagari)');
  M.propV       = probe(doc, '.drawer .prop__v, .prop__v', P.TYPE, 'drawer prop value');
  M.divider     = probe(doc, '.drawer .divider, .divider', ['height', 'background-color', 'margin-top', 'margin-bottom', 'border-top-width'], 'drawer divider');

  /* Whole-drawer heading scale: every heading-like node with its size. */
  const dw = doc.querySelector('.drawer');
  M.drawerTypeScale = dw ? [...dw.querySelectorAll('*')].filter(e => {
    const t = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    return t.length > 0 && t.length < 60;
  }).slice(0, 40).map(e => {
    const cs = f.contentWindow.getComputedStyle(e);
    return {
      cls: String(e.className), text: e.textContent.trim().slice(0, 22),
      fs: cs.fontSize, fw: cs.fontWeight, ls: cs.letterSpacing,
      ff: cs.fontFamily.split(',')[0], tt: cs.textTransform, color: cs.color,
    };
  }) : [];

  M.devanagari = devanagari(doc);

  /* ── Table ─────────────────────────────────────────────────────────────
     The Boards > Table tab renders an empty state in the mockup, so the row
     object is measured where it actually renders: the Tasks screen. */
  const scrim = doc.querySelector('.scrim');
  if (scrim) { scrim.click(); await sleep(400); }
  const tasksItem = [...doc.querySelectorAll('.side__item')].find(e => e.innerText.trim().startsWith('Tasks'));
  if (tasksItem) {
    tasksItem.click();
    await until(() => doc.querySelector('.tbl__row'), 8000);
    await sleep(400);
  }
  M.tableClasses = classInventory(doc, '.screen');
  M.table     = probe(doc, '.tbl', ['background-color', 'border-radius', 'border-top-width', 'border-top-color', 'overflow'], 'table shell');
  M.tableHead = probe(doc, '.tbl__head', P.TYPE.concat(['height', 'padding-left', 'padding-right', 'gap', 'background-color', 'border-bottom-width', 'position']), 'table header row');
  M.tableRow  = probe(doc, '.tbl__row', ['min-height', 'height', 'padding-left', 'padding-right', 'gap', 'border-bottom-width', 'border-bottom-color', 'display', 'align-items'], 'table row');
  M.tableCell = probe(doc, '.tbl__c', ['gap', 'align-items', 'font-size'], 'table cell');
  M.tableTtl  = probe(doc, '.tbl__t', P.TYPE, 'table row title');
  M.tableId   = probe(doc, '.tbl__id', P.TYPE, 'table row id');
  const trr = doc.querySelector('.tbl__row');
  M.tableRowHeightRendered = trr ? +trr.getBoundingClientRect().height.toFixed(2) : null;

  say(M);
  document.title = 'DONE';
})().catch(e => say({ ERROR: String((e && e.stack) || e) }));
