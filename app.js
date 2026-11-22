(() => {
  'use strict';

  const CFG = window.BP_CONFIG;
  const TOKEN_KEY = 'bp_token';
  const app = document.getElementById('app');

  // ───────────── Константы раскладки ─────────────

  const GF = 14;     // суперфинал
  const RESET = 15;  // решающий матч, если суперфинал выиграл игрок нижней сетки
  const STAGES = {
    1: 'Верхняя сетка · 1/4 финала', 2: 'Нижняя сетка · 1-й раунд', 3: 'Верхняя сетка · 1/2 финала',
    4: 'Нижняя сетка · 2-й раунд', 5: 'Финал верхней сетки', 6: 'Нижняя сетка · 3-й раунд',
    7: 'Финал нижней сетки', 8: 'Суперфинал'
  };
  // [колонка, строка] — карточка занимает 2 строки сетки
  const UPPER_LAYOUT = { 1: [1, 1], 2: [1, 3], 3: [1, 5], 4: [1, 7], 7: [2, 2], 8: [2, 6], 11: [3, 4], 14: [4, 4], 15: [4, 1] };
  const LOWER_LAYOUT = { 5: [1, 1], 6: [1, 3], 9: [2, 1], 10: [2, 3], 12: [3, 2], 13: [4, 2] };
  const UPPER_EDGES = [[1, 7], [2, 7], [3, 8], [4, 8], [7, 11], [8, 11], [11, 14]];
  const LOWER_EDGES = [[5, 9], [6, 10], [9, 12], [10, 12], [12, 13]];
  const UPPER_COLS = ['1/4 финала', '1/2 финала', 'Финал верхней', 'Финал турнира'];
  const LOWER_COLS = ['1-й раунд', '2-й раунд', '3-й раунд', 'Финал нижней'];
  const ELIM_PLACE = { 5: '7–8 место', 6: '7–8 место', 9: '5–6 место', 10: '5–6 место', 12: '4 место', 13: '3 место' };
  const TOP4_MATCHES = [11, 12];

  // ───────────── Состояние ─────────────

  let S = null;            // ответ get_state
  let lastJson = '';
  let token = readToken();
  let draft = null;        // черновик прогноза на турнир
  let draftDirty = false;
  let bracketDraft = {};   // черновик сетки пикема: {номер матча: id победителя}
  let bracketDirty = false;
  let modalRender = null;  // функция перерисовки открытой модалки
  let pending = 0;

  function readToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
  function setToken(t) {
    token = t;
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* приватный режим */ }
  }

  // ───────────── API ─────────────

  async function rpc(fn, args = {}) {
    pending++;
    try {
      const res = await fetch(`${CFG.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: CFG.key, Authorization: `Bearer ${CFG.key}` },
        body: JSON.stringify(args)
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { /* не JSON */ }
      if (!res.ok) {
        const err = new Error((data && data.message) || `Ошибка сервера (${res.status})`);
        if (data && data.hint === 'auth') { setToken(null); err.auth = true; }
        throw err;
      }
      return data;
    } catch (e) {
      if (e instanceof TypeError) throw new Error('Нет связи с сервером. Проверьте интернет');
      throw e;
    } finally {
      pending--;
    }
  }

  function applyState(st, force) {
    if (token && !st.me) setToken(null);
    const json = JSON.stringify({ ...st, server_time: null });
    S = st;
    if (!draftDirty) draft = draftFromState();
    if (!bracketDirty) bracketDraft = { ...(st.my_picks || {}) };
    // Не перерисовываем страницу, пока человек печатает в поле (например, в панели организатора)
    const typing = !force && app.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (typing) return;
    if (force || json !== lastJson) {
      lastJson = json;
      render();
      if (modalRender) modalRender();
    }
  }

  async function refresh(silent) {
    try {
      applyState(await rpc('get_state', { p_token: token }));
    } catch (e) {
      if (e.auth) return refresh(silent);
      if (!silent) toast(e.message, 'bad');
      if (!S) app.innerHTML = `<div class="empty">Не удалось загрузить данные турнира.<br><span class="dim">${esc(e.message)}</span><br><br><button class="btn" onclick="location.reload()">Обновить</button></div>`;
    }
  }

  // ───────────── Хелперы ─────────────

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const P = id => (S.players.find(p => p.id === id) || {}).name || '—';
  const M = id => S.matches.find(m => m.id === id);
  const me = () => S && S.me;
  const isPlayer = () => me() && !me().is_admin;
  const myPick = id => (S.my_picks || {})[id];

  function srcLabel(src) {
    const n = src.slice(1);
    return src[0] === 'S' ? `№${n}` : src[0] === 'W' ? `поб. М${n}` : `пр. М${n}`;
  }
  function matchTitle(m) {
    if (m.id === GF) return `Суперфинал · М${GF}`;
    if (m.id === RESET) return `Матч ${RESET} · если нужно`;
    return `Матч ${m.id}`;
  }
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }
  const pts = n => `${n} ${plural(n, 'очко', 'очка', 'очков')}`;

  function playerRecords() {
    const rec = {};
    S.players.forEach(p => { rec[p.id] = { wins: 0, losses: 0, out: null }; });
    S.matches.forEach(m => {
      if (!m.winner) return;
      rec[m.winner].wins++;
      rec[m.loser].losses++;
      if (ELIM_PLACE[m.id]) rec[m.loser].out = ELIM_PLACE[m.id];
    });
    const pl = S.placements || {};
    if (pl['1']) { rec[pl['1']].out = '1 место'; rec[pl['2']].out = '2 место'; }
    return rec;
  }
  function top4Set() {
    const s = new Set();
    TOP4_MATCHES.forEach(id => { const m = M(id); if (m.a) s.add(m.a); if (m.b) s.add(m.b); });
    return s;
  }
  function pickResult(m, pid) {
    if (!pid || !m.winner) return '';
    return pid === m.winner ? 'ok' : 'bad';
  }
  function visibleMatches() {
    // Решающий матч показываем, пока он может понадобиться
    return S.matches.filter(m => m.active || !M(GF).winner);
  }

  // ───────────── Рендер ─────────────

  function route() { return (location.hash.replace(/^#\/?/, '') || 'bracket').split('?')[0]; }
  function routeParam(name) { return new URLSearchParams(location.hash.split('?')[1] || '').get(name); }

  function render() {
    if (!S) return;
    renderHeader();
    const r = route();
    document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('active', a.dataset.route === r));
    const views = { bracket: viewBracket, pickem: viewPickem, leaderboard: viewLeaderboard, rules: viewRules, admin: viewAdmin };
    (views[r] || viewBracket)();
  }

  function renderHeader() {
    const st = S.settings || {};
    document.getElementById('brandTitle').textContent = st.title || 'Турнир по бильярду';
    const sub = [st.date, st.place].filter(Boolean).join(' · ');
    document.getElementById('brandSub').textContent = sub || 'Double elimination · 8 игроков · 14 партий (+1)';
    document.title = `${st.title || 'Турнир по бильярду'} · Пикем`;
    document.getElementById('adminTab').hidden = !(me() && me().is_admin);
    const box = document.getElementById('userbox');
    if (me()) {
      box.innerHTML = `<button class="chip-user" id="profileBtn"><span class="avatar">${esc(me().name[0])}</span><span class="uname">${esc(me().name)}</span></button>`;
      document.getElementById('profileBtn').onclick = openProfile;
    } else {
      box.innerHTML = `<button class="btn primary small" id="loginBtn">Войти</button>`;
      document.getElementById('loginBtn').onclick = openLogin;
    }
  }

  // ── Сетка ──

  function viewBracket() {
    const rec = playerRecords();
    const lb = S.leaderboard || [];
    const done = S.matches.filter(m => m.winner).length;
    const total = M(RESET).active ? 15 : 14;

    app.innerHTML = `
      <div class="hero">
        <div>
          <h1>Сетка турнира</h1>
          <p>Двойное выбывание: два поражения — игрок выбывает. Нажмите на матч, чтобы сделать прогноз или посмотреть детали.</p>
        </div>
        <div class="stats">
          <div class="stat"><b>${done}/${total}</b><span>сыграно партий</span></div>
          <div class="stat"><b>${S.predictions_open ? 'открыт' : 'закрыт'}</b><span>пикем</span></div>
          <div class="stat"><b>${lb.filter(x => x.picked > 0).length}</b><span>участвуют в пикеме</span></div>
        </div>
      </div>

      <div class="section">
        <div class="section-head"><h2>Верхняя сетка</h2><span class="muted">Проигравший переходит в нижнюю сетку — куда, указано в шапке матча</span></div>
        <div class="bracket-wrap"><div class="bracket upper" id="bUpper" style="grid-template-columns:repeat(${UPPER_COLS.length},minmax(200px,1fr))">${bracketCols(UPPER_COLS)}${Object.entries(UPPER_LAYOUT).map(([id, pos]) => matchCard(M(+id), pos)).join('')}</div></div>
      </div>

      <div class="section">
        <div class="section-head"><h2 style="color:var(--lower)">Нижняя сетка</h2><span class="muted">Второе поражение — выбывание. Оранжевым — игроки, пришедшие из верхней сетки</span></div>
        <div class="bracket-wrap"><div class="bracket lower" id="bLower" style="grid-template-columns:repeat(${LOWER_COLS.length},minmax(200px,1fr))">${bracketCols(LOWER_COLS)}${Object.entries(LOWER_LAYOUT).map(([id, pos]) => matchCard(M(+id), pos)).join('')}</div></div>
        <div class="legend">
          ${me() && !me().is_admin ? '<span><i style="background:var(--gold)"></i>мой пикем</span><span><i style="background:var(--ok)"></i>угадал</span><span><i style="background:var(--bad)"></i>мимо</span>' : ''}
          <span>% — доля участников, поставивших на игрока в этом матче (видно после начала турнира)</span>
        </div>
      </div>

      <div class="section grid2">
        <div class="panel">
          <div class="section-head"><h2>Участники</h2></div>
          <table class="tbl">
            <thead><tr><th>№</th><th>Игрок</th><th class="num">В–П</th><th>Статус</th></tr></thead>
            <tbody>${S.players.map(p => {
              const r = rec[p.id];
              const status = r.out ? `<span class="tag ${r.out.startsWith('1') ? 'gold' : ''}">${r.out}</span>`
                : r.losses >= 1 ? '<span class="tag" style="color:var(--lower)">нижняя сетка</span>'
                : '<span class="tag live">верхняя сетка</span>';
              return `<tr><td class="dim">${p.id}</td><td><b>${esc(p.name)}</b></td><td class="num">${r.wins}–${r.losses}</td><td>${status}</td></tr>`;
            }).join('')}</tbody>
          </table>
        </div>
        <div>
          <div class="panel">
            <div class="section-head"><h2>Итоги</h2></div>
            <div class="places">${[1, 2, 3, 4].map(n => {
              const pid = S.placements[String(n)];
              const how = ['', 'поб. суперфинала', 'пр. суперфинала', 'пр. М13', 'пр. М12'][n];
              return `<div class="place"><span class="medal m${n}">${n}</span><span class="who ${pid ? '' : 'dim'}">${pid ? esc(P(pid)) : '—'}</span><span class="how">${how}</span></div>`;
            }).join('')}</div>
          </div>
          <div class="panel" style="margin-top:16px">
            <div class="section-head"><h2>Порядок игр</h2></div>
            <div class="picklist">${Object.entries(STAGES).map(([step, label]) => {
              const ms = visibleMatches().filter(m => m.play_order === +step);
              const allDone = ms.length && ms.every(m => m.winner || !m.active);
              const anyOpen = ms.some(m => m.open || (m.locked && !m.winner));
              return `<div class="pi"><span><span class="dim">${step}.</span> <b>${ms.map(m => 'М' + m.id).join(', ')}</b> <span class="muted">· ${label}</span></span>${allDone ? '<span class="tag ok">✓</span>' : anyOpen ? '<span class="tag gold">сейчас</span>' : ''}</div>`;
            }).join('')}</div>
          </div>
        </div>
      </div>`;

    app.querySelectorAll('.match').forEach(el => { el.onclick = () => openMatch(+el.dataset.match); });
    requestAnimationFrame(drawAllLines);
  }

  function bracketCols(titles) {
    return titles.map((t, i) => `<div class="col-title" style="grid-column:${i + 1}">${t}</div>`).join('');
  }

  function matchCard(m, [col, row]) {
    const totalVotes = m.votes ? Object.values(m.votes).reduce((a, b) => a + b, 0) : 0;
    const row1 = side => {
      const pid = m[side];
      const src = m[side + '_src'];
      const fromUpper = m.bracket === 'lower' && src[0] === 'L';
      const cls = ['prow', fromUpper ? 'from-upper' : '', m.winner && pid === m.winner ? 'win' : '', m.winner && pid === m.loser ? 'lose' : ''].join(' ');
      const mine = isPlayer() && pid && myPick(m.id) === pid ? `<span class="mypick ${pickResult(m, pid)}" title="мой прогноз"></span>` : '';
      const pct = m.votes && pid && totalVotes ? `<span class="pct">${Math.round(100 * (m.votes[pid] || 0) / totalVotes)}%</span>` : '';
      return `<div class="${cls}"><span class="seed">${pid ? '№' + pid : ''}</span><span class="pname ${pid ? '' : 'tbd'}">${pid ? esc(P(pid)) : srcLabel(src)}</span>${mine}${pct}</div>`;
    };
    let right = esc(m.loser_to || '');
    if (m.id === RESET) right = m.active ? 'играется' : (M(GF).winner ? 'не нужен' : '');
    if (m.locked && !m.winner) right = '<span class="openflag">идёт</span>';
    if (m.score) right = `<span class="score">${esc(m.score)}</span>`;
        return `<div class="match ${m.bracket} ${m.active || !M(GF).winner ? '' : 'inactive'}" data-match="${m.id}" style="grid-column:${col};grid-row:${row + 1} / span 2">
      <div class="mh"><span>${matchTitle(m)}</span><span class="to">${right}</span></div>${row1('a')}${row1('b')}</div>`;
  }

  function drawAllLines() {
    drawLines(document.getElementById('bUpper'), UPPER_EDGES, true);
    drawLines(document.getElementById('bLower'), LOWER_EDGES, false);
  }

  function drawLines(grid, edges, withFinal) {
    if (!grid) return;
    grid.querySelector('svg.lines')?.remove();
    const g = grid.getBoundingClientRect();
    const rect = id => grid.querySelector(`[data-match="${id}"]`)?.getBoundingClientRect();
    let d = '';
    edges.forEach(([from, to]) => {
      const a = rect(from), b = rect(to);
      if (!a || !b) return;
      const x1 = a.right - g.left, y1 = a.top + a.height / 2 - g.top;
      const x2 = b.left - g.left, y2 = b.top + b.height / 2 - g.top;
      const mx = x1 + (x2 - x1) / 2;
      d += `M${x1},${y1}H${mx}V${y2}H${x2}`;
    });
    let dashed = '';
    if (withFinal) {
      const a = rect(GF), b = rect(RESET);
      if (a && b) {
        const x = a.left + a.width / 2 - g.left;
        dashed = `<path class="dashed" d="M${x},${a.top - g.top}V${b.bottom - g.top}"/>`;
      }
    }
    grid.insertAdjacentHTML('afterbegin', `<svg class="lines" aria-hidden="true"><path d="${d}"/>${dashed}</svg>`);
  }

  // ── Модалка матча ──

  function openMatch(id) {
    modalRender = () => {
      const m = M(id);
      const picks = (S.revealed_picks || []).filter(p => p.match_id === id);
      const canPick = false;
      const sideBtn = side => {
        const pid = m[side];
        if (!pid) return `<div class="side tbd disabled"><small>${m[side + '_src'][0] === 'S' ? '' : 'ожидается'}</small><b>${srcLabel(m[side + '_src'])}</b></div>`;
        const picked = isPlayer() && myPick(id) === pid;
        const res = picked ? pickResult(m, pid) : '';
        const cls = ['side', canPick ? '' : 'disabled', picked ? 'picked' : '', res, m.winner === pid ? 'won' : '', m.loser === pid ? 'lost' : ''].join(' ');
        return `<div class="${cls}" data-pick="${pid}"><small>№${pid}</small><b>${esc(P(pid))}</b></div>`;
      };
      const byPlayer = pid => picks.filter(p => p.player_id === pid).map(p => {
        const cls = m.winner ? (pid === m.winner ? 'okc' : 'badc') : '';
        return `<span class="${cls}">${esc(p.account)}</span>`;
      });
      let status;
      if (!m.active) status = M(GF).winner ? 'Матч не понадобился: суперфинал выиграл игрок верхней сетки.' : `Играется, только если суперфинал (М${GF}) выиграет игрок из нижней сетки.`;
      else if (m.winner) status = `Победитель: <b>${esc(P(m.winner))}</b>${m.score ? ` · счёт ${esc(m.score)}` : ''}`;
      else if (m.locked) status = 'Матч идёт.';
      else if (m.open) status = 'Матч ещё не начался.';
      else status = 'Участники ещё не определены.';

      document.getElementById('modalBody').innerHTML = `
        <h2>${matchTitle(m)} <span class="muted" style="font-size:13px;font-family:Inter">· ${esc(m.round)}</span></h2>
        <div class="vs-body">${sideBtn('a')}<div class="vs-x">VS</div>${sideBtn('b')}</div>
        <p class="muted" style="margin:14px 0 6px">${status}</p>
        <p class="dim" style="margin:0 0 12px;font-size:13px">За угаданного победителя: +${pts(m.points)}${m.loser_to ? ` · ${esc(m.loser_to)}` : ''}</p>
        ${m.revealed ? `
          <h3 style="margin:14px 0 8px">Кто на кого поставил</h3>
          ${m.a && m.b ? `<div class="picklist">
            <div class="pi"><b>${esc(P(m.a))}</b><span class="muted">${byPlayer(m.a).join(', ') || '—'}</span></div>
            <div class="pi"><b>${esc(P(m.b))}</b><span class="muted">${byPlayer(m.b).join(', ') || '—'}</span></div>
          </div>` : ''}` : '<p class="dim" style="font-size:13px">Сетки участников откроются, когда начнётся турнир.</p>'}`;

    };
    showModal();
    modalRender();
  }

  // ── Мой пикем ──

  function draftFromState() {
    const d = { champion: null, top4: [], zero: [] };
    (S && S.my_predictions || []).slice().sort((a, b) => a.slot - b.slot).forEach(p => {
      if (p.kind === 'champion') d.champion = p.player_id;
      else d[p.kind].push(p.player_id);
    });
    return d;
  }

  // Прогнозная сетка: участники матчей получаются из посева и прогнозов на предыдущие матчи.
  function predictBracket(picks) {
    const w = {}, l = {}, out = {};
    const res = src => src[0] === 'S' ? +src.slice(1) : src[0] === 'W' ? (w[+src.slice(1)] || null) : (l[+src.slice(1)] || null);
    S.matches.slice().sort((a, b) => a.id - b.id).forEach(m => {
      const a = res(m.a_src), b = res(m.b_src);
      const active = !m.reset_of || (w[m.reset_of] != null && w[m.reset_of] === b);
      const p = picks[m.id];
      const win = active && a && b && (p === a || p === b) ? p : null;
      w[m.id] = win;
      l[m.id] = win ? (win === a ? b : a) : null;
      out[m.id] = { a, b, winner: win, loser: l[m.id], active };
    });
    return out;
  }
  function cleanPicks(picks) {
    const pr = predictBracket(picks), c = {};
    Object.keys(picks).forEach(id => { if (pr[id] && pr[id].winner === picks[id]) c[id] = picks[id]; });
    return c;
  }
  function predictedChampion(pr) {
    const gf = pr[GF], rs = pr[RESET];
    if (!gf || !gf.winner) return null;
    if (gf.winner === gf.a) return gf.a;
    return rs && rs.winner ? rs.winner : null;
  }

  function viewPickem() {
    const other = routeParam('u');
    if (!me() && !other) {
      app.innerHTML = `<div class="pk-banner"><div><h1>Пикем</h1><p>Как на мейджоре: до начала турнира заполните всю сетку — выберите победителя каждого матча. Войдите под своим именем.</p></div><button class="btn primary" id="pkLogin">Войти</button></div>`;
      document.getElementById('pkLogin').onclick = openLogin;
      return;
    }
    if (me() && me().is_admin && !other) {
      app.innerHTML = `<div class="pk-banner"><div><h1>Пикем</h1><p>Аккаунт организатора не участвует в пикеме. Сетки участников можно посмотреть в «Таблице» после начала турнира.</p></div><a class="btn primary" href="#/leaderboard">К таблице</a></div>`;
      return;
    }
    const own = !other || (me() && me().name === other);
    const name = own ? me().name : other;
    const open = S.predictions_open;
    if (!own && open) {
      app.innerHTML = `<div class="empty">Сетка участника «${esc(name)}» откроется, когда начнётся турнир.<br><br><a class="btn" href="#/leaderboard">Назад к таблице</a></div>`;
      return;
    }
    let picks;
    if (own) picks = bracketDraft;
    else {
      picks = {};
      (S.revealed_picks || []).filter(p => p.account === name).forEach(p => { picks[p.match_id] = p.player_id; });
    }
    const editable = own && open;
    const pr = predictBracket(picks);
    const needed = S.matches.filter(m => pr[m.id].active).length;
    const filled = S.matches.filter(m => pr[m.id].active && pr[m.id].winner).length;
    const champ = predictedChampion(pr);
    const lb = S.leaderboard || [];
    const row = lb.find(x => x.name === name) || { total: 0, correct: 0, match_pts: 0 };
    const rank = 1 + lb.filter(x => x.total > row.total || (x.total === row.total && x.correct > row.correct)).length;
    const scrolls = [...app.querySelectorAll('.bracket-wrap')].map(e => e.scrollLeft);

    app.innerHTML = `
      <div class="pk-banner">
        <div>
          <h1>Пикем · ${esc(name)}</h1>
          <p>${editable ? 'Нажмите на игрока, который выиграет матч, — он пройдёт дальше, проигравший уйдёт в нижнюю сетку. Сетку можно менять до начала первого матча.'
            : 'Пикем закрыт. Зелёный — угадал победителя матча, красный — мимо.'}</p>
        </div>
        <div class="stats">
          ${open ? `<div class="stat"><b>${filled}/${needed}</b><span>заполнено</span></div>` : `<div class="stat"><b>${row.total}</b><span>${plural(row.total, 'очко', 'очка', 'очков')}</span></div><div class="stat"><b>${rank}<span style="font-size:13px;color:var(--muted)">/${lb.length}</span></b><span>место</span></div>`}
          <div class="stat"><b style="font-size:16px">${champ ? esc(P(champ)) : '—'}</b><span>чемпион по пикему</span></div>
        </div>
      </div>
      ${editable ? `<div class="savebar pk-save" id="pkSave">
        <button class="btn primary" id="saveBracket" ${bracketDirty ? '' : 'disabled'}>Сохранить пикем</button>
        <button class="btn small ghost" id="undoBracket" ${bracketDirty ? '' : 'disabled'}>Отменить изменения</button>
        <button class="btn small ghost" id="clearBracket" ${Object.keys(picks).length ? '' : 'disabled'}>Очистить</button>
        <span class="muted" style="font-size:13px">${bracketDirty ? '<span style="color:var(--gold)">● есть несохранённые изменения</span>' : (filled ? 'Сохранено ✓' : 'Сетка пустая')}</span>
      </div>` : ''}
      ${!own ? `<p style="margin:12px 0 0"><a class="btn small" href="#/leaderboard">← К таблице</a></p>` : ''}

      <div class="section">
        <div class="section-head"><h2>Верхняя сетка</h2></div>
        <div class="bracket-wrap"><div class="bracket upper pickmode" id="bUpper" style="grid-template-columns:repeat(${UPPER_COLS.length},minmax(200px,1fr))">${bracketCols(UPPER_COLS)}${Object.entries(UPPER_LAYOUT).map(([id, pos]) => pickCard(M(+id), pos, pr, editable)).join('')}</div></div>
      </div>
      <div class="section">
        <div class="section-head"><h2 style="color:var(--lower)">Нижняя сетка</h2></div>
        <div class="bracket-wrap"><div class="bracket lower pickmode" id="bLower" style="grid-template-columns:repeat(${LOWER_COLS.length},minmax(200px,1fr))">${bracketCols(LOWER_COLS)}${Object.entries(LOWER_LAYOUT).map(([id, pos]) => pickCard(M(+id), pos, pr, editable)).join('')}</div></div>
        <div class="legend"><span>+N — очки за угаданного победителя матча</span>${open ? '' : '<span><i style="background:var(--ok)"></i>угадал</span><span><i style="background:var(--bad)"></i>мимо</span><span>«факт» — кто выиграл на самом деле</span>'}</div>
      </div>
      ${own ? `<div class="section panel" id="challenge">${challengeHtml()}</div>` : ''}`;

    [...app.querySelectorAll('.bracket-wrap')].forEach((e, i) => { if (scrolls[i]) e.scrollLeft = scrolls[i]; });
    requestAnimationFrame(drawAllLines);
    if (own) bindChallenge();
    if (!editable) return;

    app.querySelectorAll('.prow[data-pp]').forEach(el => {
      el.onclick = () => {
        const mid = +el.dataset.pm, pid = +el.dataset.pp;
        const next = { ...bracketDraft };
        if (next[mid] === pid) delete next[mid]; else next[mid] = pid;
        bracketDraft = cleanPicks(next);
        bracketDirty = true;
        viewPickem();
      };
    });
    document.getElementById('saveBracket').onclick = async ev => {
      ev.target.disabled = true;
      try {
        const st = await rpc('save_bracket', { p_token: token, p_picks: bracketDraft });
        bracketDirty = false;
        applyState(st, true);
        toast('Пикем сохранён', 'ok');
      } catch (e) {
        toast(e.message, 'bad');
        ev.target.disabled = false;
      }
    };
    document.getElementById('undoBracket').onclick = () => { bracketDraft = { ...(S.my_picks || {}) }; bracketDirty = false; viewPickem(); };
    document.getElementById('clearBracket').onclick = () => {
      if (!confirm('Очистить всю сетку? Изменения применятся после «Сохранить».')) return;
      bracketDraft = {}; bracketDirty = true; viewPickem();
    };
  }

  function pickCard(m, [col, row], pr, editable) {
    const p = pr[m.id];
    const decided = !!m.winner;
    const rowHtml = side => {
      const pid = p[side];
      const src = m[side + '_src'];
      const picked = pid && p.winner === pid;
      let cls = 'prow';
      if (m.bracket === 'lower' && src[0] === 'L') cls += ' from-upper';
      // прогноз «сгорел»: реальные участники матча известны, и выбранного игрока среди них нет
      const dead = picked && !decided && m.a && m.b && pid !== m.a && pid !== m.b;
      if (picked) cls += decided ? (pid === m.winner ? ' pk-ok' : ' pk-bad') : dead ? ' pk-bad' : ' picked';
      else if (p.winner) cls += ' pk-other';
      const can = editable && pid && p.active && p.a && p.b;
      return `<div class="${cls}${can ? ' pickable' : ''}" ${can ? `data-pm="${m.id}" data-pp="${pid}"` : ''}>
        <span class="seed">${pid ? '№' + pid : ''}</span>
        <span class="pname ${pid ? '' : 'tbd'}">${pid ? esc(P(pid)) : srcLabel(src)}</span>
        ${picked ? `<span class="pkmark">${decided ? (pid === m.winner ? '✓' : '✗') : dead ? '✗' : '●'}</span>` : ''}
      </div>`;
    };
    let right = `+${m.points}`;
    if (m.id === RESET && !p.active) right = 'если нужно';
    const fact = decided ? `<div class="fact">факт: <b>${esc(P(m.winner))}</b>${m.score ? ' · ' + esc(m.score) : ''}</div>`
      : (!m.active && M(GF).winner ? '<div class="fact">не понадобился</div>' : '');
    return `<div class="match pick ${m.bracket} ${p.active ? '' : 'inactive'}" data-match="${m.id}" style="grid-column:${col};grid-row:${row + 1} / span 2">
      <div class="mh"><span>${matchTitle(m)}</span><span class="to">${right}</span></div>${rowHtml('a')}${rowHtml('b')}${fact}</div>`;
  }

  function challengeHtml() {
    const open = S.predictions_open;
    const rec = playerRecords();
    const t4 = top4Set();
    const pl = S.placements || {};
    const d = draft;
    const verdict = (kind, pid) => {
      if (open) return '';
      const r = rec[pid];
      if (kind === 'champion') return pl['1'] ? (pl['1'] === pid ? 'ok' : 'bad') : (r.losses >= 2 ? 'bad' : '');
      if (kind === 'top4') return t4.has(pid) ? 'ok' : (r.losses >= 2 ? 'bad' : '');
      if (kind === 'zero') return r.wins >= 1 ? 'bad' : (r.losses >= 2 ? 'ok' : '');
      return '';
    };
    const chips = (kind, selected, blocked) => `<div class="players-grid">${S.players.map(p => {
      const sel = selected.includes(p.id);
      const dis = !open || (!sel && blocked.includes(p.id));
      return `<button class="pchip ${sel ? 'sel ' + verdict(kind, p.id) : ''}" data-kind="${kind}" data-pid="${p.id}" ${dis ? 'disabled' : ''}><small>№${p.id}</small><b>${esc(p.name)}</b></button>`;
    }).join('')}</div>`;
    const champSel = d.champion ? [d.champion] : [];
    return `
      <div class="section-head" style="margin-bottom:6px">
        <h2>Бонус-прогноз</h2>
        ${open ? '<span class="tag gold">открыт до начала первого матча</span>' : '<span class="tag">закрыт</span>'}
      </div>
      <p class="muted" style="margin:0 0 16px;font-size:13.5px">Дополнительные очки к сетке: чемпион, четвёрка призёров и те, кто вылетит без побед. Сохраняется отдельно.</p>
      <div class="challenge">
        <div class="ch-row"><h3>🏆 Чемпион <span class="tag gold">5 очков</span></h3><p class="hint">Кто выиграет турнир</p>${chips('champion', champSel, d.zero)}</div>
        <div class="ch-row"><h3>Топ-4 <span class="tag gold">по 1 очку</span> <span class="dim" style="font-size:13px;font-family:Inter">${d.top4.length}/4</span></h3><p class="hint">Кто займёт места с 1-го по 4-е (порядок не важен)</p>${chips('top4', d.top4, d.top4.length >= 4 ? S.players.map(p => p.id) : d.zero)}</div>
        <div class="ch-row"><h3>Вылет с 0–2 <span class="tag gold">по 1 очку</span> <span class="dim" style="font-size:13px;font-family:Inter">${d.zero.length}/2</span></h3><p class="hint">Кто проиграет два матча, не выиграв ни одного</p>${chips('zero', d.zero, d.zero.length >= 2 ? S.players.map(p => p.id) : [...d.top4, ...champSel])}</div>
        ${open ? `<div class="savebar"><button class="btn primary" id="saveChallenge" ${draftDirty ? '' : 'disabled'}>Сохранить прогноз</button>
          <span class="muted" style="font-size:13px">${draftDirty ? 'Есть несохранённые изменения' : (S.my_predictions && S.my_predictions.length ? 'Сохранено ✓' : 'Ещё не заполнен')}</span></div>` : ''}
      </div>`;
  }

  function bindChallenge() {
    const box = document.getElementById('challenge');
    if (!box) return;
    box.querySelectorAll('.pchip').forEach(el => {
      el.onclick = () => {
        const kind = el.dataset.kind, pid = +el.dataset.pid;
        if (kind === 'champion') draft.champion = draft.champion === pid ? null : pid;
        else {
          const arr = draft[kind];
          const i = arr.indexOf(pid);
          if (i >= 0) arr.splice(i, 1); else arr.push(pid);
        }
        draftDirty = true;
        box.innerHTML = challengeHtml();
        bindChallenge();
      };
    });
    const save = document.getElementById('saveChallenge');
    if (save) save.onclick = async () => {
      save.disabled = true;
      try {
        const st = await rpc('save_predictions', { p_token: token, p_champion: draft.champion, p_top4: draft.top4, p_zero: draft.zero });
        draftDirty = false;
        applyState(st, true);
        toast('Бонус-прогноз сохранён', 'ok');
      } catch (e) {
        toast(e.message, 'bad');
        save.disabled = false;
      }
    };
  }

  // ── Таблица пикема ──

  function viewLeaderboard() {
    const lb = S.leaderboard || [];
    let prev = null, rank = 0;
    const rows = lb.map((x, i) => {
      if (!prev || prev.total !== x.total || prev.correct !== x.correct) rank = i + 1;
      prev = x;
      const isMe = me() && me().name === x.name;
      return `<tr class="clickable ${isMe ? 'me' : ''}" data-name="${esc(x.name)}">
        <td><span class="rank ${rank <= 3 && x.total > 0 ? 'r' + rank : ''}">${rank}</span></td>
        <td><span class="lb-name">${esc(x.name)}${isMe ? ' <span class="tag gold">вы</span>' : ''}</span></td>
        <td class="num"><span class="total">${x.total}</span></td>
        <td class="num hide-sm">${x.match_pts}</td>
        <td class="num hide-sm">${x.pred_pts}</td>
        <td class="num"><b class="${x.correct ? 'okc' : 'dim'}">${x.correct}</b></td>
        <td class="num hide-sm">${x.picked}</td>
      </tr>`;
    }).join('');
    const maxPts = S.matches.filter(m => m.active || !M(GF).winner).reduce((a, m) => a + m.points, 0) + 11;
    app.innerHTML = `
      <div class="hero"><div><h1>Таблица пикема</h1><p>Обновляется автоматически после каждого результата. После начала турнира нажмите на участника, чтобы увидеть его сетку.</p></div></div>
      <div class="panel section" style="padding:6px 8px">
        <table class="tbl">
          <thead><tr><th>#</th><th>Участник</th><th class="num">Очки</th><th class="num hide-sm">Сетка</th><th class="num hide-sm">Бонус</th><th class="num">Угадано</th><th class="num hide-sm">Прогнозов</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" class="muted">Пока пусто</td></tr>'}</tbody>
        </table>
      </div>
      <p class="dim" style="font-size:13px">Максимум возможных очков: ${maxPts}. При равенстве очков выше тот, у кого больше угаданных прогнозов. Сетки участников видны после начала турнира.</p>
      <div class="section">
        <div class="section-head"><h2>Кто что угадал</h2><span class="muted">Сетки участников по матчам — открываются, когда начался турнир</span></div>
        <div class="panel" style="padding:10px">${picksGridHtml()}</div>
        <div class="legend"><span><i style="background:var(--ok)"></i>угадал</span><span><i style="background:var(--bad)"></i>мимо</span><span><i style="background:var(--line2)"></i>матч идёт</span><span>— нет прогноза</span></div>
      </div>`;
    app.querySelectorAll('tr[data-name]').forEach(tr => {
      tr.onclick = () => {
        const n = tr.dataset.name;
        if (me() && me().name === n) location.hash = '#/pickem';
        else if (S.predictions_open) toast('Сетки участников откроются, когда начнётся турнир');
        else location.hash = '#/pickem?u=' + encodeURIComponent(n);
      };
    });
  }

  function picksGridHtml() {
    if (S.predictions_open) return '<div class="dim" style="padding:14px;text-align:center">Сводка появится, когда начнётся турнир — до этого сетки участников скрыты.</div>';
    const ms = visibleMatches().sort((a, b) => a.play_order - b.play_order || a.id - b.id);
    const pickOf = {};
    (S.revealed_picks || []).forEach(p => { pickOf[`${p.account}|${p.match_id}`] = p.player_id; });
    const decided = ms.filter(m => m.winner).length;
    const rows = (S.leaderboard || []).map(x => {
      let ok = 0;
      const cells = ms.map(m => {
        const pid = pickOf[`${x.name}|${m.id}`];
        if (!pid) return '<td class="gc none">—</td>';
        let cls = 'pend';
        if (m.winner) { if (pid === m.winner) { ok++; cls = 'ok'; } else cls = 'bad'; }
        return `<td class="gc ${cls}">${esc(P(pid))}</td>`;
      }).join('');
      const isMe = me() && me().name === x.name;
      return { ok, html: `<tr${isMe ? ' class="me"' : ''}><td class="gname">${esc(x.name)}</td>${cells}<td class="gc total"><b class="${ok ? 'okc' : 'dim'}">${ok}</b><span class="dim">/${decided}</span></td></tr>` };
    }).sort((a, b) => b.ok - a.ok);
    const head = ms.map(m => `<th>М${m.id}<small>${m.winner ? esc(P(m.winner)) : 'идёт'}</small></th>`).join('');
    return `<div class="gridwrap"><table class="pgrid"><thead><tr><th class="gname">Участник</th>${head}<th>Угадано</th></tr></thead><tbody>${rows.map(r => r.html).join('')}</tbody></table></div>`;
  }

  function openUser(name) {
    modalRender = () => {
      const picks = (S.revealed_picks || []).filter(p => p.account === name).sort((a, b) => M(a.match_id).play_order - M(b.match_id).play_order || a.match_id - b.match_id);
      const preds = (S.revealed_predictions || []).filter(p => p.account === name);
      const row = S.leaderboard.find(x => x.name === name) || {};
      const own = me() && me().name === name;
      const kindLabel = { champion: 'Чемпион', top4: 'Топ-4', zero: '0–2' };
      document.getElementById('modalBody').innerHTML = `
        <h2>${esc(name)}</h2>
        <div class="stats" style="margin-bottom:14px">
          <div class="stat"><b>${row.total ?? 0}</b><span>очков</span></div>
          <div class="stat"><b>${row.match_pts ?? 0}</b><span>за матчи</span></div>
          <div class="stat"><b>${row.pred_pts ?? 0}</b><span>за турнир</span></div>
        </div>
        <h3 style="margin-bottom:8px">Прогнозы на матчи</h3>
        <div class="picklist">${picks.length ? picks.map(p => {
          const m = M(p.match_id);
          const r = pickResult(m, p.player_id);
          return `<div class="pi"><span><span class="dim">М${m.id}</span> ${m.a ? esc(P(m.a)) : '?'} – ${m.b ? esc(P(m.b)) : '?'}</span><span><b>${esc(P(p.player_id))}</b> ${r === 'ok' ? `<span class="tag ok">+${m.points}</span>` : r === 'bad' ? '<span class="tag bad">0</span>' : '<span class="tag">идёт</span>'}</span></div>`;
        }).join('') : '<div class="dim" style="font-size:13px">Открытых прогнозов пока нет.</div>'}</div>
        <h3 style="margin:16px 0 8px">Прогноз на турнир</h3>
        ${S.predictions_open
          ? `<div class="dim" style="font-size:13px">${own ? 'Ваш прогноз виден только вам до начала турнира.' : 'Откроется после начала турнира.'}</div>`
          : `<div class="picklist">${preds.length ? ['champion', 'top4', 'zero'].map(k => {
              const ps = preds.filter(p => p.kind === k).sort((a, b) => a.slot - b.slot);
              return ps.length ? `<div class="pi"><span class="muted">${kindLabel[k]}</span><b>${ps.map(p => esc(P(p.player_id))).join(', ')}</b></div>` : '';
            }).join('') : '<div class="dim" style="font-size:13px">Не заполнен.</div>'}</div>`}`;
    };
    showModal();
    modalRender();
  }

  // ── Правила ──

  function viewRules() {
    const byPts = {};
    S.matches.forEach(m => { (byPts[m.points] = byPts[m.points] || []).push('М' + m.id); });
    app.innerHTML = `
      <div class="hero"><div><h1>Правила</h1><p>Турнир и пикем — коротко и по делу.</p></div></div>
      <div class="rules section">
        <div class="panel">
          <h2>Турнир</h2>
          <ul>
            <li>Двойное выбывание: <b>два поражения — игрок выбывает</b>.</li>
            <li>Все 8 игроков начинают с 1/4 финала. Пары по силе: 1–8, 4–5, 2–7, 3–6.</li>
            <li>Проигравший в верхней сетке переходит в нижнюю — куда, указано в шапке матча.</li>
            <li>В суперфинале (М14) играют победители верхней (М11) и нижней (М13) сеток.</li>
            <li>Если М14 выигрывает игрок из нижней сетки, у обоих по одному поражению — играется <b>М15</b>.</li>
            <li>1 место — победитель суперфинала, 2 — проигравший, 3 — проигравший М13, 4 — проигравший М12, 5–6 — проигравшие М9/М10, 7–8 — проигравшие М5/М6.</li>
          </ul>
        </div>
        <div class="panel">
          <h2>Пикем</h2>
          <ol>
            <li>Войдите под своим именем и паролем от организатора. Пароль можно сменить в профиле.</li>
            <li>Как на мейджоре: <b>до начала турнира заполните всю сетку</b> — в каждом матче выберите победителя. Он проходит дальше, проигравший уходит в нижнюю сетку.</li>
            <li>Сетку можно менять сколько угодно, пока не начат первый матч. Потом она закрывается для всех.</li>
            <li>Очки дают за каждый матч, где угадан победитель — даже если по вашей сетке в этом матче играл кто-то другой, важно, кого вы поставили победителем.</li>
            <li>Чужие сетки и проценты «кто за кого» открываются, когда начинается турнир.</li>
            <li>Бонус-прогноз (чемпион, топ-4, вылет с 0–2) — дополнительные очки, закрывается тогда же.</li>
            <li>Можно ставить и на себя, и против себя.</li>
          </ol>
        </div>
        <div class="panel">
          <h2>Очки за матчи</h2>
          <table class="tbl"><tbody>
            ${Object.keys(byPts).sort((a, b) => a - b).map(p => `<tr><td><b>+${pts(+p)}</b></td><td class="muted">${byPts[p].join(', ')}</td></tr>`).join('')}
          </tbody></table>
        </div>
        <div class="panel">
          <h2>Бонус-прогноз</h2>
          <table class="tbl"><tbody>
            <tr><td><b>+5 очков</b></td><td class="muted">угаданный чемпион</td></tr>
            <tr><td><b>+1 очко</b></td><td class="muted">за каждого угаданного игрока в топ-4 (до 4 очков)</td></tr>
            <tr><td><b>+1 очко</b></td><td class="muted">за каждого угаданного игрока, вылетевшего с 0–2 (до 2 очков)</td></tr>
          </tbody></table>
          <p class="dim" style="font-size:13px;margin-bottom:0">При равенстве очков выше тот, у кого больше угаданных прогнозов.</p>
        </div>
      </div>`;
  }

  // ── Организатор ──

  const scoreDraft = {};

  function viewAdmin() {
    if (!me() || !me().is_admin) {
      app.innerHTML = '<div class="empty">Раздел только для организатора.</div>';
      return;
    }
    const st = S.settings || {};
    const ms = S.matches.slice().sort((a, b) => a.play_order - b.play_order || a.id - b.id);
    app.innerHTML = `
      <div class="hero"><div><h1>Панель организатора</h1><p>Вносите результаты — сетка и таблица пикема пересчитаются сами.</p></div></div>

      <div class="panel section">
        <div class="section-head"><h2>Матчи</h2><span class="muted">Первое «Начать матч» или первый результат закрывает пикем для всех.</span></div>
        ${ms.map(m => {
          const ready = m.active && m.a && m.b;
          const sc = scoreDraft[m.id] ?? m.score ?? '';
          return `<div class="adm-match">
            <div><b>М${m.id}</b><div class="dim" style="font-size:12px">${STAGES[m.play_order].replace('Верхняя сетка · ', 'Верх · ').replace('Нижняя сетка · ', 'Низ · ')}</div></div>
            <div>${m.a ? esc(P(m.a)) : `<span class="dim">${srcLabel(m.a_src)}</span>`} <span class="dim">vs</span> ${m.b ? esc(P(m.b)) : `<span class="dim">${srcLabel(m.b_src)}</span>`}
              <div style="margin-top:3px">${!m.active ? '<span class="tag">не нужен</span>' : m.winner ? `<span class="tag ok">победил ${esc(P(m.winner))}</span>` : m.locked ? '<span class="tag live">идёт</span>' : ready ? '<span class="tag">не начат</span>' : '<span class="tag">ожидание</span>'}</div>
            </div>
            <div class="adm-btns">
              ${ready ? `
                <button class="btn small ${m.winner === m.a ? 'sel' : ''}" data-win="${m.id}" data-pid="${m.a}">✓ ${esc(P(m.a))}</button>
                <button class="btn small ${m.winner === m.b ? 'sel' : ''}" data-win="${m.id}" data-pid="${m.b}">✓ ${esc(P(m.b))}</button>
                <input class="input" placeholder="счёт" data-score="${m.id}" value="${esc(sc)}" maxlength="20">
                ${m.winner ? `<button class="btn small danger" data-clear="${m.id}">Сбросить</button>`
                  : `<button class="btn small" data-lock="${m.id}" data-val="${m.locked ? 0 : 1}">${m.locked ? 'Отменить начало' : 'Начать матч'}</button>`}` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>

      <div class="grid2 section">
        <div class="panel">
          <div class="section-head"><h2>Настройки</h2></div>
          <label class="field"><span>Название</span><input class="input" id="sTitle" value="${esc(st.title)}" maxlength="80"></label>
          <div class="form-row">
            <label class="field"><span>Дата</span><input class="input" id="sDate" value="${esc(st.date)}" placeholder="например, 29 ноября, 18:00" maxlength="60"></label>
            <label class="field"><span>Место</span><input class="input" id="sPlace" value="${esc(st.place)}" placeholder="клуб, адрес" maxlength="80"></label>
          </div>
          <div class="savebar"><button class="btn primary" id="sSave">Сохранить</button></div>
          <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
          <div class="savebar">
            <span>Пикем: ${S.predictions_open ? '<span class="tag gold">открыт</span>' : '<span class="tag">закрыт</span>'}</span>
            <button class="btn small" id="sPred">${st.predictions_locked === 'true' ? 'Снять ручную блокировку' : 'Закрыть вручную'}</button>
          </div>
          <p class="dim" style="font-size:12.5px;margin-bottom:0">Он закрывается автоматически, как только начат или сыгран любой матч.</p>
        </div>
        <div class="panel">
          <div class="section-head"><h2>Сброс пароля</h2></div>
          <label class="field"><span>Участник</span><select class="input" id="rpName">${S.accounts.map(a => `<option>${esc(a.name)}</option>`).join('')}</select></label>
          <label class="field"><span>Новый пароль (от 6 символов)</span><input class="input" id="rpPass" autocomplete="new-password"></label>
          <div class="savebar"><button class="btn" id="rpBtn">Установить пароль</button></div>
        </div>
      </div>`;

    app.querySelectorAll('[data-score]').forEach(el => { el.oninput = () => { scoreDraft[el.dataset.score] = el.value; }; });
    app.querySelectorAll('[data-win]').forEach(el => {
      el.onclick = async () => {
        const id = +el.dataset.win, pid = +el.dataset.pid, m = M(id);
        if (m.winner && m.winner !== pid && !confirm(`Сменить победителя М${id}? Зависящие от него результаты, ставшие невозможными, будут сброшены.`)) return;
        const score = scoreDraft[id] ?? m.score ?? '';
        await adminCall('admin_set_result', { p_match: id, p_winner: pid, p_score: score }, `М${id}: победил ${P(pid)}`);
        delete scoreDraft[id];
      };
    });
    app.querySelectorAll('[data-clear]').forEach(el => {
      el.onclick = async () => {
        const id = +el.dataset.clear;
        if (!confirm(`Сбросить результат М${id}? Результаты следующих матчей с участием победителя тоже сбросятся.`)) return;
        await adminCall('admin_set_result', { p_match: id, p_winner: null, p_score: null }, `Результат М${id} сброшен`);
      };
    });
    app.querySelectorAll('[data-lock]').forEach(el => {
      el.onclick = () => adminCall('admin_set_lock', { p_match: +el.dataset.lock, p_locked: el.dataset.val === '1' },
        el.dataset.val === '1' ? `М${el.dataset.lock}: матч начат` : `М${el.dataset.lock}: начало отменено`);
    });
    document.getElementById('sSave').onclick = async () => {
      const vals = { title: document.getElementById('sTitle').value.trim(), date: document.getElementById('sDate').value.trim(), place: document.getElementById('sPlace').value.trim() };
      for (const [k, v] of Object.entries(vals)) {
        if ((st[k] || '') !== v) await adminCall('admin_set_setting', { p_key: k, p_value: v });
      }
      toast('Настройки сохранены', 'ok');
    };
    document.getElementById('sPred').onclick = () => adminCall('admin_set_setting', { p_key: 'predictions_locked', p_value: st.predictions_locked === 'true' ? 'false' : 'true' }, 'Готово');
    document.getElementById('rpBtn').onclick = async () => {
      const name = document.getElementById('rpName').value, pass = document.getElementById('rpPass').value;
      try {
        await rpc('admin_reset_password', { p_token: token, p_name: name, p_new: pass });
        document.getElementById('rpPass').value = '';
        toast(`Пароль для «${name}» обновлён`, 'ok');
      } catch (e) { toast(e.message, 'bad'); }
    };
  }

  async function adminCall(fn, args, okMsg) {
    try {
      applyState(await rpc(fn, { p_token: token, ...args }), true);
      if (okMsg) toast(okMsg, 'ok');
    } catch (e) {
      toast(e.message, 'bad');
      if (e.auth) refresh(true);
    }
  }

  // ───────────── Вход и профиль ─────────────

  function openLogin() {
    modalRender = null;
    const accs = S.accounts || [];
    document.getElementById('modalBody').innerHTML = `
      <h2>Вход</h2>
      <form id="loginForm" autocomplete="on">
        <label class="field"><span>Кто вы</span>
          <select class="input" id="lName" name="username" autocomplete="username">
            ${accs.map(a => `<option value="${esc(a.name)}">${a.is_admin ? esc(a.name) : `№${a.player_id} · ${esc(a.name)}`}</option>`).join('')}
          </select></label>
        <label class="field"><span>Пароль</span><input class="input" id="lPass" type="password" name="password" autocomplete="current-password" required></label>
        <div class="err" id="lErr"></div>
        <button class="btn primary" style="width:100%" type="submit" id="lBtn">Войти</button>
      </form>
      <p class="dim" style="font-size:12.5px;margin:12px 0 0">Пароль выдаёт организатор. Забыли — попросите его сбросить.</p>`;
    showModal();
    setTimeout(() => document.getElementById('lPass').focus(), 30);
    document.getElementById('loginForm').onsubmit = async ev => {
      ev.preventDefault();
      const btn = document.getElementById('lBtn'), err = document.getElementById('lErr');
      btn.disabled = true; err.textContent = '';
      try {
        const r = await rpc('login', { p_name: document.getElementById('lName').value, p_password: document.getElementById('lPass').value });
        if (r.error) throw new Error(r.error);
        setToken(r.token);
        draftDirty = false; bracketDirty = false;
        hideModal();
        await refresh();
        toast(`Привет, ${r.name}!`, 'ok');
        if (r.is_admin) location.hash = '#/admin';
        else if (route() === 'bracket') location.hash = '#/pickem';
      } catch (e) {
        err.textContent = e.message;
        btn.disabled = false;
      }
    };
  }

  function openProfile() {
    modalRender = null;
    document.getElementById('modalBody').innerHTML = `
      <h2>${esc(me().name)}</h2>
      <form id="pwForm">
        <h3 style="margin-bottom:10px">Сменить пароль</h3>
        <label class="field"><span>Текущий пароль</span><input class="input" id="pOld" type="password" autocomplete="current-password" required></label>
        <label class="field"><span>Новый пароль (от 6 символов)</span><input class="input" id="pNew" type="password" autocomplete="new-password" minlength="6" required></label>
        <label class="field"><span>Повторите новый пароль</span><input class="input" id="pNew2" type="password" autocomplete="new-password" minlength="6" required></label>
        <div class="err" id="pErr"></div>
        <div class="savebar"><button class="btn primary" type="submit">Сменить пароль</button><button class="btn ghost" type="button" id="logoutBtn">Выйти</button></div>
      </form>`;
    showModal();
    document.getElementById('pwForm').onsubmit = async ev => {
      ev.preventDefault();
      const err = document.getElementById('pErr');
      const n1 = document.getElementById('pNew').value, n2 = document.getElementById('pNew2').value;
      if (n1 !== n2) { err.textContent = 'Пароли не совпадают'; return; }
      try {
        await rpc('change_password', { p_token: token, p_old: document.getElementById('pOld').value, p_new: n1 });
        hideModal();
        toast('Пароль изменён', 'ok');
      } catch (e) { err.textContent = e.message; }
    };
    document.getElementById('logoutBtn').onclick = async () => {
      try { await rpc('logout', { p_token: token }); } catch { /* всё равно выходим */ }
      setToken(null);
      draftDirty = false; bracketDirty = false;
      hideModal();
      await refresh();
      toast('Вы вышли');
    };
  }

  // ───────────── Модалка, тосты ─────────────

  const modal = document.getElementById('modal');
  function showModal() { modal.hidden = false; }
  function hideModal() { modal.hidden = true; modalRender = null; }
  modal.addEventListener('click', e => { if (e.target.hasAttribute('data-close')) hideModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) hideModal(); });

  function toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  // ───────────── Старт ─────────────

  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  window.addEventListener('beforeunload', e => { if (bracketDirty) { e.preventDefault(); e.returnValue = ''; } });
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (route() === 'bracket') drawAllLines(); }, 120); });
  setInterval(() => {
    if (document.visibilityState === 'visible' && pending === 0 && (modal.hidden || modalRender)) refresh(true);
  }, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(true); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (route() === 'bracket') drawAllLines(); });

  refresh();
})();
