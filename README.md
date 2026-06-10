# Mundial 2026 · Tracker

Aplicación web estática para seguir el **Mundial de la FIFA 2026** (México · USA · Canadá). Muestra los 12 grupos, los 104 partidos del torneo, las llaves eliminatorias, marcador en vivo, quiniela personal y estadísticas. Todo con persistencia local.

![Stack](https://img.shields.io/badge/stack-HTML%20%2B%20CSS%20%2B%20JS-3CAC3B)
![License](https://img.shields.io/badge/license-MIT-blue)
![Build](https://img.shields.io/badge/build-none-lightgrey)

---

## Características

- **Grupos (A–L)** con tabla de posiciones calculada en vivo o desde la API oficial.
- **Calendario completo** de los 104 partidos (fase de grupos + eliminatorias hasta la final).
- **Marcadores en vivo** auto-actualizados cada 60 s.
- **Eliminatorias**: 32avos → 16avos → cuartos → semis → 3° lugar → final.
- **Quiniela**: predice el marcador de cada partido y suma puntos (3 exacto, 1 resultado).
- **Quiniela persistente** *(opcional)*: sincroniza tu quiniela a la nube con tu email + PIN. Cámbiate de dispositivo sin perder tus predicciones.
- **Estadísticas**: goles, partidos finalizados, top goleadores.
- **Datos Curiosos**: 150 récords y curiosidades históricas del Mundial, con búsqueda y filtro por categoría.
- **Modo offline**: si la API no responde, usa el JSON local bundled.
- **Persistencia local** con SQLite (sql.js) para tus marcadores, predicciones y notas.
- **Diseño profesional** con paleta de las 3 sedes, iconografía `ri-*`, 8 efectos futboleros, totalmente responsive y accesible.

---

## Stack

| Capa | Tecnología |
|---|---|
| UI | HTML5 + CSS3 + JavaScript ES2020 (vanilla) |
| Layout | [Bootstrap 5.3](https://getbootstrap.com/) (CDN, sin JS bundle) |
| Iconos | [Remix Icons 4](https://remixicon.com/) |
| Fuentes | [Bebas Neue](https://fonts.google.com/specimen/Bebas+Neue) + [Inter](https://fonts.google.com/specimen/Inter) |
| Persistencia | [sql.js](https://github.com/sql-js/sql.js) (WASM) en `localStorage` |
| Calendario seed | `mundial2026_calendario.json` (104 partidos) |
| API live | [worldcup26.ir](https://worldcup26.ir/api-docs) — REST gratuita, sin auth |
| Banderas | [lipis/flag-icons](https://github.com/lipis/flag-icons) v7.5.0 (vendorizado local) |

Build mínimo con pnpm para vendorizar `flag-icons` (CSS + 48 SVGs) a `/vendor/`. Sin bundler, sin transpiler, sin linter, sin tests.

---

## Cómo ejecutar

La aplicación **no funciona con `file://`** porque `sql.js` carga un WASM. Usa el script incluido que también resuelve CORS:

```bash
pnpm install    # una vez (instala flag-icons en node_modules/)
pnpm build      # una vez (genera vendor/ con 48 SVGs + CSS)
python3 server.py
# abre http://localhost:8000
```

`server.py` hace dos cosas:
1. Sirve los archivos estáticos del proyecto (index.html, JS, CSS, JSON, vendor/).
2. Actúa como proxy CORS para la API: cualquier request a `/api/proxy/*` la redirige a `https://worldcup26.ir/<rest>` con el header `Access-Control-Allow-Origin: *`.

> Si la API está caída o no hay red, la app sigue funcionando con los datos del JSON local bundled (calendario, grupos, banderas). El proxy local simplemente devuelve 502 y la app entra en modo offline automáticamente.

Alternativas de dev (sin API live):
```bash
python3 -m http.server 8000   # solo estáticos, no CORS
npx serve .                   # equivalente
```

## Deploy en Vercel (recomendado para producción)

```bash
# Instala Vercel CLI
npm i -g vercel

# Deploy (primera vez)
vercel

# Deploy a producción
vercel --prod
```

Vercel detecta automáticamente `api/proxy.js` como serverless function y la expone en `/api/proxy`. El frontend se sirve como sitio estático. HTTPS gratis, deploys automáticos al hacer push a `main`.

URL típica: `https://tu-proyecto.vercel.app`

> Plan hobby de Vercel: 100k invocaciones/mes y 100 GB de bandwidth. Suficiente para uso personal.

### Quiniela persistente (Vercel KV, opcional)

Si quieres que tu quiniela se sincronice entre dispositivos:

1. **Vercel dashboard** → tu proyecto `jfci-mundial-2026` → **Storage** → **Create KV** → nombre `mundial-2026-kv` → región `iad1`.
2. **Connect** al proyecto. Las variables `KV_REST_API_URL` y `KV_REST_API_TOKEN` se inyectan automáticamente.
3. Redeploy: `vercel --prod`.
4. Abre `quiniela.html` → click en **Iniciar sesión** → ingresa tu email + PIN (opcional).
5. Tu quiniela se guarda automáticamente en la nube. Para acceder desde otro dispositivo, inicia sesión con el mismo email + PIN.

Si no configuras Vercel KV, la app funciona 100% en local — solo verás "Sincronización no disponible" en la quiniela. La identidad usa **pass-the-hash** (SHA-256 en el cliente), así que tu email **nunca** se envía al servidor.

## Solución de problemas

### ❌ Banner rojo: "Servidor incorrecto"
**Causa**: estás usando `python3 -m http.server` (servidor estático) en lugar de `python3 server.py`. El servidor estático no implementa el proxy CORS, por eso la API devuelve 404.

**Solución**:
```bash
# 1. Detén el servidor actual (Ctrl+C en la terminal donde corre)
# 2. Ejecuta el correcto:
python3 server.py
# 3. Recarga http://localhost:8000
```

El banner tiene un botón "Copiar" para que sea más fácil.

### ❌ "Access to fetch at 'file://...' blocked by CORS policy"
**Causa**: abriste `index.html` con doble click. Los navegadores bloquean todas las peticiones `fetch()` desde el protocolo `file://` (incluyendo a la API externa).

**Solución**: usa el script incluido (recomendado) o sirve con cualquier servidor HTTP:

```bash
# Recomendado: incluye proxy CORS a la API
python3 server.py
# luego abre: http://localhost:8000
```

La app detecta este caso y muestra un overlay con instrucciones paso a paso. Si lo cerraste, ejecuta el comando y recarga.

### ⚠️ "API no disponible"
Si la API `worldcup26.ir` no responde (CORS, caída, sin internet), la app entra en **modo offline** automáticamente:
- Calendario, grupos, sedes y banderas funcionan 100% desde el JSON local.
- Marcadores en vivo y standings actualizados de la API **no** estarán disponibles.
- Puedes editar marcadores manualmente con el botón "Editar" en cada partido (se guardan en tu navegador).

Si la app está en `https://` (Vercel) y la API sigue dando CORS, asegúrate de que `api.js` apunta a `/api/proxy` y que `api/proxy.js` está desplegado.

### 🏳️ Banderas no aparecen
Las banderas se cargan desde `flagcdn.com`. Si ves el código ISO sin imagen, tu red bloquea ese dominio. El seed (`seed.js:ISO_BY_NAME`) ya tiene los 48 países mapeados, así que las URLs se generan correctamente.

---

## Estructura del proyecto

```
.
├── index.html               # Entry point: CDNs + estructura Bootstrap
├── calendario.html          # Vista Calendario
├── eliminatorias.html       # Vista Bracket
├── quiniela.html            # Vista Quiniela
├── estadisticas.html        # Vista Estadísticas
├── datos-curiosos.html      # Vista Datos Curiosos (150 facts)
├── styles.css               # Paleta + overrides + 8 efectos futboleros
├── seed.js                  # Carga inicial desde mundial2026_calendario.json
├── api.js                   # Cliente REST → /api/proxy/* (Vercel) o worldcup26.ir
├── db.js                    # SQLite (sql.js) → solo datos del usuario
├── app.js                   # Orquestador de UI, render, modales, confetti
├── components.js            # Inyecta navbar/footer/loader en cada página
├── package.json             # Declara flag-icons + script build
├── build.mjs                # Copia flag-icons de node_modules/ a vendor/
├── server.py                # Dev local: estáticos + proxy CORS en /api/proxy/*
├── api/
│   └── proxy.py             # Vercel serverless function (mismo proxy)
├── vercel.json              # Config de Vercel (con buildCommand)
├── mundial2026_calendario.json   # Calendario oficial (104 partidos, 7 fases)
├── worldcup_facts_150_ES.json    # 150 datos curiosos del Mundial
├── vendor/                  # Generado por `pnpm build` (49 SVGs + flag-icons.min.css)
├── LICENSE                  # MIT
├── README.md                # Este archivo
├── AGENTS.md                # Guía para futuras sesiones de OpenCode
└── DESIGN.md                # Sistema de diseño y efectos
```

---

## Fuentes de datos

### 1. Calendario (seed)
Archivo local: **`mundial2026_calendario.json`** — incluye:
- 48 equipos distribuidos en 12 grupos (A–L).
- 72 partidos de fase de grupos (11 jun – 1 jul 2026).
- 16 partidos de 32avos.
- 8 partidos de 16avos.
- 4 cuartos, 2 semis, 1 tercer lugar, 1 final.
- 16 estadios con ciudad y país.

### 2. Marcadores en vivo
API REST: **[`https://worldcup26.ir`](https://worldcup26.ir/api-docs)**

| Endpoint | Devuelve |
|---|---|
| `GET /get/teams` | 48 equipos con `iso2`, `flag`, `fifa_code`, `groups` |
| `GET /get/games` | 104 partidos con scores, `time_elapsed`, `finished` |
| `GET /get/groups` | Standings por letra de grupo (`pts`, `gd`, `gf`, etc.) |
| `GET /get/stadiums` | 16 estadios con `capacity`, `region` |

Sin auth, sin CORS issues, sin rate-limit documentado. Caché en memoria de 60 s.

### 3. Banderas
Imágenes servidas por **`flagcdn.com`** en formato `https://flagcdn.com/w40/{iso2}.png`.

---

## Cómo funciona

### Prioridad de los datos del marcador
```
score_final = DB.user_scores[matchId]  ??  API.home_score/away_score  ??  null
```

1. **Override del usuario** (guardado en SQLite local) — máxima prioridad, lo que tú edites.
2. **API live** de worldcup26.ir — actualiza cada 60 s.
3. **null** — partido pendiente.

### Flujo de arranque
```
1. DB.init()                  → abre sql.js
2. Seed.load()                → fetch('./mundial2026_calendario.json')
3. API.refreshAll()           → /get/teams + /get/games + /get/groups + /get/stadiums
4. Ingesta y merge            → combina seed + API
5. Aplica overrides           → DB.getAllUserScores()
6. renderAll()                → pinta grupos, partidos, bracket, stats
7. setInterval(60_000)        → auto-refresh live
```

### Lo que se guarda en SQLite
- **`user_scores`** — overrides de marcadores manuales.
- **`predictions`** — tu quiniela.
- **`notes`** — notas por partido.
- **`preferences`** — última vista, filtros, último refresh.

**Nada de datos oficiales del torneo** vive en SQLite. Si borras la base, los datos vuelven desde la API/seed al siguiente load.

---

## Diseño

- **Paleta** (de `DESIGN.md`):
  - 🟢 Verde `#3CAC3B` — victorias, "EN VIVO", CTAs primarios
  - 🔵 Azul `#2A398D` — navbar, headers, links
  - 🔴 Rojo `#E61D25` — acentos, alertas, finales
  - ⚪ Gris claro `#D1D4D1` — texto secundario
  - ⚫ Gris oscuro `#474A4A` — fondo

- **Tipografía**: Bebas Neue (titulares deportivos) + Inter (UI).
- **Efectos futboleros**:
  1. Textura de cancha de césped en el fondo.
  2. Balón rotando junto al logo (`icon-ball`).
  3. Pulso verde en badge "EN VIVO".
  4. Hover "patear" en cards de partido.
  5. Confetti al finalizar un partido.
  6. Onda expansiva al hacer clic en "Gol".
  7. Banderas nacionales reales (flagcdn).
  8. Corona animada al líder de cada grupo.

- **Accesibilidad**: contraste AA, `prefers-reduced-motion` desactiva animaciones, `aria-label` en iconos.

---

## Desarrollo

### Agregar un nuevo icono
Busca en [remixicon.com](https://remixicon.com/) y reemplaza la clase `ri-*` en el HTML/JS.

### Cambiar la paleta
Edita las variables en `:root` de `styles.css`. Bootstrap hereda los valores vía `--bs-primary`, `--bs-success`, etc.

### Agregar un nuevo efecto
Define el `@keyframes` en `styles.css` y aplícalo con una clase. Respeta `prefers-reduced-motion`.

### Modificar la prioridad de fuentes
`app.js` → `effectiveScore(m)`. El primer match gana.

### Limpiar la base local
```js
// en consola del navegador
DB.resetAll();
```

---

## Limitaciones conocidas

- Las eliminatorias (r32+) muestran labels ("Winner Group A") hasta que la API publica los cruces.
- El API está en persa/inglés. Mostramos `name_en`.
- Las eliminatorias de la API a veces devuelven `home_team_id: "0"` antes de publicarse — manejado con `home_team_label`.
- Sin PWA (offline) — al recargar sin red, el seed sirve desde el JSON bundled, pero no es un service worker.

---

## Licencia

[MIT](./LICENSE) — úsalo, modifícalo, distribúyelo libremente.

---

## Créditos

- **Calendario oficial**: FIFA (datos de dominio público).
- **API en vivo**: [worldcup26.ir](https://worldcup26.ir) — REST gratuita.
- **Banderas**: [flagcdn.com](https://flagcdn.com).
- **Iconos**: [Remix Icons](https://remixicon.com/) (licencia MIT).
- **UI**: [Bootstrap 5.3](https://getbootstrap.com/) (MIT).
