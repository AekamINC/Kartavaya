// Pahchan v1 — data. Placeholder people and times; the shapes are the spec.
const PH_ICON = {
  gps: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>,
  cam: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.3-2h6.8l1.3 2h1.8A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.4"/></svg>,
  wifi: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M2.5 9a15 15 0 0 1 19 0M5.5 12.5a10 10 0 0 1 13 0M8.7 16a5.3 5.3 0 0 1 6.6 0"/><circle cx="12" cy="19.4" r="1.1" fill="currentColor"/></svg>,
  off: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M3 3l18 18M9.5 16.6a3.6 3.6 0 0 1 5 0M5.5 12.5a10 10 0 0 1 4-2.4M2.5 9a15 15 0 0 1 5-3.2M14 5.2A15 15 0 0 1 21.5 9M15.6 12a10 10 0 0 1 2.9 .5"/></svg>,
  tick: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.6l4.6 4.6L19 7"/></svg>,
  x: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>,
  warn: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M12 3.6L21.4 20H2.6z"/><path d="M12 9.6v4.6M12 17.2v.1"/></svg>,
  flag: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M5 21V4.4M5 4.4h11l-1.6 3.4L16 11.2H5z"/></svg>,
  clock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3.1 1.9"/></svg>,
  user: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="12" cy="8.4" r="3.7"/><path d="M4.8 20a7.3 7.3 0 0 1 14.4 0"/></svg>,
  chev: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 5l7 7-7 7"/></svg>,
};

// Aekam Inc — placeholder roster. Two have no reference pair on purpose.
const PH_TEAM = [
  { id: 'e1', n: 'Priya Deshmukh', hi: 'प्रिया', r: 'Accounts', refs: 2 },
  { id: 'e2', n: 'Rahul Mehta', hi: 'राहुल', r: 'Field — GST filings', refs: 2 },
  { id: 'e3', n: 'Anjali Rao', hi: 'अंजलि', r: 'Audit', refs: 2 },
  { id: 'e4', n: 'Suresh Kulkarni', hi: 'सुरेश', r: 'Field — collections', refs: 2 },
  { id: 'e5', n: 'Fatima Shaikh', hi: 'फ़ातिमा', r: 'Payroll', refs: 2 },
  { id: 'e6', n: 'Vikram Joshi', hi: 'विक्रम', r: 'Field — site visits', refs: 0 },
  { id: 'e7', n: 'Meera Nair', hi: 'मीरा', r: 'Reception', refs: 2 },
  { id: 'e8', n: 'Arjun Pillai', hi: 'अर्जुन', r: 'Articleship', refs: 1 },
];

// A day at one office. Coordinates are around Fort, Mumbai — the geofence
// centre sits at the first row's punch; the two outliers are genuinely away.
const PH_GEO = { lat: 18.9333, lng: 72.8336, radius: 150, label: 'Aekam Inc — Fort, Mumbai' };

const PH_PUNCHES = [
  { id: 'p1', emp: 'e1', dir: 'in', t: '09:41', acc: 8, lat: 18.9334, lng: 72.8337, dist: 12, flags: [], src: 'live' },
  { id: 'p2', emp: 'e7', dir: 'in', t: '09:52', acc: 11, lat: 18.9332, lng: 72.8339, dist: 31, flags: [], src: 'live' },
  { id: 'p3', emp: 'e2', dir: 'in', t: '10:06', acc: 22, lat: 19.0176, lng: 72.8562, dist: 9840, flags: ['geo'], src: 'live', note: 'Client site — Dadar' },
  { id: 'p4', emp: 'e3', dir: 'in', t: '10:18', acc: 9, lat: 18.9336, lng: 72.8333, dist: 41, flags: ['late'], src: 'live' },
  { id: 'p5', emp: 'e6', dir: 'in', t: '10:24', acc: 14, lat: 18.9331, lng: 72.8341, dist: 58, flags: ['noref'], src: 'live' },
  { id: 'p6', emp: 'e5', dir: 'in', t: '10:31', acc: 6, lat: 18.9335, lng: 72.8335, dist: 18, flags: [], src: 'live' },
  { id: 'p7', emp: 'e4', dir: 'in', t: '10:47', acc: 184, lat: 18.9358, lng: 72.8302, dist: 412, flags: ['acc'], src: 'live', note: 'Indoor — basement parking' },
  { id: 'p8', emp: 'e8', dir: 'in', t: '11:02', acc: 12, lat: 18.9333, lng: 72.8338, dist: 22, flags: ['noref'], src: 'offline', sync: '11:38' },
  { id: 'p9', emp: 'e1', dir: 'out', t: '18:12', acc: 7, lat: 18.9334, lng: 72.8336, dist: 9, flags: [], src: 'live' },
  { id: 'p10', emp: 'e2', dir: 'out', t: '18:29', acc: 19, lat: 18.9337, lng: 72.8334, dist: 47, flags: [], src: 'live' },
  { id: 'p11', emp: 'e7', dir: 'out', t: '18:34', acc: 10, lat: 18.9332, lng: 72.8340, dist: 36, flags: [], src: 'live' },
  { id: 'p12', emp: 'e3', dir: 'out', t: '19:48', acc: 8, lat: 18.9335, lng: 72.8337, dist: 20, flags: ['ot'], src: 'live' },
];

const PH_FLAG = {
  late: ['Late', 'rv__flag--late'],
  geo: ['Outside geofence', 'rv__flag--geo'],
  noref: ['No reference pair', 'rv__flag--noref'],
  acc: ['GPS ±184m', 'rv__flag--acc'],
  off: ['Synced offline', 'rv__flag--off'],
  ot: ['Overtime', 'rv__flag--late'],
};

// Policy — every value an org can set. Defaults chosen from the brief and,
// where the brief was silent, from what the law actually requires.
const PH_POLICY = [
  ['Capture', [
    ['Source', 'In-app camera only', 'Fixed', 'No gallery path and no gallery permission is requested. With login-only auth the selfie is the only identity evidence there is; a gallery path means one saved selfie works forever.'],
    ['Front camera', 'Required', 'Fixed', 'Rear-camera capture of a printed photo is the cheapest attack on selfie attendance. Front-only does not stop it — a human reviewer does — but it raises the cost.'],
    ['Retake limit', '3 per punch', 'Editable', 'Unlimited retakes let someone hunt for a frame that hides where they are. Three is enough for a genuine bad frame.'],
  ]],
  ['Location', [
    ['Geofence', 'On · 150m radius', 'Editable', 'Radius per site. 150m absorbs urban GPS drift without covering the next building.'],
    ['Outside-fence punches', 'Allowed, flagged', 'Editable', 'Blocking them breaks every field role. Field staff are the reason this module exists.'],
    ['Accuracy floor', 'Flag above ±100m', 'Editable', 'Indoor and basement fixes routinely exceed this. Flag, never block.'],
    ['Mock-location check', 'On', 'Editable', 'Not in the brief. A mock-location app spoofs coordinates in about thirty seconds, and every competitor blocks it. Detect and flag; do not silently trust.'],
  ]],
  ['Retention', [
    ['Reference photos', 'Employment + 45 days', 'Fixed', 'The 45-day tail covers a final-settlement dispute. After that they are deleted, not archived.'],
    ['Punch selfies', '90 days', 'Fixed', 'Long enough to settle a contested month, short enough that a breach is bounded.'],
    ['Punch records', '3 years — 5 in some states', 'Editable', 'Not in the brief, and it is the one that carries a penalty. The register itself is a statutory record under the state Shops & Establishments rules; the photo is not.'],
  ]],
  ['Review', [
    ['Reviewer role', 'HR admin · Owner', 'Editable', 'Human comparison is the entire verification mechanism in v1. Whoever holds this role is the control.'],
    ['Review required', 'Flagged rows only', 'Editable', 'Requiring a verdict on every clean row turns a ten-second scan into a chore and guarantees rubber-stamping.'],
    ['Unreviewed after', '7 days → auto-accept', 'Editable', 'Say what happens to a row nobody looked at. Silence is a policy too, just an undocumented one.'],
  ]],
];

Object.assign(window, { PH_ICON, PH_TEAM, PH_GEO, PH_PUNCHES, PH_FLAG, PH_POLICY });
