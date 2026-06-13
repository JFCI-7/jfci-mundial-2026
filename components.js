// ============== components.js — partials HTML compartidos ==============
// Navbar y footer se inyectan en cada página desde este módulo.

const NAVBAR_HTML = `
  <nav class="navbar navbar-dark sticky-top navbar-expand-md navbar-mundial shadow-sm">
    <div class="container-fluid">
      <a class="navbar-brand d-flex align-items-center gap-2" href="index.html">
        <img src="img/copa_del_mundo.png" alt="" class="brand-trophy" aria-hidden="true" />
        <span class="bebas fs-3" data-i18n="nav.brand">MUNDIAL 2026</span>
      </a>
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#mainNav" aria-label="Menú">
        <i class="ri-menu-line" aria-hidden="true"></i>
      </button>
      <div class="collapse navbar-collapse" id="mainNav">
        <ul class="navbar-nav ms-auto nav-pills" id="mainNavList">
          <li class="nav-item"><a class="nav-link" href="index.html" data-i18n="nav.grupos"><i class="ri-group-line" aria-hidden="true"></i> Grupos</a></li>
          <li class="nav-item"><a class="nav-link" href="calendario.html" data-i18n="nav.calendario"><i class="ri-calendar-event-line" aria-hidden="true"></i> Calendario</a></li>
          <li class="nav-item"><a class="nav-link" href="eliminatorias.html" data-i18n="nav.eliminatorias"><i class="ri-flow-chart" aria-hidden="true"></i> Eliminatorias</a></li>
          <!-- QUINIELA temporalmente oculta: <li class="nav-item"><a class="nav-link" href="quiniela.html" data-i18n="nav.quiniela"><i class="ri-rocket-2-line" aria-hidden="true"></i> Quiniela</a></li> -->
          <li class="nav-item"><a class="nav-link" href="timeline.html" data-i18n="nav.timeline"><i class="ri-time-line" aria-hidden="true"></i> Timeline</a></li>
          <li class="nav-item"><a class="nav-link" href="estadios.html" data-i18n="nav.sedes"><i class="ri-building-2-line" aria-hidden="true"></i> Sedes</a></li>
          <li class="nav-item"><a class="nav-link" href="estadisticas.html" data-i18n="nav.stats"><i class="ri-bar-chart-box-line" aria-hidden="true"></i> Stats</a></li>
          <li class="nav-item"><a class="nav-link" href="datos-curiosos.html" data-i18n="nav.curiosidades"><i class="ri-sparkling-2-line" aria-hidden="true"></i> Curiosidades</a></li>
        </ul>
        <div class="d-flex align-items-center ms-md-2 mt-2 mt-md-0 gap-1">
          <div id="kv-fallback-badge" class="kv-fallback-badge" hidden role="status" aria-live="polite">
            <i class="ri-database-2-line" aria-hidden="true"></i>
            <span class="kv-fallback-badge-text" data-i18n="meta.fallbackBadge">Datos del {time}</span>
          </div>
          <div class="lang-switcher" id="lang-switcher">
            <button id="lang-toggle" class="lang-toggle" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Idioma">
              <span class="lang-flag-current" data-flag="es">🇲🇽</span>
              <i class="ri-arrow-down-s-line lang-caret" aria-hidden="true"></i>
            </button>
            <div class="lang-menu" role="menu">
              <button class="lang-opt" type="button" data-lang="es" role="menuitem">
                <span class="lang-flag">🇲🇽</span> <span class="lang-opt-label" data-i18n="nav.lang.es">Español</span>
              </button>
              <button class="lang-opt" type="button" data-lang="en" role="menuitem">
                <span class="lang-flag">🇺🇸</span> <span class="lang-opt-label" data-i18n="nav.lang.en">English</span>
              </button>
            </div>
          </div>
          <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Cambiar tema claro/oscuro" title="Cambiar tema">
            <i class="ri-sun-line" aria-hidden="true"></i>
            <i class="ri-moon-line" aria-hidden="true"></i>
          </button>
          <div id="nav-spinner" class="nav-spinner" aria-hidden="true" title="Actualizando datos">
            <span class="nav-spinner-dot"></span>
          </div>
        </div>
      </div>
    </div>
  </nav>
`;

const FOOTER_HTML = `
  <footer class="mundial-footer">
    <div class="container-fluid">
      <div class="row g-4">
        <div class="col-12 col-md-4">
          <div class="d-flex align-items-center gap-2 mb-3">
            <img src="img/trionda_64.png" alt="Trionda" class="footer-ball" />
            <div>
              <h5 class="bebas m-0">MUNDIAL 2026</h5>
              <small class="footer-sub" data-i18n="footer.subtitle">México · USA · Canadá</small>
            </div>
          </div>
          <p class="small footer-text mb-0" data-i18n="footer.desc">Sigue los 104 partidos del torneo más grande del mundo. Datos en vivo desde la API oficial.</p>
        </div>
        <div class="col-6 col-md-2">
          <h6 class="bebas footer-title" data-i18n="footer.nav">Navegación</h6>
          <ul class="footer-list">
            <li><a href="index.html" data-i18n="nav.grupos"><i class="ri-group-line" aria-hidden="true"></i> Grupos</a></li>
            <li><a href="calendario.html" data-i18n="nav.calendario"><i class="ri-calendar-event-line" aria-hidden="true"></i> Calendario</a></li>
            <li><a href="eliminatorias.html" data-i18n="nav.eliminatorias"><i class="ri-flow-chart" aria-hidden="true"></i> Eliminatorias</a></li>
            <!-- QUINIELA temporalmente oculta: <li><a href="quiniela.html" data-i18n="nav.quiniela"><i class="ri-rocket-2-line" aria-hidden="true"></i> Quiniela</a></li> -->
            <li><a href="timeline.html" data-i18n="nav.timeline"><i class="ri-time-line" aria-hidden="true"></i> Timeline</a></li>
            <li><a href="estadios.html" data-i18n="nav.sedes"><i class="ri-building-2-line" aria-hidden="true"></i> Sedes</a></li>
            <li><a href="estadisticas.html" data-i18n="nav.stats"><i class="ri-bar-chart-box-line" aria-hidden="true"></i> Stats</a></li>
            <li><a href="datos-curiosos.html" data-i18n="nav.curiosidades"><i class="ri-sparkling-2-line" aria-hidden="true"></i> Datos Curiosos</a></li>
          </ul>
        </div>
        <div class="col-12 col-md-6">
          <h6 class="bebas footer-title" data-i18n="footer.about">Sobre el proyecto</h6>
          <p class="small footer-text mb-2" data-i18n="footer.about.body">Aplicación web estática sin build. Datos persistidos localmente en SQLite (sql.js). Open source bajo licencia MIT.</p>
          <div class="footer-badges">
            <span class="badge bg-secondary" data-i18n="footer.badges.vanilla">Vanilla JS</span>
            <span class="badge bg-primary" data-i18n="footer.badges.mit">MIT</span>
            <span class="badge bg-success" data-i18n="footer.badges.version">v1.0</span>
          </div>
        </div>
      </div>
      <hr class="footer-divider" />
      <div class="d-flex flex-wrap justify-content-between align-items-center small footer-bottom">
        <span>
          <i class="ri-database-2-line" aria-hidden="true"></i> <span data-i18n="footer.data">Datos en vivo</span>
          (<a href="https://worldcup26.ir" target="_blank" rel="noopener" class="footer-link-light">worldcup26.ir</a>)
          · <span data-i18n="footer.credit">Página desarrollada por</span>
          <strong data-i18n="footer.credit.company">CenturiaTI</strong> <span data-i18n="footer.credit.legal">(Centuria Tecnologías de la Información).</span>
          <span data-i18n="footer.credit.developer">Desarrollador:</span>
          <strong data-i18n="footer.credit.developerName">Jesus Islas</strong>.
        </span>
        <span class="footer-stadium" data-i18n="footer.stadium">11 jun — 19 jul 2026 · 16 estadios · 48 selecciones · 104 partidos</span>
      </div>
    </div>
  </footer>
`;

const LOADER_HTML = `
  <div id="page-loader" class="page-loader" aria-hidden="true">
    <div class="loader-inner">
      <img src="img/copa_del_mundo.png" alt="Cargando..." class="loader-trophy" />
      <div class="loader-balls">
        <span class="loader-ball loader-ball-1"></span>
        <span class="loader-ball loader-ball-2"></span>
        <span class="loader-ball loader-ball-3"></span>
      </div>
      <p class="loader-text bebas" data-i18n="loader.text">CARGANDO MUNDIAL 2026…</p>
      <div class="loader-bar"><div class="loader-bar-fill"></div></div>
    </div>
  </div>
`;

// ============== Títulos de página ==============
const PAGE_TITLES = {
  "index.html": "page.title.grupos",
  "calendario.html": "page.title.calendario",
  "eliminatorias.html": "page.title.eliminatorias",
  "quiniela.html": "page.title.quiniela",
  "timeline.html": "page.title.timeline",
  "estadios.html": "page.title.sedes",
  "estadisticas.html": "page.title.estadisticas",
  "datos-curiosos.html": "page.title.curiosidades",
  "404.html": "page.title.404",
};

function applyI18n(root) {
  if (!window.I18N) return;
  const scope = root || document;
  // 1. Reemplaza todos los data-i18n="key" en el scope.
  scope.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    const text = I18N.t(key);
    // Conserva los iconos: solo reemplaza el texto, no el HTML completo.
    if (el.children.length === 0) {
      el.textContent = text;
    } else {
      // Tiene hijos (iconos). Reemplaza solo el último nodo de texto.
      const lastNode = el.lastChild;
      if (lastNode && lastNode.nodeType === Node.TEXT_NODE) {
        lastNode.textContent = " " + text;
      } else {
        el.appendChild(document.createTextNode(" " + text));
      }
    }
  });
  // 1b. Reemplaza placeholders (data-i18n-placeholder="key") en inputs.
  scope.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.setAttribute("placeholder", I18N.t(el.getAttribute("data-i18n-placeholder")));
  });
  // 2. Actualiza el atributo lang y data-lang del <html>.
  document.documentElement.setAttribute("lang", I18N.lang);
  document.documentElement.setAttribute("data-lang", I18N.lang);
  // 3. Actualiza el título del documento.
  const path = location.pathname.split("/").pop() || "index.html";
  const titleKey = PAGE_TITLES[path];
  if (titleKey) document.title = I18N.t(titleKey);
  // 4. Actualiza la bandera del switcher según el idioma actual.
  const cur = document.querySelector(".lang-flag-current");
  if (cur) {
    const flags = { es: "🇲🇽", en: "🇺🇸" };
    cur.textContent = flags[I18N.lang] || "🌐";
    cur.setAttribute("data-flag", I18N.lang);
  }
  // Marca el item activo en el menú.
  document.querySelectorAll(".lang-opt").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-lang") === I18N.lang);
  });
}

function injectSharedParts(currentPage) {
  // Carga i18n.js si no está presente.
  if (!window.I18N && !document.getElementById("i18n-script")) {
    const s = document.createElement("script");
    s.id = "i18n-script";
    s.src = "i18n.js";
    document.head.appendChild(s);
  }
  const navHolder = document.getElementById("navbar-placeholder");
  if (navHolder) navHolder.outerHTML = NAVBAR_HTML;
  const footerHolder = document.getElementById("footer-placeholder");
  if (footerHolder) footerHolder.outerHTML = FOOTER_HTML;
  // Loader va al inicio del body
  if (!document.getElementById("page-loader")) {
    document.body.insertAdjacentHTML("afterbegin", LOADER_HTML);
  }
  // Prefetch de las otras páginas (acelera la navegación entre vistas)
  injectPrefetchLinks(currentPage);
  // CSS de flag-icons (vendorizado por build.mjs)
  injectFlagIconsCSS();
  // Marca el link activo
  const link = document.querySelector(`.navbar-nav .nav-link[href="${currentPage}"]`);
  if (link) link.classList.add("active");
  // Aplica traducciones
  applyI18n();
  // Asocia el click del switcher
  setupLangSwitcher();
  // Asocia el click del toggler del navbar (no usamos Bootstrap JS)
  setupNavbarToggle();
  // Título del documento (en caso de que applyI18n no se haya ejecutado)
  const titleKey = PAGE_TITLES[currentPage];
  if (titleKey && window.I18N) document.title = I18N.t(titleKey);
}

function hideLoader() {
  const loader = document.getElementById("page-loader");
  if (!loader) return;
  loader.classList.add("loader-hide");
  setTimeout(() => loader.remove(), 600);
}

// ============== PREFETCH ==============
// Descarga silenciosa de las otras páginas para que la navegación sea instantánea
const PAGES = ["index.html", "calendario.html", "eliminatorias.html", "quiniela.html", "timeline.html", "estadios.html", "estadisticas.html", "datos-curiosos.html"];

function injectPrefetchLinks(currentPage) {
  // No duplicar si ya están en el head
  if (document.querySelector("link[data-prefetch]")) return;
  PAGES.forEach(p => {
    if (p === currentPage) return;
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = p;
    link.as = "document";
    link.setAttribute("data-prefetch", p);
    document.head.appendChild(link);
  });
}

// ============== FLAG ICONS CSS ==============
// Carga flag-icons.min.css (vendorizado por build.mjs) en el <head>.
// CSS define las clases .fi y .fi-xx que renderizan el SVG de fondo.
function injectFlagIconsCSS() {
  if (document.querySelector("link[data-flag-icons]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./vendor/css/flag-icons.min.css";
  link.setAttribute("data-flag-icons", "1");
  document.head.appendChild(link);
}

// ============== LANGUAGE SWITCHER ==============
function setupLangSwitcher() {
  const switcher = document.getElementById("lang-switcher");
  const btn = document.getElementById("lang-toggle");
  const menu = switcher ? switcher.querySelector(".lang-menu") : null;
  if (!btn || !menu) return;

  // Toggle al hacer click en el botón.
  btn.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    const isOpen = switcher.classList.toggle("open");
    btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });

  // Click en una opción → cambia idioma.
  switcher.querySelectorAll(".lang-opt").forEach(opt => {
    opt.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      const lang = opt.getAttribute("data-lang");
      if (lang && window.I18N && lang !== I18N.lang) {
        I18N.set(lang, true); // recarga la página
      }
    });
  });

  // Click fuera cierra el menú.
  document.addEventListener("click", e => {
    if (switcher.classList.contains("open") && !switcher.contains(e.target)) {
      switcher.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
    }
  });

  // Esc cierra el menú.
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && switcher.classList.contains("open")) {
      switcher.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
      btn.focus();
    }
  });
}

// ============== NAVBAR TOGGLE (mobile hamburger) ==============
// No usamos Bootstrap JS, así que el atributo data-bs-toggle no funciona.
// Implementamos el toggle manualmente: añade/quita .show en #mainNav.
function setupNavbarToggle() {
  const toggler = document.querySelector(".navbar-toggler");
  const target = document.getElementById("mainNav");
  if (!toggler || !target) return;

  const setOpen = (isOpen) => {
    target.classList.toggle("show", isOpen);
    toggler.setAttribute("aria-expanded", isOpen ? "true" : "false");
    toggler.classList.toggle("collapsed", !isOpen);
  };

  toggler.addEventListener("click", e => {
    e.stopPropagation();
    setOpen(!target.classList.contains("show"));
  });

  // Click fuera del menú → cierra.
  document.addEventListener("click", e => {
    if (!target.classList.contains("show")) return;
    if (target.contains(e.target) || toggler.contains(e.target)) return;
    setOpen(false);
  });

  // Click en un link del menú → cierra (antes de navegar).
  target.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", () => setOpen(false));
  });

  // Esc cierra el menú.
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && target.classList.contains("show")) {
      setOpen(false);
      toggler.focus();
    }
  });

  // Al pasar el breakpoint md (768px) Bootstrap CSS muestra el menú siempre.
  // No necesitamos reset manual porque `.show` no afecta el display en >=md.
}

// ============== MINI SPINNER (navbar) ==============
function showMiniSpinner() {
  const s = document.getElementById("nav-spinner");
  if (s) s.classList.add("nav-spinner-active");
}

function hideMiniSpinner() {
  const s = document.getElementById("nav-spinner");
  if (s) s.classList.remove("nav-spinner-active");
}
