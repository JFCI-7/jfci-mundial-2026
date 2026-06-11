// ============== APP.js — orquestador (multi-página) ==============
// Cada HTML (index, calendario, eliminatorias, quiniela, estadisticas)
// carga este módulo. El módulo detecta qué página es y solo ejecuta
// los renders necesarios.

// ============== i18n helper ==============
// Atajo a I18N.t. Si I18N no está cargado, devuelve el key (fallback seguro).
function t(key, vars) {
  return window.I18N ? I18N.t(key, vars) : key;
}

const STATE = {
  teams: new Map(),
  matches: [],
  matchesById: new Map(),
  standings: new Map(),
  stadiums: new Map(),
  source: "—",
  loadedAt: null,
  apiError: null,
};

let currentMatchId = null;
let REFRESH_TIMER = null;

const CURRENT_PAGE = (location.pathname.split("/").pop() || "index.html")
  .toLowerCase()
  .replace(/[^a-z0-9.\-]/g, "");

// ============== THEME TOGGLE (aplica antes del render para evitar flicker) ==============
(function applyThemeEarly() {
  const saved = localStorage.getItem("mundial2026_theme");
  const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  const theme = saved || (prefersLight ? "light" : "dark");
  document.documentElement.classList.toggle("theme-light", theme === "light");
})();

// ============== FLAG FALLBACK (iniciales cuando no hay iso2) ==============
function makeFlagFallback(name, iso2) {
  const initials = (name || "?").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const span = document.createElement("span");
  span.className = "flag-24 flag-fallback";
  span.textContent = initials || "?";
  span.title = (iso2 || "") + " — " + (name || "");
  return span;
}

function teamFlagHtml(team) {
  if (team?.iso2) return `<span class="fi fi-${team.iso2} flag-24" title="${escapeHtml(team.name)}"></span>`;
  if (team?.name) return `<span class="flag-24 flag-fallback" title="${escapeHtml(team.name)}">${team.name[0]}</span>`;
  return `<span class="flag-24 flag-fallback" title="?">?</span>`;
}

// ============== BOOTSTRAP ==============
document.addEventListener("DOMContentLoaded", async () => {
  // Para Datos Curiosos, saltamos TODO el bootstrap complejo.
  // Esta vista es 100% estática: solo necesita navbar/footer + JSON local.
  // La pongo AL INICIO para evitar que cualquier excepción en otros setups
  // (DB, Seed, API) bloquee el render de los facts.
  if (CURRENT_PAGE === "datos-curiosos.html") {
    console.log("[bootstrap] datos-curiosos.html → branch estático");
    if (typeof injectSharedParts === "function") {
      injectSharedParts(CURRENT_PAGE);
    }
    if (typeof setupThemeToggle === "function") setupThemeToggle();
    // Status: "150 datos · Catálogo local" (override del HTML estático)
    const ds = document.getElementById("data-source");
    if (ds) ds.textContent = "150 datos · Catálogo local";
    renderFacts();
    setTimeout(hideLoader, 100);
    return;
  }

  try {
  // Inyecta navbar, footer, loader
  if (typeof injectSharedParts === "function") {
    injectSharedParts(CURRENT_PAGE);
  }

  setupModals();
  setupConfetti();
  setupThemeToggle();
  setupFatalOverlay();
  setupServerBanner();
  setupRefresh();

  await DB.init();
  restoreUserPrefs();

  let seedOk = false;
  try {
    const seed = await Seed.load();
    ingestSeed(seed);
    setStatus("offline", seed.loadedAt);
    seedOk = true;
  } catch (e) {
    console.warn("Seed no disponible:", e);
    setStatus("error", "—");
    showFatalError(e);
    return;
  }

  // Refrescar desde API
  const apiOk = await refreshFromAPI(true);
  if (!apiOk && seedOk) {
    const lastErr = STATE.apiError || "desconocido";
    if (lastErr.includes("404")) showServerBanner();
    else showToast("API no disponible — mostrando datos locales.", "warning");
  }

  setupFilters();
  setupPredictionTabs();
  if (CURRENT_PAGE === "quiniela.html") setupAuth();

  // Render según la página actual
  renderForPage();
  // Banner live / próximos (solo aplica a index.html, pero el chequeo del id es interno)
  renderLiveBanner();
  hideLoader();
  // Si tenemos datos cacheados, el render fue instantáneo.
  // El spinner en navbar se activa solo si hay fetch pendiente.
  if (typeof showMiniSpinner === "function") {
    const hasData = STATE.matchesById && STATE.matchesById.size > 0;
    if (!hasData) showMiniSpinner();
    setTimeout(hideMiniSpinner, 200);
  }
  startAutoRefresh();
  } catch (e) {
    console.error("Bootstrap fatal:", e);
    // Si estamos en datos curiosos al menos intentamos mostrar
    if (CURRENT_PAGE === "datos-curiosos.html") {
      try { renderFacts(); } catch (_) {}
    }
    if (typeof hideLoader === "function") hideLoader();
  }
});

// ============== RENDER POR PÁGINA ==============
function renderForPage() {
  if (CURRENT_PAGE === "index.html" || CURRENT_PAGE === "") {
    renderLiveBanner();
    renderGroups();
  } else if (CURRENT_PAGE === "calendario.html") {
    renderMatches();
  } else if (CURRENT_PAGE === "eliminatorias.html") {
    renderBracket();
  } else if (CURRENT_PAGE === "quiniela.html") {
    renderPredictions();
  } else if (CURRENT_PAGE === "estadisticas.html") {
    renderStats();
  } else if (CURRENT_PAGE === "datos-curiosos.html") {
    renderFacts();
  } else if (CURRENT_PAGE === "estadios.html") {
    renderStadiums();
  } else if (CURRENT_PAGE === "timeline.html") {
    renderTimeline();
  }
}

function setStatus(source, ts) {
  STATE.source = source;
  STATE.loadedAt = ts;
  const el = document.getElementById("data-source");
  if (!el) return;
  const labels = {
    api:     t("meta.dataSource.api"),
    seed:    t("meta.dataSource.facts"),
    offline: t("meta.dataSource.facts"),
    mixed:   t("meta.dataSource.api"),
    error:   t("common.error"),
  };
  el.textContent = labels[source] || source;
  el.className = source === "error" ? "text-danger" : "text-success";
  const lr = document.getElementById("last-refresh");
  if (lr && ts && ts !== "—") {
    const locale = (window.I18N && I18N.lang === "en") ? "en-US" : "es-MX";
    try { lr.textContent = new Date(ts).toLocaleTimeString(locale); } catch { lr.textContent = ts; }
  }
}

// ============== INGEST ==============
function ingestSeed(seed) {
  (seed.teams || []).forEach(t => {
    STATE.teams.set(t.name, t);
    if (t.group) STATE.teams.set(`g:${t.group}:${t.name}`, t);
  });
  (seed.matches || []).forEach(m => {
    STATE.matchesById.set(m.id, m);
  });
  STATE.matches = Array.from(STATE.matchesById.values());
}

function ingestAPI(api) {
  (api.teams || []).forEach(t => STATE.teams.set(t.code || t.name, t));
  (api.stadiums || []).forEach(s => STATE.stadiums.set(s.id, s));
  (api.standings || []).forEach(g => STATE.standings.set(g.name, g.teams));

  let updated = 0, added = 0;
  (api.matches || []).forEach(m => {
    const key = matchKey(m);
    let existing = STATE.matchesById.get(m.id);
    if (!existing) {
      for (const cand of STATE.matchesById.values()) {
        if (matchKey(cand) === key) { existing = cand; break; }
      }
    }
    if (existing) {
      if (m.home_score !== null) existing.home_score = m.home_score;
      if (m.away_score !== null) existing.away_score = m.away_score;
      existing.status = m.status;
      existing.time_elapsed = m.time_elapsed;
      existing.apiId = m.apiId;
      if (m.home.name_en && m.home.name_en !== "TBD") {
        // Preservar iso2/flag del seed si la API no los trae (api.js pone iso2:null).
        const seedHome = existing.home || {};
        const newHome = { ...seedHome, ...m.home };
        if (!newHome.iso2 && seedHome.iso2) newHome.iso2 = seedHome.iso2;
        if (!newHome.flag && seedHome.flag) newHome.flag = seedHome.flag;
        existing.home = newHome;
      }
      if (m.away.name_en && m.away.name_en !== "TBD") {
        const seedAway = existing.away || {};
        const newAway = { ...seedAway, ...m.away };
        if (!newAway.iso2 && seedAway.iso2) newAway.iso2 = seedAway.iso2;
        if (!newAway.flag && seedAway.flag) newAway.flag = seedAway.flag;
        existing.away = newAway;
      }
      updated++;
    } else {
      STATE.matchesById.set(m.id, m);
      STATE.matches.push(m);
      added++;
    }
  });
  console.log(`API merge: ${updated} actualizados, ${added} nuevos`);
}

function normalizeName(s) {
  if (!s) return "";
  return String(s).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/democratic republic of the /g, "")
    .replace(/\bdr\b\.?/g, "")
    .replace(/\s+/g, "")
    .replace(/united states/g, "usa")
    .replace(/south korea/g, "korea")
    .replace(/ivory coast/g, "cotedivoire")
    .replace(/bosnia and herzegovina/g, "bosnia")
    .replace(/czech republic/g, "czechia")
    .replace(/saudi arabia/g, "saudi")
    .replace(/new zealand/g, "newzealand")
    .replace(/cape verde/g, "capeverde")
    .replace(/costa rica/g, "costarica")
    .replace(/trinidad and tobago/g, "trinidad")
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function matchKey(m) {
  return `${m.stage}|${m.group || ""}|${m.matchday}|${normalizeName(m.home?.name)}|${normalizeName(m.away?.name)}`;
}

// ============== API REFRESH ==============
async function refreshFromAPI(force = false) {
  try {
    const api = await API.refreshAll(force);
    ingestAPI(api);
    setStatus(STATE.matchesById.size > 0 ? "api" : "seed", api.loadedAt);
    DB.setPref("lastRefresh", api.loadedAt);
    STATE.apiError = null;
    return true;
  } catch (e) {
    console.warn("API no disponible:", e.message);
    STATE.apiError = e.message || String(e);
    if (STATE.matches.length > 0) setStatus("mixed", STATE.loadedAt);
    return false;
  }
}

function startAutoRefresh() {
  if (REFRESH_TIMER) clearInterval(REFRESH_TIMER);
  REFRESH_TIMER = setInterval(async () => {
    if (typeof showMiniSpinner === "function") showMiniSpinner();
    const ok = await refreshFromAPI();
    if (ok) renderForPage();
    renderLiveBanner();
    if (typeof detectGoalChanges === "function") detectGoalChanges();
    if (typeof hideMiniSpinner === "function") hideMiniSpinner();
  }, 60_000);
}

function setupRefresh() {
  const btn = document.getElementById("btn-refresh");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line spin" aria-hidden="true"></i> Refrescando…';
    if (typeof showMiniSpinner === "function") showMiniSpinner();
    await refreshFromAPI(true);
    renderForPage();
    renderLiveBanner();
    if (typeof detectGoalChanges === "function") detectGoalChanges();
    if (typeof hideMiniSpinner === "function") hideMiniSpinner();
    btn.disabled = false;
    btn.innerHTML = '<i class="ri-refresh-line" aria-hidden="true"></i> Refrescar';
  });
}

// ============== FILTROS ==============
function setupFilters() {
  const sel = document.getElementById("filter-group");
  if (!sel) return;
  const groups = Array.from(new Set(STATE.matches.filter(m => m.group).map(m => m.group))).sort();
  groups.forEach(g => sel.add(new Option(`Grupo ${g}`, g)));
  sel.addEventListener("change", () => { renderMatches(); DB.setPref("fGroup", sel.value); });

  const roundSel = document.getElementById("filter-round");
  if (roundSel) {
    roundSel.addEventListener("change", () => { renderMatches(); DB.setPref("fRound", roundSel.value); });
  }

  const predSel = document.getElementById("pred-group");
  if (predSel) {
    groups.forEach(g => predSel.add(new Option(`Grupo ${g}`, g)));
    predSel.addEventListener("change", renderPredictions);
  }

  // Restaurar filtros guardados
  const fg = DB.getPref("fGroup"); if (fg) sel.value = fg;
  const fr = DB.getPref("fRound"); if (fr && roundSel) roundSel.value = fr;
}

function restoreUserPrefs() {
  // Solo restauramos los filtros (la vista está determinada por la URL actual)
  // Los filtros se aplican en setupFilters()
}

// ============== FATAL OVERLAY (CORS / file:// / seed load fail) ==============
function setupFatalOverlay() {
  const reloadBtn = document.getElementById("fatal-reload-btn");
  if (reloadBtn) {
    reloadBtn.addEventListener("click", () => {
      const overlay = document.getElementById("fatal-overlay");
      if (overlay) overlay.hidden = true;
      hideLoader();
      location.reload();
    });
  }
  const copyBtn = document.getElementById("fatal-copy-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const cmd = document.getElementById("fatal-cmd-text")?.textContent || "python3 server.py";
      try {
        await navigator.clipboard.writeText(cmd);
        showToast("Comando copiado al portapapeles", "success");
      } catch { showToast("No se pudo copiar. Selecciónalo manualmente.", "error"); }
    });
  }
}

function showFatalError(originalError) {
  const overlay = document.getElementById("fatal-overlay");
  if (!overlay) { hideLoader(); return; }
  const title = document.getElementById("fatal-title");
  const msg = document.getElementById("fatal-msg");
  const isFileProtocol = location.protocol === "file:";
  if (isFileProtocol) {
    title.textContent = "Abriste el archivo con doble click";
    msg.innerHTML =
      `Los navegadores bloquean las peticiones <code>fetch()</code> cuando abres un archivo directamente. ` +
      `Necesitas servir la carpeta con un servidor HTTP local.`;
  } else {
    title.textContent = "No se pudo cargar el calendario";
    msg.innerHTML = `Ocurrió un error al obtener <code>mundial2026_calendario.json</code>:` +
      `<br><code>${escapeHtml(originalError?.message || String(originalError))}</code>`;
  }
  overlay.hidden = false;
  hideLoader();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ============== SERVER BANNER ==============
function setupServerBanner() {
  const closeBtn = document.getElementById("server-banner-close");
  if (closeBtn) closeBtn.addEventListener("click", () => {
    const b = document.getElementById("server-banner");
    if (b) b.hidden = true;
  });
  const copyBtn = document.getElementById("server-banner-copy");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const cmd = document.getElementById("server-banner-cmd")?.textContent || "python3 server.py";
      try {
        await navigator.clipboard.writeText(cmd);
        showToast("Comando copiado. Detén el servidor actual (Ctrl+C) y ejecuta: " + cmd, "success", 8000);
      } catch { showToast("No se pudo copiar.", "error"); }
    });
  }
}

function showServerBanner() {
  const b = document.getElementById("server-banner");
  if (b) b.hidden = false;
}

// ============== AUTH (Quiniela persistente) ==============
// Solo se activa en quiniela.html. En otras páginas los botones están ocultos
// (d-none) y no se monta nada.
function setupAuth() {
  const signinBtn = document.getElementById("btn-signin");
  const signoutBtn = document.getElementById("btn-signout");
  const syncBtn = document.getElementById("btn-sync");
  const modal = document.getElementById("auth-modal");
  if (!signinBtn || !signoutBtn || !syncBtn || !modal) return; // solo en quiniela.html

  const form = document.getElementById("auth-form");
  const emailInp = document.getElementById("auth-email");
  const pinInp = document.getElementById("auth-pin");
  const emailErr = document.getElementById("auth-email-err");
  const pinErr = document.getElementById("auth-pin-err");
  const skipBtn = document.getElementById("auth-skip");
  const errBox = document.getElementById("auth-error");

  // Abrir modal
  const openModal = () => {
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    errBox.classList.add("d-none");
    errBox.textContent = "";
    emailErr.classList.add("d-none");
    pinErr.classList.add("d-none");
    emailInp.value = "";
    pinInp.value = "";
    setTimeout(() => emailInp.focus(), 100);
  };
  const closeModal = () => {
    modal.hidden = true;
    document.body.style.overflow = "";
  };

  signinBtn.addEventListener("click", openModal);
  modal.querySelectorAll("[data-close]").forEach(el => el.addEventListener("click", closeModal));
  skipBtn.addEventListener("click", closeModal);

  // Submit
  form.addEventListener("submit", async e => {
    e.preventDefault();
    emailErr.classList.add("d-none");
    pinErr.classList.add("d-none");
    errBox.classList.add("d-none");

    const email = emailInp.value.trim();
    const pin = pinInp.value.trim();

    if (!DB.validateEmail(email)) { emailErr.classList.remove("d-none"); emailInp.focus(); return; }
    if (pin && !DB.validatePin(pin)) { pinErr.classList.remove("d-none"); pinInp.focus(); return; }

    const submitBtn = form.querySelector('button[type="submit"]');
    const origLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = t("auth.syncing");

    try {
      // Validar credenciales contra el server ANTES de guardar nada.
      const validation = await DB.validateCredentials(email, pin);
      if (validation.status === "wrong_pin") {
        errBox.textContent = t("auth.wrongPin");
        errBox.classList.remove("d-none");
        pinInp.value = "";
        pinInp.focus();
        return;
      }
      if (validation.status === "pin_required") {
        errBox.textContent = t("auth.pinRequired");
        errBox.classList.remove("d-none");
        pinInp.value = "";
        pinInp.focus();
        return;
      }
      if (validation.status === "pin_unexpected") {
        errBox.textContent = t("auth.pinUnexpected");
        errBox.classList.remove("d-none");
        pinInp.value = "";
        pinInp.focus();
        return;
      }
      if (validation.status === "network_error") {
        errBox.textContent = t("auth.networkError");
        errBox.classList.remove("d-none");
        return;
      }
      // "ok" o "kv_unavailable" → proceder (kv_unavailable cae a local).
      await DB.setUserCredentials(email, pin);
      // Si el usuario tiene PIN, escribir metadata inmediatamente para que
      // logins futuros puedan detectar wrong_pin incluso sin predicciones.
      await DB.pushMetadataNow();
      const result = await DB.pullFromServer();
      if (result.status === "kv_unavailable") {
        errBox.textContent = t("auth.serverUnavailable");
        errBox.classList.remove("d-none");
        DB.clearUserCredentials();
        return;
      }
      if (result.status === "wrong_pin" || result.status === "pin_required") {
        // Doble check (en caso de race condition con metadata).
        errBox.textContent = result.status === "wrong_pin" ? t("auth.wrongPin") : t("auth.pinRequired");
        errBox.classList.remove("d-none");
        pinInp.value = "";
        pinInp.focus();
        DB.clearUserCredentials();
        return;
      }
      if (result.status === "error" || result.status === "network_error") {
        errBox.textContent = t("auth.networkError");
        errBox.classList.remove("d-none");
        DB.clearUserCredentials();
        return;
      }
      // Éxito: cerrar modal, actualizar UI, re-render
      closeModal();
      updateSyncUI();
      renderPredictions();
      showToast(t("auth.syncSuccess"), "success", 3000);
    } catch (err) {
      errBox.textContent = err.message || t("auth.networkError");
      errBox.classList.remove("d-none");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = origLabel;
    }
  });

  // Sincronizar manualmente
  syncBtn.addEventListener("click", async () => {
    if (!DB.getUserId()) return;
    syncBtn.disabled = true;
    syncBtn.querySelector("i")?.classList.add("ri-loader-4-line");
    syncBtn.querySelector("i")?.classList.add("spin");
    try {
      const result = await DB.pullFromServer();
      if (result.status === "kv_unavailable") {
        showToast(t("auth.serverUnavailable"), "warning", 5000);
      } else if (result.status === "network_error") {
        showToast(t("auth.networkError"), "error");
      } else if (result.status === "pulled" || result.status === "uploaded_local") {
        updateSyncUI();
        renderPredictions();
        showToast(t("auth.syncSuccess"), "success", 2500);
      }
    } finally {
      syncBtn.disabled = false;
      syncBtn.querySelector("i")?.classList.remove("ri-loader-4-line");
      syncBtn.querySelector("i")?.classList.remove("spin");
    }
  });

  // Cerrar sesión — abre modal con 2 opciones
  signoutBtn.addEventListener("click", openSignoutConfirm);

  // Si ya hay user, intentar pull silencioso al cargar
  if (DB.getUserId()) {
    DB.pullFromServer().then(result => {
      if (result.status === "wrong_pin" || result.status === "pin_required") {
        // El hash guardado en localStorage no es válido → forzar signout.
        DB.clearUserCredentials();
        updateSyncUI();
        renderPredictions();
        showToast(t(result.status === "wrong_pin" ? "auth.wrongPin" : "auth.pinRequired"), "error", 4000);
      } else if (result.status === "pulled" || result.status === "uploaded_local") {
        updateSyncUI();
        renderPredictions();
      } else {
        updateSyncUI();
      }
    });
  } else {
    updateSyncUI();
  }
}

// Modal de confirmación de sign out con 2 opciones: mantener o borrar local.
function openSignoutConfirm() {
  const modal = document.getElementById("signout-confirm-modal");
  if (!modal) return;
  const keepBtn = document.getElementById("btn-signout-keep");
  const wipeBtn = document.getElementById("btn-signout-wipe");
  if (!keepBtn || !wipeBtn) return;

  const close = () => { modal.hidden = true; document.body.style.overflow = ""; };
  const onKeep = () => {
    DB.clearUserCredentials();
    close();
    updateSyncUI();
    renderPredictions();
    showToast(t("auth.signOut"), "info", 2500);
    cleanup();
  };
  const onWipe = () => {
    DB.wipeLocalData();
    DB.clearUserCredentials();
    close();
    updateSyncUI();
    renderPredictions();
    showToast(t("auth.signOut"), "info", 2500);
    cleanup();
  };
  const onBackdrop = e => { if (e.target.matches("[data-close]")) close(); };
  const onKey = e => { if (e.key === "Escape") { close(); cleanup(); } };
  const cleanup = () => {
    keepBtn.removeEventListener("click", onKeep);
    wipeBtn.removeEventListener("click", onWipe);
    modal.removeEventListener("click", onBackdrop);
    document.removeEventListener("keydown", onKey);
  };

  keepBtn.addEventListener("click", onKeep);
  wipeBtn.addEventListener("click", onWipe);
  modal.addEventListener("click", onBackdrop);
  document.addEventListener("keydown", onKey);

  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function updateSyncUI() {
  const signinBtn = document.getElementById("btn-signin");
  const signoutBtn = document.getElementById("btn-signout");
  const syncBtn = document.getElementById("btn-sync");
  const statusEl = document.getElementById("sync-status");
  if (!signinBtn || !signoutBtn || !syncBtn || !statusEl) return;

  const userId = DB.getUserId();
  const last = DB.getLastSync();

  if (userId) {
    signinBtn.classList.add("d-none");
    signoutBtn.classList.remove("d-none");
    syncBtn.classList.remove("d-none");
    // Habilita tabs y filtros (por si estaban deshabilitados del estado locked).
    document.querySelectorAll('input[name="pred-tab"]').forEach(r => {
      r.disabled = false;
      r.closest("label")?.classList.remove("pred-disabled");
    });
    const grpSel = document.getElementById("pred-group");
    if (grpSel) {
      grpSel.disabled = false;
      grpSel.classList.remove("pred-disabled");
    }
    if (last) {
      const when = new Date(last);
      const locale = window.I18N && I18N.lang === "en" ? "en-US" : "es-MX";
      const formatted = when.toLocaleString(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
      statusEl.innerHTML = `<i class="ri-check-line text-success" aria-hidden="true"></i> <span>${t("auth.syncedAt", { date: formatted })}</span>`;
    } else {
      statusEl.innerHTML = `<i class="ri-cloud-line" aria-hidden="true"></i> <span>${t("auth.notSynced")}</span>`;
    }
  } else {
    signinBtn.classList.remove("d-none");
    signoutBtn.classList.add("d-none");
    syncBtn.classList.add("d-none");
    statusEl.innerHTML = `<i class="ri-cloud-off-line" aria-hidden="true"></i> <span>${t("auth.localOnlyChip")}</span>`;
  }
}

// ============== THEME TOGGLE ==============
function setupThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const isLight = document.documentElement.classList.toggle("theme-light");
    localStorage.setItem("mundial2026_theme", isLight ? "light" : "dark");
    // Si estamos en Estadísticas, re-pintar los ECharts con el nuevo tema.
    if (CURRENT_PAGE === "estadisticas.html" && typeof echarts !== "undefined") {
      const ids = ["chart-status", "chart-stages", "chart-accum", "chart-top"];
      for (const id of ids) {
        const el = document.getElementById(id);
        const inst = el && echarts.getInstanceByDom(el);
        if (inst) inst.dispose();
      }
      renderStats();
    }
  });
}

// ============== TOASTS ==============
// `content` puede ser string (escapeada) o HTML pre-formateado.
// Para HTML usar el helper `goalToastHtml` o pasar `html: true` (no usado actualmente).
function showToast(message, kind = "info", durationMs = 4500, contentHtml = null) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const icons = {
    info:    "ri-information-line",
    success: "ri-checkbox-circle-line",
    warning: "ri-alert-line",
    error:   "ri-close-circle-line",
    goal:    "ri-football-line",
  };
  const item = document.createElement("div");
  item.className = `toast-item toast-${kind}`;
  if (contentHtml) {
    item.innerHTML = contentHtml;
  } else {
    item.innerHTML = `<i class="${icons[kind] || icons.info}" aria-hidden="true"></i><span>${escapeHtml(message)}</span>`;
  }
  container.appendChild(item);
  requestAnimationFrame(() => item.classList.add("show"));
  setTimeout(() => {
    item.classList.remove("show");
    setTimeout(() => item.remove(), 350);
  }, durationMs);
}

// ============== NOTIFICACIONES DE GOLES ==============
// Mantiene un map de scores anteriores y, al refrescar la API, detecta cambios
// y dispara toasts tipo "goal" para cada gol nuevo.
const PREVIOUS_SCORES = new Map(); // matchId → { home, away, status, time }

function goalToastHtml(match, scoringTeam) {
  const s = effectiveScore(match);
  const isHome = scoringTeam === "home";
  const team = isHome ? match.home : match.away;
  const otherTeam = isHome ? match.away : match.home;
  const newScore = isHome ? `${s.home}-${s.away}` : `${s.home}-${s.away}`;
  const minute = match.time_elapsed || "—";
  return `
    <div class="toast-goal">
      <div class="toast-goal-icon" aria-hidden="true">
        <i class="ri-football-fill"></i>
      </div>
      <div class="toast-goal-body">
        <div class="toast-goal-head">
          <span class="toast-goal-team">⚽ ${escapeHtml(t("live.goalScored", { team: team.name }))}</span>
          <span class="toast-goal-minute">${escapeHtml(String(minute))}'</span>
        </div>
        <div class="toast-goal-score">
          <span class="fi fi-${team.iso2} flag-24" title="${escapeHtml(team.name)}"></span>
          <span class="toast-goal-team-name">${escapeHtml(team.name)}</span>
          <span class="toast-goal-numbers bebas">${newScore}</span>
          <span class="fi fi-${otherTeam.iso2} flag-24" title="${escapeHtml(otherTeam.name)}"></span>
          <span class="toast-goal-team-name">${escapeHtml(otherTeam.name)}</span>
        </div>
        <a class="toast-goal-link" href="calendario.html">
          ${escapeHtml(t("live.viewMatch"))} <i class="ri-arrow-right-line"></i>
        </a>
      </div>
    </div>
  `;
}

function detectGoalChanges() {
  const live = STATE.matches.filter(m => m.status === "live" || m.status === "finished");
  for (const m of live) {
    const s = effectiveScore(m);
    if (s.home === null || s.away === null) continue;
    const prev = PREVIOUS_SCORES.get(m.id);
    if (!prev) {
      // Primer poll: solo guardar, no notificar
      PREVIOUS_SCORES.set(m.id, { home: s.home, away: s.away, status: m.status, time: m.time_elapsed });
      continue;
    }
    // Detectar gol en home
    if (s.home > prev.home && m.status === "live") {
      showToast(null, "goal", 6000, goalToastHtml(m, "home"));
    }
    // Detectar gol en away
    if (s.away > prev.away && m.status === "live") {
      showToast(null, "goal", 6000, goalToastHtml(m, "away"));
    }
    // Detectar paso de pending → live
    if (prev.status === "pending" && m.status === "live") {
      showToast(t("live.matchStarted", { home: m.home?.name || "?", away: m.away?.name || "?" }), "info", 5000);
    }
    // Detectar paso de live → finished
    if (prev.status === "live" && m.status === "finished") {
      const home = m.home?.name || "?";
      const away = m.away?.name || "?";
      showToast(t("live.matchFinished", { home: home, hs: s.home, as: s.away, away: away }), "success", 6000);
    }
    // Actualizar cache
    PREVIOUS_SCORES.set(m.id, { home: s.home, away: s.away, status: m.status, time: m.time_elapsed });
  }
}

function matchSummary(m) {
  return `${m.home.name} vs ${m.away.name}`;
}

// ============== MODALES ==============
function setupModals() {
  document.querySelectorAll("[data-close]").forEach(el => {
    el.addEventListener("click", () => {
      const modal = el.closest(".modal-mundial");
      if (modal) modal.hidden = true;
    });
  });
  const cancelBtn = document.getElementById("btn-cancel");
  if (cancelBtn) cancelBtn.addEventListener("click", () => {
    const m = document.getElementById("modal");
    if (m) m.hidden = true;
  });
  const saveBtn = document.getElementById("btn-save-score");
  if (saveBtn) saveBtn.addEventListener("click", onSaveScore);
  const clearBtn = document.getElementById("btn-clear-override");
  if (clearBtn) clearBtn.addEventListener("click", onClearOverride);
  document.querySelectorAll(".goal-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const team = btn.dataset.team;
      const input = document.getElementById(team === "a" ? "score-a" : "score-b");
      input.value = (parseInt(input.value) || 0) + 1;
      btn.classList.remove("goal-active");
      void btn.offsetWidth;
      btn.classList.add("goal-active");
    });
  });
}

function openScoreModal(matchId) {
  const m = STATE.matchesById.get(matchId);
  if (!m) return;
  currentMatchId = matchId;

  const score = effectiveScore(m);
  document.getElementById("team-a-name").textContent = m.home?.name || "Local";
  document.getElementById("team-b-name").textContent = m.away?.name || "Visitante";
  document.getElementById("score-a").value = score.home;
  document.getElementById("score-b").value = score.away;
  document.getElementById("match-status").value = m.status;
  const noteEl = document.getElementById("match-note");
  if (noteEl) noteEl.value = DB.getNote(matchId);

  const fa = document.getElementById("team-a-flag");
  const fb = document.getElementById("team-b-flag");
  setFlag(fa, m.home);
  setFlag(fb, m.away);

  const when = m.date ? new Date(m.date).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  document.getElementById("modal-title").innerHTML =
    `<i class="ri-edit-2-line" aria-hidden="true"></i> ${stageLabel(m.stage)} · ${m.group || m.stage} · J${m.matchday} · ${when}`;

  const override = DB.getUserScore(matchId);
  const clearBtn = document.getElementById("btn-clear-override");
  if (clearBtn) clearBtn.style.display = override ? "inline-block" : "none";

  document.getElementById("modal").hidden = false;
}

function setFlag(img, team) {
  if (!img) return;
  if (team?.iso2) {
    img.src = API.flagUrl(team.iso2);
    img.alt = team.name || "";
    img.style.display = "";
    img.onerror = null;
  } else {
    img.removeAttribute("src");
    img.alt = "";
    img.style.display = "none";
  }
}

function onSaveScore() {
  const home = parseInt(document.getElementById("score-a").value) || 0;
  const away = parseInt(document.getElementById("score-b").value) || 0;
  const status = document.getElementById("match-status").value;
  const noteEl = document.getElementById("match-note");
  const note = noteEl ? noteEl.value.trim() : "";

  DB.setUserScore(currentMatchId, home, away, status);
  DB.setNote(currentMatchId, note);

  const m = STATE.matchesById.get(currentMatchId);
  if (m) m.status = status;

  document.getElementById("modal").hidden = true;

  if (status === "finished") fireConfetti();
  renderForPage();
}

function onClearOverride() {
  if (!confirm("¿Restaurar marcador oficial (de la API)?")) return;
  DB.clearUserScore(currentMatchId);
  const m = STATE.matchesById.get(currentMatchId);
  if (m && m.source === "api") m.status = m.finished ? "finished" : (m.time_elapsed && m.time_elapsed !== "notstarted" ? "live" : "pending");
  document.getElementById("modal").hidden = true;
  renderForPage();
}

// ============== CONFETTI ==============
function setupConfetti() {
  const canvas = document.getElementById("confetti-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  });
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  window._confetti = { canvas, ctx, particles: [], animating: false };
}

function fireConfetti() {
  if (!window._confetti?.ctx) return;
  const { canvas, ctx, particles } = window._confetti;
  const colors = ["#04BF45", "#E61D25", "#FFD700", "#6805F2", "#BFF207"];
  for (let i = 0; i < 80; i++) {
    particles.push({
      x: canvas.width / 2 + (Math.random() - .5) * 200,
      y: canvas.height / 2,
      vx: (Math.random() - .5) * 12,
      vy: Math.random() * -14 - 4,
      g: 0.4,
      size: Math.random() * 6 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - .5) * 0.2,
      life: 1,
    });
  }
  if (!_confetti.animating) animateConfetti();
}

function animateConfetti() {
  const { canvas, ctx, particles } = window._confetti;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles.forEach(p => {
    p.x += p.vx; p.y += p.vy; p.vy += p.g; p.rot += p.vr; p.life -= 0.008;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
    ctx.restore();
  });
  for (let i = particles.length - 1; i >= 0; i--) {
    if (particles[i].life <= 0 || particles[i].y > canvas.height + 50) particles.splice(i, 1);
  }
  if (particles.length > 0) {
    requestAnimationFrame(animateConfetti);
    window._confetti.animating = true;
  } else {
    window._confetti.animating = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

// ============== RENDER HELPERS ==============
function effectiveScore(m) {
  const override = DB.getUserScore(m.id);
  if (override) {
    return { home: override.home_score, away: override.away_score, source: "user" };
  }
  return { home: m.home_score, away: m.away_score, source: m.source || "api" };
}

function stageLabel(s) {
  return {
    group: "Fase de grupos",
    r32: "32avos", r16: "Octavos", qf: "Cuartos", sf: "Semifinal",
    third: "Tercer lugar", final: "Final",
  }[s] || s;
}

// ============== RENDER: LIVE BANNER ==============
// Banner destacado en la home: muestra partidos en vivo ahora,
// o si no hay, los próximos 3 partidos pendientes.
function renderLiveBanner() {
  const container = document.getElementById("live-banner");
  if (!container) return;

  // Filtrar solo partidos con equipos definidos (no TBD de eliminatorias)
  const live = STATE.matches
    .filter(m => m.status === "live" && m.home?.name_en && m.away?.name_en)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  if (live.length > 0) {
    console.log(`[live-banner] ${live.length} partido(s) en vivo`);
    const liveNow = t("groups.liveBanner.title");
    const liveCount = t("groups.summary.live").toLowerCase();
    const viewAll = t("groups.liveBanner.viewAll");
    container.innerHTML = `
      <div class="live-banner live-banner-active" role="status" aria-live="polite">
        <div class="live-banner-head">
          <span class="live-badge"><span class="nav-spinner-dot" aria-hidden="true"></span> ${escapeHtml(liveNow)}</span>
          <span class="live-banner-count">${live.length} ${escapeHtml(liveCount)}</span>
          <a href="calendario.html" class="btn btn-sm btn-outline-light ms-auto">${escapeHtml(viewAll)}</a>
        </div>
        <div class="live-banner-grid">
          ${live.map(renderLiveCard).join("")}
        </div>
      </div>
    `;
    return;
  }

  // Sin live: mostrar los 3 próximos pendientes
  const now = Date.now();
  const upcoming = STATE.matches
    .filter(m => m.status === "pending" && m.date && new Date(m.date).getTime() > now
              && m.home?.name_en && m.away?.name_en)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .slice(0, 3);

  if (upcoming.length > 0) {
    console.log(`[live-banner] ${upcoming.length} próximo(s) partido(s)`);
    const upcomingTitle = t("groups.upcomingTitle");
    const viewAll = t("groups.liveBanner.viewAll");
    container.innerHTML = `
      <div class="live-banner">
        <div class="live-banner-head">
          <span class="upcoming-badge"><i class="ri-time-line" aria-hidden="true"></i> ${escapeHtml(upcomingTitle)}</span>
          <a href="calendario.html" class="btn btn-sm btn-outline-light ms-auto">${escapeHtml(viewAll)}</a>
        </div>
        <div class="live-banner-grid">
          ${upcoming.map(renderUpcomingRow).join("")}
        </div>
      </div>
    `;
  } else {
    console.log("[live-banner] sin partidos live ni próximos");
    container.innerHTML = "";
  }
}

function renderLiveCard(m) {
  const s = effectiveScore(m);
  const rawMin = m.time_elapsed;
  const hasNumericMinute = rawMin && rawMin !== "live" && rawMin !== "notstarted" && !isNaN(Number(rawMin));
  const minuteHtml = hasNumericMinute ? `<div class="live-minute">${escapeHtml(String(rawMin))}'</div>` : "";
  return `
    <a href="calendario.html" class="live-card live-card-live" aria-label="Partido en vivo">
      <div class="live-team">
        <span class="fi fi-${m.home.iso2} flag-24" title="${escapeHtml(m.home.name)}"></span>
        <span class="live-team-name">${escapeHtml(m.home.name)}</span>
        <span class="bebas live-score">${s.home !== null ? s.home : "0"}</span>
      </div>
      <div class="live-team">
        <span class="fi fi-${m.away.iso2} flag-24" title="${escapeHtml(m.away.name)}"></span>
        <span class="live-team-name">${escapeHtml(m.away.name)}</span>
        <span class="bebas live-score">${s.away !== null ? s.away : "0"}</span>
      </div>
      ${minuteHtml}
    </a>
  `;
}

function renderUpcomingRow(m) {
  const d = new Date(m.date);
  const dayStr = d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
  const timeStr = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  return `
    <a href="calendario.html" class="upcoming-row" aria-label="Próximo partido">
      <div class="upcoming-teams">
        <span class="fi fi-${m.home.iso2} flag-24" title="${escapeHtml(m.home.name)}"></span>
        <span>${escapeHtml(m.home.name)}</span>
        <span class="text-muted mx-1">vs</span>
        <span>${escapeHtml(m.away.name)}</span>
        <span class="fi fi-${m.away.iso2} flag-24" title="${escapeHtml(m.away.name)}"></span>
      </div>
      <div class="upcoming-when">
        <i class="ri-calendar-line" aria-hidden="true"></i> ${dayStr} · ${timeStr}
        ${m.venue ? ` · <i class="ri-building-line" aria-hidden="true"></i> ${escapeHtml(m.venue)}` : ""}
        ${m.group ? ` · <span class="upcoming-badge" style="font-size:.65rem;padding:.1rem .4rem">Grupo ${escapeHtml(m.group)}</span>` : ""}
      </div>
    </a>
  `;
}

// ============== RENDER: GRUPOS ==============
function renderGroups() {
  const container = document.getElementById("groups-container");
  if (!container) return;
  const letters = Array.from(new Set(STATE.matches.filter(m => m.stage === "group" && m.group).map(m => m.group))).sort();
  container.innerHTML = "";
  letters.forEach(letter => {
    container.appendChild(createGroupCard(letter));
  });
}

function createGroupCard(letter) {
  const col = document.createElement("div");
  col.className = "col-12 col-sm-6 col-lg-4 col-xl-3";
  const card = document.createElement("div");
  card.className = "card card-mundial group-card h-100";
  const header = document.createElement("div");
  header.className = "card-header p-3";
  header.innerHTML = `<div class="d-flex justify-content-between align-items-center">
    <div class="bebas fs-2">GRUPO ${letter}</div>
    <i class="ri-shield-star-fill fs-3" style="color: var(--accent-2)" aria-hidden="true"></i>
  </div>`;
  card.appendChild(header);
  const body = document.createElement("div");
  body.className = "card-body p-2";
  const standings = computeStandings(letter);
  if (standings.length === 0) {
    body.innerHTML = '<p class="text-muted small p-2">' + escapeHtml(t("common.empty")) + '</p>';
  } else {
    standings.forEach((t, i) => {
      const row = document.createElement("div");
      row.className = "team-row" + (i < 2 ? " qualified" : "");
      row.innerHTML = `
        <div class="team-name">
          <span class="pos">${i + 1}</span>
          <span class="flag-wrap">
            ${t.iso2 ? `<span class="fi fi-${t.iso2} flag-24" title="${escapeHtml(t.name)}"></span>` : `<span class="flag-24 flag-fallback" title="${escapeHtml(t.name)}">${escapeHtml(t.name[0])}</span>`}
          </span>
          <span>${t.name}</span>
        </div>
        <div class="team-stats">
          <strong>${t.pts}</strong> · ${t.pj}PJ · ${t.gf}:${t.ga}
        </div>
      `;
      body.appendChild(row);
    });
  }
  card.appendChild(body);
  col.appendChild(card);
  return col;
}

function computeStandings(letter) {
  // Calcular SIEMPRE localmente desde los partidos. El endpoint /get/groups
  // de worldcup26.ir devuelve standings incorrectos (asigna puntos al equipo
  // equivocado), así que no lo usamos. El cálculo local siempre es correcto:
  // lee los scores de cada partido finalizado del grupo y suma puntos/GF/GA.
  const teams = Array.from(STATE.teams.values()).filter(t => t.group === letter);
  const table = new Map();
  teams.forEach(t => {
    table.set(t.name, {
      name: t.name, iso2: t.iso2,
      pj: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0,
    });
  });
  STATE.matches.filter(m => m.group === letter && m.stage === "group").forEach(m => {
    const s = effectiveScore(m);
    // Solo contar partidos FINALIZADOS. Los pendientes tienen home_score=0/0
    // en el API (no null) y se contarían como empates fantasma. Los live aún
    // no están decididos (estándar de standings oficiales). Excepción: si el
    // usuario hizo override manual del score (s.source==="user"), contamos ese.
    const isUserOverride = s.source === "user";
    if (!isUserOverride && m.status !== "finished") return;
    if (s.home === null || s.away === null) return;
    // Usar name (estable entre API y seed) en vez de code (que la API pone null).
    const h = table.get(m.home?.name);
    const a = table.get(m.away?.name);
    if (!h || !a) return;
    h.pj++; a.pj++;
    h.gf += s.home; h.ga += s.away;
    a.gf += s.away; a.ga += s.home;
    if (s.home > s.away) { h.w++; h.pts += 3; a.l++; }
    else if (s.home < s.away) { a.w++; a.pts += 3; h.l++; }
    else { h.d++; a.d++; h.pts++; a.pts++; }
  });
  return Array.from(table.values()).sort((x, y) =>
    y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf
  );
}

// ============== RENDER: MATCHES ==============
function renderMatches() {
  const list = document.getElementById("matches-list");
  if (!list) return;
  const group = document.getElementById("filter-group")?.value;
  const round = document.getElementById("filter-round")?.value;
  list.innerHTML = "";

  let matches = STATE.matches.filter(m => m.stage === "group");
  if (group) matches = matches.filter(m => m.group === group);
  if (round) matches = matches.filter(m => String(m.matchday) === round);

  const byRound = {};
  matches.forEach(m => {
    const r = m.matchday || 0;
    (byRound[r] = byRound[r] || []).push(m);
  });

  if (matches.length === 0) {
    list.innerHTML = '<p class="text-muted">' + escapeHtml(t("cal.empty")) + '</p>';
    return;
  }
  Object.keys(byRound).sort((a, b) => a - b).forEach(round => {
    const header = document.createElement("div");
    header.className = "bebas fs-5 mt-2 mb-1";
    header.style.color = "var(--accent-2)";
    header.innerHTML = `<i class="ri-calendar-event-line" aria-hidden="true"></i> ${t("cal.matchday", { n: round })}`;
    list.appendChild(header);
    byRound[round].sort((a, b) => (a.date || "").localeCompare(b.date || "")).forEach(m => {
      list.appendChild(createMatchCard(m));
    });
  });
}

function renderScorersList(scorers) {
  if (!scorers || scorers.length === 0) return "";
  const items = scorers.map(s => {
    const minute = s.minute !== null && s.minute !== undefined
      ? ` <span class="scorer-min">${escapeHtml(String(s.minute))}'</span>`
      : "";
    return `<span class="scorer"><i class="ri-football-fill" aria-hidden="true"></i> ${escapeHtml(s.player)}${minute}</span>`;
  }).join("");
  return `<div class="scorers">${items}</div>`;
}

function createMatchCard(m) {
  const card = document.createElement("div");
  card.className = "match-card";
  const s = effectiveScore(m);
  const hasScore = s.home !== null && s.away !== null;
  const scoreText = hasScore ? `${s.home} - ${s.away}` : "– : –";
  let dateOnly = "TBD", timeOnly = "—";
  if (m.date) {
    const d = new Date(m.date);
    if (!isNaN(d.getTime())) {
      dateOnly = d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
      timeOnly = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
    }
  }
  const homeName = m.home?.name || "TBD";
  const awayName = m.away?.name || "TBD";
  const homeFlag = teamFlagHtml(m.home);
  const awayFlag = teamFlagHtml(m.away);

  const statusBadge = m.status === "live"
    ? '<span class="badge badge-live"><i class="ri-live-line" aria-hidden="true"></i> ' + escapeHtml(t("status.live")) + '</span>'
    : m.status === "finished"
    ? '<span class="badge badge-finished"><i class="ri-checkbox-circle-fill" aria-hidden="true"></i> ' + escapeHtml(t("status.finished")) + '</span>'
    : '<span class="badge badge-pending"><i class="ri-time-line" aria-hidden="true"></i> ' + escapeHtml(t("status.upcoming")) + '</span>';

  const overrideMark = s.source === "user" ? ' <i class="ri-user-star-fill" style="color: var(--accent-2)" title="Marcador personalizado"></i>' : "";

  // Minuto en vivo (solo cuando el partido está en vivo y time_elapsed es numérico).
  const liveMinute = (m.status === "live" && m.time_elapsed && m.time_elapsed !== "live" && m.time_elapsed !== "notstarted")
    ? `<span class="match-minute">${escapeHtml(m.time_elapsed)}'</span>`
    : "";

  // Goleadores (solo para partidos en vivo o finalizados).
  const showScorers = m.status === "live" || m.status === "finished";
  const homeScorers = showScorers ? renderScorersList(m.home?.scorers) : "";
  const awayScorers = showScorers ? renderScorersList(m.away?.scorers) : "";

  card.innerHTML = `
    <div class="row align-items-center g-2">
      <div class="col-12 col-md-9">
        <div class="match-teams">
          <div class="team-col">
            ${homeFlag}
            <span class="name">${homeName}</span>
            ${homeScorers}
          </div>
          <div class="score ${m.status}">${scoreText}${overrideMark}</div>
          <div class="team-col away">
            <span class="name">${awayName}</span>
            ${awayScorers}
            ${awayFlag}
          </div>
        </div>
        <div class="match-meta-center text-center mt-2">
          <div class="d-flex flex-wrap gap-2 justify-content-center small">
            <span><i class="ri-time-line" aria-hidden="true"></i> ${timeOnly}</span>
            <span><i class="ri-calendar-line" aria-hidden="true"></i> ${dateOnly}</span>
            <span class="group-tag">${m.group || m.stage}</span>
            <span>J${m.matchday || "—"}</span>
          </div>
          ${m.venue ? `<div class="venue mt-1"><i class="ri-building-line" aria-hidden="true"></i> ${m.venue}</div>` : ""}
        </div>
      </div>
      <div class="col-12 col-md-3 text-center">
        ${statusBadge}
        ${liveMinute}
        <!-- BOTÓN EDITAR OCULTO TEMPORALMENTE: <button class="btn btn-edit-score mt-2" aria-label="Editar marcador" title="Sobrescribir marcador manualmente (override sobre la API)">
          <i class="ri-edit-2-line" aria-hidden="true"></i>
        </button> -->
      </div>
    </div>
  `;
  // TEMPORALMENTE DESHABILITADO: card.addEventListener("click", e => {
  //   if (e.target.closest("button")) return;
  //   openScoreModal(m.id);
  // });
  // const btn = card.querySelector("button");
  // btn.addEventListener("click", e => {
  //   e.stopPropagation();
  //   openScoreModal(m.id);
  // });
  return card;
}

// ============== RENDER: BRACKET ==============
function renderBracket() {
  const container = document.getElementById("knockout-container");
  if (!container) return;
  container.innerHTML = "";
  const stages = [
    { key: "r32",   label: t("bracket.r32") },
    { key: "r16",   label: t("bracket.r16") },
    { key: "qf",    label: t("bracket.qf") },
    { key: "sf",    label: t("bracket.sf") },
    { key: "third", label: t("bracket.third") },
    { key: "final", label: t("bracket.final") },
  ];
  let any = false;
  stages.forEach(stage => {
    const matches = STATE.matches.filter(m => m.stage === stage.key);
    if (matches.length === 0) return;
    any = true;
    const section = document.createElement("div");
    section.className = "koround";
    section.innerHTML = `<h4><i class="ri-trophy-line" aria-hidden="true"></i> ${stage.label}</h4>`;
    const grid = document.createElement("div");
    grid.className = "ko-grid";
    matches.forEach(m => grid.appendChild(createKoCard(m)));
    section.appendChild(grid);
    container.appendChild(section);
  });
  if (!any) {
    container.innerHTML = '<p class="text-muted">Los cruces se mostrarán cuando se publiquen. Refresca con el botón superior.</p>';
  }
}

function createKoCard(m) {
  const div = document.createElement("div");
  div.className = "ko-match";
  const s = effectiveScore(m);
  const hWins = s.home !== null && s.away !== null && s.home > s.away;
  const aWins = s.home !== null && s.away !== null && s.away > s.home;

  // Determinar si el equipo ya está definido.
  // "Pendiente" = sigue siendo TBD: tiene label genérico ("Winner Group A") y
  //               no tiene nombre real.
  // "Definido" = la API ya publicó al equipo real (tras finalizar la fase de grupos).
  const homeIsPending = !m.home?.name_en && !!m.home?.label;
  const awayIsPending = !m.away?.name_en && !!m.away?.label;
  const homeName = m.home?.name || m.home?.label || "TBD";
  const awayName = m.away?.name || m.away?.label || "TBD";
  const homeFlag = !homeIsPending && m.home?.iso2
    ? `<span class="fi fi-${m.home.iso2} flag-24" title="${escapeHtml(homeName)}"></span>`
    : "";
  const awayFlag = !awayIsPending && m.away?.iso2
    ? `<span class="fi fi-${m.away.iso2} flag-24" title="${escapeHtml(awayName)}"></span>`
    : "";

  const dateStr = m.date ? new Date(m.date).toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) : "TBD";
  div.innerHTML = `
    <div class="ko-team ${hWins ? "adv" : ""} ${homeIsPending ? "pending" : ""}">
      ${homeFlag}
      <span class="ko-team-name">${homeName}</span>
      <span class="bebas">${s.home !== null ? s.home : "—"}</span>
    </div>
    <div class="ko-team ${aWins ? "adv" : ""} ${awayIsPending ? "pending" : ""}">
      ${awayFlag}
      <span class="ko-team-name">${awayName}</span>
      <span class="bebas">${s.away !== null ? s.away : "—"}</span>
    </div>
    <div class="ko-label">
      <i class="ri-calendar-line" aria-hidden="true"></i> ${dateStr}
      ${m.venue ? ` · <i class="ri-building-line" aria-hidden="true"></i> ${m.venue}` : ""}
    </div>
  `;
  div.addEventListener("click", () => openScoreModal(m.id));
  return div;
}

// ============== RENDER: PREDICTIONS ==============
// ============== RENDER: PREDICTIONS ==============
const PRED_TABS = {
  group: { label: () => t("pred.tabs.group"),      useGroupFilter: true },
  r32:   { label: () => t("pred.tabs.r32"),         useGroupFilter: false },
  r16:   { label: () => t("pred.tabs.r16"),         useGroupFilter: false },
  qf:    { label: () => t("pred.tabs.qf"),          useGroupFilter: false },
  sf:    { label: () => t("pred.tabs.sf"),          useGroupFilter: false },
  final: { label: () => t("pred.tabs.final"),       useGroupFilter: false },
};
// Multiplicador de puntos por stage (el último vale más)
const PRED_WEIGHT = {
  group: 1, r32: 2, r16: 3, qf: 4, sf: 6, final: 10,
};

const PRED_STATE = { tab: "group" };

function renderPredictions() {
  const list = document.getElementById("predictions-list");
  if (!list) return;
  list.innerHTML = "";

  // Gate: si no hay user autenticado, mostrar placeholder y deshabilitar tabs/filtros.
  if (!DB.getUserId()) {
    renderPredictionsLocked();
    return;
  }

  const tab = PRED_STATE.tab;
  const cfg = PRED_TABS[tab] || PRED_TABS.group;
  const grp = document.getElementById("pred-group")?.value;

  let matches = STATE.matches.filter(m => m.stage === tab);
  if (cfg.useGroupFilter && grp) matches = matches.filter(m => m.group === grp);
  matches = matches.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  // Si es eliminatoria y los equipos son TBD, mostrar un placeholder
  if (["r32", "r16", "qf", "sf", "final"].includes(tab) &&
      matches.length > 0 && matches.every(m => !m.home?.name_en || !m.away?.name_en)) {
    list.innerHTML = `
      <div class="card-mundial p-4 text-center">
        <i class="ri-time-line" style="font-size:2.5rem;color:var(--text-muted)"></i>
        <p class="mt-2 mb-0">Los cruces de <strong>${escapeHtml(cfg.label)}</strong> se mostrarán cuando se publiquen.<br>
        <span class="small text-muted">Una vez que la fase de grupos finalice, la API publicará los equipos clasificados y podrás predecir los cruces aquí.</span></p>
      </div>
    `;
    document.getElementById("pred-meta").textContent = "";
    return;
  }

  const preds = new Map(DB.getAllPredictions().map(p => [p.match_id, p]));
  const counter = document.getElementById("pred-meta");

  let points = 0, correct = 0;
  matches.forEach(m => list.appendChild(buildPredCard(m, preds, tab, p => { points += p.added; correct += p.added > 0 ? 1 : 0; })));

  if (counter) {
    const weight = PRED_WEIGHT[tab] || 1;
    const weightText = tab === "group" ? "" : ` · ${t("pred.pointsMultiplier", { n: weight })}`;
    counter.innerHTML = `${t("pred.matchCount", { n: matches.length }).replace("{n}", "<strong>" + matches.length + "</strong>")} <strong>${escapeHtml(cfg.label())}</strong>${weightText}.`;
  }

  setupPredCardListeners(list, tab);
  const pp = document.getElementById("pred-points");
  if (pp) pp.textContent = `${points} ${t("pred.summary.points")} · ${correct} ${t("pred.summary.correct")}`;
  updateSyncUI();
}

// Estado bloqueado: usuario no autenticado. Muestra placeholder + deshabilita tabs/filtros.
function renderPredictionsLocked() {
  const list = document.getElementById("predictions-list");
  if (!list) return;
  list.innerHTML = `
    <div class="pred-locked card-mundial p-4 text-center">
      <i class="ri-lock-2-line pred-locked-icon" aria-hidden="true"></i>
      <h3 class="bebas mt-3 mb-2" data-i18n="pred.locked.title">Inicia sesión para hacer tu quiniela</h3>
      <p class="text-muted small mb-3" data-i18n="pred.locked.body">Necesitas una cuenta para guardar tus predicciones en este dispositivo y sincronizarlas con la nube.</p>
      <button id="btn-pred-locked-signin" type="button" class="btn btn-primary fw-bold" data-i18n="pred.locked.cta">Iniciar sesión</button>
    </div>
  `;
  // Aplica i18n a los data-i18n del placeholder recién inyectado.
  list.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  // El botón del placeholder abre el modal de auth existente.
  document.getElementById("btn-pred-locked-signin")?.addEventListener("click", () => {
    const modal = document.getElementById("auth-modal");
    if (modal) {
      modal.hidden = false;
      document.body.style.overflow = "hidden";
    }
  });
  // Limpia meta info y puntos; deshabilita tabs y filtros.
  const meta = document.getElementById("pred-meta");
  if (meta) meta.textContent = "";
  const pp = document.getElementById("pred-points");
  if (pp) pp.textContent = "";
  // Tabs de fase + filtro de grupo: visualmente deshabilitados.
  document.querySelectorAll('input[name="pred-tab"]').forEach(r => {
    r.disabled = true;
    r.closest("label")?.classList.add("pred-disabled");
  });
  const grpSel = document.getElementById("pred-group");
  if (grpSel) {
    grpSel.disabled = true;
    grpSel.classList.add("pred-disabled");
  }
}

function buildPredCard(m, preds, tab, tally) {
  const card = document.createElement("div");
  card.className = "pred-card";
  const pred = preds.get(m.id);
  const eff = effectiveScore(m);
  const isKO = tab !== "group";

  if (isKO) {
    return buildPredKoCard(card, m, pred, eff, tab, tally);
  }
  return buildPredGroupCard(card, m, pred, eff, tally);
}

function buildPredGroupCard(card, m, pred, eff, tally) {
  let cls = "";
  let added = 0;
  if (pred && m.status === "finished" && eff.home !== null) {
    const exacto = pred.home_pred === eff.home && pred.away_pred === eff.away;
    const ganador = (pred.home_pred > pred.away_pred) === (eff.home > eff.away);
    if (exacto) { cls = "correct"; added = 3; }
    else if (ganador) { cls = "correct"; added = 1; }
    else cls = "wrong";
  }
  if (cls) card.classList.add(cls);
  card.classList.add("pred-group-card");
  tally({ added });

  const realLabel = t("pred.realLabel");
  const realScoreHtml = eff.home !== null
    ? `<span class="pred-real small text-muted">${realLabel} <strong>${eff.home}-${eff.away}</strong></span>`
    : `<span class="pred-real small text-muted">—</span>`;

  card.innerHTML = `
    <div class="pred-row pred-row-top">
      <span class="small text-muted">${escapeHtml(m.group || "")}·J${m.matchday || ""}</span>
    </div>
    <div class="pred-row pred-row-teams">
      <span class="team team-home">
        <span class="team-name">${escapeHtml(m.home?.name || "TBD")}</span>
        ${m.home?.iso2 ? `<span class="fi fi-${m.home.iso2} flag-24" title="${escapeHtml(m.home.name)}"></span>` : ""}
      </span>
      <span class="vs-small">vs</span>
      <span class="team team-away">
        ${m.away?.iso2 ? `<span class="fi fi-${m.away.iso2} flag-24" title="${escapeHtml(m.away.name)}"></span>` : ""}
        <span class="team-name">${escapeHtml(m.away?.name || "TBD")}</span>
      </span>
    </div>
    <div class="pred-row pred-row-bottom">
      <div class="pred-inputs">
        <input type="number" min="0" class="form-control form-control-sm" 
               value="${pred?.home_pred ?? 0}" data-match="${m.id}" data-side="home" 
               aria-label="${escapeHtml(m.home?.name || "")}">
        <span class="pred-dash" aria-hidden="true">-</span>
        <input type="number" min="0" class="form-control form-control-sm" 
               value="${pred?.away_pred ?? 0}" data-match="${m.id}" data-side="away" 
               aria-label="${escapeHtml(m.away?.name || "")}">
      </div>
      ${realScoreHtml}
    </div>
  `;
  return card;
}

function buildPredKoCard(card, m, pred, eff, tab, tally) {
  card.classList.add("pred-ko");
  const weight = PRED_WEIGHT[tab] || 1;
  const homeDefined = m.home?.name_en;
  const awayDefined = m.away?.name_en;

  // Determinar ganador seleccionado
  let selected = pred?.winner; // "home" | "away" | null
  if (!selected && pred) {
    // Compatibilidad: si guardamos home_pred/away_pred sin winner, derivar
    if (pred.home_pred > pred.away_pred) selected = "home";
    else if (pred.away_pred > pred.home_pred) selected = "away";
  }

  // Puntos si el partido ya terminó
  let added = 0;
  if (pred && m.status === "finished" && eff.home !== null) {
    const realWinner = eff.home > eff.away ? "home" : (eff.away > eff.home ? "away" : null);
    if (selected && realWinner && selected === realWinner) {
      added = weight;
    }
  }
  tally({ added });

  // Fechas / venue
  const dateStr = m.date ? new Date(m.date).toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) : "TBD";
  const venue = m.venue || "";

  // Render radios
  const homeRadio = `
    <label class="pred-ko-team ${selected === "home" ? "selected" : ""} ${!homeDefined ? "pending" : ""}" data-team="home">
      <input class="form-check-input" type="radio" name="pred-ko-${m.id}" value="home" ${selected === "home" ? "checked" : ""} ${!homeDefined ? "disabled" : ""}>
      ${homeDefined && m.home?.iso2 ? `<span class="fi fi-${m.home.iso2} flag-24"></span>` : `<i class="ri-time-line" style="color:var(--text-muted)"></i>`}
      <span class="name">${escapeHtml(m.home?.name || m.home?.label || "TBD")}</span>
    </label>
  `;
  const awayRadio = `
    <label class="pred-ko-team ${selected === "away" ? "selected" : ""} ${!awayDefined ? "pending" : ""}" data-team="away">
      <input class="form-check-input" type="radio" name="pred-ko-${m.id}" value="away" ${selected === "away" ? "checked" : ""} ${!awayDefined ? "disabled" : ""}>
      ${awayDefined && m.away?.iso2 ? `<span class="fi fi-${m.away.iso2} flag-24"></span>` : `<i class="ri-time-line" style="color:var(--text-muted)"></i>`}
      <span class="name">${escapeHtml(m.away?.name || m.away?.label || "TBD")}</span>
    </label>
  `;

  card.innerHTML = `
    ${homeRadio}
    <span class="pred-ko-vs">VS</span>
    ${awayRadio}
    <div class="pred-ko-meta">
      <span><i class="ri-flow-chart"></i> ${escapeHtml(PRED_TABS[tab]?.label || tab)}</span>
      <span><i class="ri-calendar-line"></i> ${dateStr}</span>
      ${venue ? `<span><i class="ri-building-line"></i> ${escapeHtml(venue)}</span>` : ""}
      <span class="pred-ko-points">x${weight} pts</span>
      ${eff.home !== null ? `<span><i class="ri-checkbox-circle-line"></i> Real: <strong>${eff.home}-${eff.away}</strong></span>` : ""}
    </div>
  `;
  card.dataset.matchId = m.id;
  return card;
}

function setupPredCardListeners(list, tab) {
  const isKO = tab !== "group";
  if (!isKO) {
    list.querySelectorAll("input[type=number]").forEach(inp => {
      inp.addEventListener("change", () => {
        const id = inp.dataset.match;
        const card = inp.closest(".pred-card");
        const homeInp = card.querySelector('[data-side="home"]');
        const awayInp = card.querySelector('[data-side="away"]');
        DB.setPrediction(id, parseInt(homeInp.value) || 0, parseInt(awayInp.value) || 0);
        renderPredictions();
      });
    });
  } else {
    list.querySelectorAll(".pred-ko-team").forEach(label => {
      label.addEventListener("click", e => {
        const card = label.closest(".pred-card");
        const matchId = card.dataset.matchId;
        const team = label.dataset.team;
        if (!matchId || !team) return;
        const home = team === "home" ? 1 : 0;
        const away = team === "away" ? 1 : 0;
        DB.setPrediction(matchId, home, away, { winner: team });
        renderPredictions();
      });
    });
  }
}

function setupPredictionTabs() {
  document.querySelectorAll('input[name="pred-tab"]').forEach(r => {
    r.addEventListener("change", e => {
      PRED_STATE.tab = e.target.value;
      renderPredictions();
    });
  });
}

// ============== RENDER: STATS ==============
function renderStats() {
  const container = document.getElementById("stats-container");
  if (!container) return;
  const total = STATE.matches.length;
  const group = STATE.matches.filter(m => m.stage === "group").length;
  const ko = total - group;
  const finished = STATE.matches.filter(m => m.status === "finished").length;
  const live = STATE.matches.filter(m => m.status === "live").length;
  const pending = STATE.matches.filter(m => m.status === "pending").length;
  let totalGoals = 0;
  STATE.matches.forEach(m => {
    const s = effectiveScore(m);
    if (s.home !== null && s.away !== null) totalGoals += s.home + s.away;
  });
  const goalsByTeam = new Map();
  STATE.matches.forEach(m => {
    const s = effectiveScore(m);
    if (s.home === null) return;
    const h = m.home?.name; const a = m.away?.name;
    if (h) goalsByTeam.set(h, (goalsByTeam.get(h) || 0) + s.home);
    if (a) goalsByTeam.set(a, (goalsByTeam.get(a) || 0) + s.away);
  });
  const top = Array.from(goalsByTeam.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // Datos por jornada (goles acumulados)
  const goalsByMatchday = new Map();
  STATE.matches.forEach(m => {
    if (!m.matchday) return;
    const s = effectiveScore(m);
    if (s.home === null) return;
    const cur = goalsByMatchday.get(m.matchday) || 0;
    goalsByMatchday.set(m.matchday, cur + s.home + s.away);
  });
  const matchdays = Array.from(goalsByMatchday.keys()).sort((a, b) => a - b);
  const goalsAcc = [];
  let acc = 0;
  for (const md of matchdays) {
    acc += goalsByMatchday.get(md) || 0;
    goalsAcc.push(acc);
  }

  // Distribución por fase
  const stageMap = { group: t("stage.group_short"), r32: t("stage.r32_short"), r16: t("stage.r16_short"), qf: t("stage.qf_short"), sf: t("stage.sf_short"), third: t("stage.tp_short"), final: t("stage.f_short") };
  const stageCounts = {};
  STATE.matches.forEach(m => {
    const k = stageMap[m.stage] || m.stage;
    stageCounts[k] = (stageCounts[k] || 0) + 1;
  });

  container.innerHTML = `
    <div class="col-12 col-md-6 col-lg-3">
      <div class="stat-card">
        <h3><i class="ri-calendar-line" aria-hidden="true"></i> ${t("stats.summary.matches")}</h3>
        <div class="stat-row"><span>Total</span><span class="v">${total}</span></div>
        <div class="stat-row"><span>${t("stage.groups")}</span><span class="v">${group}</span></div>
        <div class="stat-row"><span>Eliminatorias</span><span class="v">${ko}</span></div>
        <div class="stat-row"><span>${t("status.finished")}</span><span class="v">${finished}</span></div>
        <div class="stat-row"><span>${t("status.live")}</span><span class="v">${live}</span></div>
        <div class="stat-row"><span>${t("status.upcoming")}</span><span class="v">${pending}</span></div>
      </div>
    </div>
    <div class="col-12 col-md-6 col-lg-3">
      <div class="stat-card">
        <h3><i class="ri-football-line" aria-hidden="true"></i> ${t("stats.summary.goals")}</h3>
        <div class="stat-row"><span>Total anotados</span><span class="v bebas fs-5">${totalGoals}</span></div>
        <div class="stat-row"><span>${t("stats.summary.avgGoals")}/partido</span><span class="v">${finished > 0 ? (totalGoals / finished).toFixed(2) : "0.00"}</span></div>
        <div class="stat-row"><span>Equipos con goles</span><span class="v">${goalsByTeam.size}</span></div>
      </div>
    </div>
    <div class="col-12 col-lg-6">
      <div class="stat-card">
        <h3><i class="ri-trophy-line" aria-hidden="true"></i> ${t("stats.summary.topScorer")}</h3>
        ${top.length === 0 ? '<p class="text-muted small">' + escapeHtml(t("common.empty")) + '</p>' :
          top.map(([name, g]) => `<div class="stat-row"><span>${name}</span><span class="v">${g} goles</span></div>`).join("")}
      </div>
    </div>

    <div class="col-12 col-lg-6">
      <div class="stat-card">
        <h3><i class="ri-pie-chart-2-line" aria-hidden="true"></i> Estado de partidos</h3>
        <div id="chart-status" class="echart"></div>
      </div>
    </div>
    <div class="col-12 col-lg-6">
      <div class="stat-card">
        <h3><i class="ri-bar-chart-2-line" aria-hidden="true"></i> Partidos por fase</h3>
        <div id="chart-stages" class="echart"></div>
      </div>
    </div>

    <div class="col-12">
      <div class="stat-card">
        <h3><i class="ri-line-chart-line" aria-hidden="true"></i> Goles acumulados por jornada</h3>
        <div id="chart-accum" class="echart echart-tall"></div>
      </div>
    </div>

    <div class="col-12">
      <div class="stat-card">
        <h3><i class="ri-trophy-line" aria-hidden="true"></i> Goles por selección (top ${Math.min(top.length, 12)})</h3>
        <div id="chart-top" class="echart echart-tall"></div>
      </div>
    </div>
  `;

  // Render de las gráficas (después de inyectar el HTML, en el siguiente tick)
  setTimeout(() => renderEchartsCharts({ finished, live, pending, stageCounts, top, matchdays, goalsAcc }), 0);
}

function getEchartsTheme() {
  // Lee vars CSS de la app para que los charts se integren con el tema
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim() || "#fff";
  return {
    primary:   v("--primary"),
    secondary: v("--secondary"),
    accent:    v("--accent"),
    accent2:   v("--accent-2"),
    text:      v("--text"),
    muted:     v("--text-muted"),
    border:    v("--border"),
    bg:        v("--bg-elevated"),
  };
}

function renderEchartsCharts({ finished, live, pending, stageCounts, top, matchdays, goalsAcc }) {
  if (typeof echarts === "undefined") {
    console.warn("[stats] ECharts no disponible");
    return;
  }
  const t = getEchartsTheme();
  const baseTextStyle = { color: t.text, fontFamily: "Inter, sans-serif" };
  const tooltipBase = {
    backgroundColor: t.bg,
    borderColor: t.border,
    textStyle: { color: t.text, fontFamily: "Inter, sans-serif" },
  };

  // 1. Estado de partidos (pie/donut)
  const chartStatus = echarts.init(document.getElementById("chart-status"), null, { renderer: "canvas" });
  chartStatus.setOption({
    backgroundColor: "transparent",
    tooltip: { trigger: "item", ...tooltipBase, formatter: "{b}: {c} ({d}%)" },
    legend: { bottom: 0, textStyle: { color: t.muted, fontSize: 11 } },
    series: [{
      type: "pie",
      radius: ["45%", "70%"],
      center: ["50%", "45%"],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: t.bg, borderWidth: 2 },
      label: { color: t.text, fontSize: 12, formatter: "{b}\n{d}%" },
      labelLine: { lineStyle: { color: t.muted } },
      data: [
        { value: finished, name: window.I18N ? I18N.t("stats.charts.status.finalized") : "Finalizados", itemStyle: { color: t.primary } },
        { value: live,     name: window.I18N ? I18N.t("stats.charts.status.live") : "En vivo",       itemStyle: { color: t.accent2 } },
        { value: pending,  name: window.I18N ? I18N.t("stats.charts.status.pending") : "Pendientes", itemStyle: { color: t.secondary } },
      ],
    }],
  });

  // 2. Partidos por fase (bar)
  const stageEntries = Object.entries(stageCounts);
  const chartStages = echarts.init(document.getElementById("chart-stages"), null, { renderer: "canvas" });
  chartStages.setOption({
    backgroundColor: "transparent",
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...tooltipBase },
    grid: { left: 70, right: 16, top: 16, bottom: 30 },
    xAxis: {
      type: "category",
      data: stageEntries.map(([k]) => k),
      axisLine: { lineStyle: { color: t.border } },
      axisLabel: { color: t.muted, fontSize: 11 },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: t.border } },
      axisLabel: { color: t.muted, fontSize: 11 },
    },
    series: [{
      type: "bar",
      data: stageEntries.map(([_, v]) => v),
      barMaxWidth: 36,
      itemStyle: {
        color: t.secondary,
        borderRadius: [4, 4, 0, 0],
      },
      emphasis: { itemStyle: { color: t.primary } },
    }],
  });

  // 3. Goles acumulados por jornada (line)
  if (matchdays.length > 0) {
    const chartAccum = echarts.init(document.getElementById("chart-accum"), null, { renderer: "canvas" });
    chartAccum.setOption({
      backgroundColor: "transparent",
      tooltip: { trigger: "axis", ...tooltipBase },
      grid: { left: 50, right: 24, top: 30, bottom: 36 },
      xAxis: {
        type: "category",
        name: "Jornada",
        nameLocation: "middle",
        nameGap: 26,
        nameTextStyle: { color: t.muted, fontSize: 11 },
        data: matchdays.map(md => "J" + md),
        axisLine: { lineStyle: { color: t.border } },
        axisLabel: { color: t.muted, fontSize: 11 },
      },
      yAxis: {
        type: "value",
        name: "Goles",
        nameTextStyle: { color: t.muted, fontSize: 11 },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: t.border } },
        axisLabel: { color: t.muted, fontSize: 11 },
      },
      series: [{
        type: "line",
        data: goalsAcc,
        smooth: true,
        symbol: "circle",
        symbolSize: 8,
        itemStyle: { color: t.accent2, borderColor: t.bg, borderWidth: 2 },
        lineStyle: { color: t.primary, width: 3 },
        areaStyle: {
          color: {
            type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: t.primary + "55" },
              { offset: 1, color: t.primary + "00" },
            ],
          },
        },
      }],
    });
  }

  // 4. Top goleadores (horizontal bar)
  if (top.length > 0) {
    const topN = top.slice(0, 12);
    const chartTop = echarts.init(document.getElementById("chart-top"), null, { renderer: "canvas" });
    chartTop.setOption({
      backgroundColor: "transparent",
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...tooltipBase },
      grid: { left: 140, right: 24, top: 16, bottom: 28 },
      xAxis: {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: t.border } },
        axisLabel: { color: t.muted, fontSize: 11 },
      },
      yAxis: {
        type: "category",
        data: topN.map(([n]) => n).reverse(),
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.text, fontSize: 11 },
      },
      series: [{
        type: "bar",
        data: topN.map(([_, g]) => g).reverse(),
        barMaxWidth: 22,
        itemStyle: {
          color: { type: "linear", x: 0, y: 0, x2: 1, y2: 0,
            colorStops: [
              { offset: 0, color: t.secondary },
              { offset: 1, color: t.primary },
            ],
          },
          borderRadius: [0, 4, 4, 0],
        },
        label: { show: true, position: "right", color: t.text, fontSize: 11 },
      }],
    });
  }

  // Resize handler (responsive charts)
  const allCharts = [chartStatus, chartStages];
  if (matchdays.length > 0) allCharts.push(echarts.getInstanceByDom(document.getElementById("chart-accum")));
  if (top.length > 0) allCharts.push(echarts.getInstanceByDom(document.getElementById("chart-top")));
  window.addEventListener("resize", () => {
    allCharts.forEach(c => c && c.resize());
  });
}

// ============== RENDER: DATOS CURIOSOS ==============
let FACTS_STATE = { all: [], filtered: [], currentIndex: 0 };

const FACT_CATEGORY_ICONS = {
  "Historia": "ri-time-line",
  "Goles": "ri-football-line",
  "Asistencia": "ri-group-line",
  "Anfitriones": "ri-home-4-line",
  "Campeones": "ri-trophy-line",
  "Continentes": "ri-earth-line",
  "Cultura": "ri-palette-line",
  "Eliminatorias": "ri-flow-chart",
  "Estadios": "ri-building-2-line",
  "Finales": "ri-medal-line",
  "Finanzas": "ri-money-dollar-circle-line",
  "Jugadores": "ri-user-star-line",
  "Mascotas": "ri-bear-smile-line",
  "Partidos": "ri-calendar-event-line",
  "Premios": "ri-award-line",
  "Récords": "ri-bar-chart-star-line",
  "Tarjetas": "ri-file-warning-line",
  "Tecnología": "ri-cpu-line",
  "Televisión": "ri-tv-line",
};

const FACT_CATEGORY_COLORS = {
  "Historia": "var(--secondary)",
  "Goles": "var(--primary)",
  "Asistencia": "var(--accent-2)",
  "Anfitriones": "var(--accent)",
  "Campeones": "var(--accent-2)",
  "Continentes": "var(--secondary)",
  "Cultura": "var(--primary)",
  "Eliminatorias": "var(--accent)",
  "Estadios": "var(--text-muted)",
  "Finales": "var(--primary)",
  "Finanzas": "var(--accent-2)",
  "Jugadores": "var(--primary)",
  "Mascotas": "var(--accent-2)",
  "Partidos": "var(--secondary)",
  "Premios": "var(--accent-2)",
  "Récords": "var(--primary)",
  "Tarjetas": "var(--accent)",
  "Tecnología": "var(--secondary)",
  "Televisión": "var(--secondary)",
};

// ============== RENDER: STADIUMS ==============
const STADIUM_STATE = { all: [], filtered: [] };

const COUNTRY_ISO2 = {
  "Mexico": "mx",
  "United States": "us",
  "Canada": "ca",
};

const STADIUM_COUNTRY_KEY = {
  "Mexico": "MEX",
  "United States": "USA",
  "Canada": "CAN",
};

const REGION_LABEL = {
  "Western": "Oeste",
  "Central": "Centro",
  "Eastern": "Este",
};

// Emojis representativos de cada estadio (sin imágenes)
const STADIUM_EMOJI = {
  "Estadio Azteca": "🏟️",
  "Estadio Akron": "🏟️",
  "Mercedes-Benz Stadium": "🏟️",
  "AT&T Stadium": "🏟️",
  "NRG Stadium": "🏟️",
  "Arrowhead Stadium": "🏟️",
  "Lumen Field": "🏟️",
  "Levi's Stadium": "🏟️",
  "SoFi Stadium": "🏟️",
  "MetLife Stadium": "🏟️",
  "Lincoln Financial Field": "🏟️",
  "Hard Rock Stadium": "🌴",
  "BC Place": "🏔️",
  "BMO Field": "🏟️",
  "GEHA Field at Arrowhead Stadium": "🏟️",
  "Inter&Co Stadium": "🏟️",
  "Inglewood Stadium": "🏟️",
  "Moscone Stadium": "🏟️",
};

function renderStadiums() {
  const container = document.getElementById("stadiums-container");
  const summary = document.getElementById("stadium-summary");
  if (!container) return;

  // Obtener estadios de STATE.stadiums (cargados por API)
  STADIUM_STATE.all = Array.from(STATE.stadiums?.values() || []);
  if (STADIUM_STATE.all.length === 0) {
    container.innerHTML = `
      <div class="col-12">
        <div class="card-mundial p-4 text-center">
          <i class="ri-building-2-line" style="font-size:2.5rem;color:var(--text-muted)"></i>
          <p class="text-muted mt-2 mb-0">No se pudieron cargar las sedes de la API.</p>
        </div>
      </div>`;
    if (summary) summary.innerHTML = "";
    return;
  }

  // Resumen
  if (summary) {
    const totalCap = STADIUM_STATE.all.reduce((acc, s) => acc + (s.capacity || 0), 0);
    const byCountry = {};
    for (const s of STADIUM_STATE.all) {
      byCountry[s.country] = (byCountry[s.country] || 0) + 1;
    }
    const maxCap = STADIUM_STATE.all.reduce((a, s) => (s.capacity || 0) > a.capacity ? s : a, { capacity: 0 });
    summary.innerHTML = `
      <div class="col-12 col-md-6 col-lg-3">
        <div class="stadium-summary-card">
          <div class="stadium-summary-icon"><i class="ri-building-2-line"></i></div>
          <div>
            <div class="label">${t("st.summary.total")}</div>
            <div class="value bebas">${STADIUM_STATE.all.length}</div>
            <div class="sub">${t("st.subtitle").split("·").pop().trim()}</div>
          </div>
        </div>
      </div>
      <div class="col-12 col-md-6 col-lg-3">
        <div class="stadium-summary-card">
          <div class="stadium-summary-icon"><i class="ri-group-line"></i></div>
          <div>
            <div class="label">${t("st.summary.capacity")}</div>
            <div class="value bebas">${(totalCap / 1_000_000).toFixed(2)}M</div>
            <div class="sub">espectadores</div>
          </div>
        </div>
      </div>
      <div class="col-12 col-md-6 col-lg-3">
        <div class="stadium-summary-card">
          <div class="stadium-summary-icon"><i class="ri-star-line"></i></div>
          <div>
            <div class="label">${t("st.summary.biggest")}</div>
            <div class="value bebas" style="font-size:1.05rem">${escapeHtml(maxCap.name || "—")}</div>
            <div class="sub">${(maxCap.capacity || 0).toLocaleString("es-MX")} espectadores</div>
          </div>
        </div>
      </div>
      <div class="col-12 col-md-6 col-lg-3">
        <div class="stadium-summary-card">
          <div class="stadium-summary-icon"><i class="ri-earth-line"></i></div>
          <div>
            <div class="label">${t("st.summary.distribution")}</div>
            <div class="value bebas" style="font-size:1rem">
              ${Object.entries(byCountry).map(([c, n]) => {
                const cKey = "st.country." + STADIUM_COUNTRY_KEY[c];
                const cLabel = (window.I18N && I18N.t(cKey) !== cKey) ? I18N.t(cKey) : c;
                return `${cLabel}: ${n}`;
              }).join(" · ")}
            </div>
            <div class="sub">sedes</div>
          </div>
        </div>
      </div>
    `;
  }

  // Llenar dropdown de países (solo una vez)
  const sel = document.getElementById("stadium-country");
  if (sel && sel.options.length <= 1) {
    const countries = Array.from(new Set(STADIUM_STATE.all.map(s => s.country))).sort();
    sel.innerHTML = '<option value="">' + escapeHtml(t("st.filters.allCountries")) + '</option>' +
      countries.map(c => {
        const cKey = "st.country." + STADIUM_COUNTRY_KEY[c];
        const cLabel = (window.I18N && I18N.t(cKey) !== cKey) ? I18N.t(cKey) : c;
        return `<option value="${escapeHtml(c)}">${escapeHtml(cLabel)}</option>`;
      }).join("");
  }

  applyStadiumFilters();
  setupStadiumListeners();
}

function applyStadiumFilters() {
  const search = (document.getElementById("stadium-search")?.value || "").toLowerCase().trim();
  const country = document.getElementById("stadium-country")?.value || "";
  const region = document.querySelector('input[name="stadium-region"]:checked')?.value || "";

  STADIUM_STATE.filtered = STADIUM_STATE.all.filter(s => {
    if (country && s.country !== country) return false;
    if (region && s.region !== region) return false;
    if (search) {
      const hay = `${s.name} ${s.fifa_name} ${s.city} ${s.country}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  // Ordenar por país (México, USA, Canadá) y luego por capacidad desc
  const countryOrder = { "Mexico": 0, "United States": 1, "Canada": 2 };
  STADIUM_STATE.filtered.sort((a, b) => {
    const oa = countryOrder[a.country] ?? 99;
    const ob = countryOrder[b.country] ?? 99;
    if (oa !== ob) return oa - ob;
    return (b.capacity || 0) - (a.capacity || 0);
  });

  renderStadiumCards();
}

function renderStadiumCards() {
  const container = document.getElementById("stadiums-container");
  if (!container) return;

  if (STADIUM_STATE.filtered.length === 0) {
    container.innerHTML = `
      <div class="col-12">
        <div class="card-mundial p-4 text-center">
          <i class="ri-search-eye-line" style="font-size:2.5rem;color:var(--text-muted)"></i>
          <p class="text-muted mt-2 mb-0">${escapeHtml(t("st.empty"))}</p>
        </div>
      </div>`;
    return;
  }

  container.innerHTML = STADIUM_STATE.filtered.map(renderStadiumCard).join("");
}

function renderStadiumCard(s) {
  const iso2 = COUNTRY_ISO2[s.country] || null;
  const emoji = STADIUM_EMOJI[s.name] || "🏟️";
  const regionText = REGION_LABEL[s.region] || s.region || "—";
  const cKey = "st.country." + (STADIUM_COUNTRY_KEY[s.country] || "");
  const cLabel = (window.I18N && I18N.t(cKey) !== cKey) ? I18N.t(cKey) : (s.country || "—");
  return `
    <div class="col-12 col-md-6 col-lg-4">
      <article class="stadium-card">
        <span class="stadium-region-badge">${escapeHtml(regionText)}</span>
        <div class="stadium-head">
          <div class="stadium-emoji" aria-hidden="true">${emoji}</div>
          <div class="stadium-title">
            <h3>${escapeHtml(s.name || "")}</h3>
            <div class="fifa-name">${escapeHtml(s.fifa_name || "")}</div>
          </div>
          ${iso2 ? `<span class="fi fi-${iso2} stadium-flag" title="${escapeHtml(cLabel)}"></span>` : ""}
        </div>
        <div class="stadium-stats">
          <div class="stadium-stat">
            <span class="stat-label">${t("st.city")}</span>
            <span class="stat-value">${escapeHtml(s.city || "—")}</span>
          </div>
          <div class="stadium-stat">
            <span class="stat-label">${t("st.country")}</span>
            <span class="stat-value">${escapeHtml(cLabel)}</span>
          </div>
          <div class="stadium-stat">
            <span class="stat-label">${t("st.capacity")}</span>
            <span class="stat-value bebas">${(s.capacity || 0).toLocaleString("es-MX")}</span>
          </div>
          <div class="stadium-stat">
            <span class="stat-label">${t("st.region")}</span>
            <span class="stat-value">${escapeHtml(regionText)}</span>
          </div>
        </div>
      </article>
    </div>
  `;
}

function setupStadiumListeners() {
  const search = document.getElementById("stadium-search");
  const country = document.getElementById("stadium-country");
  if (search) search.addEventListener("input", applyStadiumFilters);
  if (country) country.addEventListener("change", applyStadiumFilters);
  document.querySelectorAll('input[name="stadium-region"]').forEach(r => {
    r.addEventListener("change", applyStadiumFilters);
  });
}

// ============== RENDER: TIMELINE ==============
const TIMELINE_STATE = { mode: "day", stage: "", status: "", jump: "" };

const TIMELINE_STAGE_LABEL = {
  group: () => t("stage.group_short"), r32: () => t("stage.r32_short"), r16: () => t("stage.r16_short"), qf: () => t("stage.qf_short"), sf: () => t("stage.sf_short"), third: () => t("stage.tp_short"), final: () => t("stage.f_short"),
};

function renderTimeline() {
  const container = document.getElementById("timeline-container");
  const summary = document.getElementById("timeline-summary");
  if (!container) return;

  const all = STATE.matches.filter(m => m.home?.name_en && m.away?.name_en);

  // Summary
  if (summary) {
    const liveCount = all.filter(m => m.status === "live").length;
    const groups = all.filter(m => m.stage === "group").length;
    const kos = all.length - groups;
    const firstDay = all.map(m => m.date).filter(Boolean).sort()[0];
    const lastDay = all.map(m => m.date).filter(Boolean).sort().pop();
    const now = Date.now();
    const next = all
      .filter(m => m.status === "pending" && m.date && new Date(m.date).getTime() > now)
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))[0];
    const nextName = next ? `${next.home?.name || "TBD"} vs ${next.away?.name || "TBD"}` : t("tl.summary.none");
    const nextDate = next ? new Date(next.date).toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) : "—";
    const nextTime = next ? new Date(next.date).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "—";
    const daysSet = new Set(all.map(m => m.date?.slice(0, 10)).filter(Boolean));
    const daysCount = daysSet.size;
    const daysDur = firstDay && lastDay
      ? Math.round((new Date(lastDay).getTime() - new Date(firstDay).getTime()) / 86400000) + 1
      : 0;
    summary.innerHTML = `
      <div class="col-12 col-md-6 col-lg-3">
        <div class="tl-summary-card tl-summary-live">
          <div class="tl-summary-icon"><i class="ri-live-line"></i></div>
          <div class="tl-summary-body">
            <div class="tl-summary-label" data-i18n="tl.summary.liveLabel">En vivo</div>
            <div class="tl-summary-value">${liveCount}</div>
            <div class="tl-summary-sub">${liveCount === 1 ? t("tl.summary.liveNow") : t("tl.summary.liveNowPlural")}</div>
          </div>
        </div>
      </div>
      <div class="col-12 col-md-6 col-lg-3">
        <div class="tl-summary-card tl-summary-upcoming">
          <div class="tl-summary-icon"><i class="ri-time-line"></i></div>
          <div class="tl-summary-body">
            <div class="tl-summary-label" data-i18n="tl.summary.nextLabel">Próximo partido</div>
            <div class="tl-summary-value" style="font-size:1.05rem">${escapeHtml(nextName)}</div>
            <div class="tl-summary-sub">${escapeHtml(nextDate)} · ${escapeHtml(nextTime)}</div>
          </div>
        </div>
      </div>
      <div class="col-12 col-md-6 col-lg-3">
        <div class="tl-summary-card tl-summary-total">
          <div class="tl-summary-icon"><i class="ri-football-line"></i></div>
          <div class="tl-summary-body">
            <div class="tl-summary-label" data-i18n="tl.summary.totalLabel">Total partidos</div>
            <div class="tl-summary-value">${all.length}</div>
            <div class="tl-summary-sub">${groups} grupos + ${kos} eliminatorias</div>
          </div>
        </div>
      </div>
      <div class="col-12 col-md-6 col-lg-3">
        <div class="tl-summary-card tl-summary-days">
          <div class="tl-summary-icon"><i class="ri-calendar-event-line"></i></div>
          <div class="tl-summary-body">
            <div class="tl-summary-label" data-i18n="tl.summary.daysLabel">Duración</div>
            <div class="tl-summary-value">${daysDur} <span style="font-size:0.9rem;color:var(--text-muted)">días</span></div>
            <div class="tl-summary-sub">${firstDay ? new Date(firstDay).toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) : "—"} → ${lastDay ? new Date(lastDay).toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) : "—"}</div>
          </div>
        </div>
      </div>
    `;
  }

  populateTimelineJump(all);
  applyTimelineFilters();
  setupTimelineListeners();
}

function currentStageLabel(matches) {
  const today = new Date().toISOString().slice(0, 10);
  const todays = matches.filter(m => m.date?.slice(0, 10) === today);
  if (todays.length === 0) return "Pre-torneo";
  const stages = todays.map(m => m.stage);
  if (stages.includes("group")) return "Grupos";
  if (stages.includes("r32")) return "32avos";
  if (stages.includes("r16")) return "Octavos";
  if (stages.includes("qf")) return "Cuartos";
  if (stages.includes("sf")) return "Semis";
  if (stages.includes("final")) return "Final";
  return "Torneo";
}

function populateTimelineJump(matches) {
  const sel = document.getElementById("tl-jump");
  if (!sel || sel.options.length > 1) return;
  const days = Array.from(new Set(matches.map(m => m.date?.slice(0, 10)).filter(Boolean))).sort();
  sel.innerHTML = '<option value="">Selecciona un día…</option>' +
    days.map(d => {
      const date = new Date(d + "T12:00:00");
      const label = date.toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" });
      return `<option value="${d}">${escapeHtml(label)}</option>`;
    }).join("");
}

function applyTimelineFilters() {
  const stage = TIMELINE_STATE.stage;
  const status = TIMELINE_STATE.status;
  const jump = TIMELINE_STATE.jump;
  const mode = TIMELINE_STATE.mode;

  let filtered = STATE.matches.filter(m => m.home?.name_en && m.away?.name_en);
  if (stage) filtered = filtered.filter(m => m.stage === stage);
  if (status) filtered = filtered.filter(m => m.status === status);
  if (jump) filtered = filtered.filter(m => m.date?.slice(0, 10) === jump);

  // Group by day
  const byDay = new Map();
  for (const m of filtered) {
    const day = m.date?.slice(0, 10);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(m);
  }

  // Si modo "week", agrupar en semanas
  let groups = [];
  if (mode === "day") {
    for (const [day, ms] of byDay.entries()) {
      groups.push({ label: day, matches: ms });
    }
  } else {
    // Week: agrupar por lunes de la semana
    const byWeek = new Map();
    for (const [day, ms] of byDay.entries()) {
      const d = new Date(day + "T12:00:00");
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const key = monday.toISOString().slice(0, 10);
      if (!byWeek.has(key)) byWeek.set(key, []);
      byWeek.get(key).push({ day, matches: ms });
    }
    for (const [monday, days] of byWeek.entries()) {
      const allMatches = days.flatMap(d => d.matches);
      allMatches.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      const sunday = new Date(monday + "T12:00:00");
      sunday.setDate(sunday.getDate() + 6);
      const label = `Semana del ${new Date(monday + "T12:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short" })} al ${sunday.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}`;
      groups.push({ label, matches: allMatches });
    }
  }

  groups.sort((a, b) => a.label.localeCompare(b.label));

  renderTimelineView(groups);
}

function renderTimelineView(groups) {
  const container = document.getElementById("timeline-container");
  const counter = document.getElementById("tl-count");
  if (!container) return;

  const totalMatches = groups.reduce((acc, g) => acc + g.matches.length, 0);
  if (counter) {
    const stageText = TIMELINE_STATE.stage ? ` · ${(TIMELINE_STAGE_LABEL[TIMELINE_STATE.stage] && TIMELINE_STAGE_LABEL[TIMELINE_STATE.stage]()) || TIMELINE_STATE.stage}` : "";
    const statusText = TIMELINE_STATE.status ? ` · ${TIMELINE_STATE.status}` : "";
    counter.innerHTML = `Mostrando <strong>${totalMatches}</strong> partidos en <strong>${groups.length}</strong> ${TIMELINE_STATE.mode === "day" ? "días" : "semanas"}${stageText}${statusText}.`;
  }

  if (groups.length === 0) {
    container.innerHTML = `<div class="tl-empty"><i class="ri-search-eye-line" style="font-size:2.5rem;display:block;margin-bottom:.5rem"></i>No hay partidos que coincidan con los filtros.</div>`;
    return;
  }

  container.innerHTML = groups.map(g => renderTimelineGroup(g)).join("");

  // Scroll a la fecha seleccionada
  if (TIMELINE_STATE.jump) {
    const el = container.querySelector(`[data-day="${TIMELINE_STATE.jump}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderTimelineGroup(group) {
  const isWeek = TIMELINE_STATE.mode === "week";
  const firstMatch = group.matches[0];
  const dayKey = firstMatch?.date?.slice(0, 10) || "";
  const isToday = dayKey === new Date().toISOString().slice(0, 10);
  const date = new Date(firstMatch.date);
  const dayLabel = isWeek ? group.label : date.toLocaleDateString("es-MX", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  const daySub = !isWeek ? `${group.matches.length} ${group.matches.length === 1 ? "partido" : "partidos"}` : `${group.matches.length} ${group.matches.length === 1 ? "partido" : "partidos"} en la semana`;

  return `
    <div class="tl-day" data-day="${dayKey}">
      <div class="tl-day-header">
        <div class="tl-day-pin ${isToday ? "tl-day-pin-today" : ""}">
          <i class="ri-${isToday ? "live-line" : "calendar-line"}" aria-hidden="true"></i>
        </div>
        <div class="tl-day-title">
          <span class="main">${escapeHtml(dayLabel)}</span>
          <span class="sub">${daySub}</span>
        </div>
        <span class="tl-day-count">${group.matches.length}</span>
      </div>
      <div class="tl-track">
        ${group.matches.map(renderTimelineCard).join("")}
      </div>
    </div>
  `;
}

function renderTimelineCard(m) {
  const s = effectiveScore(m);
  const d = new Date(m.date);
  const time = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  const hWins = s.home !== null && s.away !== null && s.home > s.away;
  const aWins = s.home !== null && s.away !== null && s.away > s.home;
  const stageText = (TIMELINE_STAGE_LABEL[m.stage] && TIMELINE_STAGE_LABEL[m.stage]()) || m.stage;
  const venue = m.venue || "";

  const timeDisplay = m.status === "live" && m.time_elapsed && m.time_elapsed !== "live" && m.time_elapsed !== "notstarted"
    ? `${escapeHtml(String(m.time_elapsed))}'`
    : escapeHtml(time);
  const stageDisplay = `${escapeHtml(stageText)}${m.group ? " · G" + escapeHtml(m.group) : ""}`;

  const statusBadge = m.status === "live"
    ? `<span class="tl-status-badge tl-status-live"><span class="nav-spinner-dot" style="width:6px;height:6px;margin:0"></span> EN VIVO</span>`
    : m.status === "finished"
    ? `<span class="tl-status-badge tl-status-finished"><i class="ri-checkbox-circle-fill" aria-hidden="true"></i> FINAL</span>`
    : `<span class="tl-status-badge tl-status-pending"><i class="ri-time-line" aria-hidden="true"></i> ${escapeHtml(time)}</span>`;

  const showScorers = m.status === "live" || m.status === "finished";
  const homeScorers = showScorers ? renderScorersList(m.home?.scorers) : "";
  const awayScorers = showScorers ? renderScorersList(m.away?.scorers) : "";

  return `
    <a href="calendario.html" class="tl-card tl-card-${m.status}" data-match="${m.id}">
      <div class="tl-card-head">
        <div class="tl-time">
          ${timeDisplay}
          <span class="sub">${stageDisplay}</span>
        </div>
      </div>
      <div class="tl-card-body">
        <div class="tl-match-teams">
          <div class="tl-team ${hWins ? "tl-team-winner" : ""}">
            <span class="fi fi-${m.home.iso2} flag-24" title="${escapeHtml(m.home.name)}"></span>
            <span class="tl-team-name">${escapeHtml(m.home.name)}</span>
            ${homeScorers}
          </div>
          <div class="tl-score">${s.home !== null ? s.home : "0"}<span class="tl-vs"> - </span>${s.away !== null ? s.away : "0"}</div>
          <div class="tl-team tl-team-away ${aWins ? "tl-team-winner" : ""}">
            <span class="tl-team-name">${escapeHtml(m.away.name)}</span>
            ${awayScorers}
            <span class="fi fi-${m.away.iso2} flag-24" title="${escapeHtml(m.away.name)}"></span>
          </div>
        </div>
      </div>
      <div class="tl-card-foot">
        <div class="tl-meta">
          ${statusBadge}
          ${venue ? `<span class="venue"><i class="ri-building-line"></i> ${escapeHtml(venue)}</span>` : ""}
        </div>
      </div>
    </a>
  `;
}

function setupTimelineListeners() {
  const stage = document.getElementById("tl-stage");
  const status = document.getElementById("tl-status");
  const jump = document.getElementById("tl-jump");
  if (stage) stage.addEventListener("change", e => { TIMELINE_STATE.stage = e.target.value; applyTimelineFilters(); });
  if (status) status.addEventListener("change", e => { TIMELINE_STATE.status = e.target.value; applyTimelineFilters(); });
  if (jump) jump.addEventListener("change", e => { TIMELINE_STATE.jump = e.target.value; applyTimelineFilters(); });
  document.querySelectorAll('input[name="tl-mode"]').forEach(r => {
    r.addEventListener("change", e => { TIMELINE_STATE.mode = e.target.value; applyTimelineFilters(); });
  });
}

async function renderFacts() {
  const list = document.getElementById("facts-list");
  if (!list) {
    console.warn("[renderFacts] #facts-list no existe en el DOM");
    return;
  }

  try {
    const isEN = window.I18N && I18N.lang === "en";
    const jsonPath = isEN ? "./worldcup_facts_500_EN.json" : "./worldcup_facts_150_ES.json";
    const r = await fetch(jsonPath, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    FACTS_STATE.all = data.datos || [];
    console.log(`[renderFacts] cargados ${FACTS_STATE.all.length} datos (${isEN ? "EN" : "ES"})`);
  } catch (e) {
    list.innerHTML = `<div class="col-12"><div class="fatal-card"><div class="fatal-icon"><i class="ri-error-warning-line"></i></div><h2>${escapeHtml(t("err.fatal.file"))}</h2><p>${escapeHtml(String(e.message))}</p></div></div>`;
    console.error("Facts load error:", e);
    return;
  }

  try {
    populateFactCategoryFilter();
    applyFactFilters();
    setupFactListeners();
    console.log(`[renderFacts] render OK, cards: ${FACTS_STATE.filtered.length}`);
  } catch (e) {
    list.innerHTML = `<div class="col-12"><div class="fatal-card"><div class="fatal-icon"><i class="ri-bug-line"></i></div><h2>Error al renderizar</h2><p>${escapeHtml(String(e.message))}</p><pre style="text-align:left;font-size:.75rem;background:rgba(0,0,0,.3);padding:.5rem;border-radius:4px;overflow:auto">${escapeHtml(String(e.stack || ""))}</pre></div></div>`;
    console.error("Facts render error:", e);
    return;
  }

  const ts = document.getElementById("last-refresh");
  if (ts) {
    const today = new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
    ts.textContent = `Catálogo: ${today}`;
  }
}

function populateFactCategoryFilter() {
  const sel = document.getElementById("fact-category");
  if (!sel) return;
  const cats = Array.from(new Set(FACTS_STATE.all.map(f => f.categoria))).sort((a, b) => a.localeCompare(b, "es"));
  const current = sel.value;
  sel.innerHTML = '<option value="">' + escapeHtml(t("facts.category.all")) + '</option>' +
    cats.map(c => {
      const catKey = "facts.cat." + c;
      const label = (window.I18N && I18N.t(catKey) !== catKey) ? I18N.t(catKey) : c;
      return `<option value="${escapeHtml(c)}">${escapeHtml(label)}</option>`;
    }).join("");
  sel.value = current;
}

function setupFactListeners() {
  const search = document.getElementById("fact-search");
  const cat = document.getElementById("fact-category");
  const rnd = document.getElementById("btn-fact-random");
  if (search) search.addEventListener("input", applyFactFilters);
  if (cat) cat.addEventListener("change", applyFactFilters);
  if (rnd) rnd.addEventListener("click", showRandomFact);
}

function applyFactFilters() {
  const search = (document.getElementById("fact-search")?.value || "").toLowerCase().trim();
  const cat = document.getElementById("fact-category")?.value || "";
  FACTS_STATE.filtered = FACTS_STATE.all.filter(f => {
    if (cat && f.categoria !== cat) return false;
    if (search) {
      const haystack = `${f.dato} ${f.categoria} ${f.fuente || ""}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
  FACTS_STATE.currentIndex = 0;
  renderFactCards();
}

function renderFactCards() {
  const list = document.getElementById("facts-list");
  const counter = document.getElementById("fact-count");
  if (!list) return;

  const total = FACTS_STATE.all.length;
  const shown = FACTS_STATE.filtered.length;
  if (counter) {
    counter.innerHTML = shown === total
      ? t("facts.countAll", { total: total }).replace("{total}", "<strong>" + total + "</strong>")
      : t("facts.count", { shown: shown, total: total }).replace("{shown}", "<strong>" + shown + "</strong>").replace("{total}", "<strong>" + total + "</strong>");
  }

  if (!FACTS_STATE.filtered.length) {
    list.innerHTML = `<div class="col-12"><div class="card-mundial p-4 text-center"><i class="ri-search-eye-line" style="font-size:2.5rem;color:var(--text-muted)"></i><p class="text-muted mt-2 mb-0">${escapeHtml(t("facts.empty"))}</p></div></div>`;
    return;
  }

  list.innerHTML = FACTS_STATE.filtered.map(f => renderFactCard(f)).join("");
}

function renderFactCard(f) {
  const icon = FACT_CATEGORY_ICONS[f.categoria] || "ri-sparkling-2-line";
  const color = FACT_CATEGORY_COLORS[f.categoria] || "var(--secondary)";
  // Traduce el nombre de la categoría al idioma actual.
  const catKey = "facts.cat." + f.categoria;
  const catLabel = (window.I18N && I18N.t(catKey) !== catKey) ? I18N.t(catKey) : f.categoria;
  const sourceLabel = t("facts.source");
  const source = f.url_fuente
    ? `<a href="${escapeHtml(f.url_fuente)}" target="_blank" rel="noopener" class="fact-source" title="Abrir fuente">
         <i class="ri-external-link-line" aria-hidden="true"></i> ${escapeHtml(f.fuente || sourceLabel)}
       </a>`
    : (f.fuente ? `<span class="fact-source"><i class="ri-bookmark-line" aria-hidden="true"></i> ${escapeHtml(f.fuente)}</span>` : "");
  return `
    <div class="col-12 col-md-6 col-lg-4">
      <article class="fact-card">
        <div class="fact-head">
          <span class="fact-num">#${f.id}</span>
          <span class="fact-tag" style="--cat-color: ${color}">
            <i class="${icon}" aria-hidden="true"></i> ${escapeHtml(catLabel)}
          </span>
        </div>
        <p class="fact-body">${escapeHtml(f.dato)}</p>
        ${source ? `<footer class="fact-foot">${source}</footer>` : ""}
      </article>
    </div>
  `;
}

function showRandomFact() {
  if (!FACTS_STATE.filtered.length) return;
  const idx = Math.floor(Math.random() * FACTS_STATE.filtered.length);
  const allCards = document.querySelectorAll(".fact-card");
  const target = allCards[idx];
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.remove("fact-card-pulse");
    void target.offsetWidth;
    target.classList.add("fact-card-pulse");
  }
}
