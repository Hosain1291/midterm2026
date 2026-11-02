/* 2026 미국 중간선거 개표 특보 */
(() => {
  const REFRESH_MS = 60000;
  const SMALL = ['VT', 'NH', 'MA', 'RI', 'CT', 'NJ', 'DE', 'MD'];
  const PARTY = {
    D: { ko: '민주', c: 'var(--D)', l: 'var(--D2)' },
    R: { ko: '공화', c: 'var(--R)', l: 'var(--R2)' },
    I: { ko: '무소속', c: 'var(--I)', l: 'var(--I2)' },
    L: { ko: '자유', c: 'var(--O)', l: 'var(--O)' },
    G: { ko: '녹색', c: 'var(--O)', l: 'var(--O)' },
  };
  const P = p => PARTY[p] || { ko: '기타', c: 'var(--O)', l: 'var(--O)' };
  const group = p => (p === 'D' || p === 'R' ? p : 'I');
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let geo = null, grid = null, data = null, view = 'senate', filter = 'all', query = '';
  const live = { src: null, senate: {}, governor: {}, house: {}, test: false, rehearsal: false, ok: null, updated: null, govAt: 0, attribution: '', page: '' };
  const seenCalls = new Map(); // 키 → 처음 본 시각

  /* =========================================================
     테마 · 시계
     ========================================================= */
  $('themeBtn').addEventListener('click', () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch (e) {}
  });
  const tickClock = () => {
    $('clock').textContent = new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
  };
  tickClock(); setInterval(tickClock, 10000);

  /* =========================================================
     데이터: 기본 정보 + 실시간 피드
     civicAPI 공개 피드 (브라우저에서 직접, 1분마다)
     ========================================================= */
  async function loadBase() {
    try {
      const r = await fetch('data/races.json?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) data = await r.json();
    } catch (e) {}
  }
  async function getJSON(url, opt = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(url, { ...opt, signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) { const e = new Error(r.status); e.status = r.status; throw e; }
      return await r.json();
    } finally { clearTimeout(t); }
  }

  // --- civicAPI ---
  const API = () => data.source.base;
  function partyCode(p) {
    const s = String(p || '').toLowerCase();
    if (s.startsWith('democrat') || s === 'dfl' || s.includes('farmer-labor')) return 'D';
    if (s.startsWith('republican')) return 'R';
    if (s.startsWith('libertarian')) return 'L';
    if (s.startsWith('green')) return 'G';
    return 'I';
  }
  function feedRace(o) {
    const cs = (o.candidates || []).map(c => ({ en: String(c.name || '').replace(/\s+/g, ' ').trim(), party: partyCode(c.party), votes: +c.votes || 0, winner: !!c.winner }));
    const total = cs.reduce((a, c) => a + c.votes, 0);
    cs.forEach(c => { c.pct = total ? c.votes / total * 100 : 0; });
    return { reporting: +o.percent_reporting || 0, cands: cs, total };
  }
  let civicUpdated = null;
  const stamp = d => { if (d && d.last_updated && (!civicUpdated || d.last_updated > civicUpdated)) civicUpdated = d.last_updated; };
  const civ = { senate: {}, governor: {}, house: {}, test: false };
  async function civicSenate() {
    const d = await getJSON(API() + '/race/' + data.source.senateAggregate);
    civ.test = !!d.test_data; stamp(d);
    const out = {};
    for (const [k, reg] of Object.entries(d.region_results || {})) out[k.slice(0, 2).toUpperCase()] = feedRace(reg);
    civ.senate = out;
  }
  async function civicHouse() {
    const d = await getJSON(API() + '/race/' + data.source.houseAggregate);
    stamp(d);
    const out = {};
    for (const [k, reg] of Object.entries(d.region_results || {})) out[k.toUpperCase()] = feedRace(reg);
    civ.house = out;
  }
  async function civicGovernors() {
    const list = data.governor.races;
    const dt = data.source.electionDate;
    let i = 0;
    const out = { ...civ.governor };
    async function worker() {
      while (i < list.length) {
        const r = list[i++];
        try {
          if (!r.civicId) {
            const s = await getJSON(`${API()}/race/search?country=US&province=${r.state}&startDate=${dt}&endDate=${dt}&query=Governor&limit=25`);
            const hit = (s.races || []).find(x => /governor/i.test(x.election_name || '') && !/lieut|primary/i.test(x.election_name || ''));
            if (hit) r.civicId = hit.id; else continue;
          }
          const d = await getJSON(API() + '/race/' + r.civicId);
          stamp(d);
          out[r.state] = feedRace(d);
          if (d.test_data) civ.test = true;
        } catch (e) {}
      }
    }
    await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
    civ.governor = out;
    live.govAt = Date.now();
  }
  async function loadCivic() {
    const jobs = [civicSenate(), civicHouse()];
    if (view === 'governor' || Date.now() - live.govAt > 300000) jobs.push(civicGovernors());
    const res = await Promise.allSettled(jobs);
    if (!res.some(x => x.status === 'fulfilled')) return false;
    Object.assign(live, { src: 'civic', senate: civ.senate, governor: civ.governor, house: civ.house, test: civ.test, rehearsal: false, updated: civicUpdated, attribution: 'civicAPI', page: 'https://civicapi.org' });
    return true;
  }

  async function refresh() {
    if (!data) return;
    let ok = false;
    try { ok = await loadCivic(); } catch (e) {}
    live.ok = ok;
    setStatus();
    render();
  }

  const fmtTime = iso => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  function setStatus() {
    $('status').classList.toggle('stale', !live.ok);
    const name = 'civicAPI';
    let t;
    if (!live.ok) t = '피드 연결 재시도 중…';
    else if (live.test) t = `${name} · 개표 시작 전`;
    else t = `${name}${live.rehearsal ? ' 리허설' : ''} · ${live.updated ? fmtTime(live.updated) : '개표 시작 전'}`;
    $('statusText').textContent = t;
    $('srcLine').innerHTML = '개표 수치·당선 판정: <a href="https://civicapi.org" target="_blank" rel="noopener">civicAPI (civicapi.org)</a> 공개 피드';
  }

  /* =========================================================
     기본 정보 + 피드 합치기
     ========================================================= */
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[.,'"()]/g, ' ').replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = s => { const w = norm(s).split(' ').filter(Boolean); return { first: w[0] || '', last: w[w.length - 1] || '', full: w.join(' ') }; };

  function merge(r, L) {
    const cands = r.candidates.map(c => ({ ...c, votes: 0, pct: 0, fw: false }));
    let reporting = 0;
    if (L && !live.test) {
      reporting = +L.reporting || 0;
      const used = new Set();
      cands.forEach(c => {
        const a = parts(c.en);
        let best = -1, score = 0;
        (L.cands || []).forEach((f, j) => {
          if (used.has(j)) return;
          const b = parts(f.en);
          let sc = 0;
          if (a.full === b.full) sc += 10;
          if (a.last === b.last) sc += 4;
          if (a.first === b.first) sc += 2; else if (b.first && (b.first.startsWith(a.first) || a.first.startsWith(b.first))) sc += 1;
          if (group(f.party) === group(c.party)) sc += 1;
          if (sc > score) { score = sc; best = j; }
        });
        if (best >= 0 && score >= 4) {
          used.add(best);
          const f = L.cands[best];
          Object.assign(c, { votes: f.votes, pct: f.pct, fw: f.winner });
        }
      });
      (L.cands || []).forEach((f, j) => {
        if (!used.has(j) && f.pct >= 1) cands.push({ name: f.en, party: f.party, votes: f.votes, pct: f.pct, fw: f.winner, extra: true });
      });
    }
    let winner = r.winner;
    if (winner === null || winner === undefined) {
      const w = cands.findIndex(c => c.fw);
      winner = w >= 0 ? w : null;
    }
    return { ...r, candidates: cands, reporting, winner };
  }

  function raceState(r) {
    const cs = r.candidates || [];
    let lead = null;
    cs.forEach((c, i) => { if (+c.pct > 0 && (lead === null || +c.pct > +cs[lead].pct)) lead = i; });
    if (r.winner !== null && r.winner !== undefined && cs[r.winner]) return { status: 'called', idx: r.winner, party: cs[r.winner].party, lead };
    if (lead !== null || +r.reporting > 0) return { status: 'counting', idx: lead, party: lead !== null ? cs[lead].party : null, lead };
    return { status: 'wait', idx: null, party: null, lead };
  }
  function margin(r) {
    const cs = [...r.candidates].sort((a, b) => b.pct - a.pct);
    return cs.length > 1 && cs[0].pct ? cs[0].pct - cs[1].pct : null;
  }

  let mergedCache = {}, houseCache = null;
  function racesOf(v) {
    if (v === 'house') return [];
    if (!mergedCache[v]) mergedCache[v] = data[v].races.map(r => merge(r, live[v][r.state]));
    return mergedCache[v];
  }
  const races = () => racesOf(view);

  // 하원: 선거구별 상태
  function district(id) {
    const L = live.test ? null : live.house[id];
    if (!L || !L.cands || !L.cands.length) return { status: 'wait', party: null, L };
    const w = L.cands.find(c => c.winner);
    if (w) return { status: 'called', party: group(w.party), L, w };
    if (L.total > 0) {
      const top = L.cands.reduce((a, c) => (c.votes > a.votes ? c : a), L.cands[0]);
      return { status: 'counting', party: group(top.party), L, w: top };
    }
    return { status: 'wait', party: null, L };
  }
  function houseTally() {
    if (houseCache) return houseCache;
    const by = {};
    for (const st of Object.keys(geo.states)) if (geo.states[st].seats) by[st] = { won: { D: 0, R: 0, I: 0 }, lead: { D: 0, R: 0, I: 0 }, ds: [] };
    for (const d of grid.districts) {
      const s = district(d.id);
      by[d.st].ds.push({ id: d.id, ...s });
      if (s.status === 'called') by[d.st].won[s.party]++;
      else if (s.status === 'counting') by[d.st].lead[s.party]++;
    }
    return (houseCache = by);
  }
  function houseState(st) {
    const t = houseTally()[st];
    const seats = geo.states[st].seats;
    const done = t.won.D + t.won.R + t.won.I;
    const leads = t.lead.D + t.lead.R + t.lead.I;
    return { ...t, seats, done, status: done >= seats ? 'called' : done + leads > 0 ? 'counting' : 'wait' };
  }
  const distName = id => {
    const [st, n] = id.split('-');
    return `${geo.states[st].ko} ${n === 'AL' ? '전역구' : +n + '구'}`;
  };

  /* =========================================================
     지도
     ========================================================= */
  function buildMap() {
    const svg = $('map');
    let h = '';
    if (view === 'house') {
      const r = grid.r - 0.7;
      const pts = (x, y) => [0, 1, 2, 3, 4, 5].map(k => { const a = (60 * k - 30) * Math.PI / 180; return `${(x + Math.cos(a) * r).toFixed(1)},${(y + Math.sin(a) * r).toFixed(1)}`; }).join(' ');
      for (const d of grid.districts) h += `<polygon class="cell" data-d="${d.id}" data-st="${d.st}" points="${pts(d.x, d.y)}"></polygon>`;
      h += `<path class="hexborder" d="${grid.borders}"></path>`;
      for (const [ab, [x, y]] of Object.entries(grid.labels)) h += `<text class="hexlab" x="${x}" y="${y}">${ab}</text>`;
    } else {
      for (const [ab, s] of Object.entries(geo.states)) h += `<path class="st" data-st="${ab}" d="${s.d}"></path>`;
      for (const [ab, s] of Object.entries(geo.states)) {
        if (SMALL.includes(ab) || ab === 'DC') continue;
        let { cx, cy } = s;
        if (ab === 'FL') cx += 18;
        if (ab === 'LA') cx -= 10;
        if (ab === 'MI') { cx += 14; cy += 26; }
        if (ab === 'KY') cy += 4;
        h += `<text data-lb="${ab}" x="${cx}" y="${cy}">${ab}</text>`;
      }
      SMALL.forEach((ab, i) => {
        const y = 150 + i * 30;
        h += `<g class="box" data-st="${ab}"><rect data-st="${ab}" x="905" y="${y}" width="44" height="24" rx="2"></rect><text data-lb="${ab}" x="927" y="${y + 12}">${ab}</text></g>`;
      });
    }
    svg.setAttribute('viewBox', view === 'house' ? grid.box.join(' ') : '0 0 975 610');
    svg.innerHTML = h;
    svg.dataset.view = view;
  }

  function stateFill(st) {
    const r = races().find(x => x.state === st);
    if (!r) return null;
    const s = raceState(r);
    if (s.status === 'called') return P(group(s.party)).c;
    if (s.status === 'counting' && s.party) return P(group(s.party)).l;
    return 'var(--map-wait)';
  }
  function paintMap() {
    const svg = $('map');
    if (svg.dataset.view !== view) buildMap();
    if (view === 'house') {
      houseTally();
      svg.querySelectorAll('.cell').forEach(el => {
        const s = district(el.dataset.d);
        el.style.fill = s.status === 'called' ? P(s.party).c : s.status === 'counting' ? P(s.party).l : 'var(--map-wait)';
      });
      return;
    }
    svg.querySelectorAll('[data-st]').forEach(el => {
      if (el.tagName === 'g') return;
      const f = stateFill(el.dataset.st);
      el.style.fill = f || 'var(--map-none)';
      el.classList.toggle('hit', !!f);
    });
    svg.querySelectorAll('text[data-lb]').forEach(t => {
      const f = stateFill(t.dataset.lb);
      t.setAttribute('class', f && !f.includes('2)') && !f.includes('wait') ? 'on' : 'off');
    });
  }

  function tipRows(cands, winIdx) {
    return cands.slice().map((c, i) => ({ c, i })).sort((a, b) => (b.c.pct || 0) - (a.c.pct || 0)).slice(0, 4)
      .map(({ c, i }) => `<div class="tr"><span><i class="sw" style="background:${P(group(c.party)).c}"></i>${i === winIdx ? '✓ ' : ''}${esc(c.name || c.en)}</span><b>${pct(c.pct)}</b></div>`).join('');
  }
  function onHover(e) {
    const tip = $('tip');
    const el = e.target.closest('[data-st]');
    if (!el) { tip.hidden = true; return; }
    const st = el.dataset.st;
    let h = '';
    if (view === 'house') {
      const id = el.dataset.d;
      if (!id) { tip.hidden = true; return; }
      const s = district(id);
      h = `<div class="tt">${distName(id)}</div>`;
      if (s.L && s.L.cands) {
        const cs = s.L.cands.map(c => ({ ...c, name: c.en }));
        h += tipRows(cs, s.status === 'called' ? cs.findIndex(c => c.winner) : -1);
        h += `<div class="ts">${s.status === 'called' ? '당선 확정' : s.status === 'counting' ? '개표 중' : '개표 전'}${s.L.reporting ? ` · 개표율 ${Math.round(s.L.reporting)}%` : ''}</div>`;
      } else h += '<div class="ts">개표 전</div>';
    } else {
      const r = races().find(x => x.state === st);
      h = `<div class="tt">${geo.states[st].ko}</div>`;
      if (!r) h += `<div class="ts">이번 ${view === 'senate' ? '상원' : '주지사'} 선거 없음</div>`;
      else {
        const rs = raceState(r);
        h += tipRows(r.candidates, rs.status === 'called' ? rs.idx : -1);
        h += `<div class="ts">${statusText(r, rs)}</div>`;
      }
    }
    tip.innerHTML = h;
    tip.hidden = false;
    const box = $('map').parentElement.getBoundingClientRect();
    let x = e.clientX - box.left + 14, y = e.clientY - box.top + 14;
    if (x + 270 > box.width) x = e.clientX - box.left - 280;
    if (y + 150 > box.height) y = e.clientY - box.top - 150;
    tip.style.left = Math.max(0, x) + 'px';
    tip.style.top = Math.max(0, y) + 'px';
  }
  function focusCard(st) {
    const card = document.getElementById('race-' + st);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 1600);
  }

  /* =========================================================
     의석 현황판
     ========================================================= */
  const pct = v => (+v ? (+v).toFixed(1) + '%' : '–');
  function tally() {
    if (view === 'house') {
      const won = { D: 0, R: 0, I: 0 }, lead = { D: 0, R: 0, I: 0 };
      for (const v of Object.values(houseTally())) for (const p of ['D', 'R', 'I']) { won[p] += v.won[p]; lead[p] += v.lead[p]; }
      return { won, lead, total: 435, base: null, gain: null };
    }
    const base = data[view].holdover;
    const won = { D: base.D, R: base.R, I: base.I || 0 };
    const lead = { D: 0, R: 0, I: 0 };
    const gain = { D: 0, R: 0, I: 0 };
    let called = 0, flips = 0;
    for (const r of races()) {
      const s = raceState(r);
      if (s.status === 'called') {
        const g = group(s.party);
        won[g]++; called++;
        if (g !== r.incumbentParty) { flips++; gain[g]++; gain[r.incumbentParty]--; }
      } else if (s.status === 'counting' && s.party) lead[group(s.party)]++;
    }
    return { won, lead, total: view === 'senate' ? 100 : 50, base, gain, called, flips };
  }

  function renderBoard() {
    const t = tally();
    const goal = view === 'senate' ? 51 : view === 'house' ? 218 : null;
    const unit = view === 'governor' ? '명' : '석';
    const lu = view === 'house' ? '석' : '곳';
    const w = n => (n / t.total * 100) + '%';
    const und = Math.max(0, t.total - t.won.D - t.won.R - t.won.I - t.lead.D - t.lead.R - t.lead.I);
    const chg = p => (t.gain && t.gain[p] ? `<span class="chg">${t.gain[p] > 0 ? '+' : ''}${t.gain[p]}</span>` : '');
    const sub = p => [view === 'senate' && p === 'D' ? '무소속 2 포함' : '', t.lead[p] ? `${t.lead[p]}${lu} 우세` : ''].filter(Boolean).join(' · ') || '&nbsp;';

    let headline;
    if (view === 'senate') {
      if (t.won.R >= 50) headline = `공화당, 상원 다수당 유지 확정 (공화 ${t.won.R}석, 부통령 캐스팅보트 포함)`;
      else if (t.won.D >= 51) headline = `민주당, 상원 다수당 탈환 확정 (민주 계열 ${t.won.D}석)`;
      else headline = `35곳 중 ${t.called}곳 확정 · 다수당까지 민주 ${51 - t.won.D}석 / 공화 ${50 - t.won.R}석 · 교체 ${t.flips}곳`;
    } else if (view === 'house') {
      const done = t.won.D + t.won.R + t.won.I;
      if (t.won.D >= 218) headline = '민주당, 하원 과반(218석) 확보';
      else if (t.won.R >= 218) headline = '공화당, 하원 과반(218석) 확보';
      else headline = `435석 중 ${done}석 확정 · 과반까지 민주 ${218 - t.won.D}석 / 공화 ${218 - t.won.R}석`;
    } else {
      headline = `36곳 중 ${t.called}곳 확정 · 정당 교체 ${t.flips}곳 · 선거 없는 14개 주(민주 6 · 공화 8) 포함`;
    }

    $('board').innerHTML = `
      <div class="board-row">
        <div class="tile D"><span class="big">${t.won.D}</span><div class="who"><b>민주당</b><span>${sub('D')}</span>${chg('D')}</div></div>
        <div class="mid">${goal ? `<span class="lab">과반</span><span class="val">${goal}</span>` : `<span class="lab">주지사</span><span class="val">50</span>`}
          ${t.won.I || t.lead.I ? `<span class="oth">무소속·기타 ${t.won.I}${t.lead.I ? ` (+${t.lead.I})` : ''}</span>` : ''}</div>
        <div class="tile R"><span class="big">${t.won.R}</span><div class="who"><b>공화당</b><span>${sub('R')}</span>${chg('R')}</div></div>
      </div>
      <div class="seatbar">
        <div class="bar">
          <span style="width:${w(t.won.D)};background:var(--D)"></span>
          <span style="width:${w(t.lead.D)};background:var(--D2)"></span>
          <span style="width:${w(t.won.I)};background:var(--I)"></span>
          <span style="width:${w(t.lead.I)};background:var(--I2)"></span>
          <span style="width:${w(und)};background:var(--map-wait)"></span>
          <span style="width:${w(t.lead.R)};background:var(--R2)"></span>
          <span style="width:${w(t.won.R)};background:var(--R)"></span>
          ${goal ? `<i class="maj"></i><span class="majlab">과반 ${goal}${unit}</span>` : ''}
        </div>
      </div>
      <div class="bar-legend">
        <span><i style="background:var(--D)"></i>${view === 'house' ? '당선 확정' : '확정·비개선'}</span>
        <span><i style="background:var(--D2)"></i>개표 중 우세</span>
        <span><i style="background:var(--map-wait)"></i>미정</span>
        ${t.base ? `<span>선거 없는 ${view === 'senate' ? '의석' : '주'}: 민주 ${t.base.D} · 공화 ${t.base.R}</span>` : ''}
      </div>
      <p class="headline"><span class="tag">${view === 'senate' ? '상원' : view === 'house' ? '하원' : '주지사'}</span>${headline}</p>`;
  }

  function renderLegend() {
    const sw = (c, t) => `<span><i style="background:${c}"></i>${t}</span>`;
    let h = sw('var(--D)', '민주 당선') + sw('var(--D2)', '우세') + sw('var(--R)', '공화 당선') + sw('var(--R2)', '우세') + sw('var(--I)', '기타');
    h += sw('var(--map-wait)', '개표 전');
    if (view !== 'house') h += sw('var(--map-none)', '선거 없음');
    $('legend').innerHTML = h;
    $('mapTitle').textContent = { senate: '상원 선거 지도', house: '하원 435석 카토그램 (1칸 = 1석)', governor: '주지사 선거 지도' }[view];
  }

  /* =========================================================
     사이드: 주목 경합 · 최근 확정 · 속보 띠
     ========================================================= */
  function trackCalls() {
    for (const v of ['senate', 'governor']) {
      for (const r of racesOf(v)) {
        const s = raceState(r);
        if (s.status !== 'called') continue;
        const k = `${v}:${r.state}:${s.idx}`;
        if (!seenCalls.has(k)) seenCalls.set(k, { t: Date.now(), v, r, s });
        else Object.assign(seenCalls.get(k), { r, s });
      }
    }
    for (const d of grid.districts) {
      const s = district(d.id);
      if (s.status !== 'called') continue;
      const k = `house:${d.id}:${s.w.en}`;
      if (!seenCalls.has(k)) seenCalls.set(k, { t: Date.now(), v: 'house', id: d.id, s });
    }
  }
  const OFFICE = { senate: '상원', governor: '주지사', house: '하원' };
  function callText(c) {
    if (c.v === 'house') return { where: `${distName(c.id)} 하원`, who: esc(c.s.w.en), party: group(c.s.w.party), flip: false };
    const cand = c.r.candidates[c.s.idx];
    return { where: `${geo.states[c.r.state].ko} ${OFFICE[c.v]}`, who: esc(cand.name), party: group(cand.party), flip: group(cand.party) !== c.r.incumbentParty, from: c.r.incumbentParty };
  }
  function renderSide() {
    // 주목 경합
    const keys = view === 'house' ? [] : races().filter(r => r.key);
    $('keyList').closest('.panel').style.display = view === 'house' ? 'none' : '';
    $('keyList').innerHTML = keys.map(r => {
      const s = raceState(r);
      const lead = s.idx !== null ? r.candidates[s.idx] : null;
      const m = margin(r);
      const col = lead ? (s.status === 'called' ? P(group(lead.party)).c : P(group(lead.party)).l) : 'var(--map-wait)';
      return `<div class="mrow" data-go="${r.state}"><span class="bar6" style="background:${col}"></span>
        <div><div class="t">${geo.states[r.state].ko}</div><div class="s">${lead ? `${esc(lead.name)} ${s.status === 'called' ? '당선' : '우세'}` : '개표 전'}</div></div>
        <div class="m">${m !== null ? '+' + m.toFixed(1) : '–'}<small>${r.reporting ? Math.round(r.reporting) + '% 개표' : ''}</small></div></div>`;
    }).join('') || '<div class="empty">주목 경합이 없습니다</div>';

    // 최근 확정 (현재 탭 기준)
    const calls = [...seenCalls.values()].filter(c => c.v === view).sort((a, b) => b.t - a.t).slice(0, 30);
    $('callList').innerHTML = calls.map(c => {
      const x = callText(c);
      const go = c.v === 'house' ? c.id.split('-')[0] : c.r.state;
      return `<div class="mrow" data-go="${go}"><span class="bar6" style="background:${P(x.party).c}"></span>
        <div><div class="t">${x.where}</div><div class="s">${x.who} (${P(x.party).ko}) 당선${x.flip ? ` · <b style="color:var(--accent)">${P(x.from).ko}→${P(x.party).ko} 교체</b>` : ''}</div></div>
        <div class="m"><small>${new Date(c.t).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false })}</small></div></div>`;
    }).join('') || '<div class="empty">아직 당선이 확정된 곳이 없습니다</div>';
  }
  let lastTicker = '';
  function renderTicker() {
    const all = [...seenCalls.values()].sort((a, b) => b.t - a.t);
    const pick = all.filter(c => c.v !== 'house').slice(0, 12).concat(all.filter(c => c.v === 'house').slice(0, 8));
    let html;
    if (!pick.length) html = `<span>${live.test || !live.updated ? '개표가 시작되면 당선 확정 소식이 이곳에 흐릅니다' : '개표가 진행 중입니다 — 아직 당선 확정된 곳이 없습니다'}</span>`;
    else html = pick.map(c => {
      const x = callText(c);
      return `<span><i class="dot" style="background:${P(x.party).c}"></i><b>${x.where}</b> ${x.who}(${P(x.party).ko}) 당선 확정${x.flip ? ` — ${P(x.from).ko}→${P(x.party).ko} 교체` : ''}</span>`;
    }).join('');
    if (html !== lastTicker) {
      lastTicker = html;
      const m = $('tickerMove');
      m.innerHTML = html;
      m.style.animationDuration = Math.max(30, m.scrollWidth / 70) + 's';
    }
  }

  /* =========================================================
     카드
     ========================================================= */
  function statusText(r, s) {
    if (s.status === 'called') return '당선 확정';
    if (s.status === 'counting') return '개표 중';
    return '개표 전';
  }
  function raceCard(r) {
    const s = raceState(r);
    const g = geo.states[r.state];
    const flip = s.status === 'called' && group(s.party) !== r.incumbentParty;
    const tags = [];
    if (s.status === 'called') tags.push(`<span class="tag2 won" style="background:${P(group(s.party)).c}">${P(group(s.party)).ko} 당선</span>`);
    if (flip) tags.push(`<span class="tag2 flip">${P(r.incumbentParty).ko}→${P(group(s.party)).ko}</span>`);
    if (r.key) tags.push('<span class="tag2 key">주목</span>');
    if (r.label) tags.push(`<span class="tag2">${r.label}</span>`);
    if (r.open) tags.push('<span class="tag2">현직 불출마</span>');
    const order = r.candidates.map((c, i) => i).sort((a, b) => (+r.candidates[b].pct || 0) - (+r.candidates[a].pct || 0));
    const rows = order.map(i => {
      const c = r.candidates[i];
      const win = s.status === 'called' && i === s.idx;
      const col = P(group(c.party)).c;
      return `<div class="cand${win ? ' win' : ''}"><span class="sw" style="background:${col}"></span>
        <div class="nm">${esc(c.name)}<span class="pp">${P(c.party).ko}</span>${c.inc ? '<span class="inc">현직</span>' : ''}${win ? '<span class="chk">당선</span>' : ''}</div>
        <div class="pc">${pct(c.pct)}${c.votes ? `<small>${c.votes.toLocaleString('ko-KR')}표</small>` : ''}</div>
        <div class="track"><span style="width:${Math.min(100, +c.pct || 0)}%;background:${col}"></span></div></div>`;
    }).join('');
    const cls = s.status === 'called' ? 'st-called' : s.status === 'counting' ? 'st-count' : '';
    const rep = Math.round(+r.reporting || 0);
    return `<article class="race" id="race-${r.state}">
      <div class="race-top"><div class="race-name">${g.ko}<small>${g.en}</small></div><div class="tags">${tags.join('')}</div></div>
      <div class="cands">${rows}</div>
      <div class="race-foot"><span class="${cls}">${statusText(r, s)}</span>
        <span class="prog">${rep ? `개표 ${rep}%<span class="pbar"><span style="width:${rep}%"></span></span>` : `현 ${P(r.incumbentParty).ko} 보유`}</span></div>
    </article>`;
  }
  function houseCard(st) {
    const g = geo.states[st];
    const hs = houseState(st);
    const sq = hs.ds.map(d => {
      const c = d.status === 'called' ? P(d.party).c : d.status === 'counting' ? P(d.party).l : 'var(--map-wait)';
      return `<i style="background:${c}" title="${distName(d.id)}"></i>`;
    }).join('');
    const cls = hs.status === 'called' ? 'st-called' : hs.status === 'counting' ? 'st-count' : '';
    const ld = hs.lead.D + hs.lead.R + hs.lead.I;
    const txt = hs.status === 'called' ? '전 의석 확정' : hs.status === 'counting' ? `${hs.done}/${hs.seats}석 확정` + (ld ? ` · 우세 민주 ${hs.lead.D} 공화 ${hs.lead.R}` : '') : '개표 전';
    return `<article class="race" id="race-${st}">
      <div class="race-top"><div class="race-name">${g.ko}<small>${g.en}</small></div><div class="tags"><span class="tag2">${hs.seats}석</span></div></div>
      <div class="hseats">${sq}</div>
      <div class="hnums"><span style="color:var(--D)">민주 ${hs.won.D}</span><span style="color:var(--R)">공화 ${hs.won.R}</span>${hs.won.I ? `<span style="color:var(--I)">기타 ${hs.won.I}</span>` : ''}</div>
      <div class="race-foot"><span class="${cls}">${txt}</span><span>미정 ${hs.seats - hs.done}석</span></div>
    </article>`;
  }
  function renderGrid() {
    const q = query.trim();
    const match = st => !q || geo.states[st].ko.includes(q) || geo.states[st].en.toLowerCase().includes(q.toLowerCase()) || st.toLowerCase() === q.toLowerCase();
    const byKo = (a, b) => geo.states[a].ko.localeCompare(geo.states[b].ko, 'ko');
    let html = '';
    if (view === 'house') {
      html = Object.keys(houseTally()).filter(match)
        .filter(st => filter === 'all' || filter === 'key' || houseState(st).status === filter)
        .sort(byKo).map(houseCard).join('');
    } else {
      html = races().filter(r => match(r.state)).filter(r => {
        if (filter === 'all') return true;
        if (filter === 'key') return r.key;
        return raceState(r).status === filter;
      }).sort((a, b) => byKo(a.state, b.state)).map(raceCard).join('');
    }
    $('grid').innerHTML = html || '<div class="empty">조건에 맞는 선거가 없습니다.</div>';
    $('listTitle').textContent = { senate: '주별 상원 선거', house: '주별 하원 의석', governor: '주별 주지사 선거' }[view];
    document.querySelector('[data-f="key"]').style.display = view === 'house' ? 'none' : '';
  }

  function render() {
    if (!data || !geo || !grid) return;
    mergedCache = {}; houseCache = null;
    document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.view === view));
    const n = $('notice');
    let note = data.notice || '';
    if (live.rehearsal) note = (note ? note + ' · ' : '') + '지금 보이는 수치는 리허설(시험) 데이터로, 실제 결과가 아닙니다.';
    n.hidden = !note;
    n.textContent = note;
    trackCalls();
    renderBoard();
    renderLegend();
    paintMap();
    renderSide();
    renderTicker();
    renderGrid();
  }

  /* =========================================================
     이벤트
     ========================================================= */
  function route() {
    const v = location.hash.slice(1);
    view = ['senate', 'house', 'governor'].includes(v) ? v : 'senate';
    if (filter === 'key' && view === 'house') filter = 'all';
    document.querySelectorAll('#filters button').forEach(b => b.classList.toggle('on', b.dataset.f === filter));
    $('tip').hidden = true;
    render();
    if (view === 'governor' && data && Date.now() - live.govAt > 60000) civicGovernors().then(() => { live.governor = civ.governor; render(); });
  }
  $('filters').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    filter = b.dataset.f;
    document.querySelectorAll('#filters button').forEach(x => x.classList.toggle('on', x === b));
    renderGrid();
  });
  $('search').addEventListener('input', e => { query = e.target.value; renderGrid(); });
  const svg = $('map');
  svg.addEventListener('mousemove', onHover);
  svg.addEventListener('mouseleave', () => { $('tip').hidden = true; });
  svg.addEventListener('click', e => {
    const el = e.target.closest('[data-st]');
    if (el) focusCard(el.dataset.st);
  });
  document.querySelector('.side').addEventListener('click', e => {
    const r = e.target.closest('[data-go]');
    if (r) focusCard(r.dataset.go);
  });
  window.addEventListener('hashchange', route);

  Promise.all([
    fetch('data/states.json').then(r => r.json()),
    fetch('data/house-grid.json').then(r => r.json()),
    loadBase(),
  ]).then(([g, hg]) => {
    geo = g; grid = hg;
    route();
    refresh();
    setInterval(refresh, REFRESH_MS);
    setInterval(loadBase, 300000);
  });
})();
