# Apuestas — estadísticas de los últimos partidos de un jugador

Herramienta para consultar los **últimos N partidos de cualquier futbolista** con sus
estadísticas por partido: **tiros, tiros a puerta**, goles, asistencias, faltas y tarjetas.

## ¿Por qué ESPN y no SofaScore?

Se probó primero SofaScore (`api.sofascore.com` y `www.sofascore.com/api/v1`): ambas
devuelven **403 Forbidden** porque están protegidas por Cloudflare y bloquean cualquier
petición que no venga de un navegador real. Para saltarse eso harían falta herramientas
tipo `cloudscraper` o un navegador automatizado (Playwright/Selenium), que son frágiles
y pueden dejar de funcionar en cualquier momento.

En cambio, **ESPN tiene una API pública sin bloqueo** que devuelve JSON limpio con
exactamente los datos que se necesitan. Endpoints usados:

| Para qué | Endpoint |
|---|---|
| Buscar jugador por nombre | `https://site.web.api.espn.com/apis/search/v2?query=NOMBRE&limit=10` |
| Partidos + estadísticas | `https://site.web.api.espn.com/apis/common/v3/sports/soccer/athletes/ID/gamelog` |

El gamelog trae por cada partido: `totalGoals, goalAssists, totalShots, shotsOnTarget,
foulsCommitted, foulsSuffered, offsides, yellowCards, redCards`, más fecha, rival,
competición, resultado y marcador.

**Importante:** el gamelog por defecto solo devuelve la liga del club (ni Champions, ni
Mundial). Cada competición se pide aparte con `?league=SLUG` (ej. `fifa.world` para el
Mundial, `uefa.champions` para Champions). Los scripts consultan automáticamente las
competiciones de club que ESPN lista en los filtros de la respuesta + una lista fija de
competiciones de selección (Mundial, amistosos, Eurocopa, Nations League, Copa América,
Copa Oro y eliminatorias), fusionan todo, quitan duplicados por id de partido y ordenan
por fecha.

## Versión web (index.html + styles.css + app.js)

La misma herramienta como página web, **sin servidor ni dependencias**: tres archivos
estáticos — `index.html` (estructura), `styles.css` (diseño, con modo claro/oscuro
automático) y `app.js` (lógica). Abre `index.html` con doble clic (o sube la carpeta
gratis a GitHub Pages/Netlify). Funciona porque la API de ESPN envía
`Access-Control-Allow-Origin: *`, así que el navegador puede llamarla directamente sin
problema de CORS.

Incluye buscador de jugador con sugerencias, selector de 5/10/15/20 partidos, cabecera
del jugador con goles/asistencias, tiles con los promedios (con barra de proporción en
los conteos), gráfico de columnas apiladas de tiros por partido (azul intenso = a
puerta, azul claro = fuera/bloqueados, con línea de media y tooltip), y la tabla
completa con chips de resultado (V/E/D) y mini-barras en la columna de tiros.

El código de `app.js` está separado en módulos para poder ampliarlo:
`CONFIG` (competiciones y URL base), `Api` (llamadas a ESPN), `Logica` (parseo y
combinación, funciones puras sin DOM), `Formato` (fechas/números/resultados es-ES),
`UI` (render) y `App` (controlador). Para añadir una estadística nueva: agrégala en
`Logica.parsearPartidos` y luego pínchala en `UI.tiles` o en `UI.tarjetaTabla`.

## Uso (Python)

Requiere `requests` (ya instalado con `py -m pip install requests`). Desde esta carpeta:

```powershell
py jugador.py "lamine yamal"
py jugador.py "mbappe" --partidos 10       # últimos 10 en vez de 5
py jugador.py "luis diaz" --indice 2       # si hay varios con ese nombre, elige el 2º
```

Si el nombre coincide con varios jugadores, el script lista todos los candidatos con su
liga para que elijas el correcto con `--indice`.

Además de la tabla, muestra **promedios de tiros y tiros a puerta** y en cuántos de los
últimos partidos registró al menos 1 tiro — lo relevante para mercados de tiros.

## Versión PowerShell (alternativa, sin dependencias)

`jugador.ps1` hace lo mismo sin necesitar Python:

```powershell
.\jugador.ps1 -Jugador "lamine yamal" -Partidos 5
.\jugador.ps1 -Jugador "vinicius" -Csv               # además exporta un CSV en esta carpeta
```

> Si PowerShell bloquea el script por política de ejecución:
> `powershell -ExecutionPolicy Bypass -File .\jugador.ps1 -Jugador "lamine yamal"`

## Limitaciones

- ESPN cubre las grandes ligas y competiciones internacionales; en ligas menores puede
  faltar detalle de estadísticas.
- El gamelog devuelve los partidos de la(s) temporada(s) recientes (~25-30 partidos).
- Es una API no documentada oficialmente: ESPN podría cambiarla, aunque lleva años estable.
