'use strict';
// Menus : accueil, course rapide, création de carrière, tableau de bord de carrière.
(function () {
  const F1 = window.F1;
  const C = F1.Career;
  const fmt = F1.fmt;
  const $ = (id) => document.getElementById(id);
  const screen = $('screen');

  // ---------- Petit utilitaire de création d'éléments ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const k of kids.flat()) {
      if (k == null || k === false) continue;
      el.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
    }
    return el;
  }

  function show(...nodes) {
    screen.innerHTML = '';
    screen.append(...nodes);
    screen.classList.remove('hidden');
    screen.scrollTop = 0;
  }

  function card(title, ...kids) {
    return h('div', { class: 'menu-card wide' }, title ? h('h2', { class: 'screen-title' }, title) : null, ...kids);
  }

  function backBtn(fn, label) { return h('button', { class: 'back', onclick: fn }, '← ' + (label || 'Retour')); }

  function seg(options, current, onPick) {
    const wrap = h('div', { class: 'seg' });
    for (const [v, label] of options) {
      wrap.appendChild(h('button', { class: v === current ? 'selected' : '', onclick: () => onPick(v) }, label));
    }
    return wrap;
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem('paddock-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('paddock-' + k, JSON.stringify(v)); } catch (e) { /* ignoré */ } },
  };

  const teamById = (id) => F1.TEAMS2026.find((t) => t.id === id);
  const stars = (rating) => {
    const n = Math.max(1, Math.min(5, Math.round((rating - 70) / 4.5)));
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  };

  function carCanvas(team, w, hgt) {
    const c = h('canvas', { width: w * 2, height: hgt * 2, style: `width:${w}px;height:${hgt}px` });
    F1.drawCarPreview(c, team);
    return c;
  }

  function trackCanvas(gp, w, hgt, color) {
    const c = h('canvas', { width: w * 2, height: hgt * 2, style: `width:100%;max-width:${w}px;aspect-ratio:${w}/${hgt}` });
    F1.drawTrackPreview(c, gp, { color });
    return c;
  }

  function teamCard(team, opts) {
    const drivers = (opts && opts.drivers) || [];
    return h('button', { class: 'team-card' + (opts && opts.selected ? ' selected' : ''), style: `--team:${team.color}`, onclick: opts && opts.onclick },
      carCanvas(team, 70, 44),
      h('span', { class: 'tc-body' },
        h('span', { class: 'tc-name' }, team.name),
        h('span', { class: 'tc-meta' }, `Moteur ${F1.ENGINES[team.engine].name} · ${stars(C.carRating(team))}`),
        drivers.length ? h('span', { class: 'tc-meta' }, drivers.map((d) => d.last).join(' · ')) : null,
        opts && opts.extra ? h('span', { class: 'tc-meta' }, opts.extra) : null));
  }

  function driverCard(d, team, opts) {
    return h('button', { class: 'driver-card' + (opts && opts.selected ? ' selected' : ''), style: `--team:${team ? team.color : '#888'}`, onclick: opts && opts.onclick },
      h('span', { class: 'dc-num' }, String(d.num)),
      h('span', { class: 'dc-body' },
        h('span', { class: 'dc-name' }, `${d.flag} ${d.first} `, h('b', null, d.last.toUpperCase())),
        h('span', { class: 'dc-meta' }, `${team ? team.name : 'Libre'} · Vitesse ${Math.round(d.pace)} · Course ${Math.round(d.craft)}`)));
  }

  function driverGrid(drivers, teamsLookup, selectedId, onPick) {
    const g = h('div', { class: 'driver-grid' });
    for (const d of drivers) {
      g.appendChild(driverCard(d, teamsLookup(d.team), { selected: d.id === selectedId, onclick: () => onPick(d.id) }));
    }
    return g;
  }

  // ---------- Accueil ----------
  function home() {
    const save = C.load();
    if (!F1.Session.state || F1.Session.state() === 'idle') F1.Session.demo(F1.CALENDAR[(Math.random() * 24) | 0]);
    const items = [];
    if (save) {
      const t = save.teams.find((x) => x.id === save.playerTeam);
      const d = save.drivers.find((x) => x.id === save.playerDriver);
      items.push(h('button', { class: 'home-btn primary', onclick: () => hub(save) },
        h('span', { class: 'hb-title' }, 'Continuer la carrière'),
        h('span', { class: 'hb-sub' }, `${save.mode === 'team' ? 'Écurie' : 'Pilote'} · ${save.mode === 'team' ? t.name : `${d.first} ${d.last} (${t.name})`} · Saison ${save.season} · Manche ${Math.min(24, save.round + 1)}/24`)));
    }
    items.push(h('button', { class: 'home-btn' + (save ? '' : ' primary'), onclick: () => { if (!save || confirm('Une carrière est déjà en cours. La remplacer ?')) careerMode(); } },
      h('span', { class: 'hb-title' }, 'Nouvelle carrière'),
      h('span', { class: 'hb-sub' }, 'Mode pilote ou mode écurie, 24 Grands Prix')));
    items.push(h('button', { class: 'home-btn', onclick: quickRace },
      h('span', { class: 'hb-title' }, 'Course rapide'),
      h('span', { class: 'hb-sub' }, 'Circuit, écurie, pilote, météo et aides')));
    items.push(h('button', { class: 'home-btn', onclick: () => settingsScreen(home) },
      h('span', { class: 'hb-title' }, 'Aides et commandes'),
      h('span', { class: 'hb-sub' }, 'Sensibilité, aides au pilotage, aéro active')));

    show(h('div', { class: 'menu-card home' },
      h('header', { class: 'title' },
        h('div', { class: 'stripes' }),
        h('h1', null, 'Paddock ', h('span', null, '2026')),
        h('p', { class: 'subtitle' }, '24 circuits · 11 écuries · 22 pilotes · mode carrière')),
      h('div', { class: 'home-list' }, items),
      installHint(),
      h('details', { class: 'help' },
        h('summary', null, 'Commandes'),
        h('ul', { html: '<li><kbd>↑</kbd> / <kbd>W</kbd> / <kbd>Z</kbd> : accélérer · <kbd>↓</kbd> / <kbd>S</kbd> : freiner</li><li><kbd>←</kbd> <kbd>→</kbd> / <kbd>A</kbd> <kbd>Q</kbd> <kbd>D</kbd> : tourner</li><li><kbd>R</kbd> : se replacer · <kbd>Échap</kbd> / <kbd>P</kbd> : pause · <kbd>M</kbd> : son</li><li>Manette : stick gauche, RT / LT · Mobile : boutons à l\'écran</li>' })),
      h('p', { class: 'disclaimer' }, 'Jeu de fan non officiel, sans lien avec la Formule 1, la FIA ou les écuries. Tracés : données ouvertes « f1-circuits » (licence MIT).')));
  }

  // Aide à l'installation sur iPhone / iPad (Safari, hors application installée)
  function installHint() {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = navigator.standalone || window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches;
    if (!ios || standalone || window.self !== window.top) return null;
    return h('div', { class: 'install-hint' },
      h('b', null, '📲 Installer le jeu sur cet appareil'),
      h('span', null, 'Touchez le bouton Partager ', h('span', { class: 'share-ico' }, '⬆︎'), ' de Safari, puis « Sur l\'écran d\'accueil ». Le jeu s\'ouvrira en plein écran, même hors connexion.'));
  }

  // ---------- Course rapide : circuit → écurie → pilote → réglages ----------
  const qs = Object.assign({ gp: 'au-1953', team: 'ferrari', driver: 'lec', length: '3', quali: 'sim' }, store.get('quick', {}));
  const saveQs = () => store.set('quick', qs);

  function stepper(n) {
    const labels = ['Circuit', 'Écurie', 'Pilote', 'Réglages'];
    return h('div', { class: 'stepper' }, labels.map((l, i) => h('span', { class: i === n ? 'on' : i < n ? 'done' : '' }, `${i + 1}. ${l}`)));
  }

  function quickRace() {
    const list = h('div', { class: 'circuit-list' });
    F1.CALENDAR.forEach((gp, i) => {
      const track = F1.getTrack(gp);
      list.appendChild(h('button', { class: 'circuit-row' + (gp.id === qs.gp ? ' selected' : ''), onclick: () => { qs.gp = gp.id; saveQs(); quickTeam(); } },
        h('span', { class: 'cr-flag' }, gp.flag),
        h('span', { class: 'cr-body' },
          h('span', { class: 'cr-name' }, gp.gp.replace('Grand Prix ', 'GP ')),
          h('span', { class: 'cr-meta' }, `${gp.circuit} · ${gp.place} · ${(track.length / 10000).toFixed(3)} km · ${gp.laps} tours`)),
        h('span', { class: 'cr-round' }, `${i + 1}`),
        trackCanvas(gp, 90, 60)));
    });
    show(card('Course rapide', backBtn(home), stepper(0), h('h3', null, 'Choisissez le circuit'), list));
  }

  function quickTeam() {
    const g = h('div', { class: 'team-grid' });
    for (const t of F1.TEAMS2026) {
      g.appendChild(teamCard(t, {
        selected: t.id === qs.team,
        drivers: F1.DRIVERS2026.filter((d) => d.team === t.id),
        onclick: () => { qs.team = t.id; saveQs(); quickDriver(); },
      }));
    }
    const gp = F1.CALENDAR.find((x) => x.id === qs.gp);
    show(card(`${gp.flag} ${gp.gp}`, backBtn(quickRace, 'Circuits'), stepper(1), h('h3', null, 'Choisissez votre écurie'), g));
  }

  function quickDriver() {
    const t = teamById(qs.team);
    const g = h('div', { class: 'driver-pick' });
    for (const d of F1.DRIVERS2026.filter((x) => x.team === t.id)) {
      g.appendChild(h('button', { class: 'driver-big' + (d.id === qs.driver ? ' selected' : ''), style: `--team:${t.color}`, onclick: () => { qs.driver = d.id; saveQs(); quickSettings(); } },
        h('span', { class: 'db-num' }, String(d.num)),
        h('span', { class: 'db-flag' }, d.flag),
        h('span', { class: 'db-first' }, d.first),
        h('span', { class: 'db-last' }, d.last.toUpperCase()),
        h('span', { class: 'db-meta' }, `Vitesse ${d.pace} · Course ${d.craft}`)));
    }
    show(card(t.name, backBtn(quickTeam, 'Écuries'), stepper(2), h('h3', null, 'Choisissez votre pilote'), carCanvas(t, 160, 100), g));
  }

  // Bloc de réglages partagé (course rapide, carrière, accueil)
  function settingsPanel(rerender, opts) {
    const S = F1.Settings, st = S.get();
    const toggle = (key, label, desc) => h('button', { class: 'toggle' + (st.assists[key] ? ' on' : ''), onclick: () => { S.set({ assists: { [key]: !st.assists[key] } }); rerender(); } },
      h('span', { class: 'tg-label' }, label), h('span', { class: 'tg-desc' }, desc), h('span', { class: 'tg-state' }, st.assists[key] ? 'Activé' : 'Désactivé'));
    const parts = [];
    if (opts && opts.weather) {
      parts.push(h('section', null, h('h3', null, 'Météo'), seg(Object.entries(S.WEATHER_CHOICES), st.weather, (v) => { S.set({ weather: v }); rerender(); })));
    }
    if (opts && opts.difficulty) {
      parts.push(h('section', null, h('h3', null, 'Difficulté de l\'IA'), seg(Object.entries(F1.DIFFICULTIES).map(([k, v]) => [k, v.label]), st.difficulty, (v) => { S.set({ difficulty: v }); rerender(); })));
    }
    parts.push(h('section', null, h('h3', null, 'Aides au pilotage'),
      h('div', { class: 'toggles' },
        toggle('brake', 'Freinage assisté', 'Freine automatiquement avant les virages'),
        toggle('tc', 'Antipatinage / stabilité', 'Limite les dérapages et le patinage'),
        toggle('steer', 'Direction assistée', 'Aide à suivre la trajectoire'),
        toggle('line', 'Trajectoire idéale', 'Ligne verte, rouge aux freinages'))));
    parts.push(h('div', { class: 'row' },
      h('section', null, h('h3', null, 'Sensibilité de la direction'), seg(Object.entries(S.SENS).map(([k, v]) => [k, v.label]), st.sens, (v) => { S.set({ sens: v }); rerender(); })),
      h('section', null, h('h3', null, 'Aéro active'), seg(Object.entries(S.AERO), st.aero, (v) => { S.set({ aero: v }); rerender(); }))));
    parts.push(h('p', { class: 'hint' }, 'Batterie : elle se vide en accélérant et se recharge au freinage. ⚡ / touche E : boost (plus de puissance, vide la batterie plus vite). Aéro active manuelle : bouton AÉRO / Espace dans les lignes droites ; elle se referme au freinage.'));
    return parts;
  }

  function quickSettings() {
    const gp = F1.CALENDAR.find((x) => x.id === qs.gp);
    const d = F1.DRIVERS2026.find((x) => x.id === qs.driver);
    const t = teamById(qs.team);
    show(card('Réglages de la course',
      backBtn(quickDriver, 'Pilotes'), stepper(3),
      h('p', { class: 'summary' }, `${gp.flag} ${gp.gp} · ${t.name} · ${d.flag} ${d.first} ${d.last} (#${d.num})`),
      ...settingsPanel(quickSettings, { weather: true, difficulty: true }),
      h('div', { class: 'row' },
        h('section', null, h('h3', null, 'Distance'), seg(F1.RACE_LENGTHS.map((r) => [r.id, r.id.length <= 1 ? r.label : `${r.label} (${r.laps(gp)} t.)`]), qs.length, (v) => { qs.length = v; saveQs(); quickSettings(); })),
        h('section', null, h('h3', null, 'Qualifications'), seg([['sim', 'Simulées'], ['play', 'Jouées']], qs.quali, (v) => { qs.quali = v; saveQs(); quickSettings(); }))),
      h('button', { class: 'primary big', onclick: startQuick }, 'Départ')));
  }

  function settingsScreen(back) {
    show(card('Aides et commandes', backBtn(back), ...settingsPanel(() => settingsScreen(back), {})));
  }

  function quickCareer() {
    // Une « carrière » temporaire non sauvegardée sert de base aux calculs
    const c = {
      difficulty: F1.Settings.get().difficulty, raceLength: qs.length, season: 2026, round: F1.CALENDAR.findIndex((g) => g.id === qs.gp), seed: (Math.random() * 1e9) | 0,
      teams: JSON.parse(JSON.stringify(F1.TEAMS2026)), drivers: JSON.parse(JSON.stringify(F1.DRIVERS2026)), playerDriver: qs.driver,
    };
    return c;
  }

  function startQuick() {
    const c = quickCareer();
    const gp = F1.CALENDAR[c.round];
    let weather = F1.Settings.get().weather;
    if (weather === 'random') weather = F1.Settings.rollWeather(gp.id);
    const go = (playerTime) => {
      const q = C.simQuali(c, gp, playerTime);
      F1.Session.start({
        gp, mode: 'race', laps: C.lapsFor(c, gp), entries: C.entries(c, q.order, c.playerDriver), allowRestart: true,
        title: gp.gp, weather,
        onEnd: (res) => { if (!res) return quickSettings(); showRaceResults(c, gp, res, quickSettings, q); },
      });
    };
    if (qs.quali === 'play') {
      F1.Session.start({
        gp, mode: 'quali', entries: C.entries(c, [c.playerDriver], c.playerDriver), weather,
        provisional: (t) => C.simQuali(c, gp, t).order.indexOf(c.playerDriver) + 1,
        onEnd: (res) => go(res && res.time != null ? res.time : 9999),
      });
    } else go();
  }

  // Résultats d'une course (rapide ou carrière)
  function showRaceResults(c, gp, res, onContinue, quali, rows) {
    const list = rows || res.order.map((o, i) => ({ id: o.id, pos: i + 1, dnf: o.dnf, gap: o.gap, time: o.time, lapsDown: o.lapsDown, pts: !o.dnf && i < 10 ? F1.POINTS[i] : 0 }));
    const tbody = h('tbody');
    list.forEach((r, i) => {
      const d = C.driver(c, r.id);
      const t = C.team(c, d.team);
      let gap;
      if (r.dnf) gap = 'Abandon';
      else if (i === 0 && r.time != null) gap = fmt(r.time);
      else if (r.gap != null) gap = '+' + r.gap.toFixed(3);
      else gap = r.lapsDown > 0 ? `+${r.lapsDown} tour${r.lapsDown > 1 ? 's' : ''}` : '—';
      const grid = quali ? quali.order.indexOf(r.id) + 1 : null;
      tbody.appendChild(h('tr', { class: d.id === c.playerDriver ? 'me' : '' },
        h('td', null, String(r.pos)),
        h('td', null, h('span', { class: 'swatch', style: `background:${t.color}` }), `${d.flag} ${d.first} ${d.last}`, res.fastest === r.id ? h('span', { class: 'fl', title: 'Meilleur tour' }, ' ⏱') : null),
        h('td', { class: 'hide-sm' }, t.name),
        h('td', { class: 'hide-sm' }, grid ? String(grid) : ''),
        h('td', null, gap),
        h('td', null, r.pts ? `+${r.pts}` : '')));
    });
    const me = list.find((r) => r.id === c.playerDriver);
    show(card(`${gp.flag} ${gp.gp}`,
      h('p', { class: 'subtitle' }, me ? (me.dnf ? 'Abandon.' : `Vous terminez P${me.pos}${me.pts ? ` (+${me.pts} pts)` : ''}.`) : ''),
      res.fastest ? h('p', { class: 'subtitle' }, `Meilleur tour : ${C.fullName(C.driver(c, res.fastest))} en ${fmt(res.fastestTime)}`) : null,
      h('div', { class: 'table-wrap' }, h('table', { class: 'results-table' },
        h('thead', null, h('tr', null, h('th', null, 'Pos'), h('th', null, 'Pilote'), h('th', { class: 'hide-sm' }, 'Écurie'), h('th', { class: 'hide-sm' }, 'Grille'), h('th', null, 'Temps'), h('th', null, 'Pts'))),
        tbody)),
      h('button', { class: 'primary big', onclick: onContinue }, 'Continuer')));
  }

  // ---------- Nouvelle carrière ----------
  let wiz = null;
  function careerMode() {
    wiz = { difficulty: 'normal', raceLength: '5' };
    show(card('Nouvelle carrière',
      backBtn(home),
      h('div', { class: 'choice-grid' },
        h('button', { class: 'choice', onclick: () => { wiz.mode = 'driver'; driverChoice(); } },
          h('span', { class: 'choice-icon' }, '🏎️'),
          h('span', { class: 'choice-title' }, 'Mode pilote'),
          h('span', { class: 'choice-desc' }, 'Pilotez un des 22 pilotes 2026, ou créez votre écurie et choisissez votre pilote. Battez votre coéquipier, gagnez en réputation, recevez des offres.')),
        h('button', { class: 'choice', onclick: () => { wiz.mode = 'team'; teamChoice(); } },
          h('span', { class: 'choice-icon' }, '🛠️'),
          h('span', { class: 'choice-title' }, 'Mode écurie'),
          h('span', { class: 'choice-desc' }, 'Dirigez une des 11 écuries 2026 ou créez la 12e. Gérez le budget, développez la voiture et pilotez l\'un de vos deux pilotes.')))));
  }

  // Mode pilote : pilote existant ou nouvelle écurie
  function driverChoice() {
    show(card('Mode pilote',
      backBtn(careerMode),
      h('div', { class: 'choice-grid' },
        h('button', { class: 'choice', onclick: pickExistingDriver },
          h('span', { class: 'choice-icon' }, '👤'),
          h('span', { class: 'choice-title' }, 'Choisir un pilote 2026'),
          h('span', { class: 'choice-desc' }, 'Prenez la place de l\'un des 22 pilotes de la grille, dans son écurie.')),
        h('button', { class: 'choice', onclick: () => teamForm(customTeamDriver) },
          h('span', { class: 'choice-icon' }, '✨'),
          h('span', { class: 'choice-title' }, 'Créer une nouvelle écurie'),
          h('span', { class: 'choice-desc' }, 'Fondez la 12e écurie, puis créez votre pilote ou recrutez un pilote 2026.')))));
  }

  function pickExistingDriver() {
    show(card('Choisissez votre pilote',
      backBtn(driverChoice),
      driverGrid(F1.DRIVERS2026, teamById, wiz.driverId, (id) => {
        wiz.driverId = id;
        wiz.team = { id: F1.DRIVERS2026.find((d) => d.id === id).team };
        wiz.driver = { id };
        settings(pickExistingDriver);
      })));
  }

  function customTeamDriver() {
    show(card(`${wiz.team.custom.name} : votre pilote`,
      backBtn(() => teamForm(customTeamDriver)),
      h('div', { class: 'choice-grid' },
        h('button', { class: 'choice', onclick: () => driverForm((drv) => { wiz.driver = { custom: drv }; settings(customTeamDriver); }, customTeamDriver) },
          h('span', { class: 'choice-icon' }, '🧑‍🚀'),
          h('span', { class: 'choice-title' }, 'Créer mon pilote'),
          h('span', { class: 'choice-desc' }, 'Nom, numéro, nationalité : c\'est vous au volant.')),
        h('button', { class: 'choice', onclick: pickDriverForNewTeam },
          h('span', { class: 'choice-icon' }, '🤝'),
          h('span', { class: 'choice-title' }, 'Prendre un pilote 2026'),
          h('span', { class: 'choice-desc' }, 'Recrutez l\'un des 22 pilotes. Un pilote libre le remplace dans son ancienne écurie.')))));
  }

  function pickDriverForNewTeam() {
    show(card('Recrutez votre pilote',
      backBtn(customTeamDriver),
      driverGrid(F1.DRIVERS2026, teamById, null, (id) => { wiz.driver = { id }; settings(pickDriverForNewTeam); })));
  }

  // Mode écurie : écurie existante ou 12e écurie
  function teamChoice() {
    show(card('Mode écurie',
      backBtn(careerMode),
      h('div', { class: 'choice-grid' },
        h('button', { class: 'choice', onclick: pickExistingTeam },
          h('span', { class: 'choice-icon' }, '🏁'),
          h('span', { class: 'choice-title' }, 'Reprendre une écurie 2026'),
          h('span', { class: 'choice-desc' }, 'Choisissez l\'une des 11 écuries, avec ses deux pilotes et son budget.')),
        h('button', { class: 'choice', onclick: () => teamForm(pickTeamDrivers) },
          h('span', { class: 'choice-icon' }, '✨'),
          h('span', { class: 'choice-title' }, 'Créer la 12e écurie'),
          h('span', { class: 'choice-desc' }, 'Nom, couleurs, motoriste, puis recrutez vos deux pilotes.')))));
  }

  function pickExistingTeam() {
    const g = h('div', { class: 'team-grid' });
    for (const t of F1.TEAMS2026) {
      g.appendChild(teamCard(t, {
        drivers: F1.DRIVERS2026.filter((d) => d.team === t.id),
        extra: `Budget ${t.budget} M€`,
        onclick: () => { wiz.team = { id: t.id }; wiz.driver = null; settings(pickExistingTeam); },
      }));
    }
    show(card('Choisissez votre écurie', backBtn(teamChoice), g));
  }

  // Formulaire de création d'écurie
  function teamForm(next) {
    const t = Object.assign({ name: '', short: '', color: '#0fb5ae', color2: '#ffffff', engine: 'mercedes' }, wiz.team && wiz.team.custom);
    const preview = h('canvas', { width: 220, height: 140, style: 'width:110px;height:70px' });
    const redraw = () => F1.drawCarPreview(preview, { color: t.color, color2: t.color2 });
    const name = h('input', { value: t.name, maxlength: 24, placeholder: 'Ex. : Tahiti Racing', oninput: (e) => { t.name = e.target.value; } });
    const short = h('input', { value: t.short, maxlength: 3, placeholder: 'TAH', style: 'text-transform:uppercase', oninput: (e) => { t.short = e.target.value.toUpperCase(); } });
    const c1 = h('input', { type: 'color', value: t.color, oninput: (e) => { t.color = e.target.value; redraw(); } });
    const c2 = h('input', { type: 'color', value: t.color2, oninput: (e) => { t.color2 = e.target.value; redraw(); } });
    const eng = h('select', { onchange: (e) => { t.engine = e.target.value; } },
      Object.entries(F1.ENGINES).map(([k, v]) => h('option', { value: k, selected: k === t.engine }, `${v.name} (puissance ${v.power})`)));
    const err = h('p', { class: 'error' });
    show(card('Créer votre écurie',
      backBtn(wiz.mode === 'team' ? teamChoice : driverChoice),
      h('div', { class: 'form' },
        h('label', null, 'Nom de l\'écurie', name),
        h('label', null, 'Abréviation (3 lettres)', short),
        h('div', { class: 'row' },
          h('label', null, 'Couleur principale', c1),
          h('label', null, 'Couleur secondaire', c2),
          h('div', { class: 'preview' }, preview)),
        h('label', null, 'Motoriste', eng),
        h('p', { class: 'hint' }, 'Une nouvelle écurie démarre avec une voiture moins performante que les équipes établies (aéro 76, châssis 76, fiabilité 80) et un budget de 120 M€.')),
      err,
      h('button', { class: 'primary big', onclick: () => {
        if (!t.name.trim()) { err.textContent = 'Donnez un nom à votre écurie.'; return; }
        if (F1.TEAMS2026.some((x) => x.name.toLowerCase() === t.name.trim().toLowerCase())) { err.textContent = 'Ce nom est déjà pris par une écurie 2026.'; return; }
        t.name = t.name.trim();
        t.short = (t.short || t.name.slice(0, 3)).toUpperCase();
        wiz.team = { custom: t };
        next();
      } }, 'Continuer')));
    redraw();
  }

  // Formulaire de création de pilote
  function driverForm(onDone, back) {
    const takenNums = new Set(F1.DRIVERS2026.concat(F1.FREE_AGENTS).map((d) => d.num));
    const d = { first: '', last: '', code: '', num: 7, flag: '🇫🇷' };
    while (takenNums.has(d.num)) d.num++;
    const err = h('p', { class: 'error' });
    const code = h('input', { maxlength: 3, placeholder: 'ABC', style: 'text-transform:uppercase', oninput: (e) => { d.code = e.target.value.toUpperCase(); } });
    show(card('Créer votre pilote',
      backBtn(back),
      h('div', { class: 'form' },
        h('div', { class: 'row' },
          h('label', null, 'Prénom', h('input', { maxlength: 16, oninput: (e) => { d.first = e.target.value; } })),
          h('label', null, 'Nom', h('input', { maxlength: 18, oninput: (e) => { d.last = e.target.value; if (!code.value) d.code = ''; } }))),
        h('div', { class: 'row' },
          h('label', null, 'Code (3 lettres)', code),
          h('label', null, 'Numéro', h('input', { type: 'number', min: 2, max: 99, value: d.num, oninput: (e) => { d.num = +e.target.value; } })),
          h('label', null, 'Nationalité', h('select', { onchange: (e) => { d.flag = e.target.value; } }, F1.NATIONS.map((f) => h('option', { value: f, selected: f === d.flag }, f)))))),
      err,
      h('button', { class: 'primary big', onclick: () => {
        if (!d.first.trim() || !d.last.trim()) { err.textContent = 'Entrez un prénom et un nom.'; return; }
        if (!(d.num >= 2 && d.num <= 99) || takenNums.has(d.num)) { err.textContent = 'Choisissez un numéro libre entre 2 et 99.'; return; }
        d.first = d.first.trim();
        d.last = d.last.trim();
        d.code = (d.code || d.last.replace(/[^A-Za-zÀ-ÿ]/g, '').slice(0, 3)).toUpperCase().padEnd(3, 'X');
        onDone(d);
      } }, 'Valider le pilote')));
  }

  // 12e écurie en mode écurie : recruter deux pilotes
  function pickTeamDrivers() {
    wiz.teamDrivers = wiz.teamDrivers || [];
    const pool = F1.FREE_AGENTS.slice();
    if (wiz.myDriver) pool.unshift(Object.assign({ id: 'me', pace: 82, craft: 78 }, wiz.myDriver));
    const toggle = (id) => {
      const i = wiz.teamDrivers.indexOf(id);
      if (i >= 0) wiz.teamDrivers.splice(i, 1);
      else if (wiz.teamDrivers.length < 2) wiz.teamDrivers.push(id);
      pickTeamDrivers();
    };
    const g = h('div', { class: 'driver-grid' });
    for (const d of pool) g.appendChild(driverCard(d, null, { selected: wiz.teamDrivers.includes(d.id), onclick: () => toggle(d.id) }));
    show(card(`${wiz.team.custom.name} : vos pilotes (${wiz.teamDrivers.length}/2)`,
      backBtn(() => teamForm(pickTeamDrivers)),
      h('p', { class: 'subtitle' }, 'Recrutez deux pilotes libres, ou créez votre propre pilote.'),
      wiz.myDriver ? null : h('button', { onclick: () => driverForm((drv) => { wiz.myDriver = drv; wiz.teamDrivers = ['me'].concat(wiz.teamDrivers).slice(0, 2); pickTeamDrivers(); }, pickTeamDrivers) }, '+ Créer un pilote'),
      g,
      h('button', { class: 'primary big', disabled: wiz.teamDrivers.length !== 2, onclick: () => {
        wiz.driver = wiz.myDriver && wiz.teamDrivers.includes('me') ? { custom: wiz.myDriver } : null;
        settings(pickTeamDrivers);
      } }, 'Continuer')));
  }

  // Réglages puis création
  function settings(back) {
    show(card('Réglages de la carrière',
      backBtn(back),
      h('section', null, h('h3', null, 'Difficulté de l\'IA'), seg(Object.entries(F1.DIFFICULTIES).map(([k, v]) => [k, v.label]), wiz.difficulty, (v) => { wiz.difficulty = v; settings(back); })),
      h('section', null, h('h3', null, 'Distance des courses jouées'), seg(F1.RACE_LENGTHS.map((r) => [r.id, r.label]), wiz.raceLength, (v) => { wiz.raceLength = v; settings(back); })),
      h('p', { class: 'hint' }, 'Chaque Grand Prix peut être joué ou simulé. Les courses simulées utilisent toujours la distance réelle.'),
      h('button', { class: 'primary big', onclick: () => {
        const c = C.create({
          mode: wiz.mode, team: wiz.team, driver: wiz.driver, teamDrivers: wiz.teamDrivers,
          difficulty: wiz.difficulty, raceLength: wiz.raceLength,
        });
        hub(c);
      } }, 'Lancer la carrière')));
  }

  // ---------- Tableau de bord de la carrière ----------
  let hubTab = 'weekend';
  function hub(c, tab) {
    if (tab) hubTab = tab;
    if (C.seasonOver(c)) return seasonEnd(c);
    const gp = C.gp(c);
    if (F1.Session.state() === 'idle') F1.Session.demo(gp);
    const team = C.team(c, c.playerTeam);
    const me = C.driver(c, c.playerDriver);
    const tabs = [['weekend', 'Week-end'], ['drivers', 'Pilotes'], ['teams', 'Constructeurs'], ['calendar', 'Calendrier'], ['team', c.mode === 'team' ? 'Développement' : 'Mon écurie']];
    const body = { weekend: tabWeekend, drivers: tabDrivers, teams: tabTeams, calendar: tabCalendar, team: tabTeam }[hubTab](c);
    const myPts = c.points.drivers[me.id] || 0;
    const myPos = C.driverStandings(c).findIndex((x) => x.d.id === me.id) + 1;
    show(h('div', { class: 'menu-card wide hub', style: `--team:${team.color}` },
      h('div', { class: 'hub-head' },
        h('div', { class: 'hub-id' },
          carCanvas(team, 64, 40),
          h('div', null,
            h('div', { class: 'hub-title' }, c.mode === 'team' ? team.name : `${me.first} ${me.last}`),
            h('div', { class: 'hub-sub' }, c.mode === 'team' ? `Directeur d'écurie · Budget ${team.budget.toFixed(1)} M€` : `${team.name} · #${me.num}`))),
        h('div', { class: 'hub-stats' },
          h('div', null, h('span', { class: 'label' }, 'Saison'), h('b', null, String(c.season))),
          h('div', null, h('span', { class: 'label' }, 'Manche'), h('b', null, `${c.round + 1}/24`)),
          h('div', null, h('span', { class: 'label' }, c.mode === 'team' ? 'Constructeurs' : 'Championnat'),
            h('b', null, c.mode === 'team' ? `P${C.teamStandings(c).findIndex((x) => x.t.id === team.id) + 1} · ${c.points.teams[team.id]} pts` : `P${myPos} · ${myPts} pts`))),
        h('button', { class: 'back', onclick: home }, 'Menu')),
      h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('button', { class: k === hubTab ? 'selected' : '', onclick: () => hub(c, k) }, l))),
      body));
  }

  // Météo prévue pour la manche en cours (tirée une fois, selon le climat du circuit)
  function weatherFor(c) {
    c.wx = c.wx || {};
    const key = c.season + '-' + c.round;
    if (!c.wx[key]) {
      const r = F1.util.rng((c.seed || 1) + c.round * 7919 + c.season * 31);
      c.wx[key] = F1.Settings.rollWeather(C.gp(c).id, r);
      C.save(c);
    }
    return c.wx[key];
  }

  function tabWeekend(c) {
    const gp = C.gp(c);
    const wx = weatherFor(c);
    const track = F1.getTrack(gp);
    const laps = C.lapsFor(c, gp);
    const wk = c.weekend;
    const team = C.team(c, c.playerTeam);
    const mates = C.teamDrivers(c, team.id);

    const pickDriver = c.mode === 'team' && !wk ? h('section', null, h('h3', null, 'Pilote que vous contrôlez'),
      seg(mates.map((d) => [d.id, `${d.flag} ${d.first} ${d.last}`]), c.playerDriver, (v) => { c.playerDriver = v; C.save(c); hub(c); })) : null;

    const qualiBox = h('div', { class: 'step' + (wk ? ' done' : '') },
      h('div', { class: 'step-title' }, '1. Qualifications'),
      wk ? h('div', null,
        h('p', null, `Pole position : ${C.fullName(C.driver(c, wk.quali.order[0]))} (${fmt(wk.quali.times[wk.quali.order[0]])})`),
        h('p', null, h('b', null, `Vous partez P${wk.quali.order.indexOf(c.playerDriver) + 1}`), ` · ${wk.quali.times[c.playerDriver] < 9000 ? fmt(wk.quali.times[c.playerDriver]) : 'sans temps'}`),
        h('button', { onclick: () => showGrid(c) }, 'Voir la grille'))
        : h('div', { class: 'step-btns' },
          h('button', { class: 'primary', onclick: () => playQuali(c) }, 'Jouer les qualifications'),
          h('button', { onclick: () => { setQuali(c, C.simQuali(c, gp)); showGrid(c); } }, 'Simuler')));

    const raceBox = h('div', { class: 'step' + (wk ? '' : ' locked') },
      h('div', { class: 'step-title' }, `2. Course · ${laps} tour${laps > 1 ? 's' : ''} joués (${gp.laps} en simulation)`),
      h('div', { class: 'step-btns' },
        h('button', { class: 'primary', disabled: !wk, onclick: () => playRace(c) }, 'Jouer la course'),
        h('button', { disabled: !wk, onclick: () => simRace(c) }, 'Simuler la course')));

    return h('div', { class: 'weekend' },
      h('div', { class: 'gp-head' },
        h('div', null,
          h('div', { class: 'gp-big' }, `${gp.flag} ${gp.gp}`),
          h('div', { class: 'subtitle' }, `${gp.circuit} · ${gp.place} · ${(track.length / 10000).toFixed(3)} km · ${gp.laps} tours`),
          h('div', { class: 'forecast' }, `Météo prévue : ${F1.Settings.WEATHER_CHOICES[wx]}`),
          h('button', { class: 'small-btn', onclick: () => settingsScreen(() => hub(c, 'weekend')) }, '⚙️ Aides et commandes')),
        trackCanvas(gp, 260, 170, team.color)),
      pickDriver, qualiBox, raceBox);
  }

  function setQuali(c, q) {
    c.weekend = { quali: q };
    C.save(c);
  }

  function playQuali(c) {
    const gp = C.gp(c);
    F1.Session.start({
      gp, mode: 'quali', entries: C.entries(c, [c.playerDriver], c.playerDriver), maxAttempts: 3, weather: weatherFor(c),
      provisional: (t) => C.simQuali(c, gp, t).order.indexOf(c.playerDriver) + 1,
      onEnd: (res) => {
        setQuali(c, C.simQuali(c, gp, res && res.time != null ? res.time : 9999));
        showGrid(c);
      },
    });
  }

  function showGrid(c) {
    const q = c.weekend.quali;
    const pole = q.times[q.order[0]];
    const tbody = h('tbody');
    q.order.forEach((id, i) => {
      const d = C.driver(c, id);
      const t = C.team(c, d.team);
      const tm = q.times[id];
      tbody.appendChild(h('tr', { class: id === c.playerDriver ? 'me' : '' },
        h('td', null, String(i + 1)),
        h('td', null, h('span', { class: 'swatch', style: `background:${t.color}` }), `${d.flag} ${d.first} ${d.last}`),
        h('td', { class: 'hide-sm' }, t.name),
        h('td', null, tm > 9000 ? 'sans temps' : i === 0 ? fmt(tm) : `+${(tm - pole).toFixed(3)}`)));
    });
    show(card(`Grille de départ · ${C.gp(c).gp}`,
      h('div', { class: 'table-wrap' }, h('table', { class: 'results-table' },
        h('thead', null, h('tr', null, h('th', null, 'Pos'), h('th', null, 'Pilote'), h('th', { class: 'hide-sm' }, 'Écurie'), h('th', null, 'Temps'))), tbody)),
      h('button', { class: 'primary big', onclick: () => hub(c, 'weekend') }, 'Retour au week-end')));
  }

  function finishRace(c, gp, res) {
    const quali = c.weekend.quali;
    const rows = C.applyRace(c, quali, res);
    delete c.weekend;
    C.save(c);
    showRaceResults(c, gp, res, () => hub(c, 'weekend'), quali, rows);
  }

  function playRace(c) {
    const gp = C.gp(c);
    const grid = c.weekend.quali.order;
    F1.Session.start({
      gp, mode: 'race', laps: C.lapsFor(c, gp), entries: C.entries(c, grid, c.playerDriver), title: gp.gp, weather: weatherFor(c),
      onEnd: (res) => finishRace(c, gp, res),
    });
  }

  function simRace(c) {
    const gp = C.gp(c);
    finishRace(c, gp, C.simRace(c, gp, c.weekend.quali.order, weatherFor(c)));
  }

  function standingsTable(heads, rows) {
    return h('div', { class: 'table-wrap' }, h('table', { class: 'results-table' },
      h('thead', null, h('tr', null, heads.map(([t, cls]) => h('th', { class: cls }, t)))),
      h('tbody', null, rows)));
  }

  function tabDrivers(c) {
    return standingsTable([['Pos'], ['Pilote'], ['Écurie', 'hide-sm'], ['Vict.', 'hide-sm'], ['Pts']],
      C.driverStandings(c).map((x, i) => {
        const t = x.d.team ? C.team(c, x.d.team) : null;
        return h('tr', { class: x.d.id === c.playerDriver ? 'me' : '' },
          h('td', null, String(i + 1)),
          h('td', null, h('span', { class: 'swatch', style: `background:${t ? t.color : '#666'}` }), `${x.d.flag} ${x.d.first} ${x.d.last}`),
          h('td', { class: 'hide-sm' }, t ? t.name : '—'),
          h('td', { class: 'hide-sm' }, String(x.wins)),
          h('td', null, h('b', null, String(x.pts))));
      }));
  }

  function tabTeams(c) {
    return standingsTable([['Pos'], ['Écurie'], ['Pilotes', 'hide-sm'], ['Pts']],
      C.teamStandings(c).map((x, i) => h('tr', { class: x.t.id === c.playerTeam ? 'me' : '' },
        h('td', null, String(i + 1)),
        h('td', null, h('span', { class: 'swatch', style: `background:${x.t.color}` }), x.t.name),
        h('td', { class: 'hide-sm' }, C.teamDrivers(c, x.t.id).map((d) => d.code).join(' · ')),
        h('td', null, h('b', null, String(x.pts))))));
  }

  function tabCalendar(c) {
    const list = h('div', { class: 'cal-list' });
    F1.CALENDAR.forEach((gp, i) => {
      const r = c.results.find((x) => x.round === i);
      let status;
      if (r) {
        const win = C.driver(c, r.race[0].id);
        const me = r.race.find((x) => x.id === c.playerDriver);
        status = `Vainqueur : ${win.code}${me ? ` · Vous : ${me.dnf ? 'Ab.' : 'P' + me.pos}` : ''}`;
      } else status = i === c.round ? 'Prochaine manche' : '';
      list.appendChild(h('div', { class: 'cal-row' + (i === c.round ? ' next' : '') + (r ? ' done' : '') },
        h('span', { class: 'cal-n' }, String(i + 1)),
        trackCanvas(gp, 54, 36),
        h('span', { class: 'cal-gp' }, `${gp.flag} ${gp.gp}`, h('small', null, gp.circuit)),
        h('span', { class: 'cal-st' }, status)));
    });
    return list;
  }

  function bar(label, v, extra) {
    const pct = Math.max(0, Math.min(100, (v - 60) / 40 * 100));
    return h('div', { class: 'bar-row' },
      h('span', { class: 'bar-label' }, label),
      h('span', { class: 'bar' }, h('span', { class: 'bar-fill', style: `width:${pct}%` })),
      h('span', { class: 'bar-v' }, v.toFixed(1)),
      extra || null);
  }

  function tabTeam(c) {
    const t = C.team(c, c.playerTeam);
    const drivers = C.teamDrivers(c, t.id);
    const rank = c.teams.slice().sort((a, b) => C.carRating(b) - C.carRating(a)).findIndex((x) => x.id === t.id) + 1;
    const rows = [
      bar(`Moteur (${F1.ENGINES[t.engine].name})`, F1.ENGINES[t.engine].power),
    ];
    for (const [k, v] of Object.entries(C.UPGRADES)) {
      let extra = null;
      if (c.mode === 'team') {
        const cost = C.upgradeCost(c, k);
        extra = h('button', { class: 'small-btn', disabled: t.budget < cost || t[k] >= 99, title: v.desc, onclick: () => { C.buyUpgrade(c, k); hub(c, 'team'); } }, `+ ${cost} M€`);
      }
      rows.push(bar(v.label, t[k], extra));
    }
    const parts = [
      h('section', null,
        h('h3', null, `Voiture · note ${C.carRating(t).toFixed(1)} · ${rank}e de la grille`),
        c.mode === 'team' ? h('p', { class: 'hint' }, `Budget : ${t.budget.toFixed(1)} M€. Chaque amélioration ajoute +1,2 point ; son coût augmente à chaque achat de la saison. Les revenus dépendent du prestige et des points marqués.`) : null,
        rows),
      h('section', null, h('h3', null, 'Pilotes'),
        h('div', { class: 'driver-grid' }, drivers.map((d) => driverCard(d, t, {})))),
    ];
    if (c.mode === 'driver') {
      const me = C.driver(c, c.playerDriver);
      const mate = drivers.find((d) => d.id !== me.id);
      let qWins = 0, rWins = 0;
      for (const r of c.results) {
        if (!mate) break;
        if (r.grid.indexOf(me.id) < r.grid.indexOf(mate.id)) qWins++;
        const a = r.race.find((x) => x.id === me.id), b = r.race.find((x) => x.id === mate.id);
        if (a && b && a.pos < b.pos) rWins++;
      }
      parts.push(h('section', null, h('h3', null, 'Réputation et duel interne'),
        bar('Réputation', 60 + c.reputation * 0.4),
        mate ? h('p', null, `Face à ${mate.first} ${mate.last} : qualifications ${qWins}–${c.results.length - qWins}, courses ${rWins}–${c.results.length - rWins}.`) : null,
        h('p', { class: 'hint' }, 'Battez votre coéquipier et marquez des points pour recevoir de meilleures offres en fin de saison.')));
    }
    return h('div', null, parts);
  }

  // ---------- Fin de saison ----------
  function seasonEnd(c) {
    const ds = C.driverStandings(c), ts = C.teamStandings(c);
    const me = C.driver(c, c.playerDriver);
    const myPos = ds.findIndex((x) => x.d.id === me.id) + 1;
    const teamPos = ts.findIndex((x) => x.t.id === c.playerTeam) + 1;
    const champ = ds[0];
    const parts = [
      h('p', { class: 'big-time' }, `🏆 ${champ.d.first} ${champ.d.last}`),
      h('p', { class: 'subtitle' }, `Champion du monde ${c.season} avec ${champ.pts} points · Constructeurs : ${ts[0].t.name} (${ts[0].pts} pts)`),
      h('p', null, c.mode === 'team' ? `Votre écurie termine ${teamPos}e du championnat constructeurs.` : `Vous terminez ${myPos}e du championnat avec ${c.points.drivers[me.id]} points.`),
    ];
    const next = () => { C.newSeason(c); hubTab = 'weekend'; hub(c); };
    if (c.mode === 'driver') {
      const offers = C.offers(c);
      const g = h('div', { class: 'team-grid' });
      g.appendChild(teamCard(C.team(c, me.team), { extra: 'Rester dans mon écurie', onclick: next }));
      for (const id of offers) {
        const t = C.team(c, id);
        g.appendChild(teamCard(t, { drivers: C.teamDrivers(c, id), extra: 'Offre de contrat', onclick: () => {
          C.moveDriver(c, me.id, id);
          c.playerTeam = id;
          next();
        } }));
      }
      parts.push(h('h3', null, offers.length ? 'Offres de contrat pour la saison prochaine' : 'Aucune offre cette année : restez et faites vos preuves.'), g);
    } else {
      parts.push(h('button', { class: 'primary big', onclick: next }, `Saison ${c.season + 1}`));
    }
    show(card(`Fin de la saison ${c.season}`, ...parts, h('button', { class: 'back', onclick: home }, 'Menu principal')));
  }

  home();
})();
