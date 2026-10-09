const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const fetch = require("node-fetch");

const TMDB_KEY = process.env.TMDB_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const IMG = "https://image.tmdb.org/t/p/";
const PREFIX = "ar:";
const extra = [{ name: "search" }, { name: "skip" }];

const manifest = {
  id: "community.arabic.meta",
  version: "2.0.0",
  name: "ترجمة عربية",
  description: "عناوين ووصف وبوسترات بالعربي",
  resources: ["catalog", "meta"],
  types: ["movie", "series"],
  idPrefixes: [PREFIX],
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
  if (!GEMINI_API_KEY || !text) return text;
  if (trCache.has(text)) return trCache.get(text);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "ترجم الوصف التالي إلى العربية الفصحى المبسطة. أرجع الترجمة فقط:\n\n" + text }] }]
      })
    });
    const data = await res.json();
    const out = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (out) { trCache.set(text, out); return out; }
  } catch (e) {}
  return text;
}

async function getEpisodes(tvId, imdb) {
  const show = await tmdb(`/tv/${tvId}`);
  const seasons = (show.seasons || []).filter((s) => s.season_number > 0);
  const results = await Promise.all(
    seasons.map((s) => tmdb(`/tv/${tvId}/season/${s.season_number}`))
  );
  const videos = [];
  for (const s of results) {
    for (const ep of s.episodes || []) {
      if (!ep.air_date) continue;
      videos.push({
        id: `${imdb}:${ep.season_number}:${ep.episode_number}`,
        title: ep.name || `الحلقة ${ep.episode_number}`,
        season: ep.season_number,
        episode: ep.episode_number,
        released: new Date(ep.air_date).toISOString(),
        thumbnail: ep.still_path ? IMG + "w300" + ep.still_path : undefined,
        overview: ep.overview
      });
    }
  }
  return videos;
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
          id: PREFIX + imdb,
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
    const imdb = id.replace(PREFIX, "");
    const kind = type === "movie" ? "movie" : "tv";
    const data = await tmdb(`/find/${imdb}`, "&external_source=imdb_id");
    const found = type === "movie" ? data.movie_results[0] : data.tv_results[0];
    if (!found) return { meta: null };

    const item = await tmdb(`/${kind}/${found.id}`, "&append_to_response=credits");

        let description = item.overview;
    if (!description || !/[\u0600-\u06FF]/.test(description)) {
      const en = await tmdb(`/${kind}/${found.id}`, "", "en-US");
      description = await toArabic(en.overview || description);
    }

    const date = item.release_date || item.first_air_date || "";
    const credits = item.credits || {};
    const director =
      type === "movie"
        ? (credits.crew || []).filter((c) => c.job === "Director").map((c) => c.name)
        : (item.created_by || []).map((c) => c.name);
    const runtime = type === "movie" ? item.runtime : (item.episode_run_time || [])[0];

    const meta = {
      id,
      type,
      name: item.title || item.name,
      description,
      poster: item.poster_path ? IMG + "w500" + item.poster_path : undefined,
      background: item.backdrop_path ? IMG + "w1280" + item.backdrop_path : undefined,
      genres: (item.genres || []).map((g) => g.name),
      releaseInfo: date.slice(0, 4),
      released: date ? new Date(date).toISOString() : undefined,
      imdbRating: item.vote_average ? item.vote_average.toFixed(1) : undefined,
      runtime: runtime ? `${runtime} د` : undefined,
      cast: (credits.cast || []).slice(0, 8).map((c) => c.name),
      director
    };

    if (type === "movie") meta.behaviorHints = { defaultVideoId: imdb };
    else meta.videos = await getEpisodes(found.id, imdb);

    return { meta };
  } catch (e) {
    return { meta: null };
  }
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
