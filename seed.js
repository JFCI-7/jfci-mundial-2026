// ============== SEED.js — carga inicial desde JSON local ==============
// Fuente: mundial2026_calendario.json (incluye 104 partidos de las 7 fases)
// Usado como fallback cuando la API no está disponible o como primera carga.

const Seed = (() => {
  const URL = "./mundial2026_calendario.json";

  // Mapeo de stage del JSON al stage interno de la app
  const STAGE_MAP = {
    "Group Stage":    "group",
    "Round of 32":    "r32",
    "Round of 16":    "r16",
    "Quarter Finals": "qf",
    "Semi Finals":    "sf",
    "Third Place":    "third",
    "Final":          "final",
  };

  // Mapeo nombre → iso2 para mostrar banderas sin depender de la API.
  // Necesario porque el JSON local no incluye códigos FIFA.
  const ISO_BY_NAME = {
    "Mexico": "mx",
    "South Africa": "za",
    "South Korea": "kr",
    "Czech Republic": "cz",
    "Canada": "ca",
    "Bosnia and Herzegovina": "ba",
    "Qatar": "qa",
    "Switzerland": "ch",
    "Brazil": "br",
    "Morocco": "ma",
    "Haiti": "ht",
    "Scotland": "gb-sct",
    "United States": "us",
    "Paraguay": "py",
    "Australia": "au",
    "Turkey": "tr",
    "Germany": "de",
    "Curaçao": "cw",
    "Ivory Coast": "ci",
    "Ecuador": "ec",
    "Netherlands": "nl",
    "Japan": "jp",
    "Sweden": "se",
    "Tunisia": "tn",
    "Belgium": "be",
    "Egypt": "eg",
    "Iran": "ir",
    "New Zealand": "nz",
    "Spain": "es",
    "Cape Verde": "cv",
    "Saudi Arabia": "sa",
    "Uruguay": "uy",
    "France": "fr",
    "Senegal": "sn",
    "Iraq": "iq",
    "Norway": "no",
    "Argentina": "ar",
    "Algeria": "dz",
    "Austria": "at",
    "Jordan": "jo",
    "Portugal": "pt",
    "Democratic Republic of the Congo": "cd",
    "Uzbekistan": "uz",
    "Colombia": "co",
    "England": "gb-eng",
    "Croatia": "hr",
    "Ghana": "gh",
    "Panama": "pa",
  };

  // Bump de versión cuando cambia la forma del payload normalizado.
  // v2: agrega iso2 a home/away de cada match (lipis flag-icons).
  // v3: agrega home_score/away_score/status/home_scorers/away_scorers al match
  //     para soportar partidos ya jugados sin depender de la API.
  // v4: hardening — embed _seedVersion dentro del payload cacheado. Si la
  //     versión interna no coincide (e.g. browser sirve seed.js viejo que
  //     escribió CACHE_KEY v3 con datos sin scores), se refetchea en vez de
  //     devolver datos obsoletos.
  // v5: bump CACHE_KEY para invalidar cachés de browsers que tienen una versión
  //     incompleta del seed (36 matches en vez de 104).
  // v8: bump CACHE_KEY + embed KO_SCHEDULE como hardcoded fallback.
  //     Garantiza que los 32 partidos KO tengan fecha, hora, sede incluso
  //     si el JSON o el localStorage sirven datos viejos.
  const CACHE_KEY = "mundial2026_seed_cache_v8";
  const LEGACY_CACHE_KEYS = ["mundial2026_seed_cache", "mundial2026_seed_cache_v2", "mundial2026_seed_cache_v3", "mundial2026_seed_cache_v5", "mundial2026_seed_cache_v6", "mundial2026_seed_cache_v7"];
  const SEED_PAYLOAD_VERSION = 8;

  async function load() {
    // Migración silenciosa: si hay caché legacy, eliminarlo. La nueva
    // versión se generará al final de este load.
    try {
      for (const k of LEGACY_CACHE_KEYS) localStorage.removeItem(k);
    } catch (_) {}

    // Stale-while-revalidate: si hay cache con la versión correcta, devuélvelo
    // ya y refresca en background. Si la versión interna no coincide O si el
    // cache tiene datos vacíos/stale (data sanity check), ignora el cache y
    // refetchea. Degradación segura aunque el browser sirva seed.js viejo.
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const data = JSON.parse(cached);
        const versionOk = data && data._seedVersion === SEED_PAYLOAD_VERSION;
        // Sanity check: si el cache tiene < 28 matches con score y la fecha
        // actual es >= 2026-06-18 (jornada 8 ya jugada), está claramente stale.
        const playedCount = (data?.matches || []).filter(m => m.home_score !== null && m.home_score !== undefined).length;
        const looksStale = playedCount < 20; // hemos inyectado 28 jugados
        if (data && versionOk && !looksStale) {
          fetch(URL, { cache: "no-store" })
            .then(r => r.ok ? r.json() : null)
            .then(raw => {
              if (raw) {
                try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...normalize(raw), _seedVersion: SEED_PAYLOAD_VERSION })); } catch (_) {}
              }
            })
            .catch(() => { /* network error, mantener cache */ });
          return data;
        }
        // Versión obsoleta o datos vacíos. Borrar y refetchar.
        try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
      }
    } catch (_) { /* cache corrupto, ignorar */ }

    // Sin cache o versión obsoleta: bloqueamos hasta fetch
    const res = await fetch(URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Seed HTTP ${res.status}`);
    const raw = await res.json();
    const data = { ...normalize(raw), _seedVersion: SEED_PAYLOAD_VERSION };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (_) { /* quota */ }
    return data;
  }

  // Hardcoded fallback: fechas, horas (CDMX/ET) y sedes de los 32 partidos KO.
  // Fuente: calendario oficial FIFA publicado en fifa.com, sportingnews.com,
  // tycsports.com, informador.mx y mundiales-de-futbol.com (junio 2026).
  // Se usa cuando el JSON local o el caché localStorage no tienen estos campos.
  const KO_SCHEDULE = {
    73: { time:"13:00", time_et:"15:00", time_cdmx:"13:00", venue:"SoFi Stadium",           city:"Los Ángeles",                               country:"United States" },
    74: { time:"14:30", time_et:"16:30", time_cdmx:"14:30", venue:"Gillette Stadium",       city:"Foxborough (Boston)",                       country:"United States" },
    75: { time:"19:00", time_et:"21:00", time_cdmx:"19:00", venue:"Estadio BBVA",           city:"Monterrey",                                 country:"Mexico" },
    76: { time:"11:00", time_et:"13:00", time_cdmx:"11:00", venue:"NRG Stadium",            city:"Houston",                                   country:"United States" },
    77: { time:"15:00", time_et:"17:00", time_cdmx:"15:00", venue:"MetLife Stadium",        city:"East Rutherford (Nueva York/Nueva Jersey)", country:"United States" },
    78: { time:"11:00", time_et:"13:00", time_cdmx:"11:00", venue:"AT&T Stadium",           city:"Arlington (Dallas)",                        country:"United States" },
    79: { time:"19:00", time_et:"21:00", time_cdmx:"19:00", venue:"Estadio Azteca",         city:"Ciudad de México",                          country:"Mexico" },
    80: { time:"10:00", time_et:"12:00", time_cdmx:"10:00", venue:"Mercedes-Benz Stadium",  city:"Atlanta",                                   country:"United States" },
    81: { time:"18:00", time_et:"20:00", time_cdmx:"18:00", venue:"Levi's Stadium",         city:"Santa Clara",                               country:"United States" },
    82: { time:"14:00", time_et:"16:00", time_cdmx:"14:00", venue:"Lumen Field",            city:"Seattle",                                   country:"United States" },
    83: { time:"17:00", time_et:"19:00", time_cdmx:"17:00", venue:"BMO Field",              city:"Toronto",                                   country:"Canada" },
    84: { time:"13:00", time_et:"15:00", time_cdmx:"13:00", venue:"SoFi Stadium",           city:"Los Ángeles",                               country:"United States" },
    85: { time:"21:00", time_et:"23:00", time_cdmx:"21:00", venue:"BC Place",               city:"Vancouver",                                 country:"Canada" },
    86: { time:"16:00", time_et:"18:00", time_cdmx:"16:00", venue:"Hard Rock Stadium",      city:"Miami",                                     country:"United States" },
    87: { time:"19:30", time_et:"21:30", time_cdmx:"19:30", venue:"Arrowhead Stadium",      city:"Kansas City",                               country:"United States" },
    88: { time:"12:00", time_et:"14:00", time_cdmx:"12:00", venue:"AT&T Stadium",           city:"Arlington (Dallas)",                        country:"United States" },
    89: { time:"15:00", time_et:"17:00", time_cdmx:"15:00", venue:"Lincoln Financial Field",city:"Filadelfia",                                country:"United States" },
    90: { time:"11:00", time_et:"13:00", time_cdmx:"11:00", venue:"NRG Stadium",            city:"Houston",                                   country:"United States" },
    91: { time:"14:00", time_et:"16:00", time_cdmx:"14:00", venue:"MetLife Stadium",        city:"East Rutherford (Nueva York/Nueva Jersey)", country:"United States" },
    92: { time:"18:00", time_et:"20:00", time_cdmx:"18:00", venue:"Estadio Azteca",         city:"Ciudad de México",                          country:"Mexico" },
    93: { time:"13:00", time_et:"15:00", time_cdmx:"13:00", venue:"AT&T Stadium",           city:"Arlington (Dallas)",                        country:"United States" },
    94: { time:"18:00", time_et:"20:00", time_cdmx:"18:00", venue:"Lumen Field",            city:"Seattle",                                   country:"United States" },
    95: { time:"10:00", time_et:"12:00", time_cdmx:"10:00", venue:"Mercedes-Benz Stadium",  city:"Atlanta",                                   country:"United States" },
    96: { time:"14:00", time_et:"16:00", time_cdmx:"14:00", venue:"BC Place",               city:"Vancouver",                                 country:"Canada" },
    97: { time:"14:00", time_et:"16:00", time_cdmx:"14:00", venue:"Gillette Stadium",       city:"Foxborough (Boston)",                       country:"United States" },
    98: { time:"13:00", time_et:"15:00", time_cdmx:"13:00", venue:"SoFi Stadium",           city:"Los Ángeles",                               country:"United States" },
    99: { time:"15:00", time_et:"17:00", time_cdmx:"15:00", venue:"Hard Rock Stadium",      city:"Miami",                                     country:"United States" },
   100: { time:"19:00", time_et:"21:00", time_cdmx:"19:00", venue:"Arrowhead Stadium",      city:"Kansas City",                               country:"United States" },
   101: { time:"13:00", time_et:"15:00", time_cdmx:"13:00", venue:"AT&T Stadium",           city:"Arlington (Dallas)",                        country:"United States" },
   102: { time:"13:00", time_et:"15:00", time_cdmx:"13:00", venue:"Mercedes-Benz Stadium",  city:"Atlanta",                                   country:"United States" },
   103: { time:"15:00", time_et:"17:00", time_cdmx:"15:00", venue:"Hard Rock Stadium",      city:"Miami",                                     country:"United States" },
   104: { time:"13:00", time_et:"15:00", time_cdmx:"13:00", venue:"MetLife Stadium",        city:"East Rutherford (Nueva York/Nueva Jersey)", country:"United States" },
  };

  function normalize(raw) {
    const teams = [];
    if (raw.groups) {
      Object.entries(raw.groups).forEach(([letter, names]) => {
        names.forEach((name, i) => {
          const iso2 = ISO_BY_NAME[name] || null;
          teams.push({
            id: `seed-${letter}-${i}`,
            code: null,
            name,
            name_en: name,
            group: letter,
            iso2,
            flag: iso2 ? `./vendor/flags/4x3/${iso2}.svg` : null,
            source: "seed",
          });
        });
      });
    }

    const matches = [];
    if (raw.matches) {
      for (const [section, list] of Object.entries(raw.matches)) {
        if (!Array.isArray(list)) continue;
        list.forEach(m => {
            const homeIso = ISO_BY_NAME[m.home_team.name] || null;
            const awayIso = ISO_BY_NAME[m.away_team.name] || null;
            // Si el JSON trae score+status (partidos ya jugados), los respetamos.
            // Si no, dejamos null/pending para que la API los rellene luego.
            const hasScore = typeof m.home_score === "number" && typeof m.away_score === "number";
            // Hardcoded fallback: si el JSON tiene time="TBD" (o no tiene time_et
            // / time_cdmx), usamos KO_SCHEDULE que vive en este mismo archivo.
            const ko = KO_SCHEDULE[m.match_number];
            const timeVal = (m.time && m.time !== "TBD") ? m.time : (ko?.time || m.time);
            const timeEt = m.time_et || ko?.time_et || null;
            const timeCdmx = m.time_cdmx || ko?.time_cdmx || null;
            matches.push({
              id: `seed-m${m.match_number}`,
              source: "seed",
              match_number: m.match_number,
              stage: STAGE_MAP[m.stage] || section,
              matchday: m.matchday || 0,
              group: m.group || null,
              home: {
                ...m.home_team,
                iso2: homeIso,
                flag: homeIso ? `./vendor/flags/4x3/${homeIso}.svg` : null,
                scorers: Array.isArray(m.home_scorers) ? m.home_scorers : [],
              },
              away: {
                ...m.away_team,
                iso2: awayIso,
                flag: awayIso ? `./vendor/flags/4x3/${awayIso}.svg` : null,
                scorers: Array.isArray(m.away_scorers) ? m.away_scorers : [],
              },
              date: parseDate(m.date, timeVal),
              time_et: timeEt,
              time_cdmx: timeCdmx,
              venue: m.venue || ko?.venue || "",
              city: m.city || ko?.city || "",
              country: m.country || ko?.country || "",
            home_score: hasScore ? m.home_score : null,
            away_score: hasScore ? m.away_score : null,
            status: hasScore ? (m.status || "finished") : "pending",
            time_elapsed: hasScore ? (m.time_elapsed || "90") : "notstarted",
          });
        });
      }
    }

    return {
      tournament: raw.tournament,
      hosts: raw.hosts,
      teams,
      matches,
      venues: raw.venues || [],
      source: "seed",
      loadedAt: new Date().toISOString(),
    };
  }

  // El JSON tiene "date": "2026-06-11" + "time": "13:00" → ISO con hora
  function parseDate(date, time) {
    if (!date) return null;
    return time ? `${date}T${time}` : date;
  }

  return { load, ISO_BY_NAME };
})();

