'use strict';
// Boucle de jeu, entrées et séances de pilotage (qualification / course).
(function () {
  const F1 = window.F1;
  const $ = (id) => document.getElementById(id);

  const fmt = (t) => {
    if (t == null || !isFinite(t)) return '–';
    const hr = Math.floor(t / 3600);
    const m = Math.floor((t - hr * 3600) / 60);
    const s = t - hr * 3600 - m * 60;
    const sec = s.toFixed(3).padStart(6, '0');
    return hr ? `${hr}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };
  F1.fmt = fmt;

  // ---------- Entrées ----------
  const keys = new Set();
  const touch = { left: false, right: false, gas: false, brake: false, boost: false, aero: false };
  const KEYMAP = {
    ArrowUp: 'gas', KeyW: 'gas', KeyZ: 'gas',
    ArrowDown: 'brake', KeyS: 'brake',
    ArrowLeft: 'left', KeyA: 'left', KeyQ: 'left',
    ArrowRight: 'right', KeyD: 'right',
    KeyE: 'boost', ShiftLeft: 'boost', ShiftRight: 'boost',
  };
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = KEYMAP[e.code];
    if (k && S.state !== 'idle') { keys.add(k); e.preventDefault(); }
    if (e.repeat) return;
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
    if (e.code === 'KeyM') toggleMute();
    if (e.code === 'KeyC') nextCamera();
    if (e.code === 'Space' && S.state !== 'idle') { e.preventDefault(); toggleAero(); }
    if (e.code === 'KeyB' && S.state === 'run') togglePit();
    const tyreKeys = { Digit1: 'S', Digit2: 'M', Digit3: 'H', Digit4: 'I' };
    if (tyreKeys[e.code] && S.state === 'run') chooseTyre(tyreKeys[e.code]);
    if (e.code === 'KeyR' && S.state === 'run' && S.race.player && !S.race.player.finished) {
      S.race.player.resetOnTrack(S.race.track);
    }
  });
  window.addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) keys.delete(k); });
  window.addEventListener('blur', () => keys.clear());

  let padStart = false, padAero = false;
  let steerIn = 0; // direction lissée (clavier / tactile)
  function toggleAero() {
    const r = S.race;
    if (!r || r.aeroMode !== 'manual' || !r.player) return;
    S.aeroWanted = !S.aeroWanted;
    if (S.aeroWanted && !r.track.aeroZone[r.player.idx]) { S.aeroWanted = false; toast('Aéro : hors zone', ''); }
  }
  function readInput(dt) {
    const set = F1.Settings.get();
    const sens = F1.Settings.SENS[set.sens] || F1.Settings.SENS.mid;
    let target = 0, throttle = 0, brake = 0, analog = null;
    if (keys.has('left') || touch.left) target -= 1;
    if (keys.has('right') || touch.right) target += 1;
    if (keys.has('gas') || touch.gas) throttle = 1;
    if (keys.has('brake') || touch.brake) brake = 1;
    let boost = keys.has('boost') || touch.boost;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0;
      // Courbe progressive : petits mouvements du stick = petites corrections
      if (Math.abs(ax) > 0.12) analog = Math.sign(ax) * Math.pow((Math.abs(ax) - 0.12) / 0.88, sens.pad);
      const rt = gp.buttons[7] ? gp.buttons[7].value : 0;
      const lt = gp.buttons[6] ? gp.buttons[6].value : 0;
      throttle = Math.max(throttle, rt, gp.buttons[0] && gp.buttons[0].pressed ? 1 : 0);
      brake = Math.max(brake, lt, gp.buttons[1] && gp.buttons[1].pressed ? 1 : 0);
      if (gp.buttons[5] && gp.buttons[5].pressed) boost = true;
      const lb = !!(gp.buttons[4] && gp.buttons[4].pressed);
      if (lb && !padAero) toggleAero();
      padAero = lb;
      const st = !!(gp.buttons[9] && gp.buttons[9].pressed);
      if (st && !padStart) togglePause();
      padStart = st;
      break;
    }
    // Rampe de braquage : la direction s'oriente progressivement, et revient plus vite au centre
    const rate = target === 0 || Math.sign(target) !== Math.sign(steerIn) ? sens.back : sens.rate;
    const d = target - steerIn;
    steerIn += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    let steer = analog != null ? analog : steerIn;
    // Moins de braquage à haute vitesse
    const p = S.race && S.race.player;
    if (p) steer *= 1 - sens.highSpeedCut * Math.min(1, p.speed / F1.PHYS.maxSpeed);
    // Aéro manuelle : se referme d'elle-même (freinage, fin de zone) et doit être réactivée
    if (p && S.prevAero && !p.aeroOpen) S.aeroWanted = false;
    if (p) S.prevAero = p.aeroOpen;
    return { steer, throttle, brake, boost, aero: !!S.aeroWanted };
  }

  document.querySelectorAll('#touch button').forEach((btn) => {
    const k = btn.dataset.key;
    const on = (e) => {
      e.preventDefault();
      if (k === 'aero') { toggleAero(); return; }
      if (k === 'pit') { togglePit(); return; }
      touch[k] = true; btn.classList.add('active');
      try { btn.setPointerCapture(e.pointerId); } catch (_) { /* ignoré */ }
    };
    const off = (e) => { e.preventDefault(); touch[k] = false; btn.classList.remove('active'); };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('lostpointercapture', off);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  document.body.classList.toggle('touch-mode', isTouch);

  // ---------- Arrêts au stand (joueur) ----------
  function togglePit() {
    const r = S.race, p = r && r.player;
    if (!p || r.mode !== 'race' || p.finished || p.pit) return;
    p.pitReq = !p.pitReq;
    if (p.pitReq && !p.nextTyre) p.nextTyre = r.bestTyreFor(r.lapsLeft(p) - 0.3);
    toast(p.pitReq ? `Arrêt au stand ce tour-ci · pneus ${F1.TYRES[p.nextTyre].label.toLowerCase()}` : 'Arrêt annulé');
    updatePitPanel();
  }
  function chooseTyre(t) {
    const p = S.race && S.race.player;
    if (!p || !(p.pitReq || (p.pit && p.pit.phase === 'in'))) return;
    p.nextTyre = t;
    updatePitPanel();
  }
  function updatePitPanel() {
    const p = S.race && S.race.player;
    const show = !!p && (p.pitReq || (p.pit && p.pit.phase === 'in'));
    $('tp-pit').classList.toggle('hidden', !show);
    const btn = document.getElementById('touch-pit');
    if (btn) btn.classList.toggle('on', !!(p && p.pitReq));
    document.querySelectorAll('#tp-pit [data-tyre]').forEach((b) => b.classList.toggle('sel', !!p && b.dataset.tyre === p.nextTyre));
  }
  document.querySelectorAll('#tp-pit [data-tyre]').forEach((b) => b.addEventListener('click', () => chooseTyre(b.dataset.tyre)));

  // ---------- Bandeaux télé ----------
  const bannerQ = [];
  let bannerT = 0, battleCd = 6;
  function tv(kicker, main, sub, cls) {
    if (bannerQ.length > 4) bannerQ.shift();
    bannerQ.push({ kicker, main, sub, cls });
  }
  function tvTick(dt) {
    const el = $('tv-banner');
    if (bannerT > 0) {
      bannerT -= dt;
      if (bannerT <= 0) el.classList.remove('show');
      return;
    }
    if (bannerT > -0.4) { bannerT -= dt; return; } // petite pause entre deux bandeaux
    const b = bannerQ.shift();
    if (!b) return;
    el.className = 'tv-banner ' + (b.cls || '');
    el.innerHTML = '<span class="bn-kicker"></span><span class="bn-main"></span><span class="bn-sub"></span>';
    el.querySelector('.bn-kicker').textContent = b.kicker;
    el.querySelector('.bn-main').textContent = b.main;
    el.querySelector('.bn-sub').textContent = b.sub || '';
    void el.offsetWidth;
    el.classList.add('show');
    bannerT = 3.6;
  }
  // Intervalle avec la voiture qui précède (secondes), ou nombre de tours de retard
  function interval(st, i) {
    const c = st[i], a = st[i - 1];
    if (!a) return null;
    if (c.finished && a.finished) return c.finishTime - a.finishTime;
    return Math.max(0, c.gap - a.gap);
  }
  function battles(race, dt) {
    battleCd -= dt;
    if (battleCd > 0) return;
    battleCd = 9;
    const st = race.standings();
    const p = race.player, me = st.indexOf(p);
    const cands = [];
    for (let i = 1; i < st.length; i++) {
      if (st[i].finished || st[i].pit || st[i - 1].pit) continue;
      const iv = interval(st, i);
      if (iv != null && iv < 0.6 && st[i].wrap === st[i - 1].wrap) cands.push({ i, iv, near: Math.abs(i - me) });
    }
    if (!cands.length) return;
    cands.sort((x, y) => x.near - y.near || x.i - y.i);
    const b = cands[0];
    tv(`Duel pour la P${b.i}`, `${st[b.i - 1].code}  ▸  ${st[b.i].code}`, `Écart : ${b.iv.toFixed(1)} s`, 'yellow');
  }

  // ---------- État ----------
  const renderer = new F1.Renderer($('game'));
  const r3d = F1.Renderer3D ? new F1.Renderer3D(document.body) : null;
  const audio = new F1.Audio();

  // ---------- Caméras ----------
  const CAMERAS = [
    { id: 'top', label: 'Vue de dessus', kind: '2d' },
    { id: 'topRot', label: 'Vue de dessus (suit la voiture)', kind: '2d', rotate: true },
    { id: 'chase', label: 'Caméra poursuite', kind: '3d' },
    { id: 'tcam', label: 'Caméra embarquée', kind: '3d' },
    { id: 'cockpit', label: 'Cockpit', kind: '3d' },
  ];
  let camIdx = 0;
  try { camIdx = Math.max(0, CAMERAS.findIndex((c) => c.id === localStorage.getItem('paddock-cam'))); } catch (e) { /* ignoré */ }
  function nextCamera() {
    if (S.state === 'idle') return;
    camIdx = (camIdx + 1) % CAMERAS.length;
    if (CAMERAS[camIdx].kind === '3d' && !(r3d && r3d.init())) camIdx = 0; // 3D indisponible
    try { localStorage.setItem('paddock-cam', CAMERAS[camIdx].id); } catch (e) { /* ignoré */ }
    toast('🎥 ' + CAMERAS[camIdx].label);
  }
  const minimapCtx = $('minimap').getContext('2d');
  const S = {
    state: 'idle', // idle (démo derrière les menus) | countdown | run | paused | done
    race: null,
    opts: null,
    t: 0,
    demo: true,
  };

  // ---------- Démo derrière les menus ----------
  function demo(gp) {
    const track = F1.getTrack(gp);
    const entries = F1.DRIVERS2026.slice(0, 10).map((d) => ({
      name: d.last, code: d.code, team: F1.TEAMS2026.find((t) => t.id === d.team), skill: 0.97, power: 0.98,
    }));
    S.race = new F1.Race({ track, entries, laps: 999 });
    S.race.started = true;
    // Les voitures partent étalées sur le circuit
    S.race.cars.forEach((c, i) => c.placeOnTrack(track, i * track.length / 10, 0, 300));
    renderer.setScene(F1.buildScene(track));
    renderer.snapCamera(S.race.cars[0]);
    S.demo = true;
    S.state = 'idle';
    S.demoGp = gp.id;
  }

  // ---------- Séance jouée ----------
  // opts : { gp, mode: 'race'|'quali', entries, laps, title, onEnd(result), allowRestart }
  function start(opts) {
    audio.init();
    S.opts = opts;
    S.attempts = [];
    S.demo = false;
    $('screen').classList.add('hidden');
    $('dialog').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('touch').classList.toggle('hidden', !isTouch);
    newRun();
  }

  function newRun() {
    const o = S.opts;
    const track = F1.getTrack(o.gp);
    const set = F1.Settings.get();
    S.race = new F1.Race({ track, entries: o.entries, laps: o.laps, mode: o.mode, weather: o.weather || 'dry', aeroMode: set.aero, assists: set.assists, tyreWear: set.tyreWear, damage: set.damage, playerTyre: o.playerTyre });
    S.aeroWanted = false; S.prevAero = false; steerIn = 0;
    bannerQ.length = 0; bannerT = 0; battleCd = 8;
    $('tv-banner').className = 'tv-banner';
    const isRace = o.mode === 'race';
    $('tv-lap').classList.toggle('hidden', !isRace);
    $('tyre-panel').classList.toggle('hidden', !isRace);
    const tp = document.getElementById('touch-pit');
    if (tp) tp.classList.toggle('hidden', !isRace);
    $('tv-wx').textContent = S.race.wetPlan ? '🌦️' : { dry: '☀️', cloudy: '☁️', rain: '🌧️' }[S.race.weather];
    $('tv-flag').className = 'tv-flag hidden';
    $('tp-pen').classList.add('hidden');
    updatePitPanel();
    if (isRace && S.race.player) {
      const p = S.race.player;
      tv(`Sur la grille · P${p.grid}`, p.name, `${p.team.name} · n° ${p.num} · pneus ${F1.TYRES[p.tyre].label.toLowerCase()}`, 'green');
    }
    $('touch-aero').classList.toggle('hidden', set.aero !== 'manual');
    S.scene2d = F1.buildScene(track);
    renderer.setScene(S.scene2d);
    renderer.snapCamera(S.race.player);
    renderer.cam.zoom = Math.min(renderer.w, renderer.h) / 800;
    S.finishTimer = 0;
    S.hudTimer = 0;
    hideBanner();
    $('dialog').classList.add('hidden');
    $('hud-pos-label').textContent = o.mode === 'quali' ? 'Tentative' : 'Position';
    $('hud-lap-label').textContent = o.mode === 'quali' ? 'Séance' : 'Tour';
    $('leaderboard').classList.toggle('hidden', o.mode === 'quali');
    if (o.mode === 'race') {
      S.state = 'countdown';
      S.countdown = 0;
      S.lightsOutAt = 5 + 0.4 + Math.random() * 1.2;
      S.lightsShown = 0;
      $('lights').classList.remove('hidden');
      document.querySelectorAll('.light').forEach((l) => l.classList.remove('on'));
    } else {
      S.state = 'run';
      $('lights').classList.add('hidden');
      banner('Tour de qualification', 'go');
      setTimeout(() => { if ($('banner').classList.contains('go')) hideBanner(); }, 1600);
    }
    updateHud(true);
  }

  function stopToMenu() {
    S.state = 'idle';
    if (r3d) r3d.show(false);
    $('game').classList.remove('hidden');
    audio.stopEngine();
    $('hud').classList.add('hidden');
    $('touch').classList.add('hidden');
    $('dialog').classList.add('hidden');
    $('screen').classList.remove('hidden');
    keys.clear();
  }

  // Résultat d'une course jouée
  function raceResult(abandon) {
    const race = S.race;
    const st = race.standings();
    const winner = race.finishOrder[0];
    let order = st.map((c) => ({
      id: c.id,
      dnf: !!c.out,
      time: c.finished ? c.finishTime : null,
      gap: c.finished && winner ? c.finishTime - winner.finishTime : null,
      lapsDown: c.finished ? 0 : Math.max(0, (st[0].wrap - c.wrap)),
      stops: c.stops,
    }));
    if (abandon) {
      const me = order.find((o) => o.id === race.player.id);
      me.dnf = true;
      order = order.filter((o) => o !== me).concat([me]);
    }
    return {
      order,
      fastest: race.bestLap.car ? race.bestLap.car.id : null,
      fastestTime: race.bestLap.time,
    };
  }

  function finish(result) {
    const cb = S.opts.onEnd;
    stopToMenu();
    cb(result);
  }

  // ---------- Pause ----------
  function togglePause() {
    if (S.state === 'run' || S.state === 'countdown') {
      S.prevState = S.state;
      S.state = 'paused';
      audio.stopEngine();
      showPause();
    } else if (S.state === 'paused') {
      S.state = S.prevState;
      $('dialog').classList.add('hidden');
      last = performance.now();
    }
  }

  function showPause() {
    const o = S.opts;
    const btns = [['Reprendre', 'primary', togglePause]];
    btns.push([`Caméra : ${CAMERAS[camIdx].label}`, '', () => { nextCamera(); showPause(); }]);
    if (r3d && r3d.ok) btns.push([`Graphismes 3D : ${r3d.qualityLabel}`, '', () => { r3d.cycleQuality(); showPause(); }]);
    if (o.mode === 'race') {
      btns.push(['Simuler la fin de course', '', () => finish(raceResult(false))]);
      if (o.allowRestart) btns.push(['Recommencer', '', () => newRun()]);
      btns.push(['Abandonner', 'danger', () => finish(o.allowRestart ? null : raceResult(true))]);
    } else {
      btns.push(['Recommencer le tour', '', () => newRun()]);
      btns.push(['Terminer la séance', 'danger', () => finish({ time: bestAttempt() })]);
    }
    dialog('Pause', null, btns);
  }

  function bestAttempt() {
    const valid = S.attempts.filter((x) => x != null);
    return valid.length ? Math.min(...valid) : null;
  }

  function dialog(title, bodyEl, buttons) {
    const d = $('dialog');
    d.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'menu-card small';
    const h = document.createElement('h2');
    h.className = 'overlay-title';
    h.textContent = title;
    card.appendChild(h);
    if (bodyEl) card.appendChild(bodyEl);
    for (const [label, cls, fn] of buttons) {
      const b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('click', fn);
      card.appendChild(b);
    }
    d.appendChild(card);
    d.classList.remove('hidden');
    const first = card.querySelector('button');
    if (first) first.focus();
  }

  function toggleMute() {
    audio.setMuted(!audio.muted);
    $('btn-mute').textContent = audio.muted ? '🔇' : '🔊';
  }
  $('btn-mute').textContent = audio.muted ? '🔇' : '🔊';
  $('btn-mute').addEventListener('click', toggleMute);
  $('btn-pause').addEventListener('click', togglePause);

  // ---------- Messages ----------
  let toastTimer = 0;
  function toast(msg, cls) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'show' + (cls ? ' ' + cls : '');
    toastTimer = 2.4;
  }
  function banner(msg, cls) { const el = $('banner'); el.textContent = msg; el.className = cls || ''; }
  function hideBanner() { $('banner').className = 'hidden'; }

  // ---------- HUD ----------
  function updateHud(force) {
    const race = S.race, p = race.player;
    if (!p) return;
    const quali = race.mode === 'quali';
    if (quali) {
      $('hud-pos').textContent = `${S.attempts.length + 1}`;
      $('hud-lap').textContent = p.wrap < 0 ? 'Lancé' : 'Chrono';
    } else {
      const st = race.standings();
      $('hud-pos').textContent = `P${st.indexOf(p) + 1}/${st.length}`;
      $('hud-lap').textContent = `${Math.max(1, Math.min(race.laps, p.wrap + 1))}/${race.laps}`;
    }
    const cur = (S.state === 'run' || S.state === 'done') && !p.finished && p.wrap >= 0 ? race.time - p.lapStart : 0;
    $('hud-cur').textContent = fmt(cur);
    $('hud-last').textContent = p.lapTimes.length ? fmt(p.lapTimes[p.lapTimes.length - 1]) : '–';
    $('hud-best').textContent = quali ? fmt(bestAttempt()) : fmt(p.bestLap);
    $('hud-speed').textContent = Math.round(p.speed * F1.KMH);
    const bat = Math.round(p.battery * 100);
    $('hud-batt-fill').style.width = bat + '%';
    $('hud-batt-fill').className = p.boosting ? 'boost' : p.deploying ? 'deploy' : p.battery < 0.05 ? 'empty' : '';
    $('hud-batt-val').textContent = bat + ' %';
    const zone = race.track.aeroZone[p.idx] === 1;
    const aeroEl = $('hud-aero');
    aeroEl.textContent = p.aeroOpen ? 'AÉRO X' : 'AÉRO Z';
    aeroEl.className = 'aero ' + (p.aeroOpen ? 'open' : zone && race.aeroMode === 'manual' ? 'ready' : '');
    $('hud-boost').classList.toggle('on', !!p.boosting);
    if (!quali) {
      const T = F1.TYRES[p.tyre];
      const badge = $('tp-badge');
      badge.textContent = T.short;
      badge.className = 'tyre-badge ' + p.tyre.toLowerCase();
      const w = Math.min(100, Math.round(p.wear * 100));
      $('tp-wear-fill').style.width = w + '%';
      $('tp-wear-fill').style.background = w > 85 ? '#e10600' : w > 60 ? '#ffd60a' : '#3ddc84';
      const D = p.dmg;
      if (D) for (const k of ['fw', 'sus', 'rw']) {
        const v = D[k], el = $('tp-dmg-' + k);
        el.className = v >= 0.5 ? 'bad' : v >= 0.15 ? 'warn' : v > 0.02 ? 'light' : '';
        el.title = `${F1.DAMAGE_PARTS[k]} : ${Math.round(v * 100)} %`;
      }
      const win = F1.TYRE_TEMP[p.tyre] || F1.TYRE_TEMP.M, tc = Math.round(p.temp || 0);
      const te = $('tp-temp');
      te.textContent = tc + '°';
      te.className = 'tp-temp ' + (tc < win[0] - 5 ? 'cold' : tc > win[1] + 5 ? 'hot' : 'ok');
      te.title = `Température des pneus (idéale ${win[0]}–${win[1]} °C)`;
      const pen = $('tp-pen');
      pen.classList.toggle('hidden', !p.penalty);
      if (p.penalty) pen.textContent = `Pénalité +${p.penalty} s`;
      $('tp-wear-val').textContent = p.pit ? (p.pit.phase === 'stop' ? 'Arrêt…' : 'Stands') : `${w} %`;
      const lead = race.standings()[0];
      $('tv-lap-txt').textContent = lead.finished ? 'ARRIVÉE' : `TOUR ${Math.max(1, Math.min(race.laps, lead.wrap + 1))}/${race.laps}`;
    }

    if (!quali && (force || S.hudTimer <= 0)) {
      S.hudTimer = 0.3;
      const st = race.standings();
      const me = st.indexOf(p);
      // Tour de classement : tout le monde si l'écran est assez haut, sinon le haut + autour du joueur
      const rows = Math.max(8, Math.floor((window.innerHeight - 160) / 23));
      const show = new Set();
      if (st.length <= rows) st.forEach((_, i) => show.add(i));
      else {
        for (let i = 0; i < Math.min(5, rows - 6); i++) show.add(i);
        for (let i = me - 2; i <= me + 2; i++) if (i >= 0 && i < st.length) show.add(i);
        for (let i = 0; show.size < rows && i < st.length; i++) show.add(i);
      }
      const lb = $('leaderboard');
      lb.className = 'panel tower';
      lb.innerHTML = '';
      let prev = -1;
      [...show].sort((a, b) => a - b).forEach((i) => {
        if (prev >= 0 && i > prev + 1) {
          const sep = document.createElement('li');
          sep.className = 'sep';
          sep.textContent = '···';
          lb.appendChild(sep);
        }
        prev = i;
        const c = st[i];
        const li = document.createElement('li');
        if (c.isPlayer) li.className = 'me';
        let gap = '';
        if (c.out) gap = 'OUT';
        else if (i === 0) gap = c.finished ? 'Arrivé' : 'Leader';
        else if (race.started) {
          const down = st[0].wrap - c.wrap - (st[0].idx < c.idx ? 1 : 0);
          const iv = interval(st, i);
          gap = down >= 1 && !c.finished ? `+${down} T` : `+${(iv || 0).toFixed(1)}`;
        }
        const T = F1.TYRES[c.tyre];
        const tag = c.pit ? '<span class="pit">STAND</span>' : race.bestLap.car === c ? '<span class="fl">⏱</span>' : '';
        li.innerHTML = `<span class="p">${i + 1}</span><span class="sw" style="background:${c.team.color}"></span><span class="n"></span>${tag}<span class="g">${gap}</span><span class="tyre-badge tb ${c.tyre.toLowerCase()}">${T.short}</span><span class="st">${c.stops || ''}</span>`;
        li.querySelector('.n').textContent = c.code;
        lb.appendChild(li);
      });
    }
  }

  // ---------- Boucle ----------
  const STEP = 1 / 120;
  let last = performance.now();
  let acc = 0;

  function frame(now) {
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    S.t += dt;
    const race = S.race;
    if (S.state === 'paused') dt = 0;

    if (S.state === 'countdown') {
      S.countdown += dt;
      const n = Math.min(5, Math.floor(S.countdown));
      if (n > S.lightsShown) {
        S.lightsShown = n;
        document.querySelectorAll('.light').forEach((l, i) => l.classList.toggle('on', i < n));
        audio.beep(440, 0.18);
      }
      if (S.countdown >= S.lightsOutAt) {
        document.querySelectorAll('.light').forEach((l) => l.classList.remove('on'));
        audio.beep(880, 0.45, 0.2);
        race.started = true;
        S.state = 'run';
        banner('Go !', 'go');
        setTimeout(() => { if ($('banner').classList.contains('go')) hideBanner(); }, 1000);
        setTimeout(() => $('lights').classList.add('hidden'), 1000);
      }
    }

    if (dt > 0 && race) {
      acc += dt;
      const input = S.state === 'run' ? readInput(dt) : null;
      let steps = 0;
      while (acc >= STEP && steps < 8) {
        race.step(STEP, input);
        acc -= STEP;
        steps++;
        if (!S.demo) {
          for (const h of race.hits) if ((h.a.isPlayer || h.b.isPlayer) && h.force > 120) audio.thud(h.force);
          if (race.player && race.player.wallHit > 150) audio.thud(race.player.wallHit);
        }
        for (const c of race.cars) c.wallHit = 0;
      }
      if (steps >= 8) acc = 0;
      renderer.effects(race.cars, dt);
    }

    if (race && S.demo) race.events.length = 0;

    if (race && !S.demo && S.state !== 'idle') {
      const p = race.player;
      for (const ev of race.events) {
        if (race.mode === 'quali') {
          if (ev.car === p && ev.type === 'finish') {
            S.attempts.push(ev.time);
            S.state = 'done';
            qualiDone(ev.time);
          }
        } else if (ev.type === 'fastest') {
          if (ev.car === p) toast(`Meilleur tour : ${fmt(ev.time)}`, 'purple');
          if (race.time > 5) tv('Meilleur tour en course', `${ev.car.name}`, `${ev.car.team.name} · ${fmt(ev.time)}`, 'purple');
        } else if (ev.type === 'lap') {
          if (ev.car === p) toast(ev.lap === race.laps ? 'Dernier tour !' : `Tour ${ev.lap} · ${fmt(ev.time)}`);
          if (ev.lap === race.laps && race.standings()[0] === ev.car) tv('Course', 'Dernier tour', `${ev.car.name} mène la course`);
        } else if (ev.type === 'weather') {
          $('tv-wx').textContent = { dry: '☀️', cloudy: '☁️', rain: '🌧️' }[race.weather] || '🌦️';
          if (ev.msg === 'rainStart') { tv('Météo', 'La pluie arrive', 'Pensez aux pneus intermédiaires', 'yellow'); toast('🌧️ La pluie commence à tomber', 'red'); }
          else if (ev.msg === 'rain') toast('🌧️ Piste mouillée : intermédiaires conseillés', 'red');
          else if (ev.msg === 'dry') { tv('Météo', 'La piste sèche', 'Retour aux pneus slicks', 'green'); toast('☀️ La piste sèche : slicks conseillés'); }
        } else if (ev.type === 'warning') {
          if (ev.car === p) toast(ev.count >= 3 ? `Limites de la piste : avertissement ${ev.count} (dernier avant pénalité)` : `Limites de la piste : avertissement ${ev.count}`, 'red');
        } else if (ev.type === 'penalty') {
          if (ev.car === p) { toast(`Pénalité +${ev.sec} s : ${ev.reason}`, 'red'); tv('Commissaires', `Pénalité de ${ev.sec} secondes`, `${p.name} · ${ev.reason}`, 'red'); audio.beep(220, 0.3, 0.15); }
        } else if (ev.type === 'pitOvershoot') {
          if (ev.car === p) toast('Garage dépassé : les mécaniciens repoussent la voiture (+3 s)', 'red');
        } else if (ev.type === 'flag') {
          const F = { yellow: ['DRAPEAU JAUNE', 'yellow'], vsc: ['VSC', 'yellow'], sc: ['SAFETY CAR', 'yellow'], green: ['', ''] }[ev.flag];
          const el = $('tv-flag');
          el.textContent = F[0]; el.className = 'tv-flag ' + F[1] + (F[0] ? '' : ' hidden');
          if (ev.flag === 'vsc') { tv('Direction de course', 'Voiture de sécurité virtuelle', 'Vitesse limitée pour toutes les voitures', 'yellow'); toast('VSC : vitesse limitée', 'red'); }
          if (ev.flag === 'sc') { tv('Direction de course', 'Voiture de sécurité', 'Dépassements interdits, suivez la file', 'yellow'); toast('SAFETY CAR : pas de dépassement', 'red'); }
          if (ev.flag === 'yellow' && race.yellow && p && Math.abs(race.track.rel(p.idx) - race.track.rel(race.yellow.idx)) < 600) toast('Drapeau jaune : ralentissez', 'red');
        } else if (ev.type === 'scEnding') {
          tv('Direction de course', 'La voiture de sécurité rentre ce tour', 'Préparez la relance', 'yellow');
        } else if (ev.type === 'restart') {
          tv('Direction de course', 'Drapeau vert', ev.vsc ? 'Fin de la VSC' : 'Relance de la course', 'green');
          if (p && !p.out) toast('Drapeau vert : course relancée !', 'purple');
        } else if (ev.type === 'retired') {
          if (ev.car === p) { banner('Abandon', 'warn'); S.finishTimer = 3; audio.beep(140, 0.6, 0.2); }
          else tv('Abandon', ev.car.name, `${ev.car.team.name} · accident`, 'red');
        } else if (ev.type === 'damage') {
          if (ev.car === p) {
            const name = F1.DAMAGE_PARTS[ev.part], pc = Math.round(ev.level * 100);
            if (ev.level >= 0.9) toast(`${name} détruit${ev.part === 'sus' ? 'e' : ''} !${ev.part !== 'sus' ? ' Rentre au stand' : ''}`, 'red');
            else if (ev.level >= 0.5) toast(`${name} très endommagé${ev.part === 'sus' ? 'e' : ''} (${pc} %)${ev.part !== 'sus' ? ' · arrêt conseillé' : ''}`, 'red');
            else toast(`${name} endommagé${ev.part === 'sus' ? 'e' : ''} (${pc} %)`);
            audio.beep(180, 0.15, 0.12);
          } else if (ev.level >= 0.5 && race.mode === 'race') {
            tv('Incident', ev.car.name, `${F1.DAMAGE_PARTS[ev.part]} endommagé${ev.part === 'sus' ? 'e' : ''}`, '');
          }
        } else if (ev.type === 'pitIn') {
          if (ev.car === p) { toast(race.pitManual ? 'Stands : sous 80 km/h à la ligne, freine devant ton garage' : 'Entrée aux stands · limitation à 80 km/h'); updatePitPanel(); }
        } else if (ev.type === 'pit') {
          const T = F1.TYRES[ev.tyre];
          const pos = race.standings().indexOf(ev.car) + 1;
          if (ev.car === p) updatePitPanel();
          if (ev.car === p || pos <= 10) tv(`Arrêt au stand · P${pos}`, ev.car.name, `Immobilisé ${ev.stationary.toFixed(1)} s · pneus ${T.label.toLowerCase()}`, ev.car === p ? 'green' : '');
        } else if (ev.type === 'finish' && race.finishOrder.length === 1 && ev.car !== p) {
          tv('Drapeau à damier', `${ev.car.name} gagne`, ev.car.team.name, 'green');
        } else if (ev.type === 'finish' && ev.car === p) {
          banner(ev.pos === 1 ? 'Victoire !' : `Arrivée : P${ev.pos}`, ev.pos === 1 ? 'go' : '');
          S.finishTimer = 3;
          audio.beep(660, 0.3, 0.15);
          setTimeout(() => audio.beep(990, 0.5, 0.15), 180);
        }
      }
      race.events.length = 0;
      if (race.mode === 'race' && race.started && S.state !== 'paused') { battles(race, dt); }
      if (S.state !== 'paused') tvTick(dt);

      if (S.state === 'run' && race.mode === 'race' && p) {
        if (p.finished || p.out) {
          S.finishTimer -= dt;
          if (S.finishTimer <= 0) { S.state = 'done'; hideBanner(); raceDone(); }
        } else if (p.wrongWay > 1.2) banner('Mauvais sens !', 'warn');
        else if ($('banner').classList.contains('warn')) hideBanner();
      }
      if (S.state === 'done' && race.mode === 'race') {
        S.hudTimer -= dt;
        if (S.hudTimer <= 0) { S.hudTimer = 0.5; fillLive(); }
      }
      if (S.state !== 'paused') {
        const gear = audio.engine(p, S.state === 'run' || S.state === 'countdown' || S.state === 'done');
        $('hud-gear').textContent = p.speed < 5 ? 'N' : gear || 1;
      }
      if (S.state === 'run' || S.state === 'countdown') { S.hudTimer -= dt; updateHud(false); }
      if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').classList.remove('show'); }
    }

    if (race) {
      const focus = S.demo ? race.cars[0] : race.player;
      const cam = S.demo ? CAMERAS[0] : CAMERAS[camIdx];
      const use3d = cam.kind === '3d' && r3d && r3d.init();
      if (use3d) {
        r3d.setTrack(race.track, S.scene2d, race.weather);
        r3d.draw(race, focus, cam.id, S.state === 'paused' ? 0 : dt, { lights: S.state === 'countdown' ? S.lightsShown : 0 });
      } else {
        renderer.rotate = !!cam.rotate;
        renderer.draw(race, focus, S.t, S.state === 'paused' ? 0 : dt);
      }
      if (r3d) r3d.show(use3d);
      $('game').classList.toggle('hidden', use3d);
      if (!S.demo) renderer.drawMinimap(minimapCtx, race);
    }
    requestAnimationFrame(frame);
  }

  // ---------- Fin de tour de qualification ----------
  function qualiDone(time) {
    const o = S.opts;
    const body = document.createElement('div');
    body.className = 'dialog-body';
    const best = bestAttempt();
    const prov = o.provisional ? o.provisional(best) : null;
    const ref = F1.Settings.poleRef(o.gp);
    const delta = ref ? best - ref : null;
    body.innerHTML = `<p class="big-time">${fmt(time)}</p><p class="subtitle">Meilleur temps : ${fmt(best)}${prov ? ` · Position provisoire : <b>P${prov}</b>` : ''}</p>` +
      (ref ? `<p class="subtitle">⏱ ${F1.Settings.poleText(o.gp)}<br>Écart avec la pole réelle : <b>${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(3)} s</b></p>` : '');
    const btns = [];
    if (S.attempts.length < (o.maxAttempts || 3)) btns.push([`Nouvelle tentative (${S.attempts.length}/${o.maxAttempts || 3})`, '', () => newRun()]);
    btns.push(['Valider ce temps', 'primary', () => finish({ time: best })]);
    dialog('Tour terminé', body, btns);
  }

  // ---------- Fin de course : classement en direct ----------
  function raceDone() {
    const body = document.createElement('div');
    body.className = 'dialog-body';
    body.innerHTML = '<p class="subtitle">Les autres pilotes terminent leur course…</p><div class="table-wrap"><table class="results-table"><thead><tr><th>Pos</th><th>Pilote</th><th>Écart</th></tr></thead><tbody id="live-body"></tbody></table></div>';
    dialog(S.opts.title || 'Arrivée', body, [['Continuer', 'primary', () => finish(raceResult(false))]]);
    $('dialog').querySelector('.menu-card').classList.remove('small');
    fillLive();
  }

  function fillLive() {
    const tb = $('live-body');
    if (!tb) return;
    const race = S.race;
    const st = race.standings();
    tb.innerHTML = '';
    st.forEach((c, i) => {
      const tr = document.createElement('tr');
      if (c.isPlayer) tr.className = 'me';
      let gap;
      if (c.out) gap = '<span class="pending">Abandon</span>';
      else if (!c.finished) gap = '<span class="pending">en piste…</span>';
      else if (i === 0) gap = fmt(c.finishTime);
      else gap = '+' + (c.finishTime - race.finishOrder[0].finishTime).toFixed(3);
      tr.innerHTML = `<td>${i + 1}</td><td><span class="swatch" style="background:${c.team.color}"></span><span class="nm"></span></td><td>${gap}</td>`;
      tr.querySelector('.nm').textContent = c.name;
      tb.appendChild(tr);
    });
  }

  window.addEventListener('resize', () => { renderer.resize(); if (r3d) r3d.resize(); });
  $('btn-cam').addEventListener('click', nextCamera);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (S.state === 'run' || S.state === 'countdown')) togglePause();
  });

  F1.Session = { start, demo, state: () => S.state, race: () => S.race, audio };
  requestAnimationFrame(frame);
})();
