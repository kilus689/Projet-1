'use strict';
// Mode carrière : état, simulation des séances, points, finances, développement, sauvegarde.
// Sans DOM : testable avec Node.
(function (root) {
  const F1 = root.F1 || (root.F1 = {});
  const { clamp, rng, gauss } = F1.util;
  const SAVE_KEY = 'paddock-career-v1';
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const C = {};

  // ---------- Notes ----------
  C.carRating = (team) => {
    const eng = F1.ENGINES[team.engine] ? F1.ENGINES[team.engine].power : 80;
    return eng * 0.35 + team.aero * 0.35 + team.chassis * 0.3;
  };
  C.driverRating = (d) => d.pace * 0.7 + d.craft * 0.3;
  // Performance globale 0..1 (voiture 65 %, pilote 35 %)
  C.perf01 = (team, d) => {
    const car = clamp((C.carRating(team) - 70) / 22, 0, 1.2);
    const drv = clamp((C.driverRating(d) - 72) / 24, 0, 1.2);
    return car * 0.65 + drv * 0.35;
  };
  C.powerFor = (team) => clamp(0.93 + ((C.carRating(team) - 70) / 22) * 0.07, 0.9, 1.0);

  // ---------- Création ----------
  // opts : { mode: 'driver'|'team', team: {id} | {custom}, driver: {id} | {custom} | null,
  //          teamDrivers: [ids] (nouvelle écurie en mode écurie), difficulty, raceLength }
  C.create = function (opts) {
    const c = {
      v: 1,
      mode: opts.mode,
      season: 2026,
      round: 0,
      difficulty: opts.difficulty || 'normal',
      raceLength: opts.raceLength || '5',
      teams: clone(F1.TEAMS2026),
      drivers: clone(F1.DRIVERS2026).concat(clone(F1.FREE_AGENTS).map((d) => Object.assign(d, { team: null }))),
      results: [],
      upgrades: {},
      news: [],
      history: [],
      reputation: 50,
      seed: (Math.random() * 1e9) | 0,
    };
    for (const t of c.teams) t.budget = t.budget || 120;

    // Nouvelle écurie (la 12e)
    let teamId;
    if (opts.team.custom) {
      const t = Object.assign({
        id: 'custom', aero: 76, chassis: 76, reliability: 80, budget: 120, prestige: 60, custom: true,
      }, opts.team.custom);
      c.teams.push(t);
      teamId = t.id;
    } else {
      teamId = opts.team.id;
    }
    c.playerTeam = teamId;

    // Pilote créé
    let customDriver = null;
    if (opts.driver && opts.driver.custom) {
      customDriver = Object.assign({ id: 'me', pace: 82, craft: 78, born: 2006, custom: true, team: null }, opts.driver.custom);
      c.drivers.push(customDriver);
    }

    const team = c.teams.find((t) => t.id === teamId);
    const freeAgents = () => c.drivers.filter((d) => !d.team);
    const assign = (driverId, tId) => {
      const d = c.drivers.find((x) => x.id === driverId);
      if (!d) return;
      if (d.team && d.team !== tId) {
        // Le pilote quitte son écurie : un pilote libre le remplace
        const old = d.team;
        d.team = tId;
        const fa = freeAgents().filter((x) => !x.custom)[0];
        if (fa) {
          fa.team = old;
          c.news.push(`${fa.first} ${fa.last} remplace ${d.first} ${d.last} chez ${c.teams.find((t) => t.id === old).name}.`);
        }
      } else d.team = tId;
    };

    if (c.mode === 'driver') {
      const id = customDriver ? customDriver.id : opts.driver.id;
      if (team.custom) {
        assign(id, teamId);
        const mate = freeAgents().filter((x) => !x.custom)[0];
        if (mate) mate.team = teamId;
      } else if (customDriver) {
        // Pilote créé dans une écurie existante : il prend la place du second pilote
        const seat = c.drivers.filter((d) => d.team === teamId).sort((a, b) => C.driverRating(a) - C.driverRating(b))[0];
        if (seat) seat.team = null;
        customDriver.team = teamId;
      }
      c.playerDriver = id;
    } else {
      if (team.custom) {
        const ids = (opts.teamDrivers || []).slice(0, 2);
        if (customDriver && !ids.includes('me')) ids.unshift('me');
        while (ids.length < 2) {
          const fa = freeAgents().find((x) => !ids.includes(x.id) && !x.custom);
          if (!fa) break;
          ids.push(fa.id);
        }
        ids.slice(0, 2).forEach((id) => assign(id, teamId));
      }
      c.playerDriver = c.drivers.filter((d) => d.team === teamId)[0].id;
    }
    c.points = C.emptyPoints(c);
    C.save(c);
    return c;
  };

  C.emptyPoints = (c) => {
    const p = { drivers: {}, teams: {} };
    for (const d of c.drivers) p.drivers[d.id] = 0;
    for (const t of c.teams) p.teams[t.id] = 0;
    return p;
  };

  // ---------- Accès ----------
  C.team = (c, id) => c.teams.find((t) => t.id === id);
  C.driver = (c, id) => c.drivers.find((d) => d.id === id);
  C.grid = (c) => c.drivers.filter((d) => d.team);
  C.teamDrivers = (c, teamId) => c.drivers.filter((d) => d.team === teamId);
  C.gp = (c) => F1.CALENDAR[c.round];
  C.lapsFor = (c, gp) => (F1.RACE_LENGTHS.find((r) => r.id === c.raceLength) || F1.RACE_LENGTHS[1]).laps(gp);
  C.fullName = (d) => `${d.first} ${d.last}`;

  // ---------- Entrées pour une séance jouée ----------
  C.entries = function (c, order, playerId) {
    const diff = F1.DIFFICULTIES[c.difficulty] || F1.DIFFICULTIES.normal;
    return order.map((id) => {
      const d = C.driver(c, id);
      const t = C.team(c, d.team);
      const p = C.perf01(t, d);
      return {
        id: d.id,
        name: C.fullName(d),
        code: d.code,
        num: d.num,
        team: t,
        isPlayer: d.id === playerId,
        power: C.powerFor(t),
        skill: diff.skill * (0.9 + 0.1 * clamp(p, 0, 1.1)),
      };
    });
  };

  // ---------- Simulation ----------
  C.simQuali = function (c, gp, playerTime) {
    const diff = F1.DIFFICULTIES[c.difficulty] || F1.DIFFICULTIES.normal;
    const ref = F1.refLapTime(F1.getTrack(gp));
    const r = rng(c.seed + c.round * 101 + c.season);
    const times = {};
    for (const d of C.grid(c)) {
      const t = C.team(c, d.team);
      const p = C.perf01(t, d);
      times[d.id] = ref * diff.quali * (1.004 + (1 - p) * 0.045 + gauss(r) * 0.0035);
    }
    if (playerTime != null) times[c.playerDriver] = playerTime;
    const order = Object.keys(times).sort((a, b) => times[a] - times[b]);
    return { order, times };
  };

  // ---------- Qualifications en trois séances (Q1, Q2, Q3) ----------
  // Q1 : 22 voitures, 6 éliminées · Q2 : 16 voitures, 6 éliminées · Q3 : 10 voitures pour la pole
  C.Q_CUTS = [16, 10, 10];
  C.simQualiSeg = function (c, gp, seg, ids, playerTime) {
    const diff = F1.DIFFICULTIES[c.difficulty] || F1.DIFFICULTIES.normal;
    const ref = F1.refLapTime(F1.getTrack(gp));
    const r = rng(c.seed + c.round * 101 + c.season + seg * 7919);
    const times = {};
    for (const id of ids) {
      const d = C.driver(c, id), t = C.team(c, d.team), p = C.perf01(t, d);
      // La piste s'améliore (plus de gomme) d'une séance à l'autre
      times[id] = ref * diff.quali * (1.004 + (1 - p) * 0.045 + gauss(r) * 0.0035) * (1 - 0.0015 * seg);
    }
    if (playerTime != null && ids.includes(c.playerDriver)) times[c.playerDriver] = playerTime;
    const order = ids.slice().sort((a, b) => times[a] - times[b]);
    return { order, times };
  };
  // Assemble la grille à partir des trois séances : [Q3 top 10, Q2 11-16, Q1 17-22]
  C.gridFromSegs = function (segs) {
    const order = [], times = {};
    const n = segs.length;
    for (let k = n - 1; k >= 0; k--) {
      const keep = k === n - 1 ? segs[k].order : segs[k].order.slice(C.Q_CUTS[k]);
      for (const id of keep) if (!order.includes(id)) { order.push(id); times[id] = segs[k].times[id]; }
    }
    return { order, times, segs: segs.map((s) => s.order.length) };
  };

  // ---------- Week-ends sprint 2026 ----------
  C.SPRINTS = ['cn-2004', 'us-2022', 'ca-1978', 'gb-1948', 'nl-1948', 'sg-2008'];
  C.SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];
  C.isSprint = (gp) => C.SPRINTS.includes(gp.id);
  C.sprintLaps = (gp) => Math.round(gp.laps / 3);
  C.applySprint = function (c, result) {
    c.sprints = c.sprints || [];
    const rows = result.order.map((o, i) => {
      const pts = !o.dnf && i < C.SPRINT_POINTS.length ? C.SPRINT_POINTS[i] : 0;
      const d = C.driver(c, o.id);
      c.points.drivers[o.id] = (c.points.drivers[o.id] || 0) + pts;
      c.points.teams[d.team] = (c.points.teams[d.team] || 0) + pts;
      return { id: o.id, team: d.team, pos: i + 1, pts, dnf: !!o.dnf, gap: o.gap, time: o.time };
    });
    c.sprints.push({ round: c.round, race: rows });
    return rows;
  };

  C.simRace = function (c, gp, grid, weather, lapsOverride) {
    const wet = weather === 'rain' || weather === 'changing';
    const r = rng(c.seed + c.round * 977 + c.season * 7 + (lapsOverride || 0));
    const laps = lapsOverride || gp.laps;
    const ref = F1.refLapTime(F1.getTrack(gp));
    const rows = grid.map((id, g) => {
      const d = C.driver(c, id);
      const t = C.team(c, d.team);
      const p = C.perf01(t, d);
      const craft = (d.craft - 80) / 100;
      const pace = 1.03 + (1 - p) * 0.04 - craft * 0.01;
      // temps total = rythme × tours + pénalité de position de départ + aléas
      // Sous la pluie : plus d'écarts, plus d'erreurs ; les pilotes expérimentés s'en sortent mieux
      const total = ref * pace * laps * (wet ? 1.15 : 1) + g * 0.55 + gauss(r) * (6 + laps * 0.12) * (1.1 - d.craft / 100 * 0.5) * (wet ? 1.8 : 1);
      const dnf = r() < ((100 - t.reliability) / 100) * 0.16 + 0.005 + (wet ? 0.04 * (1.2 - d.craft / 100) : 0);
      const best = ref * pace * (0.985 + r() * 0.01);
      return { id, total, dnf, best, dnfLap: dnf ? 1 + Math.floor(r() * (laps - 1)) : laps };
    });
    rows.sort((a, b) => (a.dnf - b.dnf) || (a.dnf ? b.dnfLap - a.dnfLap : a.total - b.total));
    const win = rows[0].total;
    const fastest = rows.filter((x) => !x.dnf).sort((a, b) => a.best - b.best)[0];
    return {
      order: rows.map((x) => ({ id: x.id, dnf: x.dnf, gap: x.dnf ? null : x.total - win, time: x.dnf ? null : x.total })),
      fastest: fastest ? fastest.id : null,
      fastestTime: fastest ? fastest.best : null,
    };
  };

  // ---------- Résultat d'un Grand Prix ----------
  // result : { order: [{id, dnf, gap, time}], fastest }, quali : { order, times }
  C.applyRace = function (c, quali, result) {
    const gp = C.gp(c);
    const rows = result.order.map((o, i) => {
      const pts = !o.dnf && i < F1.POINTS.length ? F1.POINTS[i] : 0;
      const d = C.driver(c, o.id);
      c.points.drivers[o.id] = (c.points.drivers[o.id] || 0) + pts;
      c.points.teams[d.team] = (c.points.teams[d.team] || 0) + pts;
      return { id: o.id, team: d.team, pos: i + 1, pts, dnf: !!o.dnf, gap: o.gap, time: o.time, lapsDown: o.lapsDown || 0 };
    });
    c.results.push({
      round: c.round, gp: gp.id, grid: quali.order, poleTime: quali.times[quali.order[0]],
      race: rows, fastest: result.fastest,
    });

    // Finances et développement
    if (c.mode === 'team') C.deliverResearch(c);
    const r = rng(c.seed + c.round * 31 + c.season * 3);
    for (const t of c.teams) {
      const pts = rows.filter((x) => x.team === t.id).reduce((s, x) => s + x.pts, 0);
      t.budget = Math.round((t.budget + 2.5 + t.prestige / 25 + pts * 0.3) * 10) / 10;
      const isPlayerTeam = c.mode === 'team' && t.id === c.playerTeam;
      if (!isPlayerTeam) {
        // Développement automatique des autres écuries
        const area = ['aero', 'chassis', 'reliability'][(r() * 3) | 0];
        const gain = r() * 0.7 * (0.7 + t.budget / 400);
        t[area] = Math.min(99, t[area] + gain);
      }
    }

    // Réputation du joueur (mode pilote)
    if (c.mode === 'driver') {
      const me = rows.find((x) => x.id === c.playerDriver);
      const mate = rows.find((x) => x.team === me.team && x.id !== me.id);
      let delta = me.dnf ? -2 : (12 - me.pos) * 0.4;
      if (mate && !me.dnf && me.pos < mate.pos) delta += 2;
      c.reputation = clamp(c.reputation + delta, 0, 100);
    }

    c.round++;
    C.save(c);
    return rows;
  };

  // ---------- Développement (mode écurie) ----------
  C.UPGRADES = {
    aero: { label: 'Aérodynamique', desc: 'Appui et vitesse en courbe' },
    chassis: { label: 'Châssis', desc: 'Poids, rigidité, équilibre' },
    reliability: { label: 'Fiabilité', desc: 'Moins d\'abandons' },
  };
  C.upgradeCost = (c, area) => {
    const n = (c.upgrades[area] || 0);
    return Math.round((4 + n * 1.5) * 10) / 10;
  };
  C.buyUpgrade = function (c, area) {
    const t = C.team(c, c.playerTeam);
    const cost = C.upgradeCost(c, area);
    if (t.budget < cost || t[area] >= 99) return false;
    t.budget = Math.round((t.budget - cost) * 10) / 10;
    t[area] = Math.min(99, t[area] + 1.2);
    c.upgrades[area] = (c.upgrades[area] || 0) + 1;
    C.save(c);
    return true;
  };

  // ---------- Recherche et développement, plafond budgétaire ----------
  C.CAP = 60; // dépenses de développement autorisées par saison (M€)
  C.RND = {
    small: { label: 'Évolution', cost: 1, gain: 1.0, delay: 1 },
    big: { label: 'Gros projet', cost: 2.6, gain: 3.0, delay: 3 },
  };
  C.spent = (c) => c.spent || 0;
  C.rndCost = (c, area, size) => Math.round(C.upgradeCost(c, area) * C.RND[size].cost * 10) / 10;
  C.startResearch = function (c, area, size) {
    const t = C.team(c, c.playerTeam);
    const cost = C.rndCost(c, area, size);
    if (t.budget < cost || C.spent(c) + cost > C.CAP) return false;
    t.budget = Math.round((t.budget - cost) * 10) / 10;
    c.spent = Math.round((C.spent(c) + cost) * 10) / 10;
    c.upgrades[area] = (c.upgrades[area] || 0) + 1;
    c.rnd = c.rnd || [];
    c.rnd.push({ area, size, gain: C.RND[size].gain * (0.85 + Math.random() * 0.3), due: c.round + C.RND[size].delay });
    C.save(c);
    return true;
  };
  // Les projets arrivent sur la voiture au bout de quelques Grands Prix
  C.deliverResearch = function (c) {
    if (!c.rnd || !c.rnd.length) return;
    const t = C.team(c, c.playerTeam);
    const ready = c.rnd.filter((p) => c.round >= p.due);
    c.rnd = c.rnd.filter((p) => c.round < p.due);
    for (const p of ready) {
      t[p.area] = Math.min(99, t[p.area] + p.gain);
      c.news.push(`Nouvelle pièce (${C.UPGRADES[p.area].label.toLowerCase()}) : +${p.gain.toFixed(1)}.`);
    }
  };

  // ---------- Marché des pilotes (mode écurie) ----------
  C.signCost = (c, d) => {
    const rating = C.driverRating(d);
    const base = Math.max(1, (rating - 68) * 0.7);
    return Math.round((d.team ? base * 1.6 : base) * 10) / 10; // indemnité de transfert si sous contrat
  };
  C.market = (c) => c.drivers.filter((d) => d.team !== c.playerTeam).sort((a, b) => C.driverRating(b) - C.driverRating(a));
  C.signDriver = function (c, id, replaceId) {
    const t = C.team(c, c.playerTeam);
    const d = C.driver(c, id), out = C.driver(c, replaceId);
    const cost = C.signCost(c, d);
    if (!d || !out || out.team !== t.id || t.budget < cost) return false;
    t.budget = Math.round((t.budget - cost) * 10) / 10;
    const from = d.team;
    out.team = from || null;
    d.team = t.id;
    if (c.playerDriver === out.id) c.playerDriver = d.id;
    c.news.push(`${C.fullName(d)} signe chez ${t.name}${from ? '' : ' (pilote libre)'} ; ${C.fullName(out)} ${from ? 'part chez ' + C.team(c, from).name : 'quitte l\'écurie'}.`);
    C.save(c);
    return true;
  };

  // ---------- Classements ----------
  C.driverStandings = (c) => C.grid(c).concat(c.drivers.filter((d) => !d.team && c.points.drivers[d.id] > 0))
    .map((d) => ({ d, pts: c.points.drivers[d.id] || 0, wins: c.results.filter((r) => r.race[0].id === d.id).length }))
    .sort((a, b) => b.pts - a.pts || b.wins - a.wins);
  C.teamStandings = (c) => c.teams
    .map((t) => ({ t, pts: c.points.teams[t.id] || 0 }))
    .sort((a, b) => b.pts - a.pts);

  C.seasonOver = (c) => c.round >= F1.CALENDAR.length;

  // ---------- Fin de saison ----------
  C.offers = function (c) {
    // Mode pilote : offres selon la réputation
    const me = C.driver(c, c.playerDriver);
    const myRank = C.driverStandings(c).findIndex((x) => x.d.id === me.id) + 1;
    const score = c.reputation + (23 - myRank) * 1.5;
    return c.teams
      .filter((t) => t.id !== me.team)
      .map((t) => ({ t, need: t.prestige - 10 + (C.carRating(t) - 80) }))
      .filter((o) => score >= o.need - 5)
      .sort((a, b) => C.carRating(b.t) - C.carRating(a.t))
      .slice(0, 3)
      .map((o) => o.t.id);
  };

  C.moveDriver = function (c, driverId, teamId) {
    const me = C.driver(c, driverId);
    const from = me.team;
    const out = C.teamDrivers(c, teamId).sort((a, b) => C.driverRating(a) - C.driverRating(b))[0];
    if (out) out.team = from;
    me.team = teamId;
    c.news.push(`${C.fullName(me)} rejoint ${C.team(c, teamId).name}.`);
  };

  C.newSeason = function (c) {
    const champ = C.driverStandings(c)[0];
    const cons = C.teamStandings(c)[0];
    const meRank = C.driverStandings(c).findIndex((x) => x.d.id === c.playerDriver) + 1;
    const teamRank = C.teamStandings(c).findIndex((x) => x.t.id === c.playerTeam) + 1;
    c.history.push({ season: c.season, champion: champ.d.id, constructor: cons.t.id, myPos: meRank, teamPos: teamRank });
    const r = rng(c.seed + c.season);
    c.season++;
    for (const d of c.drivers) {
      const age = c.season - d.born;
      const dp = age < 24 ? 1 + r() * 2.5 : age < 31 ? r() * 1.2 - 0.3 : age < 36 ? -r() * 1.2 : -0.5 - r() * 2;
      d.pace = clamp(d.pace + dp, 60, 99);
      d.craft = clamp(d.craft + (age < 30 ? r() * 1.5 : r() * 0.5), 60, 99);
    }
    for (const t of c.teams) {
      // Retour vers la moyenne + aléa d'intersaison
      for (const a of ['aero', 'chassis', 'reliability']) t[a] = clamp(t[a] * 0.85 + 82 * 0.15 + (r() - 0.5) * 3, 65, 97);
    }
    c.round = 0;
    c.results = [];
    c.upgrades = {};
    c.spent = 0;
    c.sprints = [];
    c.points = C.emptyPoints(c);
    C.save(c);
  };

  // ---------- Sauvegarde ----------
  C.save = function (c) {
    try { root.localStorage && root.localStorage.setItem(SAVE_KEY, JSON.stringify(c)); } catch (e) { /* stockage indisponible */ }
  };
  C.load = function () {
    try {
      const s = root.localStorage && root.localStorage.getItem(SAVE_KEY);
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  };
  C.clear = function () {
    try { root.localStorage && root.localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignoré */ }
  };

  F1.Career = C;
})(typeof window !== 'undefined' ? window : globalThis);
