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
let missingBox = null; // encadré « carte absente de la base »
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
  const img = await loadImage(file);
  const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  img.close?.();
  return trimBackground(c);
}

// Safari ne gère pas toujours createImageBitmap : on passe alors par une balise <img>.
async function loadImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch { /* repli ci-dessous */ }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
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

async function onPhotoFile(side, file) {
  setStatus('Photo reçue, préparation…');
  try {
    setPhoto(side, await fileToCanvas(file));
  } catch (err) {
    setStatus("Impossible d'ouvrir cette image : " + err.message, true);
  }
}

function setPhoto(side, canvas) {
  photos[side] = canvas;
  const slot = $(side === 'front' ? 'slot-front' : 'slot-back');
  const img = slot.querySelector('img');
  img.src = canvas.toDataURL('image/jpeg', 0.8);
  img.hidden = false;
  slot.classList.add('filled');
  els.btnAnalyze.disabled = !photos.front;
  if (side === 'front' || getKey()) analyze();
  else setStatus('Verso ajouté. Il sert à estimer l\'état avec la reconnaissance par IA.');
}

/* ---------- Caméra avec cadre ---------- */

const cam = {
  box: $('camera'), title: $('camera-title'), video: $('video'), guide: $('guide'),
  shoot: $('cam-shoot'), file: $('cam-file'), cancel: $('cam-cancel'),
  stream: null, side: 'front',
};

async function openCamera(side) {
  cam.side = side;
  cam.title.textContent = side === 'front' ? 'Recto de la carte' : 'Verso de la carte';
  cam.box.hidden = false;
  cam.shoot.disabled = true;
  if (!navigator.mediaDevices?.getUserMedia) {
    cam.title.textContent += ' : caméra indisponible, choisis une photo';
    return;
  }
  try {
    cam.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 3840 }, height: { ideal: 2160 } },
      audio: false,
    });
    cam.video.srcObject = cam.stream;
    await cam.video.play();
    cam.shoot.disabled = false;
  } catch (err) {
    cam.title.textContent = "Caméra refusée ou indisponible : choisis une photo dans la photothèque.";
  }
}

function closeCamera() {
  cam.stream?.getTracks().forEach((t) => t.stop());
  cam.stream = null;
  cam.video.srcObject = null;
  cam.box.hidden = true;
}

// Capture uniquement l'intérieur du cadre jaune, à la pleine résolution de la caméra.
function captureGuide() {
  const v = cam.video;
  const vr = v.getBoundingClientRect();
  const gr = cam.guide.getBoundingClientRect();
  const scale = v.videoWidth / vr.width;
  const sx = Math.max(0, (gr.left - vr.left) * scale);
  const sy = Math.max(0, (gr.top - vr.top) * scale);
  const sw = Math.min(v.videoWidth - sx, gr.width * scale);
  const sh = Math.min(v.videoHeight - sy, gr.height * scale);
  const c = document.createElement('canvas');
  c.width = Math.round(sw);
  c.height = Math.round(sh);
  c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
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
function cropRegion(src, x, y, w, h, targetHeight, binarize = false) {
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
  const hist = new Array(256).fill(0);
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(((d[i] - min) / range) * 255);
    d[i] = d[i + 1] = d[i + 2] = g;
    hist[g]++;
  }
  if (binarize) {
    // Seuil d'Otsu, texte en noir sur fond blanc.
    const total = d.length / 4;
    let sum = 0, sumB = 0, wB = 0, best = 0, threshold = 128;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB || wB === total) continue;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / (total - wB);
      const between = wB * (total - wB) * (mB - mF) ** 2;
      if (between > best) { best = between; threshold = t; }
    }
    const darkText = wB && hist.slice(0, threshold).reduce((a, b) => a + b, 0) < total / 2;
    for (let i = 0; i < d.length; i += 4) {
      const black = darkText ? d[i] <= threshold : d[i] > threshold;
      d[i] = d[i + 1] = d[i + 2] = black ? 0 : 255;
    }
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
        .replace(new RegExp(`([${JA_CHARS}]) (?=[${JA_CHARS}])`, 'g'), '$1'))
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

// Parmi plusieurs lectures, préfère un numéro écrit sur autant de chiffres que le total
// (les cartes récentes impriment « 059/103 ») : « 05/103 » est alors un chiffre manqué.
function pickNumber(readings) {
  const valid = readings.filter(Boolean);
  const padded = valid.find((r) => { const [a, b] = r.split('/'); return a.length === b.length; });
  return padded || valid.sort((a, b) => b.length - a.length)[0] || '';
}

// Mots fréquents sur les cartes, propres à chaque langue (les mots communs à plusieurs sont retirés).
const LANG_WORDS = (() => {
  const raw = {
    en: 'the your this of to damage weakness retreat basic stage evolves from attack opponent opponents active flip coin heads tails energy does each card cards discard draw benched turn',
    fr: 'le la les de des du votre vos degats faiblesse retraite niveau evolue adversaire attaque pile face lancez piece energie cette une ce chaque carte cartes defaussez piochez banc tour',
    de: 'der die das und schaden schwache ruckzug gegner gegners deines deinem deine munze basis entwickelt energie fugt jede karte karten ablagestapel zieh bank zug',
    es: 'el los las tu dano debilidad retirada rival moneda cara cruz basico evoluciona energia este cada carta cartas descarta roba banca turno',
    it: 'il gli della tuo tua danni debolezza ritirata avversario moneta testa croce evolve energia questo ogni carta carte scarta pesca panchina turno',
  };
  const lists = Object.fromEntries(Object.entries(raw).map(([l, w]) => [l, new Set(w.split(' '))]));
  const count = {};
  Object.values(lists).forEach((set) => set.forEach((w) => { count[w] = (count[w] || 0) + 1; }));
  Object.values(lists).forEach((set) => set.forEach((w) => { if (count[w] > 1) set.delete(w); }));
  return lists;
})();

function detectLanguage(text) {
  const words = normalize(text).split(' ');
  let best = null, bestHits = 0, second = 0;
  for (const [lang, set] of Object.entries(LANG_WORDS)) {
    const hits = words.filter((w) => set.has(w)).length;
    if (hits > bestHits) { second = bestHits; bestHits = hits; best = lang; }
    else if (hits > second) second = hits;
  }
  return bestHits >= 2 && bestHits > second ? best : null;
}

async function analyzeWithOcr() {
  const card = photos.front;
  const chosen = els.lang.value;
  setStatus('Lecture de la carte…');
  // Plusieurs zones (le cadrage n'est jamais parfait) : on garde la lecture la plus sûre.
  const nameZones = [
    { img: cropRegion(card, 0.1, 0.02, 0.65, 0.1, 140), psm: '7' },  // ligne du nom seule
    { img: cropRegion(card, 0, 0.01, 0.8, 0.18, 260), psm: '6' },    // haut de carte, plus large
  ];

  // Nom : on essaie l'alphabet latin et le japonais.
  const tries = [];
  if (chosen !== 'ja') tries.push({ lang: 'latin', langs: ['fra', 'eng'] });
  if (chosen === 'auto' || chosen === 'ja') tries.push({ lang: 'ja', langs: ['jpn'] });
  let best = { name: '', conf: -1, lang: 'latin' };
  for (const t of tries) {
    const worker = await getWorker(t.langs);
    for (const zone of nameZones) {
      await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: zone.psm });
      const { text, confidence } = (await worker.recognize(zone.img)).data;
      const name = cleanName(text, t.lang);
      const conf = name ? confidence + (t.lang === 'ja' && JA_RE.test(name) ? 10 : 0) : -1;
      if (conf > best.conf) best = { name, conf, lang: t.lang };
    }
  }

  // Numéro : en bas à gauche de la carte, en tout petit.
  const numWorker = await getWorker(['eng']);
  await numWorker.setParameters({ tessedit_char_whitelist: '0123456789/', tessedit_pageseg_mode: '11' });
  const readings = [];
  for (const [x, y, w, h] of [[0, 0.88, 0.5, 0.12], [0, 0.82, 1, 0.18]]) {
    for (const bin of [false, true]) {
      readings.push(findNumber((await numWorker.recognize(cropRegion(card, x, y, w, h, 260, bin))).data.text));
    }
    if (pickNumber(readings).split('/').every((p, _, a) => p.length === a[1].length)) break;
  }
  const number = pickNumber(readings);

  let lang = chosen !== 'auto' ? chosen : (best.lang === 'ja' ? 'ja' : 'auto');
  // Carte en alphabet latin : la langue se lit dans le texte des attaques.
  if (lang === 'auto') {
    setStatus('Détection de la langue…');
    const worker = await getWorker(['fra', 'eng']);
    await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '6' });
    const text = (await worker.recognize(cropRegion(card, 0.04, 0.5, 0.92, 0.46, 900))).data.text;
    lang = detectLanguage(text) || 'auto';
  }
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
    // Nom japonais mal lu (ex : « ニンフィ太らン ») : on cherche avec le début du nom.
    const ja = (name.match(new RegExp(`[${JA_CHARS}]+`)) || [''])[0];
    for (const len of [ja.length - 1, 4, 3]) {
      if (len >= 2 && len < ja.length) queries.push(ja.slice(0, len));
    }
  }
  for (const q of [...new Set(queries)]) {
    add(await getJson(`${API}/${lang}/cards?name=${encodeURIComponent(q)}`));
    if (found.size) break;
  }
  // Le numéro aide toujours : on ajoute les cartes portant ce numéro.
  if (num) add(await getJson(`${API}/${lang}/cards?localId=${encodeURIComponent(num)}`));

  const sets = await getSets(lang);
  const scored = [...found.values()].map((c) => {
    const setId = setIdOf(c.id);
    const set = sets[setId];
    const localNum = parseInt(c.localId, 10);
    const sim = name ? similarity(name, c.name) : 0;
    let score = sim * 50;
    if (num && localNum === num) score += 40;
    if (total && set?.cardCount?.official === total) score += 25;
    if (setCode && compact(setCode) === compact(setId)) score += 20;
    return { brief: c, score, sim };
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
  const langs = chosen !== 'auto' ? [chosen]
    : JA_RE.test(name) ? ['ja']
    : name ? ['fr', 'en', 'de', 'es', 'it', 'ja']
    : ['fr', 'en', 'ja', 'de', 'es', 'it']; // sans nom : seul le numéro guide, le japonais est fréquent

  setStatus('Recherche de la carte et de son prix…');
  els.results.innerHTML = '';
  shown = [];
  missingBox = null;
  try {
    let candidates = [], lang = langs[0];
    for (const l of langs) {
      const found = await findCandidates(l, name, num, total);
      if (found.length && (!candidates.length || found[0].score > candidates[0].score)) {
        candidates = found;
        lang = l;
      }
      if (candidates.length && candidates[0].score >= 60) break;
    }
    // Sûr = bon nom et bon numéro, ou (sans nom) bon numéro dans une extension du bon total.
    const sure = candidates.length && candidates[0].score >= 60;
    if (!candidates.length || (!sure && !name)) {
      setStatus(name || !num
        ? 'Aucune carte trouvée. Vérifie la langue, le nom ou le numéro puis relance.'
        : "Je n'ai pas pu lire le nom et le numéro seul ne suffit pas. Tape le nom de la carte puis « Rechercher ».", true);
      if (!name) els.name.focus();
      return;
    }
    if (chosen === 'auto') els.lang.value = lang;

    // Carte introuvable : on montre seulement les autres versions du même Pokémon.
    const list = sure ? candidates : candidates.filter((c) => c.sim >= 0.5);
    const top = list.slice(0, 6);
    const details = (await Promise.all(top.map((c) =>
      getJson(`${API}/${lang}/cards/${encodeURIComponent(c.brief.id)}`).catch(() => null))));

    const ref = details.find(Boolean);
    const names = ref ? await speciesNames(ref, name) : null;
    if (names?.en && JA_RE.test(ref.name) && !englishName) englishName = names.en;

    shown = top.map((c, i) => ({ card: details[i], best: sure && i === 0 })).filter((x) => x.card);
    renderResults();
    if (sure) {
      const extra = candidates.length > top.length ? ` (${candidates.length} correspondances, les plus probables en premier)` : '';
      setStatus(`Résultats${extra}.`);
    } else {
      setStatus('');
      missingBox = renderMissing(names, num, total, shown.length > 0);
      renderResults();
    }
  } catch (err) {
    setStatus('Erreur lors de la recherche : ' + err.message, true);
  }
}

// Noms français et anglais du Pokémon (via son numéro de Pokédex), pour Cardmarket.
async function speciesNames(card, typedName) {
  const dex = Array.isArray(card.dexId) ? card.dexId[0] : card.dexId;
  if (!dex) return null;
  try {
    const sp = await getJson(`https://pokeapi.co/api/v2/pokemon-species/${dex}`);
    const pick = (l) => sp?.names?.find((n) => n.language?.name === l)?.name;
    const suffix = ((typedName || card.name).match(/\s*(ex|EX|GX|VMAX|VSTAR|V)$/) || [''])[0].trim();
    const add = (n) => (n && suffix ? `${n} ${suffix}` : n);
    return { en: add(pick('en')), fr: add(pick('fr')) };
  } catch {
    return null;
  }
}

function renderMissing(names, num, total, hasOthers) {
  const label = names?.fr || names?.en || els.name.value.trim() || 'Cette carte';
  const number = num ? ` · n° ${String(num).padStart(String(total || '').length, '0')}${total ? '/' + total : ''}` : '';
  const query = names?.en || englishName || els.name.value.trim();
  const el = document.createElement('article');
  el.className = 'result missing';
  el.innerHTML = `
    <div class="info">
      <h3>${escapeHtml(label)}${escapeHtml(number)}</h3>
      <p>Cette carte précise n'est pas encore dans la base de prix (extension sans doute trop récente).
      Vérifie son prix directement sur Cardmarket.</p>
      <div class="actions">
        <a class="button primary" href="https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(query)}" target="_blank" rel="noopener">Voir « ${escapeHtml(query)} » sur Cardmarket</a>
      </div>
      ${hasOthers ? '<p class="price-label">Autres versions de ce Pokémon, pour comparer :</p>' : ''}
    </div>`;
  return el;
}

function renderResults() {
  els.results.innerHTML = '';
  if (missingBox) els.results.appendChild(missingBox);
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

/* ---------- Navigation entre l'accueil et les rubriques ---------- */

const VIEWS = { '': 'view-home', '#accueil': 'view-home', '#detecteur': 'view-detecteur', '#sets': 'view-sets' };

function showView() {
  const hash = location.hash;
  let target = VIEWS[hash] || 'view-home';
  if (hash.startsWith('#set/')) target = 'view-set';
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== target; });
  document.getElementById('card-modal').hidden = true;
  window.scrollTo(0, 0);
  if (target === 'view-sets') Sets.showSeries();
  if (target === 'view-set') Sets.showSet(decodeURIComponent(hash.slice(5)));
}
window.addEventListener('hashchange', showView);
showView();

/* ---------- Branchements ---------- */

window.addEventListener('error', (e) => setStatus('Erreur : ' + e.message, true));
window.addEventListener('unhandledrejection', (e) => setStatus('Erreur : ' + (e.reason?.message || e.reason), true));

document.querySelectorAll('.slot').forEach((slot) => {
  slot.addEventListener('click', () => openCamera(slot.dataset.side));
});
cam.shoot.addEventListener('click', () => {
  const canvas = captureGuide();
  closeCamera();
  setPhoto(cam.side, canvas);
});
cam.file.addEventListener('change', () => {
  const f = cam.file.files[0];
  cam.file.value = '';
  closeCamera();
  if (f) onPhotoFile(cam.side, f);
});
cam.cancel.addEventListener('click', closeCamera);
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
