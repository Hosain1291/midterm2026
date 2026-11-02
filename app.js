/* 2026 미국 중간선거 개표 상황판 */
(() => {
  const REFRESH_MS = 60000;
  const SMALL = ['VT', 'NH', 'MA', 'RI', 'CT', 'NJ', 'DE', 'MD'];
  const PARTY = {
    D: { ko: '민주', full: '민주당', c: 'var(--D)', l: 'var(--D2)' },
    R: { ko: '공화', full: '공화당', c: 'var(--R)', l: 'var(--R2)' },
    I: { ko: '무소속', full: '무소속', c: 'var(--I)', l: 'var(--I2)' },
    L: { ko: '자유', full: '자유당', c: 'var(--O)', l: '#cfcfcf' },
    G: { ko: '녹색', full: '녹색당', c: 'var(--O)', l: '#cfcfcf' },
  };
  const P = p => PARTY[p] || { ko: p || '기타', full: p || '기타', c: 'var(--O)', l: '#cfcfcf' };
  const group = p => (p === 'D' || p === 'R' ? p : 'I');

  let geo = null, data = null, view = 'senate', filter = 'all', query = '';
  const live = { senate: {}, governor: {}, house: {}, test: false, ok: null, updated: null, govAt: 0 };
  const $ = id => document.getElementById(id);

  /* ---------- 기본 정보 (후보 한국어 이름 등) ---------- */
  async function loadBase() {
    try {
      const r = await fetch('data/races.json?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) data = await r.json();
    } catch (e) {}
  }

  /* ---------- 실시간 피드 (civicAPI JSON) ---------- */
  const API = () => data.source.base;
  async function getJSON(path) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(API() + path, { signal: ctl.signal, headers: { accept: 'application/json' }, cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
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
  const stamp = d => { if (d && d.last_updated && (!live.updated || d.last_updated > live.updated)) live.updated = d.last_updated; };

  async function loadSenate() {
    const d = await getJSON('/race/' + data.source.senateAggregate);
    live.test = !!d.test_data;
    stamp(d);
    const out = {};
    for (const [k, reg] of Object.entries(d.region_results || {})) out[k.slice(0, 2).toUpperCase()] = feedRace(reg);
    live.senate = out;
  }
  async function loadHouse() {
    const d = await getJSON('/race/' + data.source.houseAggregate);
    stamp(d);
    const out = {};
    for (const [k, reg] of Object.entries(d.region_results || {})) out[k.toUpperCase()] = feedRace(reg);
    live.house = out;
  }
  async function findGovId(r) {
    const dt = data.source.electionDate;
    const d = await getJSON(`/race/search?country=US&province=${r.state}&startDate=${dt}&endDate=${dt}&query=Governor&limit=25`);
    const hit = (d.races || []).find(x => /governor/i.test(x.election_name || '') && !/lieut/i.test(x.election_name || '') && !/primary/i.test(x.election_name || ''));
    if (hit) r.civicId = hit.id;
  }
  async function loadGovernors() {
    const list = data.governor.races;
    let i = 0;
    const out = { ...live.governor };
    async function worker() {
      while (i < list.length) {
        const r = list[i++];
        try {
          if (!r.civicId) await findGovId(r);
          if (!r.civicId) continue;
          const d = await getJSON('/race/' + r.civicId);
          stamp(d);
          out[r.state] = feedRace(d);
          if (d.test_data) live.test = true;
        } catch (e) {}
      }
    }
    await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
    live.governor = out;
    live.govAt = Date.now();
  }

  async function refresh() {
    if (!data) return;
    const jobs = [loadSenate(), loadHouse()];
    // 주지사는 36개 요청이라 주지사 탭을 볼 때만 1분마다, 아니면 5분마다
    if (view === 'governor' || Date.now() - live.govAt > 300000) jobs.push(loadGovernors());
    const res = await Promise.allSettled(jobs);
    live.ok = res.some(x => x.status === 'fulfilled');
    setLive();
    render();
  }

  function setLive() {
    const el = $('live');
    el.classList.toggle('stale', !live.ok);
    if (!live.ok) { $('liveText').textContent = '개표 피드 연결 재시도 중…'; return; }
    let t = live.test ? '개표 시작 전 (피드 시험 데이터)' : live.updated ? '피드 업데이트 ' + fmtTime(live.updated) : '개표 시작 전';
    $('liveText').innerHTML = t + '<span class="hide-m"> · 1분마다 자동 갱신</span>';
  }
  const fmtTime = iso => new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  /* ---------- 기본 정보 + 피드 합치기 ---------- */
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[.,'"()]/g, ' ').replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = s => { const w = norm(s).split(' ').filter(Boolean); return { first: w[0] || '', last: w[w.length - 1] || '', full: w.join(' ') }; };

  function merge(r, L) {
    const cands = r.candidates.map(c => ({ ...c, votes: 0, pct: 0, fw: false }));
    let reporting = 0, hasVotes = false;
    if (L && !live.test) {
      reporting = L.reporting;
      hasVotes = L.total > 0;
      const used = new Set();
      cands.forEach(c => {
        const a = parts(c.en);
        let best = -1, score = 0;
        L.cands.forEach((f, j) => {
          if (used.has(j)) return;
          const b = parts(f.en);
          let sc = 0;
          if (a.full === b.full) sc += 10;
          if (a.last === b.last) sc += 4;
          if (a.first === b.first) sc += 2; else if (b.first.startsWith(a.first) || a.first.startsWith(b.first)) sc += 1;
          if (group(f.party) === group(c.party)) sc += 1;
          if (sc > score) { score = sc; best = j; }
        });
        if (best >= 0 && score >= 4) {
          used.add(best);
          const f = L.cands[best];
          Object.assign(c, { votes: f.votes, pct: f.pct, fw: f.winner });
        }
      });
      L.cands.forEach((f, j) => {
        if (!used.has(j) && f.pct >= 1) cands.push({ name: f.en, party: f.party, votes: f.votes, pct: f.pct, fw: f.winner, extra: true });
      });
    }
    let winner = r.winner;
    if (winner === null || winner === undefined) {
      const w = cands.findIndex(c => c.fw);
      winner = w >= 0 ? w : null;
    }
    return { ...r, candidates: cands, reporting, hasVotes, winner };
  }

  /* ---------- 경합 상태 계산 ---------- */
  function raceState(r) {
    const cs = r.candidates || [];
    let lead = null;
    cs.forEach((c, i) => { if (+c.pct > 0 && (lead === null || +c.pct > +cs[lead].pct)) lead = i; });
    if (r.winner !== null && r.winner !== undefined && cs[r.winner]) {
      return { status: 'called', idx: r.winner, party: cs[r.winner].party };
    }
    if (lead !== null || +r.reporting > 0) {
      return { status: 'counting', idx: lead, party: lead !== null ? cs[lead].party : null };
    }
    return { status: 'wait', idx: null, party: null };
  }
  let houseCache = null;
  function houseTally() {
    if (houseCache) return houseCache;
    const by = {};
    for (const st of Object.keys(geo.states)) if (geo.states[st].seats) by[st] = { won: { D: 0, R: 0, I: 0 }, lead: { D: 0, R: 0, I: 0 } };
    if (!live.test) {
      for (const [key, L] of Object.entries(live.house)) {
        const st = key.slice(0, 2);
        if (!by[st]) continue;
        const w = L.cands.find(c => c.winner);
        if (w) { by[st].won[group(w.party)]++; continue; }
        if (L.total > 0) {
          const top = L.cands.reduce((a, c) => (c.votes > a.votes ? c : a), L.cands[0]);
          by[st].lead[group(top.party)]++;
        }
      }
    }
    return (houseCache = by);
  }
  function houseState(st) {
    const t = houseTally()[st];
    const seats = geo.states[st].seats;
    const h = { D: t.won.D, R: t.won.R, O: t.won.I };
    const done = h.D + h.R + h.O;
    const leads = t.lead.D + t.lead.R + t.lead.I;
    return { h, lead: t.lead, seats, done, status: done >= seats ? 'called' : done + leads > 0 ? 'counting' : 'wait' };
  }

  /* ---------- 지도 ---------- */
  function buildMap() {
    const svg = $('map');
    const ns = 'http://www.w3.org/2000/svg';
    let html = '';
    for (const [ab, s] of Object.entries(geo.states)) {
      html += `<path class="st" data-st="${ab}" d="${s.d}"></path>`;
    }
    html += `<path class="borders" d="${geo.borders}"></path>`;
    for (const [ab, s] of Object.entries(geo.states)) {
      if (SMALL.includes(ab) || ab === 'DC') continue;
      let { cx, cy } = s;
      if (ab === 'FL') cx += 18;
      if (ab === 'LA') cx -= 10;
      if (ab === 'MI') { cx += 14; cy += 26; }
      if (ab === 'KY') { cy += 4; }
      html += `<text data-lb="${ab}" x="${cx}" y="${cy}">${ab}</text>`;
    }
    SMALL.forEach((ab, i) => {
      const y = 150 + i * 30;
      html += `<g class="box" data-st="${ab}"><rect data-st="${ab}" x="905" y="${y}" width="44" height="24"></rect>` +
        `<text data-lb="${ab}" x="927" y="${y + 12}">${ab}</text></g>`;
    });
    svg.innerHTML = html;
    svg.addEventListener('mousemove', onHover);
    svg.addEventListener('mouseleave', () => { $('tip').hidden = true; });
    svg.addEventListener('click', e => {
      const st = e.target.closest('[data-st]')?.dataset.st;
      if (!st) return;
      const card = document.getElementById('race-' + st);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('flash');
        setTimeout(() => card.classList.remove('flash'), 1600);
      }
    });
  }

  function stateFill(st) {
    if (view === 'house') {
      if (!geo.states[st].seats) return 'var(--none)';
      const hs = houseState(st);
      if (hs.status === 'wait') return 'var(--wait)';
      const d = hs.h.D + hs.lead.D, r = hs.h.R + hs.lead.R;
      const p = d > r ? 'D' : r > d ? 'R' : 'I';
      return hs.status === 'called' ? P(p).c : P(p).l;
    }
    const r = races().find(x => x.state === st);
    if (!r) return 'var(--none)';
    const s = raceState(r);
    if (s.status === 'called') return P(group(s.party)).c;
    if (s.status === 'counting' && s.party) return P(group(s.party)).l;
    return 'var(--wait)';
  }

  function paintMap() {
    const svg = $('map');
    svg.querySelectorAll('[data-st]').forEach(el => {
      if (el.tagName === 'g') return;
      el.style.fill = stateFill(el.dataset.st);
    });
    svg.querySelectorAll('text[data-lb]').forEach(t => {
      const f = stateFill(t.dataset.lb);
      t.classList.toggle('dark', f === 'var(--none)' || f === 'var(--wait)' || f.includes('2)') || f === '#cfcfcf');
    });
  }

  function onHover(e) {
    const st = e.target.closest('[data-st]')?.dataset.st;
    const tip = $('tip');
    if (!st || !geo.states[st]) { tip.hidden = true; return; }
    const s = geo.states[st];
    let h = `<div class="tt">${s.ko}</div>`;
    if (view === 'house') {
      if (!s.seats) h += '<div class="ts">하원 투표권 의원 없음</div>';
      else {
        const hs = houseState(st);
        h += `<div class="tr"><span>민주</span><b>${+hs.h.D || 0}석</b></div>` +
          `<div class="tr"><span>공화</span><b>${+hs.h.R || 0}석</b></div>` +
          (+hs.h.O ? `<div class="tr"><span>기타</span><b>${hs.h.O}석</b></div>` : '') +
          `<div class="ts">총 ${s.seats}석 중 ${hs.done}석 확정</div>`;
      }
    } else {
      const r = races().find(x => x.state === st);
      if (!r) h += `<div class="ts">이번 ${view === 'senate' ? '상원' : '주지사'} 선거 없음</div>`;
      else {
        const rs = raceState(r);
        r.candidates.forEach((c, i) => {
          h += `<div class="tr"><span>${i === rs.idx && rs.status === 'called' ? '✓ ' : ''}${c.name} (${P(c.party).ko})</span><b>${pct(c.pct)}</b></div>`;
        });
        h += `<div class="ts">${statusText(r, rs)}</div>`;
      }
    }
    tip.innerHTML = h;
    tip.hidden = false;
    const box = $('map').parentElement.getBoundingClientRect();
    let x = e.clientX - box.left + 14, y = e.clientY - box.top + 14;
    if (x + 240 > box.width) x = e.clientX - box.left - 250;
    if (y + 140 > box.height) y = e.clientY - box.top - 140;
    tip.style.left = Math.max(0, x) + 'px';
    tip.style.top = Math.max(0, y) + 'px';
  }

  /* ---------- 요약 ---------- */
  let mergedCache = {};
  function races() {
    if (view === 'house') return [];
    if (!mergedCache[view]) mergedCache[view] = data[view].races.map(r => merge(r, live[view][r.state]));
    return mergedCache[view];
  }
  const pct = v => (+v ? (+v).toFixed(1) + '%' : '–');

  function tally() {
    if (view === 'house') {
      const won = { D: 0, R: 0, I: 0 }, lead = { D: 0, R: 0, I: 0 };
      for (const v of Object.values(houseTally())) for (const p of ['D', 'R', 'I']) { won[p] += v.won[p]; lead[p] += v.lead[p]; }
      return { won, lead, total: 435, base: { D: 0, R: 0, I: 0 } };
    }
    const base = data[view].holdover;
    const won = { D: base.D, R: base.R, I: base.I || 0 };
    const lead = { D: 0, R: 0, I: 0 };
    let flips = 0, called = 0;
    for (const r of races()) {
      const s = raceState(r);
      if (s.status === 'called') {
        won[group(s.party)]++; called++;
        if (group(s.party) !== r.incumbentParty) flips++;
      } else if (s.status === 'counting' && s.party) lead[group(s.party)]++;
    }
    return { won, lead, total: view === 'senate' ? 100 : 50, base, flips, called, n: data[view].races.length };
  }

  function renderSummary() {
    const t = tally();
    const goal = view === 'senate' ? 51 : view === 'house' ? 218 : null;
    const unit = view === 'governor' ? '명' : '석';
    const w = n => (n / t.total * 100) + '%';
    const und = t.total - t.won.D - t.won.R - t.won.I - t.lead.D - t.lead.R - t.lead.I;
    let mid = '';
    if (goal) mid = `<div class="goal">과반 기준<b>${goal}${unit}</b></div>`;
    else mid = `<div class="goal">주지사 총원<b>50명</b></div>`;
    if (t.won.I || t.lead.I) mid += `<div class="other">무소속·기타 ${t.won.I}${t.lead.I ? ` (+${t.lead.I} 우세)` : ''}</div>`;

    const titles = { senate: '상원 의석', house: '하원 의석', governor: '주지사' };
    let headline = '';
    if (view === 'senate') {
      if (t.won.R >= 50) headline = `공화당이 상원 다수당을 지켰습니다 (공화 ${t.won.R}석, 부통령 캐스팅보트 포함).`;
      else if (t.won.D >= 51) headline = `민주당이 상원 다수당을 차지했습니다 (민주 계열 ${t.won.D}석).`;
      else headline = `35곳 중 ${t.called}곳 확정 · 다수당까지 민주 ${51 - t.won.D}석, 공화 ${50 - t.won.R}석 남음 · 의석 교체 ${t.flips}곳`;
    } else if (view === 'house') {
      if (t.won.D >= 218) headline = '민주당이 하원 과반(218석)을 확보했습니다.';
      else if (t.won.R >= 218) headline = '공화당이 하원 과반(218석)을 확보했습니다.';
      else headline = `435석 중 ${t.won.D + t.won.R + t.won.I}석 확정 · 과반까지 민주 ${218 - t.won.D}석, 공화 ${218 - t.won.R}석 남음`;
    } else {
      headline = `36곳 중 ${t.called}곳 확정 · 정당 교체 ${t.flips}곳 · 이번 선거 없는 주 14곳(민주 6 · 공화 8) 포함 집계`;
    }

    $('summary').innerHTML = `
      <div class="sum-top">
        <div class="side D"><span class="pname">민주당${view === 'senate' ? '<small style="font-weight:500;font-size:12px"> (무소속 포함)</small>' : ''}</span>
          <span class="num">${t.won.D}</span>
          <span class="lead">${t.lead.D ? `+${t.lead.D}${view === 'house' ? '석' : '곳'} 우세` : '&nbsp;'}</span></div>
        <div class="mid">${mid}</div>
        <div class="side right R"><span class="pname">공화당</span>
          <span class="num">${t.won.R}</span>
          <span class="lead">${t.lead.R ? `+${t.lead.R}${view === 'house' ? '석' : '곳'} 우세` : '&nbsp;'}</span></div>
      </div>
      <div class="bar-wrap">
        <div class="bar" aria-label="${titles[view]} 막대">
          <span style="width:${w(t.won.D)};background:var(--D)"></span>
          <span style="width:${w(t.lead.D)};background:var(--D2)"></span>
          <span style="width:${w(t.won.I)};background:var(--I)"></span>
          <span style="width:${w(t.lead.I)};background:var(--I2)"></span>
          <span style="width:${w(Math.max(0, und))};background:var(--wait)"></span>
          <span style="width:${w(t.lead.R)};background:var(--R2)"></span>
          <span style="width:${w(t.won.R)};background:var(--R)"></span>
          ${goal ? '<div class="marker"></div>' : ''}
        </div>
      </div>
      <div class="bar-legend">
        <span><i style="background:var(--D)"></i>${view === 'house' ? '당선 확정' : '확정·비개선'}</span>
        <span><i style="background:var(--D2)"></i>개표 중 우세</span>
        <span><i style="background:var(--wait)"></i>미정</span>
        ${view !== 'house' ? `<span>선거 없는 ${view === 'senate' ? '의석' : '주'}: 민주 ${t.base.D} · 공화 ${t.base.R}</span>` : ''}
      </div>
      <p class="headline">${headline}</p>`;
  }

  function renderLegend() {
    const sw = (c, t) => `<span><i style="background:${c}"></i>${t}</span>`;
    let h = sw('var(--D)', '민주 당선') + sw('var(--D2)', '민주 우세') + sw('var(--R)', '공화 당선') + sw('var(--R2)', '공화 우세');
    if (view !== 'house') h += sw('var(--I)', '무소속·기타');
    h += sw('var(--wait)', view === 'house' ? '미정' : '개표 전');
    if (view !== 'house') h += sw('var(--none)', '선거 없음');
    $('legend').innerHTML = h;
    $('mapTitle').textContent = { senate: '상원 선거 지도 (35곳)', house: '하원 주별 의석 지도', governor: '주지사 선거 지도 (36곳)' }[view];
  }

  /* ---------- 카드 ---------- */
  function statusText(r, s) {
    if (s.status === 'called') return '당선 확정' + (+r.reporting ? ` · 개표율 ${r.reporting}%` : '');
    if (s.status === 'counting') return `개표 중 · 개표율 ${+r.reporting || 0}%`;
    return '개표 전';
  }

  function raceCard(r) {
    const s = raceState(r);
    const g = geo.states[r.state];
    const flip = s.status === 'called' && group(s.party) !== r.incumbentParty;
    const tags = [];
    if (r.label) tags.push(`<span class="tag sp">${r.label}</span>`);
    if (r.open) tags.push('<span class="tag sp">현직 불출마</span>');
    if (r.key) tags.push('<span class="tag key">주목</span>');
    if (flip) tags.push(`<span class="tag flip">${P(r.incumbentParty).ko}→${P(group(s.party)).ko} 교체</span>`);
    const order = r.candidates.map((c, i) => i).sort((a, b) => (+r.candidates[b].pct || 0) - (+r.candidates[a].pct || 0));
    const rows = order.map(i => {
      const c = r.candidates[i];
      const win = s.status === 'called' && i === s.idx;
      const col = P(group(c.party)).c;
      return `<div class="cand${win ? ' win' : ''}">
        <div class="nm">${win ? '<span class="chk">✓</span>' : ''}<span class="pp" style="background:${col}">${P(c.party).ko}</span>${c.name}${c.inc ? '<span class="inc">현직</span>' : ''}</div>
        <div class="pc">${pct(c.pct)}${c.votes ? `<small>${c.votes.toLocaleString('ko-KR')}표</small>` : ''}</div>
        <div class="track"><span style="width:${Math.min(100, +c.pct || 0)}%;background:${col}"></span></div>
      </div>`;
    }).join('');
    const cls = s.status === 'called' ? 'st-called' : s.status === 'counting' ? 'st-count' : '';
    return `<article class="race" id="race-${r.state}">
      <div class="race-top"><div class="race-name">${g.ko}<small>${g.en}</small></div><div class="tags">${tags.join('')}</div></div>
      ${rows}
      <div class="race-foot"><span class="${cls}">${statusText(r, s)}</span><span>현 ${P(r.incumbentParty).ko} 보유</span></div>
    </article>`;
  }

  function houseCard(st) {
    const g = geo.states[st];
    const hs = houseState(st);
    const D = +hs.h.D || 0, R = +hs.h.R || 0, O = +hs.h.O || 0;
    let sq = '';
    for (let i = 0; i < hs.seats; i++) {
      const c = i < D ? 'var(--D)' : i < D + O ? 'var(--I)' : i >= hs.seats - R ? 'var(--R)' : 'var(--wait)';
      sq += `<i style="background:${c}"></i>`;
    }
    const cls = hs.status === 'called' ? 'st-called' : hs.status === 'counting' ? 'st-count' : '';
    const ld = hs.lead.D + hs.lead.R + hs.lead.I;
    const txt = hs.status === 'called' ? '전 의석 확정' : hs.status === 'counting' ? `${hs.done}/${hs.seats}석 확정` + (ld ? ` · 우세 민주 ${hs.lead.D} 공화 ${hs.lead.R}` : '') : '개표 전';
    return `<article class="race" id="race-${st}">
      <div class="race-top"><div class="race-name">${g.ko}<small>${g.en}</small></div><div class="tags"><span class="tag sp">${hs.seats}석</span></div></div>
      <div class="hseats">${sq}</div>
      <div class="hnums"><span style="color:var(--D)">민주 ${D}</span><span style="color:var(--R)">공화 ${R}</span>${O ? `<span style="color:var(--I)">기타 ${O}</span>` : ''}</div>
      <div class="race-foot"><span class="${cls}">${txt}</span><span>미정 ${hs.seats - hs.done}석</span></div>
    </article>`;
  }

  function renderGrid() {
    const q = query.trim();
    const match = st => !q || geo.states[st].ko.includes(q) || geo.states[st].en.toLowerCase().includes(q.toLowerCase()) || st.toLowerCase() === q.toLowerCase();
    const byKo = (a, b) => geo.states[a].ko.localeCompare(geo.states[b].ko, 'ko');
    let html = '';
    if (view === 'house') {
      const list = Object.keys(houseTally()).filter(match).filter(st => {
        const s = houseState(st).status;
        return filter === 'all' || filter === 'key' || filter === s;
      }).sort(byKo);
      html = list.map(houseCard).join('');
    } else {
      const list = races().filter(r => match(r.state)).filter(r => {
        if (filter === 'all') return true;
        if (filter === 'key') return r.key;
        return raceState(r).status === filter;
      }).sort((a, b) => byKo(a.state, b.state));
      html = list.map(raceCard).join('');
    }
    $('grid').innerHTML = html || '<div class="empty">조건에 맞는 선거가 없습니다.</div>';
    $('listTitle').textContent = { senate: '주별 상원 선거', house: '주별 하원 의석', governor: '주별 주지사 선거' }[view];
    document.querySelector('[data-f="key"]').style.display = view === 'house' ? 'none' : '';
  }

  function render() {
    if (!data || !geo) return;
    mergedCache = {}; houseCache = null;
    document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.view === view));
    const n = $('notice');
    const note = data.notice || '';
    n.hidden = !note;
    n.textContent = note;
    renderSummary();
    renderLegend();
    paintMap();
    renderGrid();
  }

  /* ---------- 이벤트 ---------- */
  function route() {
    const v = location.hash.slice(1);
    view = ['senate', 'house', 'governor'].includes(v) ? v : 'senate';
    if (filter === 'key' && view === 'house') filter = 'all';
    document.querySelectorAll('#filters button').forEach(b => b.classList.toggle('on', b.dataset.f === filter));
    render();
    if (view === 'governor' && data && Date.now() - live.govAt > 60000) loadGovernors().then(render);
  }
  $('filters').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    filter = b.dataset.f;
    document.querySelectorAll('#filters button').forEach(x => x.classList.toggle('on', x === b));
    renderGrid();
  });
  $('search').addEventListener('input', e => { query = e.target.value; renderGrid(); });
  window.addEventListener('hashchange', route);

  Promise.all([fetch('data/states.json').then(r => r.json()), loadBase()]).then(([g]) => {
    geo = g;
    buildMap();
    route();
    refresh();
    setInterval(refresh, REFRESH_MS);
    setInterval(loadBase, 300000);
  });
})();
