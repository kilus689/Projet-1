'use strict';

/* Rubrique « Sets » : tous les sets Pokémon rangés par bloc, puis les cartes d'un set.
   Utilise getJson, escapeHtml, renderCard et API définis dans app.js. */

const Sets = (() => {
  const LANG_KEY = 'setsLang';
  const cache = {}; // séries et sets déjà chargés, par langue

  const $ = (id) => document.getElementById(id);
  const ui = {
    lang: $('sets-lang'), list: $('series-list'), status: $('sets-status'),
    setHeader: $('set-header'), cards: $('set-cards'), setStatus: $('set-status'),
    modal: $('card-modal'), modalBody: $('card-modal-body'), modalClose: $('card-modal-close'),
  };

  // Blocs retirés de la liste : Pokémon TCG Pocket, McDonald's, Kits du Dresseur, POP, Divers.
  const HIDDEN_SERIES = new Set(['tcgp', 'mc', 'tk', 'pop', 'misc']);
  const HIDDEN_RE = /pocket|mcdonald|kits? du dresseur|trainer kits?|^pop\b|divers|misc|ポケポケ/i;
  const isHidden = (x) => HIDDEN_SERIES.has(x.id) || HIDDEN_RE.test(x.name || '');

  // Sets de cartes promo (ex : « Promos Écarlate et Violet », id « svp »).
  const isPromo = (s) => /promo/i.test(s.name || '') || /^[a-z]+p$/i.test(s.id || '') || /プロモ/.test(s.name || '');
  const PROMO_LOGO = '<img class="LOGOCLASS promo-logo" src="img/promo.svg" alt="Cartes promo">';
  // Sets d'énergies (ex : « Énergies Écarlate et Violet », id « sve »).
  const isEnergy = (s) => /[ée]nergie|energy|エネルギー/i.test(s.name || '') || ['sve', 'mee'].includes(s.id);
  const ENERGY_LOGO = '<img class="LOGOCLASS energy-logo" src="img/energie-feu.svg" alt="Énergie Feu">';
  const setLogo = (s, cls) => isPromo(s) ? PROMO_LOGO.replace('LOGOCLASS', cls)
    : isEnergy(s) ? ENERGY_LOGO.replace('LOGOCLASS', cls)
    : logoImg(s.logo, cls, s.name) || logoImg(s.symbol, 'set-symbol', s.name);

  function getLang() {
    try { return localStorage.getItem(LANG_KEY) || 'fr'; } catch { return 'fr'; }
  }

  // Les logos TCGdex n'ont pas d'extension : on essaie .webp puis .png, sinon on masque.
  function logoImg(url, cls, alt = '') {
    if (!url) return '';
    return `<img class="${cls}" src="${escapeHtml(url)}.webp" alt="${escapeHtml(alt)}" loading="lazy"
      onerror="if(!this.dataset.png){this.dataset.png=1;this.src='${escapeHtml(url)}.png'}else{this.remove()}">`;
  }

  function formatDate(d) {
    if (!d) return '';
    const date = new Date(d);
    return isNaN(date) ? '' : date.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long' });
  }

  async function loadSeries(lang) {
    if (cache[lang]) return cache[lang];
    const list = (await getJson(`${API}/${lang}/series`)) || [];
    const details = await Promise.all(list.map((s) =>
      getJson(`${API}/${lang}/series/${encodeURIComponent(s.id)}`).catch(() => null)));
    const series = details
      .map((d, i) => d && { ...d, order: i })
      .filter((d) => d && !isHidden(d))
      .map((d) => ({ ...d, sets: (d.sets || []).filter((x) => !isHidden(x)) }))
      .filter((d) => d.sets.length);
    // Du bloc le plus récent au plus ancien (date de sortie si connue, sinon ordre de l'API).
    series.sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || '') || b.order - a.order);
    cache[lang] = series;
    return series;
  }

  async function showSeries() {
    const lang = getLang();
    ui.lang.value = lang;
    ui.status.textContent = 'Chargement des sets…';
    ui.status.classList.remove('error');
    ui.list.innerHTML = '';
    try {
      const series = await loadSeries(lang);
      if (getLang() !== lang) return; // la langue a changé pendant le chargement
      ui.status.textContent = series.length ? '' : 'Aucun set trouvé pour cette langue.';
      series.forEach((serie, i) => ui.list.appendChild(renderSerie(serie, i === 0)));
    } catch (err) {
      ui.status.textContent = 'Impossible de charger les sets : ' + err.message;
      ui.status.classList.add('error');
    }
  }

  function renderSerie(serie, open) {
    const el = document.createElement('details');
    el.className = 'serie card-box';
    el.open = open;
    const sets = [...serie.sets].reverse(); // le plus récent en premier
    el.innerHTML = `
      <summary>
        ${logoImg(serie.logo, 'serie-logo', serie.name)}
        <span class="serie-name">${escapeHtml(serie.name)}</span>
        <span class="serie-count">${sets.length} set${sets.length > 1 ? 's' : ''}</span>
      </summary>
      <div class="set-grid">
        ${sets.map((s) => `
          <a class="set-tile" href="#set/${encodeURIComponent(s.id)}">
            <span class="set-logo-wrap">${setLogo(s, 'set-logo')}</span>
            <span class="set-name">${escapeHtml(s.name)}</span>
            <small>${s.cardCount?.official ? s.cardCount.official + ' cartes' : ''}</small>
          </a>`).join('')}
      </div>`;
    return el;
  }

  async function showSet(id) {
    const lang = getLang();
    ui.setHeader.innerHTML = '';
    ui.cards.innerHTML = '';
    ui.setStatus.textContent = 'Chargement du set…';
    ui.setStatus.classList.remove('error');
    try {
      const set = await getJson(`${API}/${lang}/sets/${encodeURIComponent(id)}`);
      if (!set) throw new Error('set introuvable');
      const count = set.cardCount?.official;
      const extra = set.cardCount?.total > count ? ` (+${set.cardCount.total - count} secrètes)` : '';
      ui.setHeader.innerHTML = `
        ${setLogo(set, 'set-header-logo')}
        <h3>${escapeHtml(set.name)}</h3>
        <p class="meta">${escapeHtml(set.serie?.name || '')}${set.releaseDate ? ' · ' + formatDate(set.releaseDate) : ''}${count ? ' · ' + count + ' cartes' + extra : ''}</p>`;
      const cards = set.cards || [];
      ui.setStatus.textContent = cards.length ? 'Touche une carte pour voir son prix.' : 'Aucune carte listée pour ce set.';
      ui.cards.innerHTML = cards.map((c) => `
        <button type="button" class="card-thumb" data-id="${escapeHtml(c.id)}">
          ${c.image ? `<img src="${escapeHtml(c.image)}/low.webp" alt="${escapeHtml(c.name)}" loading="lazy">` : '<span class="no-img">?</span>'}
          <span>${escapeHtml(c.localId)} · ${escapeHtml(c.name)}</span>
        </button>`).join('');
    } catch (err) {
      ui.setStatus.textContent = 'Impossible de charger ce set : ' + err.message;
      ui.setStatus.classList.add('error');
    }
  }

  async function openCard(id) {
    ui.modal.hidden = false;
    ui.modalBody.innerHTML = '<p class="status">Chargement du prix…</p>';
    try {
      const card = await getJson(`${API}/${getLang()}/cards/${encodeURIComponent(id)}`);
      if (!card) throw new Error('carte introuvable');
      englishName = ''; // pas de nom anglais connu ici (utilisé par le lien Cardmarket)
      ui.modalBody.innerHTML = '';
      ui.modalBody.appendChild(renderCard(card, false));
    } catch (err) {
      ui.modalBody.innerHTML = `<p class="status error">Impossible de charger cette carte : ${escapeHtml(err.message)}</p>`;
    }
  }

  ui.lang.addEventListener('change', () => {
    try { localStorage.setItem(LANG_KEY, ui.lang.value); } catch { /* stockage indisponible */ }
    showSeries();
  });
  ui.cards.addEventListener('click', (e) => {
    const btn = e.target.closest('.card-thumb');
    if (btn) openCard(btn.dataset.id);
  });
  ui.modalClose.addEventListener('click', () => { ui.modal.hidden = true; });
  ui.modal.addEventListener('click', (e) => { if (e.target === ui.modal) ui.modal.hidden = true; });

  return { showSeries, showSet };
})();
