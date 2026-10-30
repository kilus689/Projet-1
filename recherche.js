'use strict';

/* Rubrique « Recherche » : toutes les cartes d'un Pokémon, dans tous les blocs et tous les sets.
   Utilise getJson, API, escapeHtml, normalize, cardImgHtml, imageSources (app.js),
   Sets (sets.js) et Reco (reco.js). */

const Recherche = (() => {
  const LANG_KEY = 'searchLang';
  const $ = (id) => document.getElementById(id);
  const ui = {
    form: $('search-poke-form'), input: $('search-poke'), lang: $('search-poke-lang'),
    list: $('poke-names'), status: $('search-poke-status'), results: $('search-poke-results'),
  };
  let searchToken = 0;

  const getLang = () => { try { return localStorage.getItem(LANG_KEY) || 'fr'; } catch { return 'fr'; } };
  const setIdOfCard = (id) => id.slice(0, id.lastIndexOf('-'));
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // La carte porte-t-elle bien ce Pokémon ? « Méga-Dracaufeu X ex » oui pour Dracaufeu,
  // mais « Mewtwo » non pour Mew (la recherche de la base renvoie tout nom qui contient le texte).
  function namesPokemon(cardName, name, lang) {
    if (lang === 'ja') {
      const i = cardName.indexOf(name);
      if (i < 0) return false;
      const next = cardName[i + name.length];
      return !next || !/[゠-ヿー]/.test(next);
    }
    const n = normalize(name);
    return n && new RegExp(`(^| )${escapeRe(n)}( |$)`).test(normalize(cardName));
  }

  // Ordre naturel des numéros (2, 10, 100, puis TG01…).
  const byLocalId = (a, b) => {
    const na = parseInt(a.localId, 10), nb = parseInt(b.localId, 10);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return String(a.localId).localeCompare(String(b.localId), 'fr', { numeric: true });
  };

  function setStatus(msg, isError = false) {
    ui.status.textContent = msg;
    ui.status.classList.toggle('error', isError);
    ui.status.classList.toggle('busy', !isError && /…\s*$/.test(msg));
  }

  async function fillSuggestions() {
    await Reco.loadDict();
    const names = Reco.namesIn(getLang()).sort((a, b) => a.localeCompare(b, 'fr'));
    ui.list.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}">`).join('');
  }

  async function search() {
    const query = ui.input.value.trim();
    const lang = getLang();
    const token = ++searchToken;
    ui.results.innerHTML = '';
    if (!query) { setStatus('Tape le nom d\'un Pokémon.'); return; }

    setStatus('Recherche des cartes…');
    try {
      // Nom tapé dans n'importe quelle langue → nom du Pokémon dans la langue des cartes.
      const species = await Reco.lookup(query);
      const name = species?.names?.[lang] || query;
      const [cards, series] = await Promise.all([
        getJson(`${API}/${lang}/cards?name=${encodeURIComponent(name)}`).then((r) => r || []),
        Sets.loadSeries(lang),
      ]);
      if (token !== searchToken) return; // une recherche plus récente a été lancée

      // Index des sets : bloc et ordre (les blocs retirés de la rubrique Sets le sont aussi ici).
      const index = new Map();
      series.forEach((serie, si) => serie.sets.forEach((set, ti) => index.set(set.id, { serie, set, si, ti })));
      const groups = new Map(); // bloc → (set → cartes)
      let total = 0;
      for (const c of cards) {
        if (!namesPokemon(c.name, name, lang)) continue;
        const where = index.get(setIdOfCard(c.id));
        if (!where) continue;
        if (!groups.has(where.serie.id)) groups.set(where.serie.id, { ...where, sets: new Map() });
        const g = groups.get(where.serie.id);
        if (!g.sets.has(where.set.id)) g.sets.set(where.set.id, { ...where, cards: [] });
        g.sets.get(where.set.id).cards.push(c);
        total++;
      }

      const shownName = species && name !== query ? `${name} (${query})` : name;
      if (!total) {
        setStatus(`Aucune carte trouvée pour « ${shownName} »${species ? '' : ' : vérifie l\'orthographe ou choisis une autre langue'}.`, true);
        return;
      }
      const nbSets = [...groups.values()].reduce((n, g) => n + g.sets.size, 0);
      setStatus(`${total} carte${total > 1 ? 's' : ''} de ${shownName} dans ${nbSets} set${nbSets > 1 ? 's' : ''}. Touche une carte pour voir son prix.`);

      // Blocs du plus récent au plus ancien, sets du plus récent au plus ancien dans chaque bloc.
      const sortedGroups = [...groups.values()].sort((a, b) => a.si - b.si);
      sortedGroups.forEach((g, i) => {
        const el = document.createElement('details');
        el.className = 'serie card-box search-serie';
        el.open = i < 2;
        const count = [...g.sets.values()].reduce((n, st) => n + st.cards.length, 0);
        const sets = [...g.sets.values()].sort((a, b) => b.ti - a.ti);
        el.innerHTML = `
          <summary>
            <span class="serie-name">${escapeHtml(g.serie.name)}</span>
            <span class="serie-count">${count} carte${count > 1 ? 's' : ''} · ${sets.length} set${sets.length > 1 ? 's' : ''}</span>
          </summary>
          ${sets.map((st) => `
            <section class="search-set">
              <a class="search-set-title" href="#set/${encodeURIComponent(st.set.id)}" data-lang="${lang}">
                <span class="search-set-logo">${Sets.setLogo(st.set, 'set-logo')}</span>
                <span><strong>${escapeHtml(st.set.name)}</strong>
                  <small>${st.cards.length} carte${st.cards.length > 1 ? 's' : ''} · voir le set ›</small></span>
              </a>
              <div class="card-grid">
                ${st.cards.sort(byLocalId).map((c) => `
                  <button type="button" class="card-thumb" data-id="${escapeHtml(c.id)}" data-serie="${escapeHtml(g.serie.id)}">
                    ${cardImgHtml(c, '', false, imageSources(c, lang, g.serie.id))}
                    <span>${escapeHtml(c.localId)} · ${escapeHtml(c.name)}</span>
                  </button>`).join('')}
              </div>
            </section>`).join('')}`;
        ui.results.appendChild(el);
      });
    } catch (err) {
      if (token === searchToken) setStatus('Impossible de faire la recherche : ' + err.message, true);
    }
  }

  ui.lang.value = getLang();
  ui.form.addEventListener('submit', (e) => { e.preventDefault(); ui.input.blur(); search(); });
  ui.lang.addEventListener('change', () => {
    try { localStorage.setItem(LANG_KEY, ui.lang.value); } catch { /* stockage indisponible */ }
    fillSuggestions();
    if (ui.input.value.trim()) search();
  });
  ui.results.addEventListener('click', (e) => {
    const thumb = e.target.closest('.card-thumb');
    if (thumb) { Sets.openCard(thumb.dataset.id, getLang(), thumb.dataset.serie); return; }
    // « voir le set » : ouvre la rubrique Sets dans la langue de la recherche.
    const link = e.target.closest('.search-set-title');
    if (link) try { localStorage.setItem('setsLang', link.dataset.lang); } catch { /* stockage indisponible */ }
  });

  return { show: () => { fillSuggestions(); if (!ui.input.value) ui.input.focus(); } };
})();
