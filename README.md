# Apuestas — estadísticas de jugadores y equipos

Herramienta con **tres modos de consulta** pensados para mercados de apuestas:

1. **Tiros por jugador** — tiros y tiros a puerta de un futbolista, partido a partido.
2. **Partidos de un equipo** — resultados recientes, forma, goles a favor/en contra y porterías a cero.
3. **Córners por partido** — córners que saca y concede un equipo en cada partido.

Los modos de equipo funcionan con **clubes y con selecciones nacionales** (misma
consulta, mismo peso): la app detecta que la "liga por defecto" del equipo es una
competición de selecciones (`fifa.world`, `uefa.euro`…) y entonces consulta Mundial,
amistosos, Eurocopa, Nations League, Copa América, Copa Oro y eliminatorias en vez de
liga + copas + Europa. Como el buscador de ESPN solo entiende inglés, hay un mapa de
alias español→inglés ("españa"→"spain", "alemania"→"germany"…), y la búsqueda filtra
otros deportes (el buscador también devuelve equipos de rugby o cricket con el mismo
nombre).

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
| Buscar jugador o equipo | `https://site.web.api.espn.com/apis/search/v2?query=NOMBRE&limit=10` (grupos `player` y `team`) |
| Partidos + estadísticas de un jugador | `https://site.web.api.espn.com/apis/common/v3/sports/soccer/athletes/ID/gamelog` |
| Calendario/resultados de un equipo | `https://site.api.espn.com/apis/site/v2/sports/soccer/LIGA/teams/ID/schedule?season=AÑO` |
| Córners de un partido | `https://site.api.espn.com/apis/site/v2/sports/soccer/LIGA/summary?event=ID` (`wonCorners` en `boxscore.teams`) |

Notas de los endpoints de equipo:

- El calendario se pide **por liga y por temporada** (`season` = año de inicio). La app
  consulta en paralelo la liga del equipo + copas nacionales + competiciones europeas,
  en la temporada actual y la anterior, y fusiona los partidos ya jugados.
- Los córners salen del *boxscore* del resumen de cada partido (una petición por
  partido, con caché). En amistosos y rondas menores ESPN no publica estadísticas:
  esos partidos se muestran con «–» y no cuentan en las medias.

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

La herramienta como página web, **sin servidor ni dependencias**: tres archivos
estáticos — `index.html` (estructura), `styles.css` (diseño, con modo claro/oscuro
automático) y `app.js` (lógica). Abre `index.html` con doble clic (o sube la carpeta
gratis a GitHub Pages/Netlify). Funciona porque la API de ESPN envía
`Access-Control-Allow-Origin: *`, así que el navegador puede llamarla directamente sin
problema de CORS.

La portada muestra **tres tarjetas de modo** (tiros por jugador / partidos de un equipo /
córners por partido); al elegir una se convierten en pestañas y aparece el buscador.
Cada vista incluye: cabecera con foto del jugador o escudo del equipo (con inicial de
reserva si la imagen no carga), tiles de promedios con barras de proporción, gráfico de
columnas apiladas con línea de media y tooltip, y tabla completa con chips de resultado
V/E/D, sede (casa/fuera), ceros atenuados y mini-barras en la columna clave. En modo
equipo la cabecera lleva además la **racha de forma** de los últimos 5 partidos.

El código de `app.js` está separado en módulos para poder ampliarlo:
`CONFIG` (competiciones y URLs), `Api` (llamadas a ESPN), `Logica` (parseo y
combinación, funciones puras sin DOM), `Formato` (fechas/números/resultados es-ES),
`UI` (render, con un constructor genérico de gráfico apilado que comparten las tres
vistas) y `App` (controlador con caché: cambiar el número de partidos no refetchea, y
los córners ya descargados no se vuelven a pedir).

**Sobre la columna TA (tarjetas amarillas):** no está rota — simplemente los
delanteros ven pocas tarjetas, así que en los últimos 5 partidos suele ser 0 real.
Se verificó con jugadores con muchas amarillas (aparecen los 1 correctamente); por eso
ahora los ceros se pintan atenuados, para que se distinga "cero de verdad" de un vistazo.

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
