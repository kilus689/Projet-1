'use strict';
// Boucle de jeu, entrées et interface.
(function () {
  const F1 = window.F1;
  const $ = (id) => document.getElementById(id);

  // ---------- Stockage local (facultatif) ----------
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem('f1-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('f1-' + k, JSON.stringify(v)); } catch (e) { /* ignoré */ }
    },
  };

  const settings = Object.assign(
    { track: 'lagons', laps: 3, difficulty: 'normal', team: 'tiare', name: '' },
    store.get('settings', {})
  );

  const fmt = (t) => {
    if (!isFinite(t)) return '–';
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m}:${s.toFixed(3).padStart(6, '0')}`;
  };

  // ---------- Entrées ----------
  const keys = new Set();
  const touch = { left: false, right: false, gas: false, brake: false };
  const KEYMAP = {
    ArrowUp: 'gas', KeyW: 'gas', KeyZ: 'gas',
    ArrowDown: 'brake', KeyS: 'brake',
    ArrowLeft: 'left', KeyA: 'left', KeyQ: 'left',
    ArrowRight: 'right', KeyD: 'right',
  };
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const k = KEYMAP[e.code];
    if (k) { keys.add(k); e.preventDefault(); }
    if (e.repeat) return;
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
    if (e.code === 'KeyM') toggleMute();
    if (e.code === 'KeyR' && game.state === 'race' && game.race.player && !game.race.player.finished) {
      game.race.player.resetOnTrack(game.race.track);
    }
  });
  window.addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) keys.delete(k); });
  window.addEventListener('blur', () => keys.clear());

  function readInput() {
    let steer = 0, throttle = 0, brake = 0;
    if (keys.has('left') || touch.left) steer -= 1;
    if (keys.has('right') || touch.right) steer += 1;
    if (keys.has('gas') || touch.gas) throttle = 1;
    if (keys.has('brake') || touch.brake) brake = 1;
    // Manette
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.15) steer = Math.max(-1, Math.min(1, steer + ax));
      const rt = gp.buttons[7] ? gp.buttons[7].value : 0;
      const lt = gp.buttons[6] ? gp.buttons[6].value : 0;
      const a = gp.buttons[0] && gp.buttons[0].pressed ? 1 : 0;
      const b = gp.buttons[1] && gp.buttons[1].pressed ? 1 : 0;
      throttle = Math.max(throttle, rt, a);
      brake = Math.max(brake, lt, b);
      if (gp.buttons[9] && gp.buttons[9].pressed && !game.padStart) togglePause();
      game.padStart = !!(gp.buttons[9] && gp.buttons[9].pressed);
      break;
    }
    return { steer, throttle, brake };
  }

  // Boutons tactiles (multi-touch)
  document.querySelectorAll('#touch button').forEach((btn) => {
    const k = btn.dataset.key;
    const on = (e) => { e.preventDefault(); touch[k] = true; btn.classList.add('active'); try { btn.setPointerCapture(e.pointerId); } catch (_) { /* ignoré */ } };
    const off = (e) => { e.preventDefault(); touch[k] = false; btn.classList.remove('active'); };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('lostpointercapture', off);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

  // ---------- État du jeu ----------
  const renderer = new F1.Renderer($('game'));
  const audio = new F1.Audio();
  const minimapCtx = $('minimap').getContext('2d');
  const game = {
    state: 'menu', // menu | countdown | race | paused | results
    race: null,
    t: 0,
    countdown: 0,
    lightsOutAt: 0,
    hudTimer: 0,
    finishTimer: 0,
    resultsShown: false,
    prevState: null,
  };

  // Course de démonstration en arrière-plan du menu
  function startDemo() {
    const def = F1.TRACKS.find((t) => t.id === settings.track) || F1.TRACKS[0];
    game.race = new F1.Race({ trackDef: def, laps: 999, difficulty: 'difficile', seed: 42 });
    game.race.started = true;
    renderer.setScene(F1.buildScene(game.race.track));
    renderer.snapCamera(game.race.cars[0]);
    game.demo = true;
  }

  function startRace() {
    audio.init();
    const def = F1.TRACKS.find((t) => t.id === settings.track) || F1.TRACKS[0];
    game.race = new F1.Race({
      trackDef: def,
      laps: settings.laps,
      difficulty: settings.difficulty,
      playerTeam: settings.team,
      playerName: settings.name.trim() || 'Vous',
    });
    game.demo = false;
    renderer.setScene(F1.buildScene(game.race.track));
    renderer.snapCamera(game.race.player);
    renderer.cam.zoom = Math.min(renderer.w, renderer.h) / 800;
    game.state = 'countdown';
    game.countdown = 0;
    game.lightsOutAt = 5 + 0.4 + Math.random() * 1.2;
    game.lightsShown = 0;
    game.finishTimer = 0;
    game.resultsShown = false;
    game.recordSaved = false;
    $('menu').classList.add('hidden');
    $('pause').classList.add('hidden');
    $('results').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('touch').classList.toggle('hidden', !isTouch);
    $('lights').classList.remove('hidden');
    document.querySelectorAll('.light').forEach((l) => l.classList.remove('on'));
    hideBanner();
    updateHud(true);
  }

  function showMenu() {
    game.state = 'menu';
    audio.stopEngine();
    $('hud').classList.add('hidden');
    $('touch').classList.add('hidden');
    $('pause').classList.add('hidden');
    $('results').classList.add('hidden');
    $('menu').classList.remove('hidden');
    refreshRecords();
    startDemo();
  }

  function togglePause() {
    if (game.state === 'race' || game.state === 'countdown') {
      game.prevState = game.state;
      game.state = 'paused';
      audio.stopEngine();
      $('pause').classList.remove('hidden');
      $('btn-resume').focus();
    } else if (game.state === 'paused') {
      game.state = game.prevState;
      $('pause').classList.add('hidden');
      last = performance.now();
    }
  }

  function toggleMute() {
    audio.setMuted(!audio.muted);
    $('btn-mute').textContent = audio.muted ? '🔇' : '🔊';
  }
  $('btn-mute').textContent = audio.muted ? '🔇' : '🔊';

  // ---------- Bannière / messages ----------
  let toastTimer = 0;
  function toast(msg, cls) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'show' + (cls ? ' ' + cls : '');
    toastTimer = 2.2;
  }
  function banner(msg, cls) {
    const el = $('banner');
    el.textContent = msg;
    el.className = cls || '';
  }
  function hideBanner() { $('banner').className = 'hidden'; }

  // ---------- HUD ----------
  function updateHud(force) {
    const race = game.race, p = race.player;
    if (!p) return;
    const st = race.standings();
    const pos = st.indexOf(p) + 1;
    $('hud-pos').textContent = `P${pos}/${st.length}`;
    const lap = Math.max(1, Math.min(race.laps, p.wrap + 1));
    $('hud-lap').textContent = `${lap}/${race.laps}`;
    const cur = game.state === 'race' && !p.finished && p.wrap >= 0 ? race.time - p.lapStart : 0;
    $('hud-cur').textContent = fmt(cur);
    $('hud-last').textContent = p.lapTimes.length ? fmt(p.lapTimes[p.lapTimes.length - 1]) : '–';
    $('hud-best').textContent = fmt(p.bestLap);
    $('hud-speed').textContent = Math.round(p.speed * F1.KMH);

    if (force || game.hudTimer <= 0) {
      game.hudTimer = 0.25;
      const lb = $('leaderboard');
      lb.innerHTML = '';
      st.forEach((c, i) => {
        const li = document.createElement('li');
        if (c.isPlayer) li.className = 'me';
        let gap = '';
        if (i === 0) gap = c.finished ? 'Arrivé' : 'Leader';
        else if (race.started) {
          const lapsDown = st[0].wrap - c.wrap - (st[0].idx < c.idx ? 1 : 0);
          gap = lapsDown >= 1 && !c.finished ? `+${lapsDown} t.` : `+${Math.max(0, c.gap).toFixed(1)}`;
        }
        li.innerHTML = `<span class="p">${i + 1}</span><span class="sw" style="background:${c.team.color}"></span><span class="n"></span><span class="g">${gap}</span>`;
        li.querySelector('.n').textContent = c.name;
        lb.appendChild(li);
      });
    }
  }

  // ---------- Résultats ----------
  function showResults() {
    const race = game.race, p = race.player;
    game.resultsShown = true;
    game.state = 'results';
    $('results').classList.remove('hidden');
    $('touch').classList.add('hidden');
    const pos = p.finishPos;
    $('results-title').textContent = pos === 1 ? 'Victoire !' : pos <= 3 ? `Podium : P${pos}` : `Arrivée : P${pos}`;
    // Record du circuit
    const recKey = 'record-' + race.track.def.id;
    const rec = store.get(recKey, null);
    let sub = `${race.track.name} · ${race.laps} tour${race.laps > 1 ? 's' : ''} · ${F1.DIFFICULTIES[settings.difficulty].label}`;
    if (isFinite(p.bestLap)) {
      if (!rec || p.bestLap < rec) {
        if (!game.recordSaved) { store.set(recKey, p.bestLap); game.recordSaved = true; }
        sub += ` · Nouveau record du circuit : ${fmt(p.bestLap)} !`;
      } else {
        sub += ` · Record : ${fmt(rec)}`;
      }
    }
    $('results-sub').textContent = sub;
    fillResults();
    $('btn-again').focus();
  }

  function fillResults() {
    const race = game.race;
    const body = $('results-body');
    body.innerHTML = '';
    const st = race.standings();
    const winner = race.finishOrder[0];
    st.forEach((c, i) => {
      const tr = document.createElement('tr');
      if (c.isPlayer) tr.className = 'me';
      let time;
      if (!c.finished) time = '<span class="pending">en course…</span>';
      else if (c === winner) time = fmt(c.finishTime);
      else time = '+' + (c.finishTime - winner.finishTime).toFixed(3);
      const fastest = race.bestLap.car === c ? ' class="fastest"' : '';
      tr.innerHTML = `<td>${i + 1}</td><td><span class="swatch" style="background:${c.team.color}"></span><span class="nm"></span></td><td>${c.team.name}</td><td>${time}</td><td${fastest}>${fmt(c.bestLap)}</td>`;
      tr.querySelector('.nm').textContent = c.name;
      body.appendChild(tr);
    });
  }

  // ---------- Boucle ----------
  const STEP = 1 / 120;
  let last = performance.now();
  let acc = 0;

  function frame(now) {
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.t += dt;
    const race = game.race;

    if (game.state === 'paused') dt = 0;

    // Feux de départ
    if (game.state === 'countdown') {
      game.countdown += dt;
      const n = Math.min(5, Math.floor(game.countdown));
      if (n > game.lightsShown) {
        game.lightsShown = n;
        document.querySelectorAll('.light').forEach((l, i) => l.classList.toggle('on', i < n));
        audio.beep(440, 0.18);
      }
      if (game.countdown >= game.lightsOutAt) {
        document.querySelectorAll('.light').forEach((l) => l.classList.remove('on'));
        audio.beep(880, 0.45, 0.2);
        race.started = true;
        game.state = 'race';
        banner('Go !', 'go');
        setTimeout(() => { if (game.state === 'race' && $('banner').classList.contains('go')) hideBanner(); }, 1000);
        setTimeout(() => $('lights').classList.add('hidden'), 1000);
      }
    }

    // Simulation à pas fixe
    if (dt > 0 && race) {
      acc += dt;
      const input = game.state === 'race' ? readInput() : null;
      while (acc >= STEP) {
        race.step(STEP, input);
        acc -= STEP;
        if (!game.demo && race.hits) {
          for (const h of race.hits) if ((h.a.isPlayer || h.b.isPlayer) && h.force > 120) audio.thud(h.force);
        }
        if (!game.demo && race.player && race.player.wallHit > 150) { audio.thud(race.player.wallHit); }
        if (race.player) race.player.wallHit = 0;
      }
      renderer.effects(race.cars, dt);
    }

    if (race && game.demo) race.events.length = 0;

    // Évènements de course
    if (race && !game.demo) {
      const p = race.player;
      for (const ev of race.events) {
        if (ev.type === 'fastest' && race.time > 0) {
          if (ev.car === p) toast(`Meilleur tour : ${fmt(ev.time)}`, 'purple');
        } else if (ev.type === 'lap' && ev.car === p) {
          if (ev.lap === race.laps) toast('Dernier tour !');
          else toast(`Tour ${ev.lap} · ${fmt(ev.time)}`);
        } else if (ev.type === 'finish' && ev.car === p) {
          banner(ev.pos === 1 ? 'Victoire !' : `Arrivée : P${ev.pos}`, ev.pos === 1 ? 'go' : '');
          game.finishTimer = 3;
          audio.beep(660, 0.3, 0.15);
          setTimeout(() => audio.beep(990, 0.5, 0.15), 180);
        }
      }
      race.events.length = 0;

      if (game.state === 'race' && p) {
        if (p.finished) {
          game.finishTimer -= dt;
          if (game.finishTimer <= 0 && !game.resultsShown) { hideBanner(); showResults(); }
        } else if (p.wrongWay > 1.2) banner('Mauvais sens !', 'warn');
        else if ($('banner').classList.contains('warn')) hideBanner();
      }
      if (game.state === 'results') {
        game.hudTimer -= dt;
        if (game.hudTimer <= 0) { fillResults(); game.hudTimer = 0.5; }
      }

      if (game.state !== 'menu' && game.state !== 'paused') {
        const gear = audio.engine(p, game.state === 'race' || game.state === 'countdown' || game.state === 'results');
        $('hud-gear').textContent = p.speed < 5 ? 'N' : gear || 1;
      }
      if (game.state === 'race' || game.state === 'countdown') {
        game.hudTimer -= dt;
        updateHud(false);
      }
      if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').classList.remove('show'); }
    }

    if (race) {
      const focus = game.demo ? race.standings()[0] : race.player;
      renderer.draw(race, focus, game.t, game.state === 'paused' ? 0 : dt);
      if (!game.demo) renderer.drawMinimap(minimapCtx, race);
    }
    requestAnimationFrame(frame);
  }

  // ---------- Menu ----------
  function buildMenu() {
    const tl = $('track-list');
    F1.TRACKS.forEach((def) => {
      const b = document.createElement('button');
      b.className = 'track-card';
      b.dataset.id = def.id;
      b.innerHTML = `<canvas width="320" height="240"></canvas><span class="t-name"></span><span class="t-desc"></span><span class="t-rec"></span>`;
      b.querySelector('.t-name').textContent = def.name;
      b.querySelector('.t-desc').textContent = def.desc;
      const track = F1.drawTrackPreview(b.querySelector('canvas'), def);
      b.querySelector('.t-desc').textContent += ` ${(track.length / 10000).toFixed(2)} km.`;
      b.addEventListener('click', () => {
        settings.track = def.id;
        saveSettings();
        selectButtons();
        startDemo();
      });
      tl.appendChild(b);
    });

    const teamList = $('team-list');
    F1.TEAMS.forEach((team) => {
      const b = document.createElement('button');
      b.className = 'team-card';
      b.dataset.id = team.id;
      b.innerHTML = `<canvas width="68" height="92"></canvas><span></span>`;
      b.querySelector('span').textContent = team.name;
      F1.drawCarPreview(b.querySelector('canvas'), team);
      b.addEventListener('click', () => { settings.team = team.id; saveSettings(); selectButtons(); });
      teamList.appendChild(b);
    });

    $('laps-seg').querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => { settings.laps = +b.dataset.v; saveSettings(); selectButtons(); }));
    $('diff-seg').querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => { settings.difficulty = b.dataset.v; saveSettings(); selectButtons(); }));

    const nameInput = $('player-name');
    nameInput.value = settings.name;
    nameInput.addEventListener('input', () => { settings.name = nameInput.value; saveSettings(); });
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startRace(); });

    $('btn-start').addEventListener('click', startRace);
    $('btn-resume').addEventListener('click', togglePause);
    $('btn-restart').addEventListener('click', startRace);
    $('btn-quit').addEventListener('click', showMenu);
    $('btn-again').addEventListener('click', startRace);
    $('btn-menu').addEventListener('click', showMenu);
    $('btn-pause').addEventListener('click', togglePause);
    $('btn-mute').addEventListener('click', toggleMute);
    selectButtons();
    refreshRecords();
  }

  function refreshRecords() {
    document.querySelectorAll('.track-card').forEach((b) => {
      const rec = store.get('record-' + b.dataset.id, null);
      b.querySelector('.t-rec').textContent = rec ? `Record : ${fmt(rec)}` : '';
    });
  }

  function selectButtons() {
    document.querySelectorAll('.track-card').forEach((b) => b.classList.toggle('selected', b.dataset.id === settings.track));
    document.querySelectorAll('.team-card').forEach((b) => b.classList.toggle('selected', b.dataset.id === settings.team));
    $('laps-seg').querySelectorAll('button').forEach((b) => b.classList.toggle('selected', +b.dataset.v === settings.laps));
    $('diff-seg').querySelectorAll('button').forEach((b) => b.classList.toggle('selected', b.dataset.v === settings.difficulty));
  }

  function saveSettings() { store.set('settings', settings); }

  window.addEventListener('resize', () => renderer.resize());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (game.state === 'race' || game.state === 'countdown')) togglePause();
  });

  buildMenu();
  startDemo();
  requestAnimationFrame(frame);
})();
