'use strict';

const API = 'https://api.tcgdex.net/v2';
const CLAUDE_MODEL = 'claude-opus-5-5';
const SDK_URLS = [
  'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk/+esm',
  'https://esm.sh/@anthropic-ai/sdk',
];
const KEY_STORAGE = 'claudeApiKey';

const $ = (id) => document.getElementById(id);
const els = {
  btnAnalyze: $('btn-analyze'), mode: $('mode'), status: $('status'), notes: $('condition-notes'),
  form: $('search-form'), name: $('name'), number: $('number'), lang: $('lang'),
  condition: $('condition'), results: $('results'),
  apiKey: $('api-key'), btnSaveKey: $('btn-save-key'), btnClearKey: $('btn-clear-key'),
};

// Cardmarket ne publie qu'un prix global (surtout des ventes en très bon état) :
// on applique une décote approximative selon l'état.
const CONDITIONS = {
  MT: { label: 'Mint', factor: 1 },
  NM: { label: 'Near Mint', factor: 1 },
  EX: { label: 'Excellent', factor: 0.85 },
  GD: { label: 'Good', factor: 0.7 },
  LP: { label: 'Light Played', factor: 0.55 },
  PL: { label: 'Played', factor: 0.4 },
  PO: { label: 'Poor', factor: 0.25 },
};

const JA_CHARS = '぀-ヿ一-鿿ー';
const JA_RE = new RegExp(`[${JA_CHARS}]`);

const photos = { front: null, back: null }; // canvas recadrés
const ocrWorkers = {};
const setsCache = {};
let shown = [];        // cartes affichées, pour recalculer quand l'état change
let englishName = '';  // nom anglais (cartes japonaises), pour le lien Cardmarket
let setCode = '';      // code d'extension lu sur la carte (ex : SV8a)

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

function getKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}

function updateMode() {
  els.mode.textContent = getKey()
    ? '🤖 Reconnaissance par IA (Claude) : langue, numéro et état détectés automatiquement.'
    : "📝 Lecteur de texte gratuit. Pour une meilleure reconnaissance et l'état automatique, ajoute une clé Claude dans les réglages en bas.";
}

/* ---------- Photos ---------- */

// Charge la photo, la réduit, puis retire le fond uni autour de la carte.
async function fileToCanvas(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bitmap.width * scale);
  c.height = Math.round(bitmap.height * scale);
  c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close?.();
  return trimBackground(c);
}

// Repère le fond à partir des coins de l'image et coupe les bandes qui lui ressemblent.
function trimBackground(src) {
  const w = src.width, h = src.height;
  const d = src.getContext('2d').getImageData(0, 0, w, h).data;
  const px = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  const m = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  const samples = [px(m, m), px(w - m, m), px(m, h - m), px(w - m, h - m)];
  // Un pixel est du fond s'il ressemble à l'un des quatre coins (le fond n'est pas toujours uni).
  const isBg = (x, y) => {
    const p = px(x, y);
    return samples.some((b) => Math.abs(p[0] - b[0]) + Math.abs(p[1] - b[1]) + Math.abs(p[2] - b[2]) < 70);
  };
  const step = 4;
  const rowIsCard = (y) => { let n = 0, t = 0; for (let x = 0; x < w; x += step) { t++; if (!isBg(x, y)) n++; } return n / t > 0.3; };
  const colIsCard = (x) => { let n = 0, t = 0; for (let y = 0; y < h; y += step) { t++; if (!isBg(x, y)) n++; } return n / t > 0.3; };
  let top = 0, bottom = h - 1, left = 0, right = w - 1;
  while (top < h / 3 && !rowIsCard(top)) top++;
  while (bottom > (2 * h) / 3 && !rowIsCard(bottom)) bottom--;
  while (left < w / 3 && !colIsCard(left)) left++;
  while (right > (2 * w) / 3 && !colIsCard(right)) right--;
  const cw = right - left + 1, ch = bottom - top + 1;
  // Si le résultat n'a pas une forme de carte, on garde l'image entière.
  const ratio = cw / ch;
  if (ratio < 0.55 || ratio > 0.9 || cw * ch < w * h * 0.15) return src;
  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  out.getContext('2d').drawImage(src, left, top, cw, ch, 0, 0, cw, ch);
  return out;
}

async function onPhoto(side, file) {
  try {
    photos[side] = await fileToCanvas(file);
  } catch (err) {
    setStatus("Impossible d'ouvrir cette image : " + err.message, true);
    return;
  }
  const slot = $(side === 'front' ? 'slot-front' : 'slot-back');
  const img = slot.querySelector('img');
  img.src = photos[side].toDataURL('image/jpeg', 0.8);
  img.hidden = false;
  slot.classList.add('filled');
  els.btnAnalyze.disabled = !photos.front;
  if (side === 'front' || getKey()) analyze();
  else setStatus('Verso ajouté. Il sert à estimer l\'état avec la reconnaissance par IA.');
}

/* ---------- Reconnaissance par IA (Claude) ---------- */

let sdkPromise = null;
function loadSdk() {
  sdkPromise ??= (async () => {
    for (const url of SDK_URLS) {
      try { return (await import(url)).default; } catch { /* essai suivant */ }
    }
    sdkPromise = null;
    throw new Error("Impossible de charger le module Claude (connexion ?)");
  })();
  return sdkPromise;
}

function toImageBlock(canvas) {
  const max = 1568;
  const scale = Math.min(1, max / Math.max(canvas.width, canvas.height));
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * scale);
  c.height = Math.round(canvas.height * scale);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  const data = c.toDataURL('image/jpeg', 0.9).split(',')[1];
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } };
}

const CARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_pokemon_card', 'language', 'name', 'name_english', 'number', 'set_total', 'set_code', 'condition', 'condition_notes'],
  properties: {
    is_pokemon_card: { type: 'boolean' },
    language: { type: 'string', enum: ['fr', 'en', 'ja', 'de', 'es', 'it', 'other'] },
    name: { type: 'string', description: 'Nom exact imprimé sur la carte, dans sa langue, suffixe compris (ex, V, VMAX…)' },
    name_english: { type: 'string', description: 'Nom anglais officiel de la carte' },
    number: { type: 'string', description: 'Numéro de la carte avant la barre oblique, ex "059". Vide si illisible.' },
    set_total: { type: 'string', description: 'Nombre après la barre oblique, ex "103". Vide si absent.' },
    set_code: { type: 'string', description: "Code d'extension imprimé en bas à gauche, ex \"SV8a\" ou \"MEW\". Vide si illisible." },
    condition: { type: 'string', enum: ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'] },
    condition_notes: { type: 'string', description: "Explication courte en français de l'état (coins, bords, surface, centrage)" },
  },
};

async function analyzeWithClaude() {
  const Anthropic = await loadSdk();
  const client = new Anthropic({ apiKey: getKey(), dangerouslyAllowBrowser: true });

  const content = [{ type: 'text', text: 'Recto de la carte :' }, toImageBlock(photos.front)];
  if (photos.back) content.push({ type: 'text', text: 'Verso de la carte :' }, toImageBlock(photos.back));
  content.push({
    type: 'text',
    text: [
      'Identifie cette carte Pokémon et estime son état selon la grille Cardmarket',
      '(MT Mint, NM Near Mint, EX Excellent, GD Good, LP Light Played, PL Played, PO Poor).',
      'Le numéro (ex 059/103) et le code d\'extension sont imprimés en petit en bas à gauche de la carte.',
      'Pour l\'état, examine les coins, les bords, la surface (rayures, plis, taches) et le centrage.',
      photos.back ? 'Le verso est fourni : utilise-le aussi, les bords et coins du verso révèlent souvent l\'usure.'
        : 'Seul le recto est fourni : précise dans les notes que le verso n\'a pas été vérifié.',
      'Une photo floue ou avec reflets ne prouve pas un défaut : ne pénalise que ce que tu vois vraiment.',
    ].join(' '),
  });

  const response = await client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: CARD_SCHEMA } },
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') throw new Error("Claude n'a pas pu analyser cette image.");
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Réponse vide de Claude.');
  return JSON.parse(text);
}

function claudeErrorMessage(err) {
  const status = err?.status;
  if (status === 401) return 'Clé Claude invalide : vérifie-la dans les réglages.';
  if (status === 429) return 'Trop de demandes à Claude, réessaie dans un instant.';
  if (status === 400 && /credit|billing/i.test(err.message)) return 'Crédit insuffisant sur ton compte Anthropic.';
  return 'Erreur Claude : ' + (err?.message || err);
}

/* ---------- Lecteur de texte gratuit (Tesseract) ---------- */

async function getWorker(langs) {
  const key = langs.join('+');
  if (!ocrWorkers[key]) {
    if (!window.Tesseract) throw new Error("Le lecteur de texte n'a pas pu être chargé (connexion ?)");
    setStatus('Chargement du lecteur de texte (première fois uniquement)…');
    ocrWorkers[key] = Tesseract.createWorker(langs).catch((err) => { delete ocrWorkers[key]; throw err; });
  }
  return ocrWorkers[key];
}

// Découpe une zone (en fractions de la carte), niveaux de gris, contraste, agrandissement.
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

const JA_STAGE_WORDS = /(たね|[12１２]?進化|HP|ＨＰ|ポケモン)/g;
const STAGE_WORDS = /\b(de base|base|basic|niveau ?\d|niv\.?|stage ?\d?|evolution|évolution|evolue[es]? de|évolue de|evolves from|turbo|restaur[ée]|pv|hp|tera|téra)\b/gi;

function cleanName(raw, lang) {
  if (lang === 'ja') {
    const lines = raw.split('\n')
      .map((l) => l.replace(JA_STAGE_WORDS, ' ').replace(new RegExp(`[^${JA_CHARS}A-Za-z ]`, 'g'), ' ')
        .replace(/\s+/g, ' ').trim()
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
  lines.sort((a, b) => b.length - a.length);
  const words = (lines[0] || '').split(' ').filter((w) => w.length >= 2 || /^(V|ex|EX|GX)$/i.test(w));
  return words.join(' ');
}

function findNumber(text) {
  const m = text.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1')
    .match(/(\d{1,3})\s*[\/⁄]\s*(\d{2,3})/);
  return m ? `${m[1]}/${m[2]}` : '';
}

async function analyzeWithOcr() {
  const card = photos.front;
  const chosen = els.lang.value;
  setStatus('Lecture de la carte…');
  // Zone large (le cadrage n'est jamais parfait) : le nom est la plus longue ligne lue.
  const nameImg = cropRegion(card, 0, 0.01, 0.8, 0.18, 260);

  // Nom : on essaie l'alphabet latin et le japonais, on garde la lecture la plus sûre.
  const tries = [];
  if (chosen !== 'ja') tries.push({ lang: 'latin', langs: ['fra', 'eng'] });
  if (chosen === 'auto' || chosen === 'ja') tries.push({ lang: 'ja', langs: ['jpn'] });
  let best = { name: '', conf: -1, lang: 'latin' };
  for (const t of tries) {
    const worker = await getWorker(t.langs);
    await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '6' });
    const { text, confidence } = (await worker.recognize(nameImg)).data;
    const name = cleanName(text, t.lang);
    const conf = name ? confidence + (t.lang === 'ja' && JA_RE.test(name) ? 10 : 0) : -1;
    if (conf > best.conf) best = { name, conf, lang: t.lang };
  }

  // Numéro : en bas à gauche de la carte, en tout petit.
  const numWorker = await getWorker(['eng']);
  await numWorker.setParameters({ tessedit_char_whitelist: '0123456789/', tessedit_pageseg_mode: '11' });
  let number = '';
  for (const [x, y, w, h] of [[0, 0.86, 0.55, 0.14], [0, 0.8, 1, 0.2]]) {
    number = findNumber((await numWorker.recognize(cropRegion(card, x, y, w, h, 220))).data.text);
    if (number) break;
  }

  const lang = chosen !== 'auto' ? chosen : (best.lang === 'ja' ? 'ja' : 'auto');
  return { name: best.name, number, lang };
}

/* ---------- Analyse ---------- */

async function analyze() {
  if (!photos.front) return;
  els.btnAnalyze.disabled = true;
  els.results.innerHTML = '';
  els.notes.hidden = true;
  englishName = '';
  setCode = '';
  try {
    if (getKey()) {
      setStatus(photos.back ? 'Claude examine le recto et le verso…' : 'Claude examine la carte…');
      let r;
      try {
        r = await analyzeWithClaude();
      } catch (err) {
        setStatus(claudeErrorMessage(err), true);
        return;
      }
      if (!r.is_pokemon_card) {
        setStatus("Ça ne ressemble pas à une carte Pokémon. Reprends la photo.", true);
        return;
      }
      els.name.value = r.name;
      els.number.value = r.number ? r.number + (r.set_total ? '/' + r.set_total : '') : '';
      if (r.language !== 'other') els.lang.value = r.language;
      if (CONDITIONS[r.condition]) els.condition.value = r.condition;
      englishName = r.name_english;
      setCode = r.set_code;
      els.notes.textContent = `État estimé : ${CONDITIONS[r.condition]?.label || r.condition}. ${r.condition_notes}`;
      els.notes.hidden = false;
    } else {
      const r = await analyzeWithOcr();
      els.name.value = r.name;
      els.number.value = r.number;
      els.lang.value = r.lang;
      if (!r.name && !r.number) {
        setStatus("Je n'arrive pas à lire la carte. Reprends la photo bien à plat et éclairée, ou tape le nom.", true);
        return;
      }
    }
    await search();
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    els.btnAnalyze.disabled = !photos.front;
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

const compact = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function findCandidates(lang, name, num, total) {
  const found = new Map();
  const add = (list) => (list || []).forEach((c) => found.set(c.id, c));

  const queries = [];
  if (name) {
    queries.push(name);
    const longest = name.split(' ').sort((a, b) => b.length - a.length)[0];
    if (longest && longest.length >= 3 && longest !== name) queries.push(longest);
  }
  for (const q of queries) {
    add(await getJson(`${API}/${lang}/cards?name=${encodeURIComponent(q)}`));
    if (found.size) break;
  }
  // Pas de nom exploitable : recherche par numéro.
  if (!found.size && num) {
    add(await getJson(`${API}/${lang}/cards?localId=${encodeURIComponent(num)}`));
  }

  const sets = await getSets(lang);
  const scored = [...found.values()].map((c) => {
    const setId = setIdOf(c.id);
    const set = sets[setId];
    const localNum = parseInt(c.localId, 10);
    let score = name ? similarity(name, c.name) * 50 : 0;
    if (num && localNum === num) score += 40;
    if (total && set?.cardCount && (set.cardCount.official === total || set.cardCount.total === total)) score += 25;
    if (setCode && compact(setCode) === compact(setId)) score += 20;
    return { brief: c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

async function search() {
  const name = els.name.value.trim();
  const m = els.number.value.match(/(\d+)\s*(?:\/\s*(\d+))?/);
  const num = m ? parseInt(m[1], 10) : null;
  const total = m && m[2] ? parseInt(m[2], 10) : null;

  if (!name && !num) {
    setStatus('Indique au moins le nom ou le numéro de la carte.', true);
    return;
  }

  // Langues à essayer : celle choisie, sinon déduite de l'écriture du nom.
  const chosen = els.lang.value;
  const langs = chosen !== 'auto' ? [chosen] : JA_RE.test(name) ? ['ja'] : ['fr', 'en', 'de', 'es', 'it'];

  setStatus('Recherche de la carte et de son prix…');
  els.results.innerHTML = '';
  shown = [];
  try {
    let candidates = [], lang = langs[0];
    for (const l of langs) {
      candidates = await findCandidates(l, name, num, total);
      lang = l;
      if (candidates.length && candidates[0].score >= 40) break;
    }
    if (!candidates.length) {
      setStatus('Aucune carte trouvée. Vérifie la langue, le nom ou le numéro puis relance.', true);
      return;
    }
    if (chosen === 'auto') els.lang.value = lang;

    const top = candidates.slice(0, 6);
    const details = await Promise.all(top.map((c) =>
      getJson(`${API}/${lang}/cards/${encodeURIComponent(c.brief.id)}`).catch(() => null)));

    shown = top.map((c, i) => ({ card: details[i], best: i === 0 && c.score >= 60 })).filter((x) => x.card);
    renderResults();
    const extra = candidates.length > top.length ? ` (${candidates.length} correspondances, les plus probables en premier)` : '';
    setStatus(`Résultats${extra}.`);
  } catch (err) {
    setStatus('Erreur lors de la recherche : ' + err.message, true);
  }
}

function renderResults() {
  els.results.innerHTML = '';
  shown.forEach(({ card, best }) => els.results.appendChild(renderCard(card, best)));
}

function cardmarketUrl(card) {
  // Cardmarket référence les cartes japonaises sous leur nom anglais.
  const q = JA_RE.test(card.name) && englishName ? englishName : card.name;
  return `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(q)}`;
}

function renderCard(card, isBest) {
  const cm = card.pricing?.cardmarket;
  const hasHolo = cm && (cm['trend-holo'] || cm['avg-holo']);
  const mainPrice = cm ? (cm.trend || cm.avg30 || cm.avg || cm['trend-holo'] || cm['avg-holo']) : null;
  const cond = CONDITIONS[els.condition.value] || CONDITIONS.NM;
  const adj = (v) => (typeof v === 'number' ? v * cond.factor : v);

  const row = (label, normal, holo) =>
    `<tr><th>${label}</th><td>${formatEur(adj(normal))}</td>${hasHolo ? `<td>${formatEur(adj(holo))}</td>` : ''}</tr>`;

  const prices = mainPrice ? `
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
    : '<p class="no-price">Pas de prix Cardmarket disponible pour cette carte : vérifie directement sur Cardmarket.</p>';

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

document.querySelectorAll('.slot input[type=file]').forEach((input) => {
  input.addEventListener('change', () => {
    const f = input.files[0];
    input.value = '';
    if (f) onPhoto(input.dataset.side, f);
  });
});
els.btnAnalyze.addEventListener('click', analyze);
els.form.addEventListener('submit', (e) => { e.preventDefault(); search(); });
els.condition.addEventListener('change', renderResults);

els.apiKey.value = getKey();
els.btnSaveKey.addEventListener('click', () => {
  try { localStorage.setItem(KEY_STORAGE, els.apiKey.value.trim()); } catch { /* stockage indisponible */ }
  updateMode();
  setStatus(getKey() ? 'Clé enregistrée sur cet appareil.' : 'Aucune clé enregistrée.');
});
els.btnClearKey.addEventListener('click', () => {
  try { localStorage.removeItem(KEY_STORAGE); } catch { /* stockage indisponible */ }
  els.apiKey.value = '';
  updateMode();
  setStatus('Clé effacée.');
});
updateMode();
