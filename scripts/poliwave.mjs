// Poliwave Results API → live.json (GitHub Actions에서 실행, 키는 저장소 Secret POLIWAVE_KEY)
// 사용: node scripts/poliwave.mjs <출력 폴더>
import fs from 'fs';
import path from 'path';

const KEY = process.env.POLIWAVE_KEY;
const OUT = process.argv[2] || 'live-out';
const BASE = 'https://www.poliwave.com/api/v1/live';
const SLUG = process.env.POLIWAVE_SLUG || ''; // 비워 두면 목록에서 자동으로 찾음 (예: us/midterms-2026)

if (!KEY) { console.log('POLIWAVE_KEY 없음: 건너뜀'); process.exit(0); }
fs.mkdirSync(OUT, { recursive: true });

async function get(url) {
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + KEY, Accept: 'application/json' } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${url} ${t.slice(0, 200)}`);
  return JSON.parse(t);
}

const NAMES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new-hampshire': 'NH', 'new-jersey': 'NJ', 'new-mexico': 'NM', 'new-york': 'NY',
  'north-carolina': 'NC', 'north-dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode-island': 'RI',
  'south-carolina': 'SC', 'south-dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west-virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
const ABBRS = new Set(Object.values(NAMES));
const slugify = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function findState(text) {
  const s = slugify(text);
  // 긴 이름부터 (west-virginia가 virginia보다 먼저)
  for (const n of Object.keys(NAMES).sort((a, b) => b.length - a.length)) if (s.includes(n)) return NAMES[n];
  const m = s.match(/(?:^|-)([a-z]{2})(?:-|$)/g) || [];
  for (const x of m) { const ab = x.replace(/-/g, '').toUpperCase(); if (ABBRS.has(ab)) return ab; }
  return null;
}
function findOffice(text) {
  const s = slugify(text);
  if (/governor|gubernat/.test(s) && !/lieutenant/.test(s)) return 'governor';
  if (/senate|senator/.test(s)) return 'senate';
  if (/house|district|congress|representative|at-large|-\d{1,2}$/.test(s)) return 'house';
  return null;
}
function partyCode(p) {
  const s = String(p || '').toLowerCase();
  if (s === 'd' || s === 'dem' || s.startsWith('democrat') || s === 'dfl' || s.includes('farmer')) return 'D';
  if (s === 'r' || s === 'rep' || s === 'gop' || s.startsWith('republican')) return 'R';
  if (s === 'l' || s.startsWith('libertarian')) return 'L';
  if (s === 'g' || s.startsWith('green')) return 'G';
  return 'I';
}
const num = v => (typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[,%]/g, '')) || 0);
const str = v => (v && typeof v === 'object' ? (v.name || v.code || v.id || '') : v || '');

function unitToRace(u, hint, callsByUnit) {
  const raw = u.candidates || [];
  const cands = raw.map(c => ({
    en: String(c.name || c.candidate || c.fullName || c.full_name || c.label || '').replace(/\s+/g, ' ').trim(),
    party: partyCode(str(c.party) || c.partyCode || c.party_code || c.partyName || c.abbr),
    votes: num(c.votes ?? c.vote ?? c.count ?? c.total),
    pct: num(c.share ?? c.pct ?? c.percent ?? c.percentage ?? c.votePct),
    winner: !!(c.winner || c.elected || c.won || c.called),
  }));
  const total = cands.reduce((a, c) => a + c.votes, 0);
  const sumPct = cands.reduce((a, c) => a + c.pct, 0);
  cands.forEach(c => {
    if (total) c.pct = c.votes / total * 100;
    else if (sumPct > 0 && sumPct <= 1.01) c.pct *= 100;
  });
  const status = String(u.status || '').toLowerCase();
  const w = u.winner;
  if (status === 'won' && w) {
    const wn = slugify(str(w)), wp = partyCode(typeof w === 'object' ? (w.party || w.partyCode) : w);
    let hit = cands.find(c => slugify(c.en) === wn);
    if (!hit && typeof w === 'object') hit = cands.find(c => c.party === wp);
    if (!hit && cands.length && status === 'won') hit = cands[0];
    if (hit) hit.winner = true;
  }
  const code = String(u.code || u.id || u.unit || u.slug || hint.key || '');
  const call = callsByUnit[code];
  if (call && !cands.some(c => c.winner)) {
    const n = slugify(str(call.winner || call.candidate || call.name));
    const hit = cands.find(c => n && slugify(c.en) === n) || cands.find(c => c.party === partyCode(call.party || str(call.winner)));
    if (hit) hit.winner = true;
  }
  return {
    reporting: num(u.counted ?? u.reported ?? u.percentReporting ?? u.percent_reporting ?? u.reporting),
    cands, total, status, basis: call?.basis || null,
  };
}

// candidates 배열을 가진 객체를 전부 찾아 상원/하원/주지사로 분류
function collect(obj, trail, out) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) { obj.forEach((x, i) => collect(x, trail, out)); return; }
  if (Array.isArray(obj.candidates)) { out.push({ u: obj, trail }); return; }
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'calls' || k === 'sources' || k === 'places' && false) continue;
    collect(v, trail.concat(k), out);
  }
}

async function main() {
  let url = SLUG ? `${BASE}/${SLUG}` : null;
  if (!url) {
    const list = await get(BASE);
    fs.writeFileSync(path.join(OUT, 'poliwave-elections.json'), JSON.stringify(list, null, 1));
    const arr = Array.isArray(list) ? list : list.elections || list.live || Object.values(list).find(Array.isArray) || [];
    const hit = arr.find(e => /us/.test(String(e.country || e.path || e.url || '')) && /midterm/i.test(JSON.stringify(e)));
    if (!hit) throw new Error('미국 중간선거를 목록에서 못 찾음 — POLIWAVE_SLUG를 지정하세요');
    url = hit.url || hit.results || hit.api || `${BASE}/${hit.country}/${hit.slug}`;
    if (url.startsWith('/')) url = 'https://www.poliwave.com' + url;
  }
  const d = await get(url);
  fs.writeFileSync(path.join(OUT, 'poliwave-raw.json'), JSON.stringify(d));

  const callsByUnit = {};
  for (const c of [].concat(d.calls || [])) callsByUnit[String(c.unit || c.code || c.id || '')] = c;

  const found = [];
  collect(d.units ?? d, ['units'], found);
  const live = { senate: {}, governor: {}, house: {} };
  let unknown = 0;
  for (const { u, trail } of found) {
    const key = String(u.code || u.id || u.slug || u.unit || '');
    const text = [trail.join(' '), key, u.name, u.title, u.office, u.race, u.chamber, u.contest, u.type, u.kind, u.page, u.url].filter(Boolean).join(' ');
    const office = findOffice([u.office, u.race, u.chamber, u.type, u.kind].filter(Boolean).join(' ')) || findOffice(text);
    const st = (u.state && (ABBRS.has(String(u.state).toUpperCase()) ? String(u.state).toUpperCase() : findState(u.state))) || findState(text);
    if (!office || !st) { unknown++; continue; }
    const race = unitToRace(u, { key }, callsByUnit);
    if (office === 'house') {
      const s = slugify(text);
      const m = s.match(/(?:district-|-)(\d{1,2})(?:-|$)/) || s.match(/(\d{1,2})$/);
      const id = /at-large|-al(?:-|$)/.test(s) || !m ? `${st}-AL` : `${st}-${m[1].padStart(2, '0')}`;
      live.house[id] = race;
    } else live[office][st] = race;
  }
  const out = {
    source: 'poliwave',
    available: d.available !== false,
    rehearsal: !!d.rehearsal,
    fetchedAt: d.fetchedAt || new Date().toISOString(),
    sourceTime: d.sourceTime || null,
    attribution: typeof d.attribution === 'string' ? d.attribution : (d.attribution?.text || 'Poliwave'),
    page: d.page || 'https://www.poliwave.com/us/live/midterms-2026',
    counts: { senate: Object.keys(live.senate).length, governor: Object.keys(live.governor).length, house: Object.keys(live.house).length, unknown },
    ...live,
  };
  fs.writeFileSync(path.join(OUT, 'live.json'), JSON.stringify(out));
  console.log('ok', JSON.stringify(out.counts), 'available', out.available, 'rehearsal', out.rehearsal);
}
main().catch(e => { console.error('실패:', e.message); process.exit(1); });
