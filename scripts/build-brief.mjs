// ---------------------------------------------------------------
// Arma data/brief.json a partir de feeds RSS públicos.
// Sin API de pago, sin LLM: puntaje por fuente + palabras clave.
// Corre desde GitHub Actions (ver .github/workflows/brief.yml).
// ---------------------------------------------------------------

import { writeFile, mkdir } from "node:fs/promises";

const NEWS_FEEDS = [
  { section: "Mundo", source: "BBC Mundo", url: "https://feeds.bbci.co.uk/mundo/rss.xml", weight: 3 },
  { section: "Tecnología", source: "Xataka", url: "https://www.xataka.com/feedburner.xml", weight: 3 },
  { section: "Tecnología", source: "Hipertextual", url: "https://hipertextual.com/feed", weight: 2 },
  { section: "Argentina", source: "La Nación", url: "https://www.lanacion.com.ar/arc/outboundfeeds/rss/", weight: 3 },
  { section: "Argentina", source: "Infobae", url: "https://www.infobae.com/arc/outboundfeeds/rss/", weight: 2,
    excludePrefixes: ["/peru/", "/mexico/", "/america/", "/espana/", "/estados-unidos/", "/colombia/", "/venezuela/",
      "/economia/", "/deportes/", "/teleshow/", "/entretenimiento/", "/tag/", "/resizer/"] },
  { section: "Economía", source: "Infobae Economía", url: "https://www.infobae.com/arc/outboundfeeds/rss/category/economia/", weight: 3 },
  { section: "Economía", source: "Ámbito", url: "https://www.ambito.com/rss/pages/finanzas.xml", weight: 2 }
];

const SPORT_FEEDS = [
  { team: "Boca Juniors", source: "Olé", url: "https://www.ole.com.ar/rss/boca-juniors/" },
  { team: "Selección Argentina", source: "Olé", url: "https://www.ole.com.ar/rss/seleccion/" },
  { team: "Fórmula 1", source: "F1", url: "https://www.formula1.com/en/latest/all.xml" },
  { team: "Deportes de invierno", source: "Marca", url: "https://www.marca.com/rss/portada.xml",
    keywordFilter: ["esquí", "esqui", "snowboard", "biatlón", "biatlon", "bobsleigh", "patinaje", "luge",
      "invierno", "fis ", "descenso", "slalom", "salto de esquí", "salto de esqui"] }
];

const BOOST_KEYWORDS = [
  "elecciones", "gobierno", "presidente", "milei", "dólar", "dolar", "inflación", "inflacion", "bcra", "fmi",
  "paro", "crisis", "guerra", "acuerdo", "récord", "record", "muere", "murió", "murio", "renuncia", "atentado",
  "terremoto", "explosión", "explosion", "juicio", "corte suprema", "congreso", "ley", "impuesto", "tasa", "fed",
  "mercado", "bolsa", "desplome", "recesión", "recesion", "pobreza", "desempleo", "cumbre", "tratado",
  "sanciones", "huelga", "ataque", "conflicto"
];

const FILLER_KEYWORDS = [
  "horóscopo", "horoscopo", "receta", "recetas", "farándula", "farandula", "influencer", "viral", "tiktok",
  "gran hermano", "masterchef", "showmatch", "cotilleo", "tarot", "signos del zodíaco", "test de personalidad",
  "oferta", "descuento", "cupón", "cupon", "black friday", "sorteo"
];

const NEWS_PER_SECTION = 3;
const FETCH_TIMEOUT_MS = 12000;

// ---------- utilidades ----------

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (parte-del-dia build)" }
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'").replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)<\\/" + name + ">"));
  if (!m) return "";
  const raw = m[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return decodeEntities(cdata ? cdata[1] : raw);
}

function parseItems(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/g) || [];
  for (const block of blocks) {
    const title = tag(block, "title");
    const link = tag(block, "link");
    const pubDate = tag(block, "pubDate") || tag(block, "dc:date");
    if (!title || !link) continue;
    const date = pubDate ? new Date(pubDate) : new Date();
    items.push({ title, link, date: isNaN(date) ? new Date() : date });
  }
  return items;
}

function ago(date) {
  const mins = Math.max(1, Math.round((Date.now() - date.getTime()) / 60000));
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `hace ${days} d`;
}

function hasFiller(title) {
  const t = title.toLowerCase();
  return FILLER_KEYWORDS.some(k => t.includes(k));
}

function boostScore(title) {
  const t = title.toLowerCase();
  return BOOST_KEYWORDS.reduce((n, k) => (t.includes(k) ? n + 1 : n), 0);
}

// ---------- noticias ----------

async function buildNews() {
  const seenLinks = new Set();
  const seenTitles = new Set();
  const bySection = new Map();

  await Promise.all(NEWS_FEEDS.map(async feed => {
    let xml;
    try {
      xml = await fetchText(feed.url);
    } catch (e) {
      console.warn(`[news] ${feed.source} (${feed.section}) falló: ${e.message}`);
      return;
    }
    let items = parseItems(xml);
    if (feed.excludePrefixes) {
      items = items.filter(it => {
        try {
          const path = new URL(it.link).pathname;
          return !feed.excludePrefixes.some(p => path.startsWith(p));
        } catch { return true; }
      });
    }
    const scored = items
      .filter(it => !hasFiller(it.title))
      .map(it => ({
        title: it.title,
        source: feed.source,
        url: it.link,
        ago: ago(it.date),
        date: it.date,
        score: feed.weight * 10 + boostScore(it.title)
      }));
    const list = bySection.get(feed.section) || [];
    bySection.set(feed.section, list.concat(scored));
  }));

  const order = ["Mundo", "Tecnología", "Argentina", "Economía"];
  const news = [];
  for (const sec of order) {
    const candidates = (bySection.get(sec) || [])
      .filter(it => {
        const key = it.title.toLowerCase().slice(0, 48);
        if (seenLinks.has(it.url) || seenTitles.has(key)) return false;
        seenLinks.add(it.url); seenTitles.add(key);
        return true;
      })
      .sort((a, b) => b.score - a.score || b.date - a.date)
      .slice(0, NEWS_PER_SECTION)
      .map(({ title, source, url, ago }) => ({ title, source, url, ago }));
    if (candidates.length) news.push({ sec, items: candidates });
  }
  return news;
}

// ---------- deporte ----------

async function buildSport() {
  const sport = [];
  for (const feed of SPORT_FEEDS) {
    let xml;
    try {
      xml = await fetchText(feed.url);
    } catch (e) {
      console.warn(`[sport] ${feed.team} falló: ${e.message}`);
      continue;
    }
    let items = parseItems(xml);
    if (feed.keywordFilter) {
      items = items.filter(it => {
        const t = it.title.toLowerCase();
        return feed.keywordFilter.some(k => t.includes(k));
      });
    }
    items.sort((a, b) => b.date - a.date);
    const top = items[0];
    if (top) {
      sport.push({
        team: feed.team,
        detail: top.title.length > 70 ? top.title.slice(0, 67) + "…" : top.title,
        value: ago(top.date)
      });
    } else {
      console.warn(`[sport] ${feed.team}: sin novedades en este ciclo`);
    }
  }
  return sport;
}

// ---------- main ----------

async function main() {
  const [news, sport] = await Promise.all([buildNews(), buildSport()]);

  const brief = {
    generatedAt: new Date().toISOString(),
    agenda: [],
    mail: [],
    news,
    sport
  };

  await mkdir("data", { recursive: true });
  await writeFile("data/brief.json", JSON.stringify(brief, null, 2) + "\n", "utf8");

  console.log(`brief.json escrito: ${news.reduce((n, s) => n + s.items.length, 0)} noticias, ${sport.length} entradas de deporte.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
