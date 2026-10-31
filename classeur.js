'use strict';

/* Rubrique « Classeur » : le classeur pro de 20 pages × 9 cases (3×3), en double page.
   Enregistré sur l'appareil (localStorage). Utilise getJson, API, escapeHtml, formatEur,
   cardImgHtml, imageSources, enableCardmarketFallback (app.js) et Sets.openCard (sets.js). */

const Classeur = (() => {
  const PAGES = 20, PER_PAGE = 9, SIZE = PAGES * PER_PAGE;
  const KEY = 'classeur';
  const STALE = 24 * 3600 * 1000; // prix à actualiser après un jour

  const $ = (id) => document.getElementById(id);
  const ui = {
    view: $('view-classeur'), binder: $('binder'), spread: $('binder-spread'),
    prev: $('binder-prev'), next: $('binder-next'), where: $('binder-where'),
    total: $('binder-total'), count: $('binder-count'), refresh: $('binder-refresh'),
    status: $('binder-status'), menu: $('slot-menu'), menuTitle: $('slot-menu-title'),
    menuBody: $('slot-menu-body'), toast: $('toast'),
  };

  // ---------- Données ----------
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && Array.isArray(d.slots)) { d.slots.length = SIZE; return { spread: d.spread || 0, slots: Array.from(d.slots, (x) => x || null) }; }
    } catch { /* données illisibles : classeur vide */ }
    return { spread: 0, slots: Array(SIZE).fill(null) };
  }
  let data = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch { return false; }
  }

  // Prix principal d'une carte (même règle que la fenêtre de prix : tendance Cardmarket d'abord).
  function mainPrice(card) {
    const cm = card.pricing?.cardmarket;
    return cm ? (cm.trend || cm.avg30 || cm.avg || cm['trend-holo'] || cm['avg-holo'] || null) : null;
  }

  // ---------- Affichage ----------
  const isWide = () => window.matchMedia('(min-width: 760px)').matches;
  const pagesPerSpread = () => (isWide() ? 2 : 1);
  const spreadCount = () => Math.ceil(PAGES / pagesPerSpread());
  const pageValue = (p) => data.slots.slice(p * PER_PAGE, (p + 1) * PER_PAGE).reduce((s, c) => s + (c?.price || 0), 0);

  function slotHtml(i) {
    const c = data.slots[i];
    const n = (i % PER_PAGE) + 1;
    if (!c) return `<button type="button" class="slot-case empty" data-slot="${i}" aria-label="Case ${n} vide"><span>${n}</span></button>`;
    const card = { id: c.id, localId: c.localId, name: c.name, image: c.image, set: { id: c.setId } };
    return `<button type="button" class="slot-case card-thumb${moving === i ? ' moving' : ''}" data-slot="${i}" data-id="${escapeHtml(c.id)}" data-lang="${c.lang}">
      ${cardImgHtml(card, '', false, imageSources(card, c.lang, c.serieId))}
    </button>`;
  }

  function pageHtml(p) {
    if (p >= PAGES) return '<div class="binder-page blank"></div>';
    const cells = Array.from({ length: PER_PAGE }, (_, k) => slotHtml(p * PER_PAGE + k)).join('');
    return `<div class="binder-page">
      <div class="binder-grid">${cells}</div>
      <p class="binder-page-foot">Page ${p + 1} · ${data.slots.slice(p * PER_PAGE, (p + 1) * PER_PAGE).some(Boolean) ? formatEur(pageValue(p)) : 'vide'}</p>
    </div>`;
  }

  let stopFallback = null;
  function render() {
    const per = pagesPerSpread();
    data.spread = Math.min(Math.max(0, data.spread), spreadCount() - 1);
    const first = data.spread * per;
    ui.spread.innerHTML = Array.from({ length: per }, (_, k) => pageHtml(first + k)).join('');
    ui.spread.classList.toggle('single', per === 1);
    ui.where.textContent = per === 2 ? `Pages ${first + 1}–${Math.min(first + 2, PAGES)} sur ${PAGES}` : `Page ${first + 1} sur ${PAGES}`;
    ui.prev.disabled = data.spread === 0;
    ui.next.disabled = data.spread >= spreadCount() - 1;
    const filled = data.slots.filter(Boolean);
    ui.total.textContent = formatEur(filled.reduce((s, c) => s + (c.price || 0), 0));
    ui.count.textContent = `${filled.length} / ${SIZE} cartes`;
    stopFallback?.();
    stopFallback = enableCardmarketFallback(ui.spread, 'fr'); // la langue de chaque carte est lue sur sa case
  }

  // Tourner les pages : la page sort en pivotant, la nouvelle entre en pivotant de l'autre côté.
  let turning = false;
  function turn(dir) {
    const target = data.spread + dir;
    if (turning || target < 0 || target >= spreadCount()) return;
    turning = true;
    ui.spread.classList.add(dir > 0 ? 'turn-out-next' : 'turn-out-prev');
    setTimeout(() => {
      data.spread = target;
      save();
      render();
      ui.spread.classList.remove('turn-out-next', 'turn-out-prev');
      ui.spread.classList.add(dir > 0 ? 'turn-in-next' : 'turn-in-prev');
      setTimeout(() => { ui.spread.classList.remove('turn-in-next', 'turn-in-prev'); turning = false; }, 260);
    }, 240);
  }

  function goToSlot(i) {
    data.spread = Math.floor(Math.floor(i / PER_PAGE) / pagesPerSpread());
  }

  let toastTimer = null;
  function toast(msg) {
    ui.toast.textContent = msg;
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 3000);
  }

  // ---------- Ajouter, déplacer, retirer ----------
  // Ajoute une carte (fiche TCGdex complète) dans la première case libre.
  async function add(card, lang, serieId) {
    const i = data.slots.indexOf(null);
    if (i < 0) { toast('Le classeur est plein (180 cartes).'); return; }
    const setId = card.set?.id || card.id.slice(0, card.id.lastIndexOf('-'));
    data.slots[i] = {
      id: card.id, lang, name: card.name, localId: card.localId, image: card.image || null,
      setId, setName: card.set?.name || '', serieId: serieId || null,
      price: mainPrice(card), priceAt: Date.now(),
    };
    if (!serieId) getSerie(lang, setId).then((s) => { if (s?.id && data.slots[i]?.id === card.id) { data.slots[i].serieId = s.id; save(); } });
    goToSlot(i);
    if (!save()) { toast("Impossible d'enregistrer sur cet appareil."); return; }
    toast(`${card.name} est dans le classeur : page ${Math.floor(i / PER_PAGE) + 1}, case ${(i % PER_PAGE) + 1}.`);
    if (!ui.view.hidden) render();
  }

  let moving = null; // case dont la carte est en train d'être déplacée
  function openMenu(i) {
    const c = data.slots[i];
    if (!c) return;
    ui.menuTitle.textContent = `${c.name} · page ${Math.floor(i / PER_PAGE) + 1}, case ${(i % PER_PAGE) + 1}`;
    ui.menuBody.innerHTML = `
      <p class="meta">${escapeHtml(c.setName)} · n° ${escapeHtml(c.localId)} · ${formatEur(c.price)}</p>
      <button type="button" class="primary" data-act="price">Voir le prix et la carte en grand</button>
      <button type="button" class="secondary" data-act="move">Déplacer vers une autre case</button>
      <button type="button" class="secondary danger" data-act="remove">Retirer du classeur</button>
      <button type="button" class="secondary" data-act="close">Fermer</button>`;
    ui.menu.dataset.slot = i;
    ui.menu.hidden = false;
  }

  ui.menu.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (!act && e.target !== ui.menu) return;
    const i = +ui.menu.dataset.slot;
    const c = data.slots[i];
    ui.menu.hidden = true;
    if (!c || act === 'close' || !act) return;
    if (act === 'price') Sets.openCard(c.id, c.lang, c.serieId);
    if (act === 'remove') { data.slots[i] = null; save(); render(); toast(`${c.name} n'est plus dans le classeur.`); }
    if (act === 'move') { moving = i; render(); setStatus('Touche la case de destination (une case occupée échange les deux cartes).'); }
  });

  ui.spread.addEventListener('click', (e) => {
    const cell = e.target.closest('.slot-case');
    if (!cell) return;
    const i = +cell.dataset.slot;
    if (moving !== null) {
      if (i !== moving) [data.slots[moving], data.slots[i]] = [data.slots[i], data.slots[moving]];
      moving = null;
      save(); render(); setStatus('');
      return;
    }
    if (data.slots[i]) openMenu(i);
    else setStatus('Case vide : ajoute une carte depuis la Recherche ou le Détecteur (bouton « ＋ Ajouter au classeur »).');
  });

  // ---------- Prix ----------
  function setStatus(msg, isError = false) {
    ui.status.textContent = msg;
    ui.status.classList.toggle('error', isError);
    ui.status.classList.toggle('busy', !isError && /…\s*$/.test(msg));
  }

  let refreshing = false;
  async function refreshPrices(onlyStale = false) {
    if (refreshing) return;
    const todo = data.slots.map((c, i) => (c && (!onlyStale || Date.now() - (c.priceAt || 0) > STALE) ? i : -1)).filter((i) => i >= 0);
    if (!todo.length) { if (!onlyStale) setStatus('Aucune carte dans le classeur.'); return; }
    refreshing = true;
    ui.refresh.disabled = true;
    let done = 0, failed = 0;
    setStatus(`Actualisation des prix (0/${todo.length})…`);
    const worker = async () => {
      while (todo.length) {
        const i = todo.shift();
        const c = data.slots[i];
        try {
          const card = await getJson(`${API}/${c.lang}/cards/${encodeURIComponent(c.id)}`, { fresh: true });
          if (card && data.slots[i]?.id === c.id) {
            Object.assign(data.slots[i], { price: mainPrice(card), priceAt: Date.now(), image: card.image || c.image });
          }
        } catch { failed++; }
        done++;
        setStatus(`Actualisation des prix (${done}/${done + todo.length})…`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    save();
    refreshing = false;
    ui.refresh.disabled = false;
    if (!ui.view.hidden) render();
    setStatus(failed ? `Prix actualisés, sauf ${failed} carte${failed > 1 ? 's' : ''} (connexion ?).` : 'Prix actualisés.', failed > 0);
  }

  // ---------- Branchements ----------
  ui.prev.addEventListener('click', () => turn(-1));
  ui.next.addEventListener('click', () => turn(1));
  ui.refresh.addEventListener('click', () => refreshPrices(false));
  window.addEventListener('resize', () => { if (!ui.view.hidden) render(); });
  // Glisser le doigt vers la gauche ou la droite pour tourner les pages.
  let touchX = null;
  ui.binder.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  ui.binder.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 60) turn(dx < 0 ? 1 : -1);
  });
  document.addEventListener('keydown', (e) => {
    if (ui.view.hidden) return;
    if (e.key === 'ArrowRight') turn(1);
    if (e.key === 'ArrowLeft') turn(-1);
  });

  return {
    add,
    show() { moving = null; setStatus(''); render(); refreshPrices(true); },
  };
})();
