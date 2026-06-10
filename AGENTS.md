# AGENTS.md — Mundial 2026

## Stack
Vanilla HTML/CSS/JS. **Una página HTML por vista** (sin SPA, sin routing). **Build step con pnpm** solo para vendorizar `flag-icons` (CSS + SVGs) a `/vendor/`. Sin bundler, sin transpiler, sin linter, sin tests.
UI: Bootstrap 5.3 + Remix Icons 4 (CDN, solo CSS — JS de Bootstrap NO se usa) + flag-icons 7 (vendorizado local).
Persistencia del usuario: SQLite vía `sql.js` (WASM desde CDN) → `localStorage` clave `mundial2026_userdb_v2`.

## Estructura (multi-página)
- `index.html`         — Vista **Grupos**.
- `calendario.html`    — Vista **Calendario** (todos los partidos).
- `eliminatorias.html` — Vista **Bracket** (fase eliminatoria).
- `quiniela.html`      — Vista **Quiniela** (predicciones del usuario).
- `estadisticas.html`  — Vista **Stats** (métricas y top goleadores).
- `datos-curiosos.html` — Vista **Datos Curiosos** (150 récords y datos históricos).
- `404.html`           — Página de error.
- `package.json`       — Declara `flag-icons@^7.5.0`. Scripts: `pnpm build`.
- `build.mjs`          — Copia SVGs de `node_modules/flag-icons/flags/4x3/<iso>.svg` a `vendor/flags/4x3/`. Solo 48 países.
- `components.js`      — Inyecta navbar + footer + loader + flag-icons CSS en cada página. Detecta la página actual desde `location.pathname`.
- `seed.js`            — `fetch('./mundial2026_calendario.json')` y normalización.
- `api.js`             — Cliente REST de `https://worldcup26.ir` vía `/api/proxy/*` (proxy serverless en Vercel, server.py en local).
- `db.js`              — IIFE `DB`. Solo datos del usuario: `user_scores`, `predictions`, `notes`, `preferences`.
- `app.js`             — Orquestador de la página actual. Detecta con `CURRENT_PAGE` qué vista renderizar.
- `styles.css`         — Variables CSS de paleta, overrides de `--bs-*`, 8 efectos futboleros, footer, loader, .flag-24/.flag-32, .fact-card.
- `img/`               — `trionda_32.png`/`trionda_64.png` (cursor), `copa_del_mundo.png` (loader y favicon).
- `vendor/`            — Generado por `pnpm build`. Contiene `flag-icons.min.css` y `flags/4x3/<iso>.svg` (48 archivos).
- `mundial2026_calendario.json` — Seed con 104 partidos, 48 equipos, 16 estadios, 7 fases.
- `worldcup_facts_150_ES.json` — Catálogo de 150 datos curiosos del Mundial (19 categorías).
- `README.md`, `DESIGN.md`, `LICENSE` (MIT).

## Build
```
pnpm install      # una vez (instala flag-icons)
pnpm build        # genera vendor/ (48 SVGs + flag-icons.min.css, ~250KB)
```
Vercel ejecuta `pnpm install && node build.mjs` en cada deploy. `node_modules/` y `vendor/` están en `.gitignore`.

## Fuentes de datos (prioridad)
```
score_final = DB.user_scores[matchId]  ??  api.home/away_score  ??  null
```
Datos oficiales **nunca** viven en SQLite. La BD solo guarda overrides del usuario.

## Cómo ejecutar
`sql.js` falla con `file://` por CORS/WASM. Usar `server.py` (sirve estáticos + proxy CORS a la API):
```
pnpm install      # una vez
pnpm build        # una vez (o cuando se actualice flag-icons)
python3 server.py
# abrir http://localhost:8000
```

`server.py` redirige cualquier request a `/api/proxy/*` hacia `https://worldcup26.ir/<rest>` con header `Access-Control-Allow-Origin: *`. En Vercel, la misma lógica vive en `api/proxy.js` como serverless function.

**Errores comunes**:
- Si abriste con doble click (protocolo `file://`): la app muestra un overlay fatal con instrucciones.
- Si usaste `python3 -m http.server` (servidor estático, sin proxy): la app muestra un banner rojo persistente arriba con el comando correcto (`python3 server.py`) y un botón "Copiar".
- Si una página da 404: la app redirige visualmente a `404.html` con un "¡Fuera de juego!".
- Si faltan las banderas: ¿corriste `pnpm build`? El `vendor/flag-icons.min.css` debe existir.

## Gotchas
- El seed (`Seed.load`) corre SIEMPRE al iniciar. La API (`API.refreshAll`) corre después, sin bloquear la UI.
- La API devuelve campos numéricos como **string** ("0", "FALSE") — `api.js:normalizeGame` los convierte.
- Eliminatorias: `home_team_id === "0"` significa TBD; usar `home_team_label` ("Winner Group A").
- Banderas: usar `<span class="fi fi-<iso2> flag-24">` con `iso2` del API. Si no hay iso2, mostrar `<span class="flag-24 flag-fallback">X</span>`. El CSS de `flag-icons` está en `vendor/flag-icons.min.css`, inyectado por `components.js`.
- `api.flagUrl(iso2)` retorna `./vendor/flags/4x3/<iso>.svg` (path local). Usado por el modal (`<img src>`).
- `db.js` usa `db.prepare(...)` con `getAsObject()` — patrón bind + step + free. NO usar `db.exec` para queries con parámetros.
- Cada página es independiente: al navegar, se recarga todo (incluyendo loader). `app.js` detecta `CURRENT_PAGE` y solo renderiza lo necesario.
- `prefers-reduced-motion: reduce` desactiva TODAS las animaciones — respetar.
- `aria-hidden="true"` en iconos decorativos; `aria-label` solo en botones de icono.

## API Free Mundial 2026
- https://worldcup26.ir/api-docs/ — Endpoints bajo `/get/*` (`teams`, `games`, `groups`, `stadiums`).
- Usar idioma inglés: campos `*_en`.
- Cliente en `api.js`. Caché 60s, auto-refresh en `app.js`.

## Banderas
- Librería: [lipis/flag-icons](https://github.com/lipis/flag-icons) v7.5.0.
- Vendorizadas a `vendor/` por `build.mjs` (solo 48 países del mundial).
- Para agregar un país: añadirlo a `REQUIRED_ISOS` en `build.mjs` y re-correr `pnpm build`.

## Datos curiosos de los mundiales
- Catálogo: `worldcup_facts_150_ES.json` (150 datos, 19 categorías: Historia, Goles, Asistencia, Anfitriones, Campeones, Continentes, Cultura, Eliminatorias, Estadios, Finales, Finanzas, Jugadores, Mascotas, Partidos, Premios, Récords, Tarjetas, Tecnología, Televisión).
- Vista: `datos-curiosos.html` con `renderFacts()` en `app.js`.
- Filtros: búsqueda libre por texto + dropdown de categoría + botón "Sorpréndeme" que hace scroll y pulse a un fact aleatorio.
- Estilos: `.fact-card` con borde lateral de color de categoría, badge de categoría con icono Remix Icon.

## Gráficas
- Librería: [Apache ECharts](https://github.com/apache/echarts) v5.5.1.
- Vendorizado local en `vendor/echarts/echarts.min.js` (~1MB).
- Cargado en `estadisticas.html` antes de `app.js` (disponible como `window.echarts`).
- 4 charts en la vista Estadísticas:
  - **Estado de partidos** (donut): Finalizados / En vivo / Pendientes.
  - **Partidos por fase** (barras): Grupos, 32avos, Octavos, Cuartos, Semis, 3° lugar, Final.
  - **Goles acumulados por jornada** (line con área): total de goles por jornada del torneo.
  - **Goles por selección (top 8)** (barras horizontales): ranking de equipos goleadores.
- Tema dinámico: `getEchartsTheme()` lee `--primary`, `--secondary`, `--accent`, `--text` etc. desde `getComputedStyle(:root)`, así los charts se adaptan al cambiar de tema.
- Re-render al cambiar tema: `setupThemeToggle` re-llama `renderStats()` si estamos en `estadisticas.html`, lo que dispose los charts viejos y los vuelve a pintar con los nuevos colores.

## Quiniela persistente (sync a Vercel KV)
- Vista: `quiniela.html`. Botones en header: **Iniciar sesión** (sign-in), **Sincronizar** (icono refresh), **Cerrar sesión** (logout). Modal con email + PIN opcional.
- Identidad: **pass-the-hash**. El email (lowercase) se concatena con un PIN opcional y se hashea con SHA-256 en el cliente vía Web Crypto API. El hash se guarda en `localStorage` con clave `mundial2026_userid`. El email **nunca** se envía al servidor.
- API REST en `api/predictions.js` (serverless Node.js, edge runtime):
  - `GET  /api/predictions?u=<hash64>` → `{ data, updated_at }` (200) o `404 not_found` o `503 kv_unavailable` (si KV no está conectado al proyecto).
  - `PUT  /api/predictions?u=<hash64>` con body `{ predictions, user_scores, notes, preferences }` → `{ ok, updated_at }` (200) o `400 invalid_*` o `413 too_large` (body > 100KB).
  - `DELETE /api/predictions?u=<hash64>` → `{ ok }` (200).
  - Headers CORS: `Access-Control-Allow-Origin: *` y métodos `GET, PUT, DELETE, OPTIONS`.
- Storage: **Vercel KV** (Redis). Key: `u:<hash64>`, value: `{ data, updated_at, version: 1 }`. La Lambda habla con KV vía REST API (`process.env.KV_REST_API_URL` + `KV_REST_API_TOKEN`), sin importar la librería `@vercel/kv`.
- Flujo de sync en `db.js`:
  - `setUserCredentials(email, pin?)` hashea con `crypto.subtle.digest("SHA-256", "mundial2026|" + email + "|" + pin)`.
  - `pullFromServer()` → GET → si 200, importa (last-write-wins: reemplaza local); si 404 y local no vacío, hace `pushToServerNow()` (migración automática); si 503, marca `syncState.enabled = false`.
  - `schedulePush(delay=1500ms)` → debounce. Llamado por `setPrediction`, `setUserScore`, `setNote`, `setPref`.
  - `pushToServerNow()` → PUT con export de las 4 tablas.
- `updateSyncUI()` actualiza el chip de status (`Sincronizado: 10 jun, 14:30` / `Solo local`), muestra/oculta los botones.
- Si el proyecto de Vercel no tiene Vercel KV conectado, la Lambda responde `503`. El cliente muestra "Sincronización no disponible" y la app funciona 100% en local.
- Setup: Vercel dashboard → Storage → Create KV → conectar al proyecto. Las variables `KV_REST_API_*` se inyectan automáticamente.
- Costo: $0/mes (Vercel KV free: 256MB → ~2.5M usuarios).
- Limitaciones aceptadas:
  - Sin password real (pass-the-hash).
  - Last-write-wins en conflictos (no hay merge).
  - Si olvidas el email o PIN, no hay recovery.

