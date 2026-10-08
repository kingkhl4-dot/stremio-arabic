const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const fetch = require("node-fetch");

const TMDB_KEY = process.env.TMDB_KEY;
const IMG = "https://image.tmdb.org/t/p/";

const extra = [{ name: "search" }, { name: "skip" }];

const manifest = {
  id: "community.arabic.meta",
  version: "1.1.0",
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
const cache = new Map();

async function tmdb(path, params = "") {
  const url = `https://api.themoviedb.org/3${path}?api_key=${TMDB_KEY}&language=ar${params}`;
  return (await fetch(url)).json();
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
        let imdb = cache.get(key);
        if (!imdb) {
          const ext = await tmdb(`/${kind}/${item.id}/external_ids`);
          imdb = ext.imdb_id;
          if (imdb) cache.set(key, imdb);
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
    return {
      meta: {
        id,
        type,
        name: item.title || item.name,
        description: item.overview,
        poster: item.poster_path ? IMG + "w500" + item.poster_path : undefined,
        background: item.backdrop_path ? IMG + "w1280" + item.backdrop_path : undefined
      }
    };
  } catch (e) {
    return { meta: null };
  }
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
