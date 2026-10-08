const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const fetch = require("node-fetch");

const TMDB_KEY = process.env.TMDB_KEY;
const GEMINI_KEY = process.env.GEMINI_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const IMG = "https://image.tmdb.org/t/p/";
const extra = [{ name: "search" }, { name: "skip" }];

const manifest = {
  id: "community.arabic.meta",
  version: "1.2.0",
  name: "ترجمة عربية",
  description: "عناوين ووصف وبوسترات بالعربي",
  resources: ["catalog", "meta"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [
    { type: "movie", id: "ar-movies", name: "أفلام (عربي)", extra },
    { type: "series", id: "ar-series", name: "مسلسلات (عربي)", extra }
  ]
};

const builder = new addonBuilder(manifest);
const idCache = new Map();
const trCache = new Map();

async function tmdb(path, params = "", lang = "ar") {
  const url = `https://api.themoviedb.org/3${path}?api_key=${TMDB_KEY}&language=${lang}${params}`;
  return (await fetch(url)).json();
}

async function toArabic(text) {
  if (!GEMINI_KEY || !text) return text;
  if (trCache.has(text)) return trCache.get(text);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "ترجم وصف الفلم التالي إلى العربية الفصحى المبسطة. أرجع الترجمة فقط بدون أي إضافات:\n\n" + text }] }]
      })
    });
    const data = await res.json();
    const out = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (out) { trCache.set(text, out); return out; }
  } catch (e) {}
  return text;
}

builder.defineCatalogHandler(async ({ type, extra }) => {
  try {
    const kind = type === "movie" ? "movie" : "tv";
    const page = extra && extra.skip ? Math.floor(extra.skip / 20) + 1 : 1;
    const data =
      extra && extra.search
        ? await tmdb(`/search/${kind}`, `&query=${encodeURIComponent(extra.search)}&page=${page}`)
        : await tmdb(`/${kind}/popular`, `&page=${page}`);

    const metas = await Promise.all(
      (data.results || []).map(async (item) => {
        const key = kind + item.id;
        let imdb = idCache.get(key);
        if (!imdb) {
          const ext = await tmdb(`/${kind}/${item.id}/external_ids`);
          imdb = ext.imdb_id;
          if (imdb) idCache.set(key, imdb);
        }
        if (!imdb) return null;
        return {
          id: imdb,
          type,
          name: item.title || item.name,
          description: item.overview,
          poster: item.poster_path ? IMG + "w500" + item.poster_path : undefined
        };
      })
    );
    return { metas: metas.filter(Boolean) };
  } catch (e) {
    return { metas: [] };
  }
});

builder.defineMetaHandler(async ({ type, id }) => {
  try {
    const data = await tmdb(`/find/${id}`, "&external_source=imdb_id");
    const item = type === "movie" ? data.movie_results[0] : data.tv_results[0];
    if (!item) return { meta: null };

    let description = item.overview;
    if (!description) {
      const en = await tmdb(`/find/${id}`, "&external_source=imdb_id", "en-US");
      const enItem = type === "movie" ? en.movie_results[0] : en.tv_results[0];
      description = await toArabic(enItem && enItem.overview);
    }

    return {
      meta: {
        id,
        type,
        name: item.title || item.name,
        description,
        poster: item.poster_path ? IMG + "w500" + item.poster_path : undefined,
        background: item.backdrop_path ? IMG + "w1280" + item.backdrop_path : undefined
      }
    };
  } catch (e) {
    return { meta: null };
  }
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
