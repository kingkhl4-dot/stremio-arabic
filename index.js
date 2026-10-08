const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const fetch = require("node-fetch");

const TMDB_KEY = process.env.TMDB_KEY;

const manifest = {
  id: "community.arabic.meta",
  version: "1.0.0",
  name: "ترجمة عربية",
  description: "عناوين ووصف وبوسترات بالعربي",
  resources: ["meta"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: []
};

const builder = new addonBuilder(manifest);

builder.defineMetaHandler(async ({ type, id }) => {
  try {
    const url = `https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_KEY}&external_source=imdb_id&language=ar`;
    const data = await (await fetch(url)).json();
    const item = type === "movie" ? data.movie_results[0] : data.tv_results[0];
    if (!item) return { meta: null };

    const img = "https://image.tmdb.org/t/p/";
    return {
      meta: {
        id,
        type,
        name: item.title || item.name,
        description: item.overview,
        poster: item.poster_path ? img + "w500" + item.poster_path : undefined,
        background: item.backdrop_path ? img + "w1280" + item.backdrop_path : undefined
      }
    };
  } catch (e) {
    return { meta: null };
  }
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
