# Apuestas — estadísticas de jugadores y equipos

Herramienta con **cinco modos de consulta** pensados para mercados de apuestas:

1. **Tiros por jugador** — tiros y tiros a puerta de un futbolista, partido a partido.
2. **Partidos de un equipo** — resultados recientes, forma, goles a favor/en contra y porterías a cero.
3. **Córners por partido** — córners que saca y concede un equipo en cada partido.
4. **Comparar dos equipos** — se escribe «América vs Tigres» y se enfrentan sus promedios
   (puntos, goles, córners, tiros, tiros a puerta y posesión) en barras cara a cara, más el
   historial de enfrentamientos directos.
5. **Partidos de hoy** — agenda agrupada por competición, con acceso directo al análisis
   y la proyección de cada encuentro.

> **Sobre los goles esperados (xG):** la API pública de ESPN **no los publica** — se
> comprobó buscando `expectedGoals`/`xG` en el resumen de partido, en el boxscore, en las
> estadísticas de jugador y en el marcador. No se inventa un xG estimado: la comparativa
> usa **tiros, tiros a puerta y posesión**, que son los datos reales de dominio que sí
> devuelve ESPN. Para xG de verdad haría falta otra fuente (FBref/Understat), que sí
> bloquean el acceso desde el navegador.

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

En cambio, **ESPN expone endpoints JSON públicos** que normalmente permiten la consulta
directa desde el navegador, aunque puede aplicar límites temporales por IP/User-Agent.
Endpoints usados:

| Para qué | Endpoint |
|---|---|
| Buscar jugador o equipo | `https://site.web.api.espn.com/apis/search/v2?query=NOMBRE&limit=10` (grupos `player` y `team`) |
| Partidos + estadísticas de un jugador | `https://site.web.api.espn.com/apis/common/v3/sports/soccer/athletes/ID/gamelog` |
| **Agenda diaria agrupada** | `https://site.api.espn.com/apis/v2/scoreboard/header?sport=soccer&dates=YYYYMMDD` |
| **Partidos de equipo con estadísticas** | `https://site.api.espn.com/apis/site/v2/sports/soccer/LIGA/scoreboard?dates=YYYYMMDD-YYYYMMDD&limit=300` |
| **Historial anual de un equipo** | `https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/ID/schedule?season=YYYY` |

### El truco para no hacer tantas peticiones

El **marcador** (`scoreboard`) es la clave: devuelve hasta **300 partidos con las
estadísticas de ambos equipos ya incluidas** —`wonCorners`, `totalShots`,
`shotsOnTarget`, `possessionPct`, `foulsCommitted`— en **una sola petición**. Antes los
córners se pedían con un `summary` por partido; ahora salen gratis con los goles.

Detalles medidos:

- El parámetro `limit` es obligatorio para pasar de 100 partidos, y el tope real es 300;
  si el rango de fechas es muy ancho, ESPN **corta por el principio y se pierden los
  partidos recientes**. Por eso se pide en **ventanas de 4 meses**, avanzando sólo hasta
  reunir la cantidad solicitada, y luego se fusionan los resultados sin duplicados.
- Un marcador vale para **todos los equipos de esa liga a la vez**: comparar dos rivales
  de la misma liga cuesta lo mismo que consultar uno solo para goles, córners, tiros y
  posesión. El historial H2H se obtiene aparte con seis calendarios anuales.
- Las ligas se eligen por **confederación**: a un equipo mexicano se le piden Concacaf
  Champions y Leagues Cup, no la Champions de Europa. Antes se pedían siempre las
  europeas, así que los partidos de Concachampions ni aparecían.
- En amistosos y rondas menores ESPN no publica estadísticas: esos partidos se muestran
  con «–» y no cuentan en las medias (la comparativa además excluye los amistosos).

### Enfrentamientos directos sin descargar seis años de ligas

El historial H2H usa `schedule` con el slug especial **`all`**. Una petición devuelve
todo el calendario del equipo para una temporada: liga, copas, torneos continentales y
amistosos. La app pide seis temporadas y filtra localmente los eventos cuyo rival tenga
el segundo id seleccionado.

Esto reemplaza una solución mucho más cara: seis años con `scoreboard` habrían sido 18
ventanas de cuatro meses multiplicadas por cada liga y copa, fácilmente más de 100
peticiones. Con `schedule` el coste es fijo: **6 peticiones**. En la prueba
América–Tigres se encontraron **15 cruces en seis temporadas**.

El calendario trae resultados, sede y competición, pero no córners ni tiros. Por eso
el comparador separa deliberadamente:

- **forma y promedios**, calculados con los últimos 5/10/15/20 partidos y `scoreboard`;
- **historial directo**, calculado con seis temporadas y `schedule`.

Los calendarios se piden en paralelo y se guardan en la caché de memoria. Durante la
misma sesión, volver a usar el mismo equipo como primer lado no repite esas peticiones.

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

## Versión web

La herramienta como página web, **sin servidor ni dependencias ni compilación**: HTML,
CSS y JavaScript de toda la vida. Abre `index.html` con doble clic (o sube la carpeta
gratis a GitHub Pages/Netlify). Funciona porque la API de ESPN envía
`Access-Control-Allow-Origin: *`, así que el navegador puede llamarla directamente sin
problema de CORS.

### Estructura

```
index.html          estructura de la página
styles.css          diseño (tokens, modo claro/oscuro automático, móvil)
js/config.js        URLs, competiciones, alias de países y ajustes de cada modo
js/formato.js       fechas, números y etiquetas en es-ES
js/logica.js        parseo, medias, comparación y lecturas — funciones puras, sin DOM ni red
js/api.js           llamadas a ESPN + caché de sesión
js/bd.js            base de datos local (IndexedDB): esquema, transacciones y consultas
js/repositorio.js   guardar y consultar el modelo: partidos, equipos, jugadores, eventos
js/datos.js         orquesta base + red: lee de local y pide a ESPN sólo lo que falta
js/ui.js            piezas de interfaz reutilizables (tarjetas, tablas, gráfico, tooltip)
js/vistas.js        arma cada una de las cuatro pantallas con esas piezas
js/app.js           controlador: estado, flujo y render
```

Son **scripts clásicos cargados en orden con `defer`**, no módulos ES: los módulos
(`import`/`export`) los bloquea el navegador al abrir un archivo con doble clic
(`file://`), y esa forma de usarlo no debía romperse. Para añadir un módulo nuevo basta
crear el archivo y añadir su `<script>` en `index.html` antes de `js/app.js`.

### Interfaz

La portada muestra **cinco tarjetas de modo** (tiros por jugador / partidos de un equipo /
córners por partido / comparar dos equipos / partidos de hoy); al elegir una se convierten en pestañas y
aparece el buscador con ejemplos clicables. Cada modo tiene **su propio color** (azul,
verde, naranja y violeta) que tiñe pestañas, botones e insignias — pero **nunca las
barras de los gráficos**: las series de datos usan siempre la misma rampa azul, validada
para daltonismo, para que un gráfico signifique lo mismo en todas las pantallas.

Cada vista incluye una tarjeta **«Lo que dicen los datos»**: frases derivadas de los
partidos descargados, siempre con el conteo a la vista para poder contrastarlas con la
tabla («Más de 9,5 córners totales en 7 de 10 (70%)», «5 partidos seguidos sin perder»,
«Tiró a puerta en 7 de 10 partidos»). Mientras cargan los datos se muestran bloques
grises con la forma del contenido, para que la página no dé saltos.
Cada vista incluye: cabecera con foto del jugador o escudo del equipo (con inicial de
reserva si la imagen no carga), tiles de promedios con barras de proporción, gráfico de
columnas apiladas con línea de media y tooltip, y tabla completa con chips de resultado
V/E/D, sede (casa/fuera), ceros atenuados y mini-barras en la columna clave. En modo
equipo la cabecera lleva además la **racha de forma** de los últimos 5 partidos.

La comparación incorpora un resumen H2H con partidos, victorias, empates, derrotas y
goles, seguido de los marcadores de las últimas seis temporadas. Si no existe ningún
cruce en ese periodo, se muestra un estado vacío en lugar de ocultar la sección. Las
tablas recientes de ambos equipos incluyen sede (C/F) y competición en cada partido.

Los modos de equipo incluyen un filtro **Local y visita / Solo local / Solo visita**.
Se aplica antes de seleccionar los últimos N partidos, por lo que vuelve a calcular
promedios, porcentajes, lecturas automáticas, forma, gráficas y tablas. Al buscar se
precargan hasta 60 partidos por equipo; después cambiar la cantidad o la sede **no hace
ninguna petición**: todo se filtra y recalcula en memoria. En la comparación, cada
perfil usa su propia condición de localía y el H2H se interpreta desde el primer equipo
escrito.

También existe un filtro local de **competición**. Sus opciones se construyen con los
partidos ya precargados y se aplican antes del filtro de sede y del recorte a los
últimos N; cambiarlo no genera llamadas a ESPN.

La vista **Partidos de hoy** utiliza una sola respuesta agrupada de ESPN para construir
la agenda por competición, con hora, estado en vivo/final, marcador y escudos. Su filtro
de competición funciona en memoria. Al elegir un encuentro, la aplicación identifica la
liga habitual de ambos clubes y reutiliza el comparador y el modal de proyección; esto
evita tratar una copa ocasional como si fuera toda la historia reciente del equipo. La
muestra se configura automáticamente con el equipo A como local y el B como visitante.

### Probabilidades, tendencia y distribución

Las vistas de tiros, goles y córners incorporan un panel analítico con línea
configurable. Para la serie filtrada muestra:

- frecuencia de cumplimiento y conteo visible (`7 de 10`, `70 %`);
- **cuota justa empírica** (`1 / frecuencia`), sin margen de casa;
- media simple y media ponderada, dando más peso a los partidos recientes;
- tendencia frente a la mitad anterior de la muestra;
- mediana, mínimo, máximo, desviación y volatilidad baja/media/alta.

En **Tiros por jugador** se puede cambiar el mercado entre tiros totales y tiros a
puerta. Cada mercado tiene sus propias líneas (1+, 2+, 3+ y 4+) y recalcula todo sin
volver a consultar ESPN. Un segundo panel muestra precisión de remate, conversión a
gol, goles por tiro a puerta, racha actual sobre la línea, partidos sin rematar y la
distribución de 0, 1, 2 o 3+ remates en la muestra seleccionada.

En el comparador, el botón **Ver proyección** abre un modal separado para no recargar la
pantalla principal. Dentro hay tres apartados —Goles, Córners y Tiros— que se muestran
uno a la vez, además de sus líneas configurables. La proyección cruza el ataque ponderado de un equipo con
la defensa ponderada del rival:

```text
goles de A = (goles marcados por A + goles recibidos por B) / 2
córners de A = (córners sacados por A + córners concedidos por B) / 2
tiros de A = (tiros realizados por A + tiros concedidos por B) / 2
```

Se calcula lo mismo para B y se muestran tiros totales y tiros a puerta por separado,
sus totales combinados, la frecuencia histórica de las líneas
configuradas de goles y córners y **ambos equipos marcan**, con su cuota justa empírica.
Todo responde a los filtros actuales de competición, sede y número de partidos.

> Estas cifras son resúmenes y estimaciones transparentes de la muestra, no xG ni
> probabilidades calibradas. La cuota justa sirve para comparar una frecuencia con una
> cuota ofrecida, pero todavía no sustituye un backtesting del modelo.

Al buscar un equipo se **prioriza la coincidencia exacta** y se ocultan los equipos
femeninos y juveniles salvo que se pidan, así que «américa vs chivas» resuelve solo
(América y Guadalajara) sin listas intermedias.

## Base de datos local (IndexedDB)

La aplicación **descarga de ESPN una sola vez y luego consulta su propia base**, que
vive en el navegador. Un partido ya jugado no cambia nunca, así que guardarlo es
seguro y elimina casi todo el tráfico.

### Esquema

Modelo normalizado: **el partido se guarda una vez**, en forma neutral (local y
visitante), y la vista de cada equipo se deriva al consultarlo.

| Almacén | Clave | Índices | Contiene |
|---|---|---|---|
| `ligas` | `slug` | — | Competiciones vistas (`mex.1`, `esp.1`, `uefa.champions`…) |
| `equipos` | `id` | `porLiga` | Nombre, abreviatura, escudo |
| `participaciones` | `[idEquipo, ligaSlug]` | `porLiga`, `porEquipo` | Qué equipo juega qué competición |
| `partidos` | `eventId` | `porFecha`, `porLigaFecha`, `porEquipo` | Fecha, liga, local/visitante y marcador |
| `estadisticas` | `[eventId, idEquipo]` | `porPartido`, `porEquipoFecha`, `porLigaFecha` | Córners, tiros, tiros a puerta, posesión, faltas, tarjetas |
| `eventos` | `id` | `porPartido`, `porJugador`, `porTipo` | Goles, penaltis, tarjetas y cambios, con minuto |
| `jugadores` | `id` | `porEquipo` | Nombre y posición |
| `actuaciones` | `[eventId, idJugador]` | `porPartido`, `porJugadorFecha`, `porEquipo` | Lo que hizo cada jugador en cada partido: tiros, goles, tarjetas |
| `cobertura` | `[ligaSlug, rango]` | `porLiga` | Qué rangos de fechas ya se han descargado |

Tres decisiones que hacen que esto funcione:

- **Índice `[idEquipo, fecha]` en `estadisticas`.** Los últimos N partidos de un equipo
  salen en **una sola consulta y ya ordenados**, sin recorrer nada ni ordenar en memoria.
  Medido: 5 partidos en **2,1 ms**.
- **`participaciones` como tabla de unión.** Un equipo juega liga, copa y continental;
  con esta tabla se puede preguntar «qué equipos tengo de la Liga MX» sin duplicar equipos.
- **`cobertura`.** Sin ella no se puede distinguir *«no hay partidos»* de *«no lo he
  descargado»*, y se acabaría pidiendo a ESPN igual que antes.

### Sobre los remates

**ESPN no publica remates individuales**: se comprobó que en el resumen de partido no
existen `shotData`, coordenadas, tipo de remate ni xG. Por eso **no hay una tabla
`remates`** que nunca podría llenarse. Los remates se guardan donde sí hay datos reales:

- **por equipo y partido** en `estadisticas` (`tiros`, `tirosPuerta`);
- **por jugador y partido** en `actuaciones` (los tiros de cada futbolista);
- y los que acabaron en gol, en `eventos`, con minuto y autor.

### Qué permite

Consultas que antes eran imposibles y ahora salen de local, sin red: ranking de córners
de una competición, porcentaje de partidos que superan una línea, histórico largo de un
equipo, o los remates de cada jugador en un partido concreto. En la prueba con datos
reales: 164 partidos de dos ligas guardados en **118 ms**, ocupando **448 KB**.

Si el navegador bloquea IndexedDB (modo privado, alguna configuración de Safari), la
aplicación lo detecta, lo dice en el pie y sigue funcionando contra la red como antes.

### Cómo se ahorran peticiones

Seis mecanismos, medidos con datos reales:

1. **La base local.** Lo ya descargado no se vuelve a pedir, ni siquiera tras cerrar el
   navegador. Sólo se refresca el tramo que llega hasta hoy, porque los partidos
   antiguos no cambian.
2. **Un marcador sirve para toda la liga.** Comparar dos rivales de la misma liga cuesta
   lo mismo que consultar uno solo.
3. **Precarga por ventanas.** Se piden tramos de 4 meses hasta reunir una reserva de
   hasta 60 partidos por equipo o alcanzar 12 meses. Esa carga ocurre una sola vez;
   cambiar entre 5/10/15/20 o todos/local/visita no vuelve a consultar ESPN.
4. **Caché de sesión.** Respuestas en memoria y búsquedas en `sessionStorage`.
5. **Lista de ligas muertas.** Si una liga responde 404 (no existe para ese país), se
   apunta y no se vuelve a pedir en toda la sesión.
6. **Calendario H2H anual.** Seis años de enfrentamientos cuestan seis peticiones fijas,
   no una descarga por cada competición y ventana de fechas.

La parte de estadísticas recientes mantiene la medición: **América vs Chivas con
«últimos 5» = 5 peticiones** (antes 10). La primera comparación añade las **6 peticiones
fijas** del historial; repetirla durante la sesión usa la caché. Bajo el buscador se
muestra siempre el coste total de la consulta.

> **Si ESPN te limita:** haciendo muchas consultas seguidas, ESPN/Akamai puede empezar a
> responder «Access Denied» (403). Se ha comprobado que el filtro mira el *User-Agent*:
> con muchas peticiones desde una misma IP puede rechazar las que parecen de navegador
> aunque `curl` siga recibiendo 200. La app lo detecta y lo dice explícitamente
> («No se pudo conectar con ESPN…»), en lugar de confundirlo con que no haya datos.
> Se pasa solo esperando un rato, y la base local es justo lo que evita provocarlo.

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
