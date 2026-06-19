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
  const CACHE_KEY = "mundial2026_seed_cache_v3";
  const LEGACY_CACHE_KEYS = ["mundial2026_seed_cache", "mundial2026_seed_cache_v2"];

  async function load() {
    // Migración silenciosa: si hay caché legacy, eliminarlo. La nueva
    // versión se generará al final de este load.
    try {
      for (const k of LEGACY_CACHE_KEYS) localStorage.removeItem(k);
    } catch (_) {}

    // Stale-while-revalidate: si hay cache, devuélvelo ya y refresca en background.
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const data = JSON.parse(cached);
        // Refrescar en background (no bloquea el primer paint)
        fetch(URL, { cache: "no-store" })
          .then(r => r.ok ? r.json() : null)
          .then(raw => {
            if (raw) {
              try { localStorage.setItem(CACHE_KEY, JSON.stringify(normalize(raw))); } catch (_) {}
            }
          })
          .catch(() => { /* network error, mantener cache */ });
        return data;
      }
    } catch (_) { /* cache corrupto, ignorar */ }

    // Sin cache: bloqueamos hasta fetch
    const res = await fetch(URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Seed HTTP ${res.status}`);
    const raw = await res.json();
    const data = normalize(raw);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (_) { /* quota */ }
    return data;
  }

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
          matches.push({
            id: `seed-m${m.match_number}`,
            source: "seed",
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
            date: parseDate(m.date, m.time),
            venue: m.venue || "",
            city: m.city || "",
            country: m.country || "",
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

