'use strict';

const API = 'https://api.tcgdex.net/v2';
const CARD_RATIO = 63 / 88; // largeur / hauteur d'une carte Pokémon

const $ = (id) => document.getElementById(id);
const els = {
  cameraWrap: $('camera-wrap'), video: $('video'), guide: $('guide'), preview: $('preview'),
  btnCamera: $('btn-camera'), btnShoot: $('btn-shoot'), file: $('file'), status: $('status'),
  form: $('search-form'), name: $('name'), number: $('number'), lang: $('lang'),
  condition: $('condition'), results: $('results'),
};

// Cardmarket ne publie qu'un prix global (surtout des ventes en très bon état) :
// on applique une décote approximative selon l'état choisi.
const CONDITIONS = {
  MT: { label: 'Mint', factor: 1 },
  NM: { label: 'Near Mint', factor: 1 },
  EX: { label: 'Excellent', factor: 0.85 },
  GD: { label: 'Good', factor: 0.7 },
  LP: { label: 'Light Played', factor: 0.55 },
  PL: { label: 'Played', factor: 0.4 },
  PO: { label: 'Poor', factor: 0.25 },
};

let stream = null;
const ocrWorkers = {};
const setsCache = {};
let shown = []; // cartes affichées, pour recalculer quand l'état change

/* ---------- Utilitaires ---------- */

function setStatus(msg, isError = false) {
  els.status.textContent = msg;
  els.status.classList.toggle('error', isError);
}

function normalize(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(new RegExp(`[^a-z0-9 ${JA_CHARS}]`, 'g'), ' ').replace(/\s+/g, ' ').trim();
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

async function getWorker(lang) {
  const extra = { de: 'deu', es: 'spa', it: 'ita' }[lang];
  const langs = lang === 'ja' ? ['jpn', 'eng'] : ['fra', 'eng', ...(extra ? [extra] : [])];
  const key = langs.join('+');
  if (ocrWorkers[key]) return ocrWorkers[key];
  if (!window.Tesseract) throw new Error("Le module de lecture de texte n'a pas pu être chargé (connexion ?)");
  setStatus('Chargement du lecteur de texte (première fois uniquement)…');
  ocrWorkers[key] = await Tesseract.createWorker(langs);
  return ocrWorkers[key];
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

const JA_CHARS = '\u3040-\u30ff\u4e00-\u9fff\uff10-\uff19ー';
const JA_STAGE_WORDS = /(たね|[12１２]?進化|HP|ＨＰ|ポケモン)/g;
const STAGE_WORDS = /\b(de base|base|basic|niveau ?\d|niv\.?|stage ?\d?|evolution|évolution|evolue[es]? de|évolue de|evolves from|turbo|restaur[ée]|pv|hp|tera|téra)\b/gi;

function cleanName(raw, lang) {
  if (lang === 'ja') {
    const lines = raw.split('\n')
      .map((l) => l.replace(JA_STAGE_WORDS, ' ').replace(new RegExp(`[^${JA_CHARS}A-Za-z ]`, 'g'), ' ')
        .replace(/[0-9０-９]+/g, ' ').replace(/\s+/g, ' ').trim()
        // Tesseract met souvent des espaces entre les caractères japonais.
        .replace(new RegExp(`(?<=[${JA_CHARS}]) (?=[${JA_CHARS}])`, 'g'), ''))
      .filter((l) => new RegExp(`[${JA_CHARS}]{2,}`).test(l));
    lines.sort((a, b) => b.length - a.length);
    return lines[0] || '';
  }
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

async function readCard(canvas, lang) {
  const worker = await getWorker(lang);
  setStatus('Lecture de la carte…');

  await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '7' });
  const nameImg = cropRegion(canvas, 0.03, 0.025, 0.72, 0.09, 110);
  const nameText = (await worker.recognize(nameImg)).data.text;
  let name = cleanName(nameText, lang);

  await worker.setParameters({ tessedit_char_whitelist: '0123456789/', tessedit_pageseg_mode: '11' });
  const numImg = cropRegion(canvas, 0, 0.88, 1, 0.11, 160);
  let number = findNumber((await worker.recognize(numImg)).data.text);

  // Plan B : lecture de toute la carte si une info manque.
  if (!name || !number) {
    await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '3' });
    const full = (await worker.recognize(cropRegion(canvas, 0, 0, 1, 1, 1400))).data.text;
    if (!number) number = findNumber(full);
    if (!name) name = cleanName(full.split('\n').slice(0, 4).join('\n'), lang);
  }
  return { name, number };
}

async function handleImage(canvas) {
  els.preview.src = canvas.toDataURL('image/jpeg', 0.85);
  els.preview.hidden = false;
  els.results.innerHTML = '';
  try {
    const { name, number } = await readCard(canvas, els.lang.value);
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
    // Rien trouvé ? On tente les autres langues (un nom japonais ne se cherche qu'en japonais).
    const fallbacks = /[\u3040-\u30ff\u4e00-\u9fff]/.test(name) ? ['ja'] : ['fr', 'en'];
    for (const other of fallbacks) {
      if (candidates.length) break;
      if (other === lang) continue;
      lang = other;
      candidates = await findCandidates(lang, name, num, total);
    }
    if (!candidates.length) {
      setStatus('Aucune carte trouvée. Corrige le nom ou le numéro puis relance.', true);
      return;
    }

    const top = candidates.slice(0, 6);
    const details = await Promise.all(top.map((c) =>
      getJson(`${API}/${lang}/cards/${encodeURIComponent(c.brief.id)}`).catch(() => null)));

    shown = top.map((c, i) => ({ card: details[i], best: i === 0 && c.score >= 60 })).filter((x) => x.card);
    renderResults();
    const extra = candidates.length > top.length ? ` (${candidates.length} correspondances, les plus probables en premier)` : '';
    setStatus(`Résultats${extra}.`);
  } catch (err) {
    setStatus("Erreur lors de la recherche : " + err.message, true);
  }
}

function renderResults() {
  els.results.innerHTML = '';
  shown.forEach(({ card, best }) => els.results.appendChild(renderCard(card, best)));
}

function cardmarketUrl(card) {
  return `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(card.name)}`;
}

function renderCard(card, isBest) {
  const cm = card.pricing?.cardmarket;
  const hasHolo = cm && (cm['trend-holo'] || cm['avg-holo']);
  const mainPrice = cm ? (cm.trend || cm.avg30 || cm.avg || cm['trend-holo'] || cm['avg-holo']) : null;
  const cond = CONDITIONS[els.condition.value] || CONDITIONS.NM;
  const adj = (v) => (typeof v === 'number' ? v * cond.factor : v);

  const row = (label, normal, holo) =>
    `<tr><th>${label}</th><td>${formatEur(adj(normal))}</td>${hasHolo ? `<td>${formatEur(adj(holo))}</td>` : ''}</tr>`;

  const prices = cm ? `
    <p class="price-label">Prix Cardmarket · état ${cond.label}</p>
    <p class="price-main">${formatEur(adj(mainPrice))}</p>
    ${cond.factor < 1 ? `<p class="price-condition">Estimation (≈ ${Math.round(cond.factor * 100)} % du prix Near Mint de ${formatEur(mainPrice)})</p>` : ''}
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
      </div>
    </div>`;
  return el;
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
els.condition.addEventListener('change', renderResults);
