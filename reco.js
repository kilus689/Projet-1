'use strict';

/* Aide à la reconnaissance du lecteur gratuit : dictionnaire des noms de Pokémon
   (data/noms-pokemon.json, d'après PokéAPI) pour corriger les erreurs de lecture,
   et choix du numéro de carte le plus plausible. Utilise normalize et levenshtein (app.js). */

const Reco = (() => {
  let dictPromise = null;

  // Erreurs typiques de lecture du japonais : kanji ou signes qui ressemblent à des katakana.
  const JA_LOOKALIKES = {
    '二': 'ニ', '力': 'カ', '口': 'ロ', '工': 'エ', '夕': 'タ', '卜': 'ト', '八': 'ハ', '才': 'オ',
    '千': 'チ', '一': 'ー', '―': 'ー', '－': 'ー', '-': 'ー', '‐': 'ー', '—': 'ー', '〜': 'ー', 'ヱ': 'エ',
  };
  const JA_SMALL = { 'ァ': 'ア', 'ィ': 'イ', 'ゥ': 'ウ', 'ェ': 'エ', 'ォ': 'オ', 'ッ': 'ツ', 'ャ': 'ヤ', 'ュ': 'ユ', 'ョ': 'ヨ', 'ヮ': 'ワ' };

  // Ramène un texte japonais à des katakana « simples », pour comparer lecture et dictionnaire.
  function normJa(s) {
    return [...(s || '')].map((ch) => {
      const c = ch.charCodeAt(0);
      if (c >= 0x3041 && c <= 0x3096) ch = String.fromCharCode(c + 0x60); // hiragana → katakana
      ch = JA_LOOKALIKES[ch] || ch;
      return JA_SMALL[ch] || ch;
    }).join('').replace(/[^゠-ヿー]/g, '');
  }
  const normLatin = (s) => normalize(s).replace(/[^a-z]/g, '');

  function loadDict() {
    dictPromise ??= fetch('data/noms-pokemon.json?v=1')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then(({ langs, species }) => {
        const ja = [], latin = new Map();
        for (const [id, ...names] of species) {
          names.forEach((name, i) => {
            const lang = langs[i];
            if (!name) return;
            if (lang === 'ja') { const n = normJa(name); if (n.length >= 2) ja.push({ id, name, n }); return; }
            const n = normLatin(name);
            if (n.length < 3) return;
            const e = latin.get(n) || { id, name, n, langs: [] };
            e.langs.push(lang);
            latin.set(n, e);
          });
        }
        return { ja, latin: [...latin.values()] };
      })
      .catch(() => { dictPromise = null; return null; });
    return dictPromise;
  }

  // Meilleure ressemblance entre un nom et un morceau du texte lu (fenêtres de taille voisine).
  function bestWindow(text, name) {
    const L = name.length;
    let best = 0;
    for (let len = Math.max(2, L - 1); len <= L + 1; len++) {
      for (let i = 0; i + len <= text.length; i++) {
        const sim = 1 - levenshtein(text.slice(i, i + len), name) / Math.max(L, len);
        if (sim > best) best = sim;
      }
    }
    return best;
  }

  // Seuil selon la longueur : un nom court doit être lu presque parfaitement.
  // (un nom de 3 caractères japonais doit être lu exactement, sinon du charabia lui ressemble vite).
  const threshold = (L, ja) => (ja ? (L <= 3 ? 1 : L === 4 ? 0.75 : 0.6) : (L <= 4 ? 0.8 : 0.72));

  // Cherche le nom de Pokémon le plus probable dans des textes lus.
  // Renvoie { id, name, langs, script, score } ou null.
  async function findSpecies(texts) {
    const dict = await loadDict();
    if (!dict) return null;
    // Chaque texte lu « vote » pour le nom qui lui ressemble le plus ; on retient un nom très
    // ressemblant, ou confirmé par au moins deux lectures (le charabia ne se répète pas).
    const votes = new Map();
    for (const raw of texts) {
      let best = null;
      const consider = (entry, sim, script) => {
        const L = entry.n.length;
        if (sim < threshold(L, script === 'ja')) return;
        const score = sim + 0.015 * Math.min(L, 8); // à ressemblance égale, un nom long est plus probant
        if (!best || score > best.score) best = { ...entry, script, score, sim };
      };
      const ja = normJa(raw);
      if (ja.length >= 2) for (const e of dict.ja) consider(e, bestWindow(ja, e.n), 'ja');
      // Texte latin : mot par mot et paires de mots (noms en deux mots, lectures coupées).
      const words = normalize(raw).split(' ').filter((w) => w.length >= 3);
      const chunks = new Set(words);
      for (let i = 0; i + 1 < words.length; i++) chunks.add(words[i] + words[i + 1]);
      for (const chunk of chunks) {
        const c = chunk.replace(/[^a-z]/g, '');
        if (c.length < 3) continue;
        for (const e of dict.latin) {
          if (Math.abs(e.n.length - c.length) > 2) continue;
          consider(e, 1 - levenshtein(c, e.n) / Math.max(c.length, e.n.length), 'latin');
        }
      }
      if (!best) continue;
      const key = `${best.script}:${best.n}`;
      const v = votes.get(key) || { ...best, support: 0 };
      v.support++;
      if (best.score > v.score) Object.assign(v, best, { support: v.support });
      votes.set(key, v);
    }
    const all = [...votes.values()].sort((a, b) => b.support - a.support || b.score - a.score);
    const sure = all.find((v) => v.sim >= 0.8 || v.support >= 2) || null;
    // Noms peu sûrs : à vérifier dans la base de cartes (voir verify).
    return { sure, weak: all.filter((v) => v !== sure).slice(0, 3) };
  }

  // Un nom peu sûr est gardé s'il existe une carte de ce Pokémon dans un set de la taille lue
  // (ex : Nymphali dans un set de 103 cartes). Le charabia passe rarement ce test.
  async function verify(weak, langs, total, getJson, getSets, API) {
    if (!total) return null;
    for (const cand of weak) {
      for (const lang of langs) {
        if ((cand.script === 'ja') !== (lang === 'ja')) continue;
        if (cand.script !== 'ja' && !cand.langs.includes(lang)) continue;
        try {
          const [cards, sets] = await Promise.all([getJson(`${API}/${lang}/cards?name=${encodeURIComponent(cand.name)}`), getSets(lang)]);
          const hit = (cards || []).some((c) => sets[c.id.slice(0, c.id.lastIndexOf('-'))]?.cardCount?.official === total);
          if (hit) return { ...cand, verified: lang };
        } catch { /* hors ligne : on ne peut pas vérifier */ }
      }
    }
    return null;
  }

  // Choisit le numéro le plus plausible parmi plusieurs lectures (« 059/103 », « 59/103 », « 8/12 »…) :
  // total qui existe vraiment comme taille de set, écriture complète (059/103), lecture répétée.
  function chooseNumber(readings, totals) {
    const counts = new Map();
    readings.filter(Boolean).forEach((r) => counts.set(r, (counts.get(r) || 0) + 1));
    let best = '', bestScore = -1;
    for (const [r, n] of counts) {
      const [a, b] = r.split('/');
      const num = parseInt(a, 10), total = parseInt(b, 10);
      let score = n; // une voix par lecture
      if (totals?.has(total)) score += 3;
      if (a.length === b.length) score += 1;
      if (num > 0 && num <= total * 1.6) score += 0.5; // les cartes secrètes dépassent un peu le total
      if (score > bestScore) { bestScore = score; best = r; }
    }
    return best;
  }

  return { findSpecies, verify, chooseNumber, loadDict, normJa };
})();
