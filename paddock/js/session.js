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
  const touch = { left: false, right: false, gas: false, brake: false };
  const KEYMAP = {
    ArrowUp: 'gas', KeyW: 'gas', KeyZ: 'gas',
    ArrowDown: 'brake', KeyS: 'brake',
    ArrowLeft: 'left', KeyA: 'left', KeyQ: 'left',
    ArrowRight: 'right', KeyD: 'right',
  };
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = KEYMAP[e.code];
    if (k && S.state !== 'idle') { keys.add(k); e.preventDefault(); }
    if (e.repeat) return;
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
    if (e.code === 'KeyM') toggleMute();
    if (e.code === 'KeyR' && S.state === 'run' && S.race.player && !S.race.player.finished) {
      S.race.player.resetOnTrack(S.race.track);
    }
  });
  window.addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) keys.delete(k); });
  window.addEventListener('blur', () => keys.clear());

  let padStart = false;
  function readInput() {
    let steer = 0, throttle = 0, brake = 0;
    if (keys.has('left') || touch.left) steer -= 1;
    if (keys.has('right') || touch.right) steer += 1;
    if (keys.has('gas') || touch.gas) throttle = 1;
    if (keys.has('brake') || touch.brake) brake = 1;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.15) steer = Math.max(-1, Math.min(1, steer + ax));
      const rt = gp.buttons[7] ? gp.buttons[7].value : 0;
      const lt = gp.buttons[6] ? gp.buttons[6].value : 0;
      throttle = Math.max(throttle, rt, gp.buttons[0] && gp.buttons[0].pressed ? 1 : 0);
      brake = Math.max(brake, lt, gp.buttons[1] && gp.buttons[1].pressed ? 1 : 0);
      const st = !!(gp.buttons[9] && gp.buttons[9].pressed);
      if (st && !padStart) togglePause();
      padStart = st;
      break;
    }
    return { steer, throttle, brake };
  }

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

  // ---------- État ----------
  const renderer = new F1.Renderer($('game'));
  const audio = new F1.Audio();
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
    S.race = new F1.Race({ track, entries: o.entries, laps: o.laps, mode: o.mode });
    renderer.setScene(F1.buildScene(track));
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
      dnf: false,
      time: c.finished ? c.finishTime : null,
      gap: c.finished && winner ? c.finishTime - winner.finishTime : null,
      lapsDown: c.finished ? 0 : Math.max(0, (st[0].wrap - c.wrap)),
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

    if (!quali && (force || S.hudTimer <= 0)) {
      S.hudTimer = 0.3;
      const st = race.standings();
      const me = st.indexOf(p);
      const show = new Set([0, 1, 2]);
      for (let i = me - 3; i <= me + 3; i++) if (i >= 0 && i < st.length) show.add(i);
      const lb = $('leaderboard');
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
        if (i === 0) gap = c.finished ? 'Arrivé' : 'Leader';
        else if (race.started) {
          const down = st[0].wrap - c.wrap - (st[0].idx < c.idx ? 1 : 0);
          gap = down >= 1 && !c.finished ? `+${down} t.` : `+${Math.max(0, c.gap).toFixed(1)}`;
        }
        li.innerHTML = `<span class="p">${i + 1}</span><span class="sw" style="background:${c.team.color}"></span><span class="n"></span><span class="g">${gap}</span>`;
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
      const input = S.state === 'run' ? readInput() : null;
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
        } else if (ev.type === 'fastest' && ev.car === p) toast(`Meilleur tour : ${fmt(ev.time)}`, 'purple');
        else if (ev.type === 'lap' && ev.car === p) toast(ev.lap === race.laps ? 'Dernier tour !' : `Tour ${ev.lap} · ${fmt(ev.time)}`);
        else if (ev.type === 'finish' && ev.car === p) {
          banner(ev.pos === 1 ? 'Victoire !' : `Arrivée : P${ev.pos}`, ev.pos === 1 ? 'go' : '');
          S.finishTimer = 3;
          audio.beep(660, 0.3, 0.15);
          setTimeout(() => audio.beep(990, 0.5, 0.15), 180);
        }
      }
      race.events.length = 0;

      if (S.state === 'run' && race.mode === 'race' && p) {
        if (p.finished) {
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
      renderer.draw(race, focus, S.t, S.state === 'paused' ? 0 : dt);
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
    body.innerHTML = `<p class="big-time">${fmt(time)}</p><p class="subtitle">Meilleur temps : ${fmt(best)}${prov ? ` · Position provisoire : <b>P${prov}</b>` : ''}</p>`;
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
      if (!c.finished) gap = '<span class="pending">en piste…</span>';
      else if (i === 0) gap = fmt(c.finishTime);
      else gap = '+' + (c.finishTime - race.finishOrder[0].finishTime).toFixed(3);
      tr.innerHTML = `<td>${i + 1}</td><td><span class="swatch" style="background:${c.team.color}"></span><span class="nm"></span></td><td>${gap}</td>`;
      tr.querySelector('.nm').textContent = c.name;
      tb.appendChild(tr);
    });
  }

  window.addEventListener('resize', () => renderer.resize());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (S.state === 'run' || S.state === 'countdown')) togglePause();
  });

  F1.Session = { start, demo, state: () => S.state, race: () => S.race, audio };
  requestAnimationFrame(frame);
})();
