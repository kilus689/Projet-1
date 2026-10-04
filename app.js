'use strict';

const API = 'https://api.tcgdex.net/v2';
const CARD_RATIO = 63 / 88; // largeur / hauteur d'une carte Pokémon

const $ = (id) => document.getElementById(id);
const els = {
  cameraWrap: $('camera-wrap'), video: $('video'), guide: $('guide'), preview: $('preview'),
  btnCamera: $('btn-camera'), btnShoot: $('btn-shoot'), file: $('file'), status: $('status'),
  form: $('search-form'), name: $('name'), number: $('number'), lang: $('lang'),
  results: $('results'), listBox: $('list-box'), list: $('list'), listTotal: $('list-total'),
  btnClear: $('btn-clear'),
};

let stream = null;
let ocrWorker = null;
const setsCache = {};

/* ---------- Utilitaires ---------- */

function setStatus(msg, isError = false) {
  els.status.textContent = msg;
  els.status.classList.toggle('error', isError);
}

function normalize(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function levenshtein(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

function similarity(a, b) {
  a = normalize(a); b = normalize(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.85;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function formatEur(v) {
  return typeof v === 'number' && v > 0
    ? v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
    : '—';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function getJson(url) {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Erreur API (${res.status})`);
  return res.json();
}

/* ---------- Caméra ---------- */

async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("La caméra n'est pas disponible ici : utilise « Choisir une photo ».", true);
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    els.video.srcObject = stream;
    await els.video.play();
    els.cameraWrap.hidden = false;
    els.preview.hidden = true;
    els.btnShoot.hidden = false;
    els.btnCamera.hidden = true;
    setStatus('');
  } catch (err) {
    setStatus("Impossible d'ouvrir la caméra (" + err.message + '). Utilise « Choisir une photo ».', true);
  }
}

function closeCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  els.cameraWrap.hidden = true;
  els.btnShoot.hidden = true;
  els.btnCamera.hidden = false;
}

// Capture uniquement la zone du cadre jaune, à pleine résolution vidéo.
function captureGuide() {
  const v = els.video;
  const scale = v.videoWidth / v.clientWidth;
  const vr = v.getBoundingClientRect();
  const gr = els.guide.getBoundingClientRect();
  const sx = (gr.left - vr.left) * scale;
  const sy = (gr.top - vr.top) * scale;
  const sw = gr.width * scale;
  const sh = gr.height * scale;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw);
  canvas.height = Math.round(sh);
  canvas.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Photo importée : on recadre au centre au format carte si l'image est plus large.
async function fileToCanvas(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let sw = bitmap.width, sh = bitmap.height, sx = 0, sy = 0;
  if (sw / sh > CARD_RATIO * 1.15) {
    sw = Math.round(sh * CARD_RATIO);
    sx = Math.round((bitmap.width - sw) / 2);
  }
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close?.();
  return canvas;
}

/* ---------- Reconnaissance du texte (OCR) ---------- */

async function getWorker() {
  if (ocrWorker) return ocrWorker;
  if (!window.Tesseract) throw new Error("Le module de lecture de texte n'a pas pu être chargé (connexion ?)");
  setStatus('Chargement du lecteur de texte (première fois uniquement)…');
  ocrWorker = await Tesseract.createWorker(['fra', 'eng']);
  return ocrWorker;
}

// Découpe une zone (en fractions de la carte), passe en niveaux de gris, contraste, agrandit.
function cropRegion(src, x, y, w, h, targetHeight) {
  const sx = src.width * x, sy = src.height * y, sw = src.width * w, sh = src.height * h;
  const scale = Math.max(1, targetHeight / sh);
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const g = ((d[i] - min) / range) * 255;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const STAGE_WORDS = /\b(de base|base|basic|niveau ?\d|niv\.?|stage ?\d?|evolution|évolution|evolue[es]? de|évolue de|evolves from|turbo|restaur[ée]|pv|hp|tera|téra)\b/gi;

function cleanName(raw) {
  const lines = raw.split('\n')
    .map((l) => l.replace(STAGE_WORDS, ' ').replace(/\d+/g, ' ')
      .replace(/[^A-Za-zÀ-ÿ'’\- ]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((l) => /[A-Za-zÀ-ÿ]{3,}/.test(l));
  // La ligne la plus longue est presque toujours le nom.
  lines.sort((a, b) => b.length - a.length);
  const words = (lines[0] || '').split(' ').filter((w) => w.length >= 2 || /^(V|ex|EX|GX)$/i.test(w));
  return words.join(' ');
}

function findNumber(text) {
  const m = text.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1')
    .match(/(\d{1,3})\s*[\/⁄]\s*(\d{2,3})/);
  return m ? `${m[1]}/${m[2]}` : '';
}

async function readCard(canvas) {
  const worker = await getWorker();
  setStatus('Lecture de la carte…');

  await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '7' });
  const nameImg = cropRegion(canvas, 0.03, 0.025, 0.72, 0.09, 110);
  const nameText = (await worker.recognize(nameImg)).data.text;
  let name = cleanName(nameText);

  await worker.setParameters({ tessedit_char_whitelist: '0123456789/', tessedit_pageseg_mode: '11' });
  const numImg = cropRegion(canvas, 0, 0.88, 1, 0.11, 160);
  let number = findNumber((await worker.recognize(numImg)).data.text);

  // Plan B : lecture de toute la carte si une info manque.
  if (!name || !number) {
    await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '3' });
    const full = (await worker.recognize(cropRegion(canvas, 0, 0, 1, 1, 1400))).data.text;
    if (!number) number = findNumber(full);
    if (!name) name = cleanName(full.split('\n').slice(0, 4).join('\n'));
  }
  return { name, number };
}

async function handleImage(canvas) {
  els.preview.src = canvas.toDataURL('image/jpeg', 0.85);
  els.preview.hidden = false;
  els.results.innerHTML = '';
  try {
    const { name, number } = await readCard(canvas);
    els.name.value = name;
    els.number.value = number;
    if (!name && !number) {
      setStatus("Je n'arrive pas à lire la carte. Reprends la photo bien à plat et éclairée, ou tape le nom.", true);
      return;
    }
    setStatus(`Lu : ${name || '?'} ${number ? '· n° ' + number : ''} — vérifie et corrige si besoin.`);
    await search();
  } catch (err) {
    setStatus(err.message, true);
  }
}

/* ---------- Recherche et prix (TCGdex → Cardmarket) ---------- */

async function getSets(lang) {
  if (!setsCache[lang]) {
    const sets = (await getJson(`${API}/${lang}/sets`)) || [];
    setsCache[lang] = Object.fromEntries(sets.map((s) => [s.id, s]));
  }
  return setsCache[lang];
}

function setIdOf(cardId) {
  return cardId.slice(0, cardId.lastIndexOf('-'));
}

async function findCandidates(lang, name, num, total) {
  const found = new Map();
  const add = (list) => (list || []).forEach((c) => found.set(c.id, c));

  const queries = [];
  if (name) {
    queries.push(name);
    const longest = name.split(' ').sort((a, b) => b.length - a.length)[0];
    if (longest && longest.length >= 4 && longest !== name) queries.push(longest);
  }
  for (const q of queries) {
    add(await getJson(`${API}/${lang}/cards?name=${encodeURIComponent(q)}`));
    if (found.size) break;
  }
  // Pas de nom lisible : recherche par numéro.
  if (!found.size && num) {
    add(await getJson(`${API}/${lang}/cards?localId=${encodeURIComponent(num)}`));
  }

  const sets = await getSets(lang);
  const scored = [...found.values()].map((c) => {
    const set = sets[setIdOf(c.id)];
    const localNum = parseInt(c.localId, 10);
    let score = name ? similarity(name, c.name) * 50 : 0;
    if (num && localNum === num) score += 40;
    if (total && set?.cardCount && (set.cardCount.official === total || set.cardCount.total === total)) score += 25;
    return { brief: c, set, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

async function search() {
  let lang = els.lang.value;
  const name = els.name.value.trim();
  const m = els.number.value.match(/(\d+)\s*(?:\/\s*(\d+))?/);
  const num = m ? parseInt(m[1], 10) : null;
  const total = m && m[2] ? parseInt(m[2], 10) : null;

  if (!name && !num) {
    setStatus('Indique au moins le nom ou le numéro de la carte.', true);
    return;
  }

  setStatus('Recherche de la carte et de son prix…');
  els.results.innerHTML = '';
  try {
    let candidates = await findCandidates(lang, name, num, total);
    // Rien en français ? On tente en anglais (et inversement).
    if (!candidates.length) {
      lang = lang === 'en' ? 'fr' : 'en';
      candidates = await findCandidates(lang, name, num, total);
    }
    if (!candidates.length) {
      setStatus('Aucune carte trouvée. Corrige le nom ou le numéro puis relance.', true);
      return;
    }

    const top = candidates.slice(0, 6);
    const details = await Promise.all(top.map((c) =>
      getJson(`${API}/${lang}/cards/${encodeURIComponent(c.brief.id)}`).catch(() => null)));

    els.results.innerHTML = '';
    top.forEach((c, i) => {
      if (details[i]) els.results.appendChild(renderCard(details[i], i === 0 && c.score >= 60));
    });
    const extra = candidates.length > top.length ? ` (${candidates.length} correspondances, les plus probables en premier)` : '';
    setStatus(`Résultats${extra}.`);
  } catch (err) {
    setStatus("Erreur lors de la recherche : " + err.message, true);
  }
}

function cardmarketUrl(card) {
  return `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(card.name)}`;
}

function renderCard(card, isBest) {
  const cm = card.pricing?.cardmarket;
  const hasHolo = cm && (cm['trend-holo'] || cm['avg-holo']);
  const mainPrice = cm ? (cm.trend || cm.avg30 || cm.avg || cm['trend-holo'] || cm['avg-holo']) : null;

  const row = (label, normal, holo) =>
    `<tr><th>${label}</th><td>${formatEur(normal)}</td>${hasHolo ? `<td>${formatEur(holo)}</td>` : ''}</tr>`;

  const prices = cm ? `
    <p class="price-label">Prix tendance Cardmarket</p>
    <p class="price-main">${formatEur(mainPrice)}</p>
    <table class="prices">
      ${hasHolo ? '<tr><th></th><td>Normale</td><td>Holo/Reverse</td></tr>' : ''}
      ${row('Tendance', cm.trend, cm['trend-holo'])}
      ${row('Moyenne 30 j', cm.avg30, cm['avg30-holo'])}
      ${row('Moyenne 7 j', cm.avg7, cm['avg7-holo'])}
      ${row('Prix le plus bas', cm.low, cm['low-holo'])}
    </table>
    ${cm.updated ? `<p class="price-label">Mis à jour le ${new Date(cm.updated).toLocaleDateString('fr-FR')}</p>` : ''}`
    : '<p class="no-price">Pas de prix Cardmarket disponible pour cette carte — vérifie directement sur Cardmarket.</p>';

  const setTotal = card.set?.cardCount?.official;
  const el = document.createElement('article');
  el.className = 'result' + (isBest ? ' best' : '');
  el.innerHTML = `
    ${card.image ? `<img src="${escapeHtml(card.image)}/low.webp" alt="${escapeHtml(card.name)}" loading="lazy">` : ''}
    <div class="info">
      <h3>${escapeHtml(card.name)}${isBest ? '<span class="badge">Meilleure correspondance</span>' : ''}</h3>
      <p class="meta">${escapeHtml(card.set?.name || '')} · n° ${escapeHtml(card.localId)}${setTotal ? '/' + setTotal : ''}${card.rarity ? ' · ' + escapeHtml(card.rarity) : ''}</p>
      ${prices}
      <div class="actions">
        <a class="button secondary" href="${cardmarketUrl(card)}" target="_blank" rel="noopener">Voir sur Cardmarket</a>
        ${mainPrice ? '<button class="primary" type="button">+ Ma liste</button>' : ''}
      </div>
    </div>`;
  el.querySelector('.actions button')?.addEventListener('click', () => {
    addToList({ id: card.id, name: card.name, set: card.set?.name || '', price: mainPrice });
  });
  return el;
}

/* ---------- Ma liste (stockée sur l'appareil) ---------- */

function loadList() {
  try { return JSON.parse(localStorage.getItem('pokeList') || '[]'); } catch { return []; }
}

function saveList(list) {
  try { localStorage.setItem('pokeList', JSON.stringify(list)); } catch { /* stockage indisponible */ }
  renderList(list);
}

function addToList(item) {
  const list = loadList();
  list.push(item);
  saveList(list);
}

function renderList(list = loadList()) {
  els.listBox.hidden = !list.length;
  els.list.innerHTML = '';
  list.forEach((item, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(item.name)} <small>(${escapeHtml(item.set)})</small></span>
      <span>${formatEur(item.price)} <button type="button" aria-label="Retirer">✕</button></span>`;
    li.querySelector('button').addEventListener('click', () => {
      const l = loadList();
      l.splice(i, 1);
      saveList(l);
    });
    els.list.appendChild(li);
  });
  const sum = list.reduce((s, it) => s + (it.price || 0), 0);
  els.listTotal.textContent = list.length ? `— ${formatEur(sum)}` : '';
}

/* ---------- Branchements ---------- */

els.btnCamera.addEventListener('click', openCamera);
els.btnShoot.addEventListener('click', async () => {
  const canvas = captureGuide();
  closeCamera();
  await handleImage(canvas);
});
els.file.addEventListener('change', async () => {
  const f = els.file.files[0];
  els.file.value = '';
  if (!f) return;
  closeCamera();
  try {
    await handleImage(await fileToCanvas(f));
  } catch (err) {
    setStatus("Impossible d'ouvrir cette image : " + err.message, true);
  }
});
els.form.addEventListener('submit', (e) => { e.preventDefault(); search(); });
els.btnClear.addEventListener('click', () => saveList([]));
renderList();
