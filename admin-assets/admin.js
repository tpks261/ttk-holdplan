'use strict';
(() => {
  const M = window.TTKAdmin;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const levels = ['', 'Begynder', 'Let øvet', 'Øvet', 'Meget øvet', 'Elite'];
  const state = { season: 'winter', view: 'dashboard', players: [], schedule: [], assignments: {}, selected: null, filter: 'all', query: '', day: 'Mandag', hold: null, busy: false, loaded: false, defaults: null, raw: {}, csv: null };
  const seasonLabel = () => state.season === 'winter' ? 'Vinter' : 'Sommer';
  const done = p => p.a.length >= M.hours(p);
  const mismatch = p => M.outsideWishes(p, state.schedule);
  const count = id => Object.values(state.assignments).filter(v => M.holds(v).includes(id)).length;
  const holdInfo = id => state.schedule.find(h => h.id === String(id));
  const selected = () => state.players.find(p => p.n === state.selected);
  const visible = () => state.players.filter(p => M.nameKey(p.n).includes(M.nameKey(state.query)) && (state.filter === 'all' || state.filter === 'pending' && !done(p) || state.filter === 'done' && done(p) || state.filter === 'mismatch' && mismatch(p)));
  function status(message, type = '') { $('save-status').textContent = message; $('save-status').className = 'feedback ' + type; }
  function busy(value) {
    state.busy = value;
    $('workspace').setAttribute('aria-busy', String(value));
    document.querySelectorAll('#season-app button,#season-app input,#season-app select,#season-app textarea').forEach(el => {
      if (value) { el.dataset.wasDisabled = String(el.disabled); el.disabled = true; }
      else if (el.dataset.wasDisabled !== undefined) { el.disabled = el.dataset.wasDisabled === 'true'; delete el.dataset.wasDisabled; }
    });
  }
  async function api(payload, season = state.season) {
    const res = await fetch('/api/admin/backend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, season }) });
    let data;
    try { data = await res.json(); } catch (_) { throw new Error('Serveren svarede ikke med gyldige data. Prøv Genindlæs.'); }
    if (!res.ok || !data.ok) throw new Error(data.error || 'Kunne ikke fuldføre handlingen');
    return data;
  }
  function adopt(data) {
    if (!Array.isArray(data.players) || !data.assignments || typeof data.assignments !== 'object') throw new Error('Ugyldige spillerdata fra serveren.');
    if (data.season && data.season !== state.season) throw new Error('Serveren returnerede en anden sæson. Intet er ændret.');
    const settings = data.adminSettings?.holds || {};
    state.schedule = state.defaults[state.season].map(h => ({ ...h, ...(settings[h.id] || {}) }));
    (data.extraHolds || []).forEach(id => {
      id = String(id);
      const original = state.schedule.find(h => h.id === M.base(id));
      if (original && !holdInfo(id)) state.schedule.push({ ...original, id, ...(settings[id] || {}) });
    });
    state.assignments = data.assignments;
    state.players = data.players.map(p => {
      const assignment = M.assignmentFor(p.n, data.assignments);
      return { ...p, a: assignment.holds, assignmentKey: assignment.key };
    }).sort((a, b) => a.n.localeCompare(b.n, 'da'));
    state.raw = data;
    state.loaded = true;
    if (!selected()) state.selected = state.players[0]?.n || null;
    if (!holdInfo(state.hold)) state.hold = state.schedule[0]?.id;
  }
  async function load() {
    if (state.busy) return;
    busy(true); status('Henter ' + seasonLabel().toLowerCase() + 'data…', 'saving');
    try { adopt(await api({ type: 'load' })); status(seasonLabel() + ' · ' + state.players.length + ' spillere hentet', 'saved'); }
    catch (e) { state.loaded = false; status(e.message, 'error'); }
    finally { busy(false); render(); }
  }
  async function mutate(payload, message) {
    if (state.busy) return;
    busy(true); status('Gemmer i ' + seasonLabel().toLowerCase() + '…', 'saving');
    let saved = false;
    try {
      await api(payload); saved = true;
      adopt(await api({ type: 'load' }));
      status(message + ' · ' + seasonLabel(), 'saved');
    } catch (e) {
      // A failed/uncertain save must never masquerade as success or leave optimistic assignments visible.
      state.loaded = false;
      status((saved ? 'Ændringen er gemt, men genindlæsning fejlede. ' : 'Handlingen kunne ikke bekræftes. ') + e.message + ' Brug Genindlæs før du fortsætter.', 'error');
    } finally { busy(false); render(); }
  }
  const button = (text, attrs = '') => `<button class="custom-hold-btn" ${attrs}>${text}</button>`;
  function filters() { return `<div class="filter-row">${[['all', 'Alle'], ['pending', 'Mangler'], ['done', 'Færdige'], ['mismatch', 'Matcher ikke']].map(([id, text]) => `<button class="filter-chip ${state.filter === id ? 'active' : ''}" data-filter="${id}" aria-pressed="${state.filter === id}">${text}</button>`).join('')}</div>`; }
  function list() {
    const el = $('player-list'); if (!el) return;
    el.innerHTML = visible().map(p => `<button class="player-item ${p.n === state.selected ? 'active' : ''}" data-player="${esc(p.n)}"><div><strong>${esc(p.n)}</strong><small>${esc(p.age || 'Alder ukendt')}${p.age ? ' år' : ''} · ${p.a.length}/${M.hours(p)} hold</small><small>${mismatch(p) ? '⚠ Matcher ikke ønsker' : done(p) ? '✓ Færdig' : 'Mangler tildeling'}</small></div></button>`).join('') || '<div class="empty">Ingen spillere matcher.</div>';
  }
  function metrics() {
    return `<div class="metrics">${[['all', state.players.length, 'Spillere'], ['done', state.players.filter(done).length, 'Færdige'], ['pending', state.players.filter(p => !done(p)).length, 'Mangler tildeling'], ['mismatch', state.players.filter(mismatch).length, 'Matcher ikke ønsker']].map(([f, n, text]) => `<button class="metric" data-filter="${f}" aria-label="${text}: ${n}"><span>${text}</span><strong>${n}</strong></button>`).join('')}</div>`;
  }
  function dashboardPanels() {
    const mismatches = state.players.filter(mismatch);
    const swaps = (state.raw.swapRequests || []).filter(r => !r.status || r.status === 'pending');
    const filled = state.schedule.filter(h => count(h.id) >= h.capacity);
    const formatHold = id => { const h = holdInfo(id); return 'Hold ' + esc(id) + (h ? ' · ' + h.day + ' ' + h.time : ''); };
    return `<div class="dashboard-panels"><section class="box"><div class="line"><h2>Matcher ikke ønsker · ${mismatches.length}</h2>${button('Se alle', 'data-filter="mismatch"')}</div><div class="plain-list">${mismatches.slice(0, 8).map(p => `<button data-player="${esc(p.n)}">${esc(p.n)}<small class="muted"> · ${p.a.map(formatHold).join(', ')}</small></button>`).join('') || 'Ingen kendte mismatch'}</div></section><section class="box"><div class="line"><h2>Holdbytteanmodninger · ${swaps.length}</h2>${button('Gennemgå', 'data-view="swaps"')}</div><div class="plain-list">${swaps.slice(0, 6).map(r => `<button data-view="swaps">${esc(r.name)}<br><span class="muted">Fra ${formatHold(r.fromHold)} → ${formatHold(r.toHold)}</span></button>`).join('') || 'Ingen holdbytter afventer'}</div></section><section class="box"><h2>Næste handlinger</h2><div class="plain-list">${button('Åbn skemavisning', 'data-view="schedule"')}${button('Tilføj spiller manuelt', 'data-view="add"')}${button('Tjek holdkapacitet · ' + filled.length + ' fyldte hold', 'data-view="settings"')}</div></section></div>`;
  }
  function dayTabs() { return `<div class="schedule-days">${[...new Set(state.schedule.map(h => h.day))].map(day => `<button data-day="${day}" class="${day === state.day ? 'active' : ''}">${day}</button>`).join('')}</div>`; }
  function schedulePanel(full = false) {
    const h = holdInfo(state.hold);
    const roster = h ? Object.entries(state.assignments).filter(([, v]) => M.holds(v).includes(h.id)).map(([n]) => state.players.find(p => p.assignmentKey === n)?.n || n) : [];
    return `<h2>${seasonLabel()} · Holdoversigt</h2>${dayTabs()}<div class="${full ? 'schedule-grid' : ''}">${state.schedule.filter(h => h.day === state.day).map(h => `<button class="hold-button ${h.id === state.hold ? 'selected' : ''}" data-roster="${esc(h.id)}"><span class="count">${count(h.id)}/${h.capacity}</span><strong>Hold ${esc(h.id)}</strong><small>${h.time} · ${esc(h.court)}</small>${count(h.id) > h.capacity ? '<small>⚠ Over kapacitet</small>' : ''}</button>`).join('')}</div>${h ? `<div class="roster"><h3>Hold ${esc(h.id)} · ${h.day} ${h.time}</h3><div class="plain-list">${roster.map(n => `<button data-player="${esc(n)}">${esc(n)}${(() => { const player = state.players.find(p => p.n === n); return player ? '<br><span class="muted">' + (player.age ? esc(player.age) + ' år · ' : '') + player.a.map(id => 'Hold ' + esc(id)).join(', ') + '</span>' : ''; })()}</button>`).join('') || '<p class="muted">Ingen spillere på holdet endnu.</p>'}</div></div>` : ''}`;
  }
  function holdChoice(h, p, wishes) {
    const on = p.a.includes(h.id), full = count(h.id) >= h.capacity;
    return `<button class="hold-button ${on ? 'selected' : ''}" data-assign="${esc(h.id)}" aria-pressed="${on}" ${!on && (full || p.a.length >= M.hours(p)) ? 'disabled' : ''}><span class="count">${count(h.id)}/${h.capacity}</span><strong>${on ? '✓ ' : ''}Hold ${esc(h.id)}${h.group ? ' · ' + esc(h.group) : ''}</strong><small>${h.day} ${h.time} · ${esc(h.court)}</small><small>${on ? 'Tildelt · klik for at fjerne' : full ? 'Holdet er fyldt' : wishes.includes(h.id) ? 'Matcher ønske' : 'Manuel tildeling'}</small></button>`;
  }
  function detail() {
    const p = selected(); if (!p) return '<div class="empty">Vælg en spiller fra listen.</div>';
    const wishes = M.wishIds(p, state.schedule), filtered = visible(), index = filtered.indexOf(p);
    return `<div class="detail-header"><div><div class="dh-name">${esc(p.n)}</div><div class="dh-meta">${M.hours(p)} timer/uge${p.age ? ' · ' + esc(p.age) + ' år' : ''}${p.p ? ' · ' + esc(p.p) + ' kr./sæson' : ''}</div><div class="dh-meta">Tildelt ${p.a.length}/${M.hours(p)} hold: ${p.a.map(esc).join(', ') || 'Ingen endnu'}</div></div></div>
    <label class="level-field">Niveau<select id="level">${[...new Set([...levels, p.level || ''])].map(l => `<option value="${esc(l)}" ${l === (p.level || '') ? 'selected' : ''}>${esc(l || 'Vælg niveau')}</option>`).join('')}</select></label>
    ${p.note ? `<div class="warning"><strong>Besked fra forældre</strong><div class="note-text">${esc(p.note)}</div></div>` : ''}
    ${mismatch(p) ? '<div class="warning">⚠ Tildelingen matcher ikke spillerens registrerede ønsker.</div>' : ''}
    ${(p.dw || []).length ? `<p class="muted">Dag-/tidsønsker: ${p.dw.map(w => esc(M.formatWish(w))).join(' · ')}</p>` : ''}
    <div class="wish-title">Spillerens ønskede hold</div>${wishes.length ? state.schedule.filter(h => wishes.includes(h.id)).map(h => holdChoice(h, p, wishes)).join('') : '<p class="muted">Ingen holdforslag ud fra de registrerede ønsker. Se beskeden og vælg manuelt.</p>'}
    ${p.a.filter(id => !holdInfo(id)).map(id => `<div class="warning">Tildelt hold ${esc(id)} findes ikke i denne sæsons skema. Tildelingen er bevaret. ${button('Fjern dette hold', `data-remove="${esc(id)}"`)}</div>`).join('')}
    <details><summary>Andre hold · manuel tildeling</summary>${state.schedule.filter(h => !wishes.includes(h.id)).map(h => holdChoice(h, p, wishes)).join('')}</details>
    <form id="manual-assignment" class="custom-hold"><label for="manual-hold">Tildel et andet hold manuelt</label><div class="custom-hold-row"><input id="manual-hold" name="hold" inputmode="decimal" placeholder="fx 2" required>${button('Tildel', 'type="submit"')}</div></form>${p.a.length ? button('Fjern alle tildelinger', 'id="clear"') : ''}<div class="nav-row"><button class="nav-btn" data-step="-1" ${index <= 0 ? 'disabled' : ''}>← Forrige</button><button class="nav-btn primary" data-step="1" ${index < 0 || index >= filtered.length - 1 ? 'disabled' : ''}>Næste →</button></div>`;
  }
  function render() {
    document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
    $('progress-text').textContent = `${seasonLabel()} · ${state.players.filter(done).length}/${state.players.length} færdige`;
    $('progress-bar').style.width = (state.players.length ? 100 * state.players.filter(done).length / state.players.length : 0) + '%';
    const work = $('workspace');
    if (!state.loaded) { work.innerHTML = '<div class="empty">Data er ikke indlæst. Brug Genindlæs for at prøve igen.</div>'; return; }
    if (state.view === 'dashboard') {
      const missing = state.players.filter(p => !done(p));
      work.innerHTML = `<section class="pane"><h2>${seasonLabel()} · Dashboard</h2>${metrics()}<div class="box"><div class="line"><h2>Mangler tildeling</h2>${button('Se alle', 'data-filter="pending"')}</div><div class="plain-list">${missing.slice(0, 8).map(p => `<button data-player="${esc(p.n)}">${esc(p.n)} · ${p.a.length}/${M.hours(p)} hold</button>`).join('') || 'Alle spillere har fået deres hold.'}</div></div>${dashboardPanels()}<div class="box">${schedulePanel(true)}</div></section>`;
    } else if (state.view === 'players') {
      work.innerHTML = `<div class="work-layout"><aside class="work-sidebar"><div class="sidebar-search"><input id="search" type="search" aria-label="Søg spiller" placeholder="Søg spiller…" value="${esc(state.query)}">${filters()}</div><div id="player-list"></div></aside><section class="work-main">${detail()}</section><aside class="work-schedule">${schedulePanel()}</aside></div>`; list();
    } else if (state.view === 'schedule') work.innerHTML = `<section class="pane"><div class="box">${schedulePanel(true)}</div></section>`;
    else if (state.view === 'settings') {
      const enabled = state.raw.capabilities?.adminSettings;
      work.innerHTML = `<section class="pane"><h2>Baner og kapacitet · ${seasonLabel()}</h2><p class="muted">Ændrer kun holdenes indstillinger. Spillere og tildelinger bevares.</p>${enabled ? '' : '<div class="warning">For at gemme baner og kapacitet skal den nye Apps Script-version først aktiveres. Indtil da vises de eksisterende standardindstillinger.</div>'}${state.schedule.map(h => `<form class="setting-row" data-settings="${esc(h.id)}"><div><strong>Hold ${esc(h.id)} · ${h.day} ${h.time}</strong><p class="muted">${count(h.id)} spillere tildelt</p></div><label>Bane / spillested<input name="court" value="${esc(h.court)}" maxlength="100" required ${!enabled ? 'disabled' : ''}></label><label>Maks. spillere<input name="capacity" type="number" min="1" max="100" step="1" value="${h.capacity}" required ${!enabled ? 'disabled' : ''}></label><button class="custom-hold-btn" ${!enabled ? 'disabled' : ''}>Gem</button>${count(h.id) > h.capacity ? '<div class="warning">⚠ Over kapacitet. Ingen tildelinger er fjernet.</div>' : ''}</form>`).join('')}</section>`;
    } else if (state.view === 'add') work.innerHTML = `<section class="pane"><div class="box"><h2>Tilføj spiller · ${seasonLabel()}</h2><form id="add-player"><div class="fields"><label>Navn<input name="name" required maxlength="150"></label><label>Alder<input name="age" type="number" min="1" max="100"></label><label>Timer/uge<input name="hours" type="number" min="1" max="7" value="1" required></label><label>Niveau<select name="level">${levels.map(l => `<option value="${l}">${l || 'Vælg niveau'}</option>`).join('')}</select></label><label>Besked / ønsker<textarea name="note" maxlength="2000"></textarea></label></div><button class="custom-hold-btn">Tilføj spiller</button></form></div></section>`;
    else if (state.view === 'csv') work.innerHTML = `<section class="pane"><div class="box"><h2>Upload CSV · ${seasonLabel()}</h2><p class="muted">Kun nye spillere importeres. Spillere, der allerede findes, springes over. Eksisterende ønsker, niveauer og tildelinger overskrives ikke.</p><div class="fields"><label>CSV-fil<input id="csv-file" type="file" accept=".csv,text/csv"></label></div><div class="csv-preview" id="csv-preview"></div></div></section>`;
    else if (state.view === 'swaps') work.innerHTML = `<section class="pane"><h2>Holdbytte · ${seasonLabel()}</h2>${(state.raw.swapRequests || []).map((r, i) => `<div class="box"><h3>${esc(r.name)}</h3><p>Hold ${esc(r.fromHold)} → Hold ${esc(r.toHold)}</p>${button('Godkend', `data-review="${i}" data-decision="approved"`)} ${button('Afvis', `data-review="${i}" data-decision="rejected"`)}</div>`).join('') || '<div class="box">Ingen afventende anmodninger.</div>'}</section>`;
    if (state.view === 'settings' && (state.raw.extraHoldOptions || []).length) {
      work.querySelector('.pane').insertAdjacentHTML('beforeend', `<div class="box"><h2>Ekstra hold</h2><div class="plain-list">${state.raw.extraHoldOptions.map(h => button((h.active ? 'Deaktivér' : 'Aktivér') + ' hold ' + esc(h.hold), `data-extra="${esc(h.hold)}" ${h.active && count(String(h.hold)) ? 'disabled' : ''}`)).join('')}</div><p class="muted">Et ekstrahold med spillere kan ikke deaktiveres.</p></div>`);
    }
  }
  async function assign(id, removeOnly = false) {
    const p = selected(); if (!p) return;
    let next = p.a.filter(h => h !== id);
    if (!p.a.includes(id) && !removeOnly) {
      if (p.a.length >= M.hours(p)) { status('Fjern et hold først. Spilleren har allerede det ønskede antal.', 'error'); return; }
      const h = holdInfo(id);
      if (!h || count(id) >= h.capacity) { status('Holdet er fyldt eller findes ikke.', 'error'); return; }
      next = [...p.a, id];
    }
    await mutate({ type: 'save', name: p.assignmentKey, playerName: p.n, holds: next.join(','), expectedHolds: p.a.join(',') }, 'Tildeling gemt: ' + p.n);
  }
  document.addEventListener('click', async event => {
    const b = event.target.closest('button'); if (!b || state.busy) return;
    const d = b.dataset;
    if (b.id === 'reload') { await load(); return; }
    if (!state.loaded) return;
    if (d.view) { state.view = d.view; state.csv = null; render(); }
    else if (d.filter) { state.view = 'players'; state.filter = d.filter; state.query = ''; state.selected = visible()[0]?.n || null; render(); }
    else if (d.player) { if (!state.players.some(p => p.n === d.player)) { status('Spilleren findes kun i tildelingsarket. Tildelingen er bevaret.', 'error'); return; } state.selected = d.player; state.view = 'players'; render(); }
    else if (d.day) { state.day = d.day; state.hold = state.schedule.find(h => h.day === d.day)?.id; render(); }
    else if (d.roster) { state.hold = d.roster; render(); }
    else if (d.step) { state.selected = visible()[visible().indexOf(selected()) + Number(d.step)]?.n || state.selected; render(); }
    else if (d.assign) await assign(d.assign);
    else if (d.remove) await assign(d.remove, true);
    else if (d.extra) await mutate({ type: 'toggleExtraHold', hold: d.extra, active: !state.raw.extraHoldOptions.find(h => String(h.hold) === d.extra).active }, 'Ekstrahold opdateret');
    else if (b.id === 'clear' && selected() && confirm('Fjern alle tildelinger for ' + selected().n + '?')) await mutate({ type: 'save', name: selected().assignmentKey, playerName: selected().n, holds: '', expectedHolds: selected().a.join(',') }, 'Tildelinger fjernet');
    else if (b.id === 'import' && state.csv) { const text = state.csv; state.csv = null; await mutate({ type: 'importCSV', data: text, preserveExisting: true }, 'CSV importeret uden at overskrive eksisterende spillere'); }
    else if (d.review !== undefined) {
      const r = state.raw.swapRequests[Number(d.review)];
      if (d.decision === 'approved' && !state.raw.capabilities?.assignmentValidation) { status('Godkendelse af holdbytte kræver den nye Apps Script-version, så sæsonens kapacitet kontrolleres korrekt.', 'error'); return; }
      await mutate({ type: 'reviewSwap', id: r.id, decision: d.decision }, 'Holdbytte behandlet');
    } else if (b.id === 'export') {
      const text = M.exportList(state.players, seasonLabel(), new Date().toLocaleDateString('da-DK'));
      const a = document.createElement('a'), url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: 'text/plain;charset=utf-8' })); a.href = url; a.download = 'TTK-' + state.season + '-tildelinger.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
  document.addEventListener('input', e => { if (e.target.id === 'search') { state.query = e.target.value; list(); } });
  document.addEventListener('change', async e => {
    if (state.busy) return;
    if (e.target.id === 'season') {
      state.season = e.target.value; state.loaded = false; state.players = []; state.assignments = {}; state.selected = null; state.filter = 'all'; state.query = ''; state.day = 'Mandag'; state.csv = null; render(); await load();
    } else if (e.target.id === 'level') await mutate({ type: 'saveLevel', name: selected().n, level: e.target.value }, 'Niveau gemt');
    else if (e.target.id === 'csv-file') {
      const file = e.target.files[0]; state.csv = null; if (!file) return;
      const season = state.season; const input = e.target;
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error('CSV-filen må højst være 2 MB.');
        const buffer = await file.arrayBuffer(); let text = new TextDecoder('utf-8').decode(buffer);
        if (text.includes('\uFFFD')) text = new TextDecoder('windows-1252').decode(buffer);
        if (season !== state.season || !input.isConnected) return;
        const preview = M.newPlayersCsv(text, state.players.map(p => p.n));
        state.csv = text;
        $('csv-preview').innerHTML = `<p>${preview.added} nye spillere · ${preview.skipped} eksisterende springes over</p><p class="muted">${preview.names.slice(0, 8).map(esc).join(', ')}${preview.names.length > 8 ? ' …' : ''}</p>${button('Importér ' + preview.added + ' nye spillere i ' + seasonLabel(), `id="import" ${!preview.added ? 'disabled' : ''}`)}`;
      } catch (err) { if (season === state.season && input.isConnected) { $('csv-preview').textContent = err.message; status(err.message, 'error'); } }
    }
  });
  document.addEventListener('submit', async e => {
    if (!e.target.matches('#add-player,#manual-assignment,[data-settings]')) return;
    e.preventDefault(); if (state.busy) return;
    const values = new FormData(e.target);
    if (e.target.id === 'manual-assignment') {
      const id = String(values.get('hold')).trim().replace(',', '.');
      if (!holdInfo(id)) { status('Angiv et holdnummer, der findes i den valgte sæson.', 'error'); return; }
      if (selected()?.a.includes(id)) { status('Holdet er allerede valgt.', 'error'); return; }
      await assign(id);
    } else if (e.target.id === 'add-player') {
      const name = String(values.get('name')).trim();
      if (state.players.some(p => M.nameKey(p.n) === M.nameKey(name))) { status('Spilleren findes allerede.', 'error'); return; }
      await mutate({ type: 'addPlayer', player: { n: name, t: Number(values.get('hours')), age: values.get('age'), level: values.get('level'), note: values.get('note'), h: [], dw: [], u: true } }, 'Spiller tilføjet');
    } else {
      await mutate({ type: 'saveAdminSettings', holdId: e.target.dataset.settings, court: String(values.get('court')).trim(), capacity: Number(values.get('capacity')), expectedVersion: state.raw.adminSettings?.version || 0 }, 'Bane og kapacitet gemt');
    }
  });
  async function start() {
    try {
      const response = await fetch('/api/auth/session'); const session = await response.json();
      if (!response.ok || !session.signedIn) { $('login-message').textContent = 'Log ind med din godkendte Google-konto.'; return; }
      const defaults = await fetch('/admin-assets/default-schedules.json');
      if (!defaults.ok) throw new Error('Holdskemaet kunne ikke hentes.');
      state.defaults = await defaults.json();
      $('login').hidden = true; $('season-app').hidden = false;
      await load();
    } catch (e) { $('login-message').textContent = 'Kunne ikke åbne admin: ' + e.message; }
  }
  start();
})();
