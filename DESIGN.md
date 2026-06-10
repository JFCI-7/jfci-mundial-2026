# DESIGN.md — Mundial 2026

## Stack UI
- **Bootstrap 5.3** (CDN) — sistema de grid, componentes, utilidades.
- **Remix Icons 4** (CDN) — iconografía consistente (`ri-*`).
- **Google Fonts** — `Inter` (UI) + `Bebas Neue` (titulares deportivos).
- **CSS custom properties** — tokens semánticos para coherencia con Bootstrap.
- **Vanilla JS** — no se usa el bundle JS de Bootstrap (modales controlados a mano en `app.js`).

CDNs en `index.html`:
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/remixicon@4.2.0/fonts/remixicon.css">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

## Paleta

Tokens semánticos (mismos nombres en dark y light, distintos valores):

| Token | Dark (default) | Light | Uso |
|---|---|---|---|
| `--primary` | `#04BF45` | `#04BF45` | Primario, victorias, "EN VIVO" |
| `--primary-dark` | `#039638` | `#039638` | Hover primario |
| `--secondary` | `#6805F2` | `#6805F2` | Secundario, navbar, headers, links |
| `--secondary-dark` | `#4F04B5` | `#4F04B5` | Hover secundario |
| `--accent` | `#D90416` | `#D90416` | Alertas, errores, finales |
| `--accent-2` | `#BFF207` | `#BFF207` | Acento decorativo, "energía", highlights |
| `--bg` | `#0D0D0D` | `#F2F2F2` | Fondo principal |
| `--bg-elevated` | `#1A1A1A` | `#FFFFFF` | Cards, modales |
| `--bg-hover` | `#262626` | `#E5E5E5` | Hover sobre surfaces |
| `--text` | `#F2F2F2` | `#0D0D0D` | Texto principal |
| `--text-muted` | `#A0A0A0` | `#5A5A5A` | Texto secundario |
| `--border` | `rgba(242,242,242,.12)` | `rgba(13,13,13,.12)` | Bordes sutiles |

Los 5 colores provistos por el usuario:
- `#D90416` → `--accent` (alertas, errores, finales)
- `#F2F2F2` → `--text` (dark) / `--bg` (light)
- `#6805F2` → `--secondary` (navbar, headers)
- `#04BF45` → `--primary` (primario, victorias)
- `#BFF207` → `--accent-2` (highlights decorativos)

Bootstrap se sobreescribe en `:root` con `--bs-primary`, `--bs-success`, `--bs-danger`, etc.

## Tipografía
- **Titulares**: `Bebas Neue` (mayúsculas, tracking ancho). Títulos de grupo, marcadores grandes.
- **UI**: `Inter` 400/500/600/700. Tablas, botones, cuerpo.

## Iconografía Remix Icon
Reemplazan todos los emojis/banderas de texto:

| Contexto | Icono |
|---|---|
| Logo / trofeo | `ri-trophy-fill`, `ri-football-fill` |
| Navbar | `ri-trophy-line`, `ri-calendar-line`, `ri-bracket-line`, `ri-bar-chart-box-line` |
| Tabs | `ri-group-line`, `ri-calendar-event-line`, `ri-flow-chart`, `ri-medal-line` |
| Botón agregar | `ri-add-line` |
| Editar marcador | `ri-edit-2-line` |
| Guardar | `ri-save-3-line` |
| Eliminar | `ri-delete-bin-line` |
| Cerrar modal | `ri-close-line` |
| EN VIVO | `ri-live-line` con pulso |
| Reloj | `ri-time-line` |
| Estadio | `ri-building-line` |
| Victoria | `ri-checkbox-circle-fill` (verde) |
| Posición 1° / 2° | (sin corona — solo borde izquierdo verde 3px) |
| Reset BD | `ri-restart-line` |
| Filtros | `ri-filter-3-line` |
| Stats | `ri-bar-chart-grouped-line`, `ri-football-line` |
| Theme toggle | `ri-sun-line` / `ri-moon-line` |

## Layout

### Navbar (con theme toggle)
```html
<nav class="navbar navbar-dark sticky-top navbar-mundial">
  <div class="container-fluid">
    <a class="navbar-brand">
      <i class="ri-trophy-fill icon-ball"></i>
      <span class="bebas fs-3">MUNDIAL 2026</span>
    </a>
    <ul class="nav nav-pills">
      <li><a data-view="groups"><i class="ri-group-line"></i> Grupos</a></li>
      ...
    </ul>
    <button id="theme-toggle" class="theme-toggle" aria-label="Cambiar tema">
      <i class="ri-sun-line"></i>
      <i class="ri-moon-line"></i>
    </button>
  </div>
</nav>
```

Gradiente de la navbar: `linear-gradient(135deg, var(--secondary) 0%, var(--primary) 50%, var(--accent-2) 100%)` — púrpura → verde → lima. Vibrante, deportivo.

### Cards de grupo
`card` Bootstrap + `card-mundial` custom:
- Header con gradiente `secondary → primary`, número del grupo en `Bebas Neue` 2.5rem color `--accent-2`.
- Filas alternadas con hover `bg-primary bg-opacity-10`.
- Top 2 con **borde izquierdo verde 3px** (sin corona, solo `.qualified`).
- Posición del líder indicada por **número grande verde** (`.qualified .pos`).

### Card de partido (layout actualizado)
**Meta centrado debajo del marcador** (sin columna izquierda de fecha/hora):

```
[Fecha + Hora centradas]   [GRUPO]   [Jornada]
[🏳 México  2-1  Sudáfrica 🏳]
[🏟 Estadio Azteca]
                        [FINAL] [Editar]
```

Layout Bootstrap:
- `col-12 col-md-9` → equipos + score + meta centrada + estadio.
- `col-12 col-md-3` → badge de estado + botón editar.

Mobile: 1 columna, todo apilado. Meta centrada con `text-md-start` para desfasar a la izquierda en desktop.

## Dark / Light Mode

### Implementación
- `:root` define los tokens con valores dark.
- `.theme-light` redefine solo los tokens de superficie (`--bg`, `--bg-elevated`, `--text`, etc.) — los acentos vibrantes se mantienen.
- Toggle: `<html class="theme-light">` activa/desactiva.
- Script IIFE en el head de `app.js` aplica el tema guardado **antes del primer render** (evita flicker).
- Persistencia: `localStorage("mundial2026_theme")`.
- Default: respeta `prefers-color-scheme` del sistema operativo.
- Botón en la navbar (esquina derecha, circular) con icono `ri-sun-line`/`ri-moon-line` que rota 15° al hover.

### Por qué solo se redefinen superficies
Los 5 colores vibrantes (verde, púrpura, rojo, lima) son la identidad. No se invierten en light mode. Solo cambian los fondos y textos.

## Efectos futboleros

### 1. Cursor balón (nuevo — global)
```css
body {
  cursor: url("data:image/svg+xml;utf8,<svg...>ball</svg>") 16 16, auto;
}
```
SVG inline (sin request), 32×32 con hexágonos clásicos, color `--primary`. Hotspot centrado. Aplicado a `body` → heredado por todos los elementos. Excepciones:
- `input, textarea, select` → `cursor: text`.
- `input[type=range/checkbox/radio]` → `cursor: pointer`.
- `a, button, .match-card, .group-card, .ko-match, .pred-card` → `cursor: pointer`.

### 2. Balón rotando
```css
@keyframes spin-ball { to { transform: rotate(360deg); } }
.icon-ball { animation: spin-ball 8s linear infinite; }
```
Aplicado al icono del trofeo en la navbar.

### 3. Pulso "EN VIVO"
```css
@keyframes live-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(4,191,69,.7); }
  50%      { box-shadow: 0 0 0 10px rgba(4,191,69,0); }
}
.badge-live { animation: live-pulse 1.5s infinite; }
```

### 4. Hover "patear" en partidos
```css
.match-card:hover {
  transform: translateX(4px) rotate(-.3deg);
  box-shadow: -6px 0 0 var(--primary), 0 4px 12px rgba(0,0,0,.3);
  background: rgba(4,191,69,.08) !important;
}
```

### 5. Confetti al finalizar
Al guardar un marcador con estado "finished", disparar confeti breve con partículas de los 5 colores de la paleta (canvas overlay, 1.5s).

### 6. Onda expansiva al hacer clic en "Gol"
```css
@keyframes goal-wave {
  0%   { transform: scale(.5); opacity: 1; }
  100% { transform: scale(2.5); opacity: 0; }
}
.goal-btn.goal-active::after { animation: goal-wave .8s ease-out; }
```

### 7. Banderas nacionales de cada equipo
- `iso2` map en `seed.js:ISO_BY_NAME` (48 países).
- Imágenes desde `flagcdn.com/w40/{iso2}.png`.
- Fallback: clase `.flag-fallback` con inicial del país sobre fondo `--text-muted`.

### 8. ~~Corona del líder~~ → **eliminado**
Por feedback del usuario. El #1 se identifica con:
- Número grande en verde (`.qualified .pos`).
- Borde izquierdo verde 3px.
- Fondo levemente resaltado en hover.

## Modales
Bootstrap 5.3 modales (`<div class="modal-mundial">` custom). Se controlan manualmente con atributo `hidden`. Estética:
- `.modal-mundial-content` con `border-radius: 1rem`, `border-top: 4px solid var(--primary)`.
- Header con icono `ri-*`.
- Inputs `.form-control`, selects `.form-select`.
- Overlay con `backdrop-filter: blur(2px)`.

## Estados visuales

| Estado | Color | Icono |
|---|---|---|
| Pendiente | `--text-muted` | `ri-time-line` |
| En vivo | `--primary` + pulso | `ri-live-line` |
| Finalizado | `--secondary` | `ri-checkbox-circle-fill` |
| Victoria | `--primary` | `ri-trophy-fill` |
| Empate | `--text-muted` | `ri-shake-hands-line` |
| Derrota | `--accent` | `ri-close-line` |

## Responsive
- **Mobile** (`< 576px`): navbar colapsa con `navbar-toggler`; cards de partido apiladas; tabla de posiciones en cards verticales.
- **Tablet** (`≥ 768px`): 2 columnas de grupos, navbar inline.
- **Desktop** (`≥ 1200px`): 4 columnas de grupos, partidos con layout horizontal completo.

## Accesibilidad
- Contraste mínimo AA: ratio dark 19:1, light 21:1.
- Iconos decorativos con `aria-hidden="true"`; los informativos con `aria-label`.
- Focus visible: `outline: 3px solid var(--primary); outline-offset: 2px;`.
- `prefers-reduced-motion: reduce` desactiva spin-ball, live-pulse, hover patear.
- Toggle de tema: respeta `prefers-color-scheme` en la primera carga; después, elección del usuario gana.

## Archivos a modificar
1. `index.html` — botón theme toggle en navbar.
2. `styles.css` — tokens semánticos, `.theme-light`, cursor balón, sin corona, layout de partido actualizado.
3. `app.js` — `applyThemeEarly()` IIFE, `setupThemeToggle()`, `matchKey()`, `createMatchCard` nuevo layout, sin corona.
4. `seed.js` — mapeo `ISO_BY_NAME` (ya existía).

## Tareas inmediatas
- [x] Migrar a tokens semánticos con dark/light.
- [x] Quitar corona.
- [x] Cursor balón global.
- [x] Layout meta centrado en partidos.
- [x] Theme toggle con persistencia.
- [x] Respetar `prefers-reduced-motion`.
