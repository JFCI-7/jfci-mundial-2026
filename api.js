// ============== API.js — cliente de worldcup26.ir ==============
// Endpoints (verificados, sin auth, sin CORS issues):
//   GET /get/teams
//   GET /get/games
//   GET /get/groups
//   GET /get/stadiums
// Documentación: https://worldcup26.ir/api-docs
//
// Notas:
// - Campos *_en para idioma inglés.
// - Marcadores vienen como STRING ("0", "1", "FALSE") → convertir.
// - finished: "TRUE" | "FALSE".
// - time_elapsed: "notstarted" | "live" | número.
// - Eliminatorias (r32/r16/qf/sf/third/final): home_team_id puede ser "0" o
//   un label ("Winner Group A"). En ese caso se respeta home_team_label.

const API = (() => {
  // Apunta al proxy serverless (/api/proxy/*) que redirige a worldcup26.ir.
  // En local: server.py sirve este mismo path.
  // En Vercel: api/proxy.py lo maneja como serverless function.
  const BASE = "/api/proxy";
  const STAGE_MAP = {
    group: "group",
    r32:   "r32",
    r16:   "r16",
    qf:    "qf",
    sf:    "sf",
    third: "third",
    final: "final",
  };

  // Mapeo de códigos ISO2 que flagcdn no tiene pero que aparecen en la API.
  // Se resuelven al cargar la primera vez.
  const ISO_OVERRIDES = {
    "eng": "gb-eng", // England
    "sco": "gb-sct", // Scotland
  };

  let _cache = { ts: 0, data: null };
  const _mem = {};
  const TTL_MS = 60_000; // 1 minuto
  const LS_PREFIX = "mundial2026_api_cache_";

  async function _get(path) {
    // 1. caché en memoria (intra-página, más rápido)
    // 2. caché en localStorage (persiste entre navegaciones, evita fetch)
    // 3. fetch real a la API
    const memKey = `m${path}`;
    const lsKey = LS_PREFIX + path;

    if (_mem[memKey] && Date.now() - _mem[memKey].ts < TTL_MS) {
      return _mem[memKey].data;
    }

    try {
      const lsRaw = localStorage.getItem(lsKey);
      if (lsRaw) {
        const parsed = JSON.parse(lsRaw);
        if (parsed && parsed.ts && Date.now() - parsed.ts < TTL_MS) {
          _mem[memKey] = parsed;
          return parsed.data;
        }
      }
    } catch (_) { /* localStorage corrupto, ignorar */ }

    const r = await fetch(BASE + path, { cache: "no-store" });
    if (!r.ok) {
      // 404 = el server local no es server.py (sirve estáticos, no proxy)
      // 502 = server.py correcto pero la API upstream falló
      const hint = r.status === 404
        ? " (¿estás usando python3 -m http.server? Usa python3 server.py)"
        : "";
      const err = new Error(`API ${path} HTTP ${r.status}${hint}`);
      err.status = r.status;
      throw err;
    }
    const data = await r.json();
    const entry = { ts: Date.now(), data };
    _mem[memKey] = entry;
    try { localStorage.setItem(lsKey, JSON.stringify(entry)); } catch (_) { /* quota */ }
    return data;
  }

  async function refreshAll(force = false) {
    if (!force && _cache.data && Date.now() - _cache.ts < TTL_MS) {
      return _cache.data;
    }
    const [teamsRes, gamesRes, groupsRes, stadiumsRes] = await Promise.all([
      _get("/get/teams"),
      _get("/get/games"),
      _get("/get/groups"),
      _get("/get/stadiums"),
    ]);

    const data = {
      teams:    (teamsRes.teams    || []).map(normalizeTeam),
      matches:  (gamesRes.games    || []).map(normalizeGame),
      standings:(groupsRes.groups  || []).map(normalizeStanding),
      stadiums: (stadiumsRes.stadiums || []).map(normalizeStadium),
      source: "api",
      loadedAt: new Date().toISOString(),
    };

    _cache = { ts: Date.now(), data };
    // Persistir el bundle completo en localStorage
    try {
      localStorage.setItem(LS_PREFIX + "_bundle", JSON.stringify(_cache));
    } catch (_) { /* quota */ }
    return data;
  }

  // Al cargar el módulo, intentar hidratar _cache desde localStorage
  try {
    const lsBundle = localStorage.getItem(LS_PREFIX + "_bundle");
    if (lsBundle) {
      const parsed = JSON.parse(lsBundle);
      if (parsed && parsed.ts && Date.now() - parsed.ts < TTL_MS) {
        _cache = parsed;
      }
    }
  } catch (_) { /* localStorage corrupto, ignorar */ }

  function normalizeTeam(t) {
    const rawIso = (t.iso2 || "").toLowerCase();
    const iso2 = ISO_OVERRIDES[rawIso] || rawIso;
    return {
      id:       String(t.id),
      code:     t.fifa_code || t.iso2 || null,
      name:     t.name_en || t.iso2 || t.fifa_code,
      name_en:  t.name_en,
      group:    t.groups,
      iso2,
      source:   "api",
    };
  }

  function normalizeGame(g) {
    const homeScore = g.home_score === "null" || g.home_score == null ? null : Number(g.home_score);
    const awayScore = g.away_score === "null" || g.away_score == null ? null : Number(g.away_score);
    const finished  = String(g.finished).toUpperCase() === "TRUE";
    const timeElapsed = g.time_elapsed || "notstarted";

    let status = "pending";
    if (finished) status = "finished";
    else if (timeElapsed && timeElapsed !== "notstarted" && timeElapsed !== "null") status = "live";

    // Parse "06/11/2026 13:00" → ISO
    let isoDate = null;
    if (g.local_date) {
      const m = g.local_date.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
      if (m) isoDate = `${m[3]}-${m[1]}-${m[2]}T${m[4]}:${m[5]}`;
    }

    // La API no incluye iso2; lo derivamos del nombre del equipo usando
    // el mismo mapeo del seed (Seed.ISO_BY_NAME). Es seguro porque seed.js
    // se carga antes que api.js en cada HTML.
    const seedIso = (typeof Seed !== "undefined" && Seed.ISO_BY_NAME) || {};
    const homeName = g.home_team_name_en || g.home_team_label || "";
    const awayName = g.away_team_name_en || g.away_team_label || "";
    const homeIso = seedIso[homeName] || ISO_OVERRIDES[(g.home_team_id || "").toLowerCase()] || null;
    const awayIso = seedIso[awayName] || ISO_OVERRIDES[(g.away_team_id || "").toLowerCase()] || null;

    return {
      id:        `api-g${g.id}`,
      apiId:     String(g.id),
      source:    "api",
      stage:     STAGE_MAP[g.type] || g.type,
      matchday:  Number(g.matchday) || 0,
      group:     (g.group && g.group.length === 1) ? g.group : null,
      home: {
        code: g.home_team_id === "0" ? null : null,
        name: homeName || "TBD",
        name_en: g.home_team_name_en,
        iso2: homeIso,
        flag: homeIso ? `./vendor/flags/4x3/${homeIso}.svg` : null,
        label: g.home_team_label || null,
      },
      away: {
        code: g.away_team_id === "0" ? null : null,
        name: awayName || "TBD",
        name_en: g.away_team_name_en,
        iso2: awayIso,
        flag: awayIso ? `./vendor/flags/4x3/${awayIso}.svg` : null,
        label: g.away_team_label || null,
      },
      stadium_id: g.stadium_id,
      date:       isoDate,
      time_elapsed: timeElapsed,
      home_score: homeScore,
      away_score: awayScore,
      status,
      finished,
    };
  }

  function normalizeStanding(g) {
    return {
      name:   g.name,
      teams:  (g.teams || []).map(t => ({
        team_id: t.team_id,
        mp: Number(t.mp) || 0,
        w:  Number(t.w)  || 0,
        d:  Number(t.d)  || 0,
        l:  Number(t.l)  || 0,
        pts: Number(t.pts) || 0,
        gf:  Number(t.gf)  || 0,
        ga:  Number(t.ga)  || 0,
        gd:  Number(t.gd)  || 0,
      })),
    };
  }

  function normalizeStadium(s) {
    return {
      id:       String(s.id),
      name:     s.name_en,
      city:     s.city_en,
      country:  s.country_en,
      capacity: s.capacity,
      region:   s.region,
    };
  }

  function flagUrl(iso2) {
    if (!iso2) return null;
    const lower = iso2.toLowerCase();
    return `./vendor/flags/4x3/${ISO_OVERRIDES[lower] || lower}.svg`;
  }

  return { refreshAll, flagUrl, _cache: () => _cache };
})();
