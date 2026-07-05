"use strict";

/* ============================================================
   Configuracion
   ============================================================ */
const CONFIG = {
  buscadorBase: "https://site.web.api.espn.com",
  sitioBase: "https://site.api.espn.com",

  // Competiciones de seleccion (jugadores): ESPN no las lista en los filtros del club
  ligasSeleccion: [
    "fifa.world", "fifa.friendly", "uefa.euro", "uefa.nations",
    "conmebol.america", "concacaf.gold",
    "fifa.worldq.uefa", "fifa.worldq.conmebol", "fifa.worldq.concacaf",
  ],

  // Competiciones de club (equipos) ademas de su liga: europeas + mundiales
  ligasClubExtra: [
    "uefa.champions", "uefa.europa", "uefa.europa.conf", "uefa.super_cup",
    "club.friendly", "fifa.cwc",
  ],

  // Copas nacionales por prefijo de la liga por defecto ("esp.1" -> "esp").
  // Una liga inexistente simplemente devuelve error y se ignora.
  copasPorPais: {
    esp: ["esp.copa_del_rey", "esp.super_cup"],
    eng: ["eng.fa", "eng.league_cup"],
    ita: ["ita.coppa_italia", "ita.super_cup"],
    ger: ["ger.dfb_pokal", "ger.super_cup"],
    fra: ["fra.coupe_de_france", "fra.super_cup"],
    por: ["por.taca_de_portugal", "por.liga_cup"],
    ned: ["ned.knvb_cup"],
  },

  // El buscador de ESPN solo entiende nombres en ingles: alias para selecciones
  aliasEquipos: {
    "españa": "spain", "espana": "spain", "francia": "france", "alemania": "germany",
    "italia": "italy", "inglaterra": "england", "paises bajos": "netherlands",
    "holanda": "netherlands", "belgica": "belgium", "brasil": "brazil",
    "japon": "japan", "marruecos": "morocco", "croacia": "croatia",
    "suiza": "switzerland", "turquia": "turkey", "estados unidos": "usa",
    "escocia": "scotland", "gales": "wales", "irlanda": "ireland",
    "polonia": "poland", "suecia": "sweden", "noruega": "norway",
    "dinamarca": "denmark", "grecia": "greece", "republica checa": "czechia",
    "ucrania": "ukraine", "egipto": "egypt", "camerun": "cameroon",
    "argelia": "algeria", "tunez": "tunisia", "arabia saudita": "saudi arabia",
    "corea del sur": "south korea", "costa de marfil": "ivory coast",
  },
};

/* ============================================================
   Api — llamadas a ESPN (sin logica de negocio)
   ============================================================ */
const Api = {
  /** Busca jugadores ("player") o equipos ("team") por nombre. Solo futbol:
      el buscador de ESPN tambien devuelve equipos de rugby, cricket, etc. */
  async buscar(nombre, tipo) {
    const url = `${CONFIG.buscadorBase}/apis/search/v2?query=${encodeURIComponent(nombre)}&limit=10`;
    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error(`ESPN respondió ${respuesta.status} al buscar`);
    const datos = await respuesta.json();
    const grupo = (datos.results || []).find((g) => g.type === tipo);
    return (grupo ? grupo.contents || [] : []).filter((c) => c.sport === "soccer");
  },

  async gamelog(idAtleta, liga) {
    const parametro = liga ? `?league=${encodeURIComponent(liga)}` : "";
    const url = `${CONFIG.buscadorBase}/apis/common/v3/sports/soccer/athletes/${idAtleta}/gamelog${parametro}`;
    return this._jsonOpcional(url);
  },

  /** Calendario de un equipo en una liga y temporada. Null si no hay datos. */
  async calendario(idEquipo, liga, temporada) {
    const url = `${CONFIG.sitioBase}/apis/site/v2/sports/soccer/${encodeURIComponent(liga)}/teams/${idEquipo}/schedule?season=${temporada}`;
    return this._jsonOpcional(url);
  },

  /** Resumen de un partido (trae los corners en el boxscore). Null si falla. */
  async resumenPartido(liga, idEvento) {
    const url = `${CONFIG.sitioBase}/apis/site/v2/sports/soccer/${encodeURIComponent(liga)}/summary?event=${idEvento}`;
    return this._jsonOpcional(url);
  },

  /** GET que devuelve null en vez de lanzar: para sondear ligas opcionales. */
  async _jsonOpcional(url) {
    try {
      const respuesta = await fetch(url);
      if (!respuesta.ok) return null;
      return await respuesta.json();
    } catch {
      return null;
    }
  },
};

/* ============================================================
   Logica — parseo y combinacion (funciones puras, sin DOM)
   ============================================================ */
const Logica = {
  /** Extrae el id de un uid tipo "s:600~a:362150" (a = atleta, t = equipo). */
  idDesdeUid(uid, letra = "a") {
    const coincidencia = new RegExp(`${letra}:(\\d+)`).exec(uid || "");
    return coincidencia ? coincidencia[1] : null;
  },

  /** Minusculas y sin acentos, para comparar nombres escritos en español. */
  normalizar(texto) {
    return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  },

  /** "españa" -> "spain": el buscador de ESPN solo entiende ingles. */
  aliasDeBusqueda(nombre) {
    return CONFIG.aliasEquipos[this.normalizar(nombre)] || nombre;
  },

  /** Una seleccion nacional tiene como liga por defecto una competicion
      de selecciones (fifa.world, uefa.euro.u19, ...), nunca una liga de club. */
  esSeleccion(ligaPorDefecto) {
    return /^(fifa\.|uefa\.euro|uefa\.nations|conmebol\.|concacaf\.)/.test(ligaPorDefecto || "");
  },

  /** Temporadas a consultar: la actual y la anterior (año de inicio). */
  temporadas(hoy = new Date()) {
    const año = hoy.getFullYear();
    return [año, año - 1];
  },

  /** Convierte una respuesta de gamelog en filas partido + estadisticas. */
  parsearPartidos(datos) {
    if (!datos || !datos.events) return [];
    const posicion = {};
    (datos.names || []).forEach((nombre, i) => { posicion[nombre] = i; });
    const stat = (stats, nombre) => {
      const valor = nombre in posicion ? Number(stats[posicion[nombre]]) : 0;
      return Number.isFinite(valor) ? valor : 0;
    };

    const filas = [];
    for (const temporada of datos.seasonTypes || []) {
      for (const categoria of temporada.categories || []) {
        for (const evento of categoria.events || []) {
          const meta = datos.events[String(evento.eventId)];
          if (!meta) continue;
          filas.push({
            eventId: String(evento.eventId),
            fecha: new Date(meta.gameDate),
            rival: meta.opponent?.displayName || "?",
            competicion: meta.leagueName || "",
            resultado: meta.gameResult || "",
            marcador: meta.score || "",
            goles: stat(evento.stats, "totalGoals"),
            asistencias: stat(evento.stats, "goalAssists"),
            tiros: stat(evento.stats, "totalShots"),
            tirosPuerta: stat(evento.stats, "shotsOnTarget"),
            amarillas: stat(evento.stats, "yellowCards"),
          });
        }
      }
    }
    return filas;
  },

  /** Convierte un calendario de equipo en filas de partidos ya jugados. */
  parsearCalendario(datos, idEquipo, ligaConsultada) {
    if (!datos || !datos.events) return [];
    const filas = [];
    for (const evento of datos.events) {
      const competicion = evento.competitions?.[0];
      if (!competicion?.status?.type?.completed) continue;
      const equipos = competicion.competitors || [];
      const mio = equipos.find((c) => String(c.team?.id) === String(idEquipo));
      const rival = equipos.find((c) => String(c.team?.id) !== String(idEquipo));
      if (!mio || !rival) continue;
      const golesFavor = Number(mio.score?.value ?? mio.score);
      const golesContra = Number(rival.score?.value ?? rival.score);
      if (!Number.isFinite(golesFavor) || !Number.isFinite(golesContra)) continue;
      filas.push({
        eventId: String(evento.id),
        fecha: new Date(evento.date),
        competicion: evento.league?.abbreviation || evento.league?.name || "",
        ligaSlug: evento.league?.slug || ligaConsultada,
        rival: rival.team?.displayName || "?",
        enCasa: mio.homeAway === "home",
        golesFavor,
        golesContra,
        resultado: golesFavor > golesContra ? "W" : golesFavor < golesContra ? "L" : "D",
      });
    }
    return filas;
  },

  /** Ligas listadas en los filtros de un gamelog (las del club del jugador). */
  ligasDelClub(datos) {
    const filtro = (datos.filters || []).find((f) => f.name === "league");
    if (!filtro) return { porDefecto: null, otras: [] };
    return {
      porDefecto: filtro.value || null,
      otras: (filtro.options || []).map((opcion) => opcion.value),
    };
  },

  /** Ligas a consultar para un equipo. Club: la suya + copas del pais +
      europeas. Seleccion: mundial, amistosos, torneos y eliminatorias. */
  ligasDeEquipo(ligaPorDefecto) {
    if (this.esSeleccion(ligaPorDefecto)) {
      return [...new Set([ligaPorDefecto, ...CONFIG.ligasSeleccion].filter(Boolean))];
    }
    const pais = (ligaPorDefecto || "").split(".")[0];
    const copas = CONFIG.copasPorPais[pais] || [];
    return [...new Set([ligaPorDefecto, ...copas, ...CONFIG.ligasClubExtra].filter(Boolean))];
  },

  /** Quita duplicados por id de partido y ordena del mas reciente al mas viejo. */
  combinar(listasDeFilas) {
    const vistos = new Set();
    return listasDeFilas
      .flat()
      .sort((a, b) => b.fecha - a.fecha)
      .filter((fila) => !vistos.has(fila.eventId) && vistos.add(fila.eventId));
  },

  /** Promedios y conteos de tiros de un jugador. */
  resumenJugador(partidos) {
    const n = partidos.length;
    const suma = (clave) => partidos.reduce((total, p) => total + p[clave], 0);
    const conteo = (predicado) => partidos.filter(predicado).length;
    return {
      n,
      promedioTiros: n ? suma("tiros") / n : 0,
      promedioPuerta: n ? suma("tirosPuerta") / n : 0,
      goles: suma("goles"),
      asistencias: suma("asistencias"),
      conUnTiro: conteo((p) => p.tiros >= 1),
      conUnTiroPuerta: conteo((p) => p.tirosPuerta >= 1),
    };
  },

  /** Balance y goles de un equipo. */
  resumenEquipo(partidos) {
    const n = partidos.length;
    const suma = (clave) => partidos.reduce((total, p) => total + p[clave], 0);
    return {
      n,
      victorias: partidos.filter((p) => p.resultado === "W").length,
      empates: partidos.filter((p) => p.resultado === "D").length,
      derrotas: partidos.filter((p) => p.resultado === "L").length,
      mediaFavor: n ? suma("golesFavor") / n : 0,
      mediaContra: n ? suma("golesContra") / n : 0,
      mediaTotal: n ? (suma("golesFavor") + suma("golesContra")) / n : 0,
      porteriasCero: partidos.filter((p) => p.golesContra === 0).length,
    };
  },

  /** Saca los corners de ambos equipos del resumen de un partido. */
  extraerCorners(datos, idEquipo) {
    const equipos = datos?.boxscore?.teams || [];
    const corners = (equipo) => {
      const stat = (equipo?.statistics || []).find((s) => s.name === "wonCorners");
      return stat ? Number(stat.displayValue) : NaN;
    };
    const mio = equipos.find((e) => String(e.team?.id) === String(idEquipo));
    const rival = equipos.find((e) => String(e.team?.id) !== String(idEquipo));
    const favor = corners(mio);
    const contra = corners(rival);
    return Number.isFinite(favor) && Number.isFinite(contra) ? { favor, contra } : null;
  },

  /** Medias de corners sobre los partidos que si tienen datos. */
  resumenCorners(filas, cache) {
    const conDatos = filas.filter((f) => cache.get(f.eventId));
    const n = conDatos.length;
    const suma = (selector) => conDatos.reduce((total, f) => total + selector(cache.get(f.eventId)), 0);
    return {
      n,
      sinDatos: filas.length - n,
      mediaFavor: n ? suma((c) => c.favor) / n : 0,
      mediaContra: n ? suma((c) => c.contra) / n : 0,
      mediaTotal: n ? suma((c) => c.favor + c.contra) / n : 0,
      conDiezMas: conDatos.filter((f) => {
        const c = cache.get(f.eventId);
        return c.favor + c.contra >= 10;
      }).length,
    };
  },
};

/* ============================================================
   Formato — fechas, numeros y resultados en es-ES
   ============================================================ */
const Formato = {
  numero: (valor) => valor.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 2 }),
  fechaCorta: (fecha) => fecha.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }),
  fechaLarga: (fecha) => fecha.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }),

  /** ESPN devuelve W/D/L; en español V (victoria) / E (empate) / D (derrota). */
  resultado(codigo) {
    const mapa = {
      W: { texto: "V", clase: "chip-v" },
      D: { texto: "E", clase: "chip-e" },
      L: { texto: "D", clase: "chip-d" },
      T: { texto: "E", clase: "chip-e" },
    };
    return mapa[codigo] || { texto: codigo || "–", clase: "chip-e" };
  },

  fotoJugador: (id) => `https://a.espncdn.com/i/headshots/soccer/players/full/${id}.png`,

  /** Traduce los subtitulos en ingles que ESPN pone a las selecciones. */
  subtitulo(texto) {
    const mapa = {
      "Men's soccer team": "Selección masculina",
      "Women's soccer team": "Selección femenina",
    };
    return mapa[texto] || texto || "";
  },
};

/* ============================================================
   UI — construccion del DOM (siempre textContent, nunca innerHTML
   con datos de la API)
   ============================================================ */
const UI = {
  /** Crea un elemento: el("div", { class: "x" }, [hijos o textos]). */
  el(etiqueta, atributos = {}, hijos = []) {
    const nodo = document.createElement(etiqueta);
    for (const [clave, valor] of Object.entries(atributos)) nodo.setAttribute(clave, valor);
    for (const hijo of hijos) nodo.append(hijo); // string -> nodo de texto (seguro)
    return nodo;
  },

  refs: {
    hero: () => document.getElementById("hero"),
    modos: () => document.getElementById("modos"),
    formulario: () => document.getElementById("formulario"),
    entrada: () => document.getElementById("entrada-nombre"),
    selector: () => document.getElementById("selector-partidos"),
    boton: () => document.getElementById("boton-buscar"),
    estado: () => document.getElementById("estado"),
    candidatos: () => document.getElementById("candidatos"),
    resultados: () => document.getElementById("resultados"),
    tooltip: () => document.getElementById("tooltip"),
  },

  mostrarEstado(mensaje, esError = false, cargando = false) {
    const nodo = this.refs.estado();
    nodo.textContent = mensaje;
    nodo.classList.toggle("error", esError);
    nodo.classList.toggle("cargando", cargando);
    nodo.hidden = !mensaje;
  },

  limpiar() {
    this.refs.candidatos().replaceChildren();
    this.refs.resultados().replaceChildren();
  },

  /** Marca el modo activo y compacta el hero + las tarjetas en pastillas. */
  activarModo(modo, placeholder) {
    this.refs.hero().classList.add("compacto");
    this.refs.modos().classList.add("compacto");
    for (const boton of this.refs.modos().querySelectorAll(".modo")) {
      boton.classList.toggle("activo", boton.dataset.modo === modo);
    }
    const formulario = this.refs.formulario();
    formulario.hidden = false;
    this.refs.entrada().placeholder = placeholder;
    this.refs.entrada().focus();
  },

  /** Foto/escudo con inicial de reserva si la imagen no carga. */
  avatar(url, nombre, opciones = {}) {
    const clases = ["avatar", opciones.escudo ? "escudo" : "", opciones.grande ? "grande" : ""].filter(Boolean);
    const contenedor = this.el("span", { class: clases.join(" ") });
    const reserva = () => contenedor.replaceChildren(
      this.el("span", { class: "monograma" }, [(nombre || "?").trim().charAt(0).toUpperCase()])
    );
    if (url) {
      const imagen = this.el("img", { src: url, alt: "" });
      imagen.addEventListener("error", reserva);
      contenedor.append(imagen);
    } else {
      reserva();
    }
    return contenedor;
  },

  renderCandidatos(candidatos, tipo, alElegir) {
    const lista = candidatos.map((candidato) => {
      const url = tipo === "player"
        ? Formato.fotoJugador(Logica.idDesdeUid(candidato.uid, "a"))
        : candidato.image?.default;
      return this.el("button", { type: "button" }, [
        this.avatar(url, candidato.displayName, { escudo: tipo === "team" }),
        this.el("span", { class: "cand-texto" }, [
          this.el("span", {}, [candidato.displayName]),
          this.el("span", { class: "sub" }, [Formato.subtitulo(candidato.subtitle)]),
        ]),
        this.el("span", { class: "liga" }, [candidato.description || ""]),
      ]);
    });
    lista.forEach((boton, i) => boton.addEventListener("click", () => alElegir(candidatos[i])));
    this.refs.candidatos().replaceChildren(...lista);
  },

  /* ---------- Piezas compartidas ---------- */

  fichaCabecera({ avatarUrl, escudo, nombre, descripcion, derecha = [] }) {
    return this.el("div", { class: "tarjeta ficha" }, [
      this.avatar(avatarUrl, nombre, { escudo, grande: true }),
      this.el("div", {}, [
        this.el("div", { class: "ficha-nombre" }, [nombre]),
        this.el("div", { class: "ficha-desc" }, [descripcion]),
      ]),
      this.el("div", { class: "ficha-derecha" }, derecha),
    ]);
  },

  rapido(valor, etiqueta) {
    return this.el("div", { class: "rapido" }, [
      this.el("div", { class: "rapido-valor" }, [String(valor)]),
      this.el("div", { class: "rapido-etiqueta" }, [etiqueta]),
    ]);
  },

  /** Racha de forma: fichas V/E/D de los ultimos partidos (izq = mas viejo). */
  tiraForma(partidos, cuantos = 5) {
    const fichas = [...partidos.slice(0, cuantos)].reverse().map((p) => {
      const res = Formato.resultado(p.resultado);
      return this.el("span", { class: `chip ${res.clase}`, title: `vs ${p.rival} (${p.golesFavor}-${p.golesContra})` }, [res.texto]);
    });
    return this.el("div", { class: "forma" }, [
      this.el("span", { class: "forma-etiqueta" }, ["Forma"]),
      ...fichas,
    ]);
  },

  tiles(definiciones) {
    const tile = ({ etiqueta, valor, contexto, proporcion = null }) => {
      const hijos = [
        this.el("div", { class: "etiqueta" }, [etiqueta]),
        this.el("div", { class: "valor" }, [valor]),
        this.el("div", { class: "contexto" }, [contexto]),
      ];
      if (proporcion !== null) {
        hijos.push(this.el("div", { class: "meter" }, [
          this.el("div", { class: "relleno", style: `width:${Math.round(proporcion * 100)}%` }),
        ]));
      }
      return this.el("div", { class: "tile" }, hijos);
    };
    return this.el("div", { class: "tiles" }, definiciones.map(tile));
  },

  /** Celda numerica; los ceros se atenuan para que destaque lo demas. */
  celdaNum(valor, extra = "") {
    const clase = `num${extra ? ` ${extra}` : ""}`;
    if (valor === 0) return this.el("td", { class: clase }, [this.el("span", { class: "cero" }, ["0"])]);
    return this.el("td", { class: clase }, [String(valor)]);
  },

  /** Celda con mini-barra proporcional al maximo de la columna. */
  celdaBarra(valor, maximo) {
    return this.el("td", { class: "num destacado" }, [
      this.el("span", { class: "celda-barra" }, [
        this.el("span", { class: "pista" }, [
          this.el("span", { class: "relleno", style: `width:${(valor / Math.max(1, maximo)) * 100}%;display:block` }),
        ]),
        String(valor),
      ]),
    ]);
  },

  celdaSede(enCasa) {
    return this.el("td", {}, [
      this.el("span", { class: "sede", title: enCasa ? "En casa" : "Fuera" }, [enCasa ? "C" : "F"]),
    ]);
  },

  /* ---------- Grafico de columnas apiladas (generico) ----------
     filas: [{ fecha, azul, claro, tooltip: { titulo, sub, lineas: [[color, valor, texto]] } }]
     El azul es la metrica principal (abajo), el claro la secundaria (arriba). */
  tarjetaGrafico({ titulo, leyendaAzul, leyendaClaro, media, etiquetaMedia, filas }) {
    const cronologico = [...filas].reverse(); // izquierda = mas viejo, derecha = mas reciente
    const maximo = Math.max(1, ...cronologico.map((f) => f.azul + f.claro));
    const techo = Math.ceil(maximo / 2) * 2; // eje con numeros limpios (pares)

    const grafico = this.el("div", { class: "grafico" });

    // Gridlines horizontales con su tick; los pasos siempre dividen el techo
    const pasos = techo <= 4 ? techo : (techo % 4 === 0 ? 4 : techo % 3 === 0 ? 3 : 2);
    for (let i = 0; i <= pasos; i++) {
      const valor = (techo / pasos) * i;
      grafico.append(this.el("div", {
        class: valor === 0 ? "gridline base" : "gridline",
        style: `bottom:${(valor / techo) * 100}%`,
      }, [
        this.el("span", { class: "tick" }, [String(valor)]),
      ]));
    }

    // Linea de referencia con la media
    if (media !== null && cronologico.length > 1) {
      const altura = Math.min(100, (media / techo) * 100);
      grafico.append(
        this.el("div", { class: "linea-media", style: `bottom:${altura}%` }),
        this.el("span", { class: "etiqueta-media", style: `bottom:calc(${altura}% + 3px)` }, [etiquetaMedia]),
      );
    }

    const columnas = this.el("div", { class: "columnas" });
    const saltarEtiquetas = cronologico.length > 12; // con muchas columnas, fecha si / fecha no
    cronologico.forEach((fila, i) => {
      const pila = this.el("div", { class: "pila" });
      if (fila.claro > 0) {
        pila.append(this.el("div", { class: "segmento seg-claro", style: `height:${(fila.claro / techo) * 100}%` }));
      }
      if (fila.azul > 0) {
        const clase = fila.claro > 0 ? "segmento seg-azul" : "segmento seg-azul tope";
        pila.append(this.el("div", { class: clase, style: `height:${(fila.azul / techo) * 100}%` }));
      }

      const hit = this.el("div", {
        class: "hit", tabindex: "0", role: "img",
        "aria-label": `${fila.tooltip.titulo}. ${fila.tooltip.sub}`,
      });
      this.conectarTooltip(hit, fila.tooltip);

      const ocultarFecha = saltarEtiquetas && (cronologico.length - 1 - i) % 2 !== 0;
      columnas.append(this.el("div", { class: "columna" }, [
        pila,
        hit,
        this.el("div", { class: ocultarFecha ? "etiqueta-x oculta" : "etiqueta-x" }, [Formato.fechaCorta(fila.fecha)]),
      ]));
    });
    grafico.append(columnas);

    const leyenda = this.el("div", { class: "leyenda" }, [
      this.el("span", { class: "clave" }, [this.el("span", { class: "muestra", style: "background:var(--acento)" }), leyendaAzul]),
      this.el("span", { class: "clave" }, [this.el("span", { class: "muestra", style: "background:var(--serie-clara)" }), leyendaClaro]),
    ]);

    return this.el("div", { class: "tarjeta grafico-envoltura" }, [
      this.el("div", { class: "tarjeta-cabecera" }, [this.el("h2", {}, [titulo]), leyenda]),
      grafico,
    ]);
  },

  conectarTooltip(hit, contenido) {
    const tooltip = this.refs.tooltip();
    const fila = ([color, valor, etiqueta]) =>
      this.el("div", { class: "fila" }, [
        this.el("span", { class: "clave-linea", style: `background:${color}` }),
        this.el("strong", {}, [String(valor)]),
        this.el("span", {}, [etiqueta]),
      ]);
    const mostrar = () => {
      tooltip.replaceChildren(
        this.el("div", { class: "titulo" }, [contenido.titulo]),
        this.el("div", { class: "sub" }, [contenido.sub]),
        ...contenido.lineas.map(fila),
      );
      tooltip.style.display = "block";
    };
    const mover = (evento) => {
      const margen = 12;
      const ancho = tooltip.offsetWidth, alto = tooltip.offsetHeight;
      let x = evento.clientX + margen, y = evento.clientY - alto - margen;
      if (x + ancho > window.innerWidth - 8) x = evento.clientX - ancho - margen;
      if (y < 8) y = evento.clientY + margen;
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
    };
    const ocultar = () => { tooltip.style.display = "none"; };

    hit.addEventListener("pointerenter", mostrar);
    hit.addEventListener("pointermove", mover);
    hit.addEventListener("pointerleave", ocultar);
    hit.addEventListener("focus", () => {
      mostrar();
      const caja = hit.getBoundingClientRect();
      mover({ clientX: caja.left + caja.width / 2, clientY: caja.top });
    });
    hit.addEventListener("blur", ocultar);
  },

  /* ============================================================
     Vista 1 — tiros por jugador
     ============================================================ */
  vistaJugador(jugador, idJugador, partidos) {
    const resumen = Logica.resumenJugador(partidos);

    const cabecera = this.fichaCabecera({
      avatarUrl: Formato.fotoJugador(idJugador),
      escudo: false,
      nombre: jugador.displayName,
      descripcion: [jugador.subtitle, jugador.description, `últimos ${resumen.n} partidos`].filter(Boolean).join(" · "),
      derecha: [
        this.rapido(resumen.goles, resumen.goles === 1 ? "gol" : "goles"),
        this.rapido(resumen.asistencias, resumen.asistencias === 1 ? "asistencia" : "asistencias"),
      ],
    });

    const tiles = this.tiles([
      { etiqueta: "Tiros por partido", valor: Formato.numero(resumen.promedioTiros), contexto: `últimos ${resumen.n} partidos` },
      { etiqueta: "Tiros a puerta por partido", valor: Formato.numero(resumen.promedioPuerta), contexto: `últimos ${resumen.n} partidos` },
      { etiqueta: "Partidos con 1+ tiro", valor: `${resumen.conUnTiro}/${resumen.n}`, contexto: "tiro de cualquier tipo", proporcion: resumen.n ? resumen.conUnTiro / resumen.n : 0 },
      { etiqueta: "Partidos con 1+ tiro a puerta", valor: `${resumen.conUnTiroPuerta}/${resumen.n}`, contexto: "tiro entre los tres palos", proporcion: resumen.n ? resumen.conUnTiroPuerta / resumen.n : 0 },
    ]);

    const grafico = this.tarjetaGrafico({
      titulo: "Tiros por partido",
      leyendaAzul: "A puerta",
      leyendaClaro: "Fuera / bloqueado",
      media: resumen.promedioTiros,
      etiquetaMedia: `media ${Formato.numero(resumen.promedioTiros)}`,
      filas: partidos.map((p) => ({
        fecha: p.fecha,
        azul: p.tirosPuerta,
        claro: p.tiros - p.tirosPuerta,
        tooltip: {
          titulo: `vs ${p.rival}`,
          sub: `${Formato.fechaLarga(p.fecha)} · ${p.competicion} · ${Formato.resultado(p.resultado).texto} ${p.marcador}`,
          lineas: [
            ["var(--acento)", p.tirosPuerta, "tiros a puerta"],
            ["var(--serie-clara)", p.tiros - p.tirosPuerta, "fuera / bloqueados"],
            ["transparent", p.tiros, "tiros totales"],
          ],
        },
      })),
    });

    const maxTiros = Math.max(1, ...partidos.map((p) => p.tiros));
    const cabeceraTabla = this.el("tr", {}, [
      ...["Fecha", "Rival", "Competición", "Res", "Marcador"].map((t) => this.el("th", {}, [t])),
      ...["G", "A", "Tiros", "A puerta", "TA"].map((t) => this.el("th", { class: "num" }, [t])),
    ]);
    const filasTabla = partidos.map((p) => {
      const res = Formato.resultado(p.resultado);
      return this.el("tr", {}, [
        this.el("td", { class: "tenue" }, [Formato.fechaLarga(p.fecha)]),
        this.el("td", {}, [p.rival]),
        this.el("td", { class: "tenue" }, [p.competicion]),
        this.el("td", {}, [this.el("span", { class: `chip ${res.clase}` }, [res.texto])]),
        this.el("td", { class: "tenue" }, [p.marcador]),
        this.celdaNum(p.goles),
        this.celdaNum(p.asistencias),
        this.celdaBarra(p.tiros, maxTiros),
        this.celdaNum(p.tirosPuerta, "destacado"),
        this.celdaNum(p.amarillas),
      ]);
    });
    const tabla = this.el("div", { class: "tarjeta" }, [
      this.el("div", { class: "tarjeta-cabecera" }, [
        this.el("h2", {}, [`Últimos ${partidos.length} partidos de ${jugador.displayName}`]),
      ]),
      this.el("div", { class: "tabla-envoltura" }, [
        this.el("table", {}, [this.el("thead", {}, [cabeceraTabla]), this.el("tbody", {}, filasTabla)]),
      ]),
    ]);

    this.refs.resultados().replaceChildren(cabecera, tiles, grafico, tabla);
  },

  /* ============================================================
     Vista 2 — partidos recientes de un equipo
     ============================================================ */
  vistaPartidos(equipo, partidos) {
    const resumen = Logica.resumenEquipo(partidos);

    const cabecera = this.fichaCabecera({
      avatarUrl: equipo.image?.default,
      escudo: true,
      nombre: equipo.displayName,
      descripcion: [Formato.subtitulo(equipo.subtitle), `últimos ${resumen.n} partidos · todas las competiciones`].filter(Boolean).join(" · "),
      derecha: [this.tiraForma(partidos)],
    });

    const tiles = this.tiles([
      { etiqueta: "Balance V-E-D", valor: `${resumen.victorias}-${resumen.empates}-${resumen.derrotas}`, contexto: `últimos ${resumen.n} partidos` },
      { etiqueta: "Goles a favor", valor: Formato.numero(resumen.mediaFavor), contexto: "por partido" },
      { etiqueta: "Goles en contra", valor: Formato.numero(resumen.mediaContra), contexto: "por partido" },
      { etiqueta: "Porterías a cero", valor: `${resumen.porteriasCero}/${resumen.n}`, contexto: "partidos sin encajar", proporcion: resumen.n ? resumen.porteriasCero / resumen.n : 0 },
    ]);

    const grafico = this.tarjetaGrafico({
      titulo: "Goles por partido",
      leyendaAzul: "A favor",
      leyendaClaro: "En contra",
      media: resumen.mediaTotal,
      etiquetaMedia: `media ${Formato.numero(resumen.mediaTotal)} goles`,
      filas: partidos.map((p) => ({
        fecha: p.fecha,
        azul: p.golesFavor,
        claro: p.golesContra,
        tooltip: {
          titulo: `vs ${p.rival}`,
          sub: `${Formato.fechaLarga(p.fecha)} · ${p.competicion} · ${p.enCasa ? "en casa" : "fuera"}`,
          lineas: [
            ["var(--acento)", p.golesFavor, "goles a favor"],
            ["var(--serie-clara)", p.golesContra, "goles en contra"],
            ["transparent", p.golesFavor + p.golesContra, "goles en el partido"],
          ],
        },
      })),
    });

    const maxGoles = Math.max(1, ...partidos.map((p) => p.golesFavor + p.golesContra));
    const cabeceraTabla = this.el("tr", {}, [
      ...["Fecha", "Rival", "Competición", "Sede", "Res", "Marcador"].map((t) => this.el("th", {}, [t])),
      this.el("th", { class: "num" }, ["Goles"]),
    ]);
    const filasTabla = partidos.map((p) => {
      const res = Formato.resultado(p.resultado);
      return this.el("tr", {}, [
        this.el("td", { class: "tenue" }, [Formato.fechaLarga(p.fecha)]),
        this.el("td", {}, [p.rival]),
        this.el("td", { class: "tenue" }, [p.competicion]),
        this.celdaSede(p.enCasa),
        this.el("td", {}, [this.el("span", { class: `chip ${res.clase}` }, [res.texto])]),
        this.el("td", { class: "destacado" }, [`${p.golesFavor}-${p.golesContra}`]),
        this.celdaBarra(p.golesFavor + p.golesContra, maxGoles),
      ]);
    });
    const tabla = this.el("div", { class: "tarjeta" }, [
      this.el("div", { class: "tarjeta-cabecera" }, [
        this.el("h2", {}, [`Últimos ${partidos.length} partidos de ${equipo.displayName}`]),
      ]),
      this.el("div", { class: "tabla-envoltura" }, [
        this.el("table", {}, [this.el("thead", {}, [cabeceraTabla]), this.el("tbody", {}, filasTabla)]),
      ]),
    ]);

    this.refs.resultados().replaceChildren(cabecera, tiles, grafico, tabla);
  },

  /* ============================================================
     Vista 3 — corners de un equipo
     ============================================================ */
  vistaCorners(equipo, partidos, cache) {
    const resumen = Logica.resumenCorners(partidos, cache);
    const corners = (p) => cache.get(p.eventId);

    const cabecera = this.fichaCabecera({
      avatarUrl: equipo.image?.default,
      escudo: true,
      nombre: equipo.displayName,
      descripcion: [Formato.subtitulo(equipo.subtitle), `córners de los últimos ${partidos.length} partidos`].filter(Boolean).join(" · "),
      derecha: [this.tiraForma(partidos)],
    });

    const contexto = `sobre ${resumen.n} partidos con datos`;
    const tiles = this.tiles([
      { etiqueta: "Córners a favor", valor: Formato.numero(resumen.mediaFavor), contexto: `por partido · ${contexto}` },
      { etiqueta: "Córners concedidos", valor: Formato.numero(resumen.mediaContra), contexto: `por partido · ${contexto}` },
      { etiqueta: "Córners totales", valor: Formato.numero(resumen.mediaTotal), contexto: `por partido · ${contexto}` },
      { etiqueta: "Partidos con 10+ córners", valor: `${resumen.conDiezMas}/${resumen.n}`, contexto: "total del partido", proporcion: resumen.n ? resumen.conDiezMas / resumen.n : 0 },
    ]);

    const conDatos = partidos.filter((p) => corners(p));
    const grafico = this.tarjetaGrafico({
      titulo: "Córners por partido",
      leyendaAzul: "A favor",
      leyendaClaro: "Concedidos",
      media: resumen.mediaTotal,
      etiquetaMedia: `media ${Formato.numero(resumen.mediaTotal)}`,
      filas: conDatos.map((p) => {
        const c = corners(p);
        return {
          fecha: p.fecha,
          azul: c.favor,
          claro: c.contra,
          tooltip: {
            titulo: `vs ${p.rival}`,
            sub: `${Formato.fechaLarga(p.fecha)} · ${p.competicion} · ${Formato.resultado(p.resultado).texto} ${p.golesFavor}-${p.golesContra}`,
            lineas: [
              ["var(--acento)", c.favor, "córners a favor"],
              ["var(--serie-clara)", c.contra, "concedidos"],
              ["transparent", c.favor + c.contra, "córners totales"],
            ],
          },
        };
      }),
    });

    const maxTotal = Math.max(1, ...conDatos.map((p) => { const c = corners(p); return c.favor + c.contra; }));
    const cabeceraTabla = this.el("tr", {}, [
      ...["Fecha", "Rival", "Competición", "Sede", "Res", "Marcador"].map((t) => this.el("th", {}, [t])),
      ...["A favor", "Concedidos", "Total"].map((t) => this.el("th", { class: "num" }, [t])),
    ]);
    const filasTabla = partidos.map((p) => {
      const res = Formato.resultado(p.resultado);
      const c = corners(p);
      return this.el("tr", {}, [
        this.el("td", { class: "tenue" }, [Formato.fechaLarga(p.fecha)]),
        this.el("td", {}, [p.rival]),
        this.el("td", { class: "tenue" }, [p.competicion]),
        this.celdaSede(p.enCasa),
        this.el("td", {}, [this.el("span", { class: `chip ${res.clase}` }, [res.texto])]),
        this.el("td", { class: "tenue" }, [`${p.golesFavor}-${p.golesContra}`]),
        ...(c
          ? [this.celdaNum(c.favor), this.celdaNum(c.contra), this.celdaBarra(c.favor + c.contra, maxTotal)]
          : [this.el("td", { class: "num tenue" }, ["–"]), this.el("td", { class: "num tenue" }, ["–"]), this.el("td", { class: "num tenue" }, ["–"])]),
      ]);
    });

    const piezasTabla = [
      this.el("div", { class: "tarjeta-cabecera" }, [
        this.el("h2", {}, [`Córners de los últimos ${partidos.length} partidos de ${equipo.displayName}`]),
      ]),
      this.el("div", { class: "tabla-envoltura" }, [
        this.el("table", {}, [this.el("thead", {}, [cabeceraTabla]), this.el("tbody", {}, filasTabla)]),
      ]),
    ];
    if (resumen.sinDatos > 0) {
      piezasTabla.push(this.el("p", { class: "nota" }, [
        `ESPN no publica córners de ${resumen.sinDatos} de estos partidos (amistosos o rondas menores); no cuentan en las medias.`,
      ]));
    }

    this.refs.resultados().replaceChildren(cabecera, tiles, grafico, this.el("div", { class: "tarjeta" }, piezasTabla));
  },
};

/* ============================================================
   App — controlador: estado + flujo
   ============================================================ */
const App = {
  estado: {
    modo: null,             // "tiros" | "partidos" | "corners"
    jugador: null,          // candidato elegido en el buscador
    idJugador: null,
    partidosJugador: [],    // cache: cambiar N no refetchea
    equipo: null,
    idEquipo: null,
    partidosEquipo: [],
    corners: new Map(),     // eventId -> { favor, contra } | null (sin datos)
  },

  placeholders: {
    tiros: "Nombre del jugador, ej: Lamine Yamal",
    partidos: "Equipo o selección, ej: Real Madrid, España",
    corners: "Equipo o selección, ej: Real Madrid, España",
  },

  init() {
    for (const boton of UI.refs.modos().querySelectorAll(".modo")) {
      boton.addEventListener("click", () => this.seleccionarModo(boton.dataset.modo));
    }
    UI.refs.formulario().addEventListener("submit", (evento) => {
      evento.preventDefault();
      this.buscar(UI.refs.entrada().value.trim());
    });
    UI.refs.selector().addEventListener("change", () => this.render());
  },

  seleccionarModo(modo) {
    if (this.estado.modo === modo) return;
    this.estado.modo = modo;
    UI.activarModo(modo, this.placeholders[modo]);
    UI.mostrarEstado("");
    UI.limpiar();
    this.render(); // si ya hay datos en cache para este modo, se pintan directamente
  },

  buscar(nombre) {
    if (!nombre) return;
    return this.estado.modo === "tiros" ? this.buscarComo(nombre, "player") : this.buscarComo(nombre, "team");
  },

  async buscarComo(nombre, tipo) {
    UI.limpiar();
    UI.refs.boton().disabled = true;
    UI.mostrarEstado(`Buscando "${nombre}"…`, false, true);
    try {
      // "españa" -> "spain", etc.: los equipos se buscan con su nombre en ingles
      const consulta = tipo === "team" ? Logica.aliasDeBusqueda(nombre) : nombre;
      const candidatos = await Api.buscar(consulta, tipo);
      if (!candidatos.length) {
        const que = tipo === "player" ? "jugador" : "equipo";
        UI.mostrarEstado(`No se encontró ningún ${que} con el nombre "${nombre}".`, true);
        return;
      }
      if (candidatos.length === 1) {
        await this.elegir(candidatos[0]);
        return;
      }
      UI.mostrarEstado("Se encontraron varios resultados — elige uno:");
      UI.renderCandidatos(candidatos, tipo, (candidato) => this.elegir(candidato));
    } catch (error) {
      UI.mostrarEstado(`Error al buscar: ${error.message}`, true);
    } finally {
      UI.refs.boton().disabled = false;
    }
  },

  elegir(candidato) {
    return this.estado.modo === "tiros" ? this.elegirJugador(candidato) : this.elegirEquipo(candidato);
  },

  async elegirJugador(candidato) {
    const idAtleta = Logica.idDesdeUid(candidato.uid, "a");
    if (!idAtleta) {
      UI.mostrarEstado("No se pudo obtener el id de este jugador.", true);
      return;
    }
    UI.limpiar();
    UI.mostrarEstado(`Descargando partidos de ${candidato.displayName}…`, false, true);
    try {
      // 1. Gamelog por defecto: trae la liga del club + la lista de sus otras competiciones
      const base = await Api.gamelog(idAtleta, null);
      if (!base) {
        UI.mostrarEstado("ESPN no tiene partidos registrados para este jugador.", true);
        return;
      }
      const { porDefecto, otras } = Logica.ligasDelClub(base);

      // 2. El resto de competiciones (club + seleccion) en paralelo
      const pendientes = [...new Set([...otras, ...CONFIG.ligasSeleccion])].filter((liga) => liga !== porDefecto);
      const respuestas = await Promise.all(pendientes.map((liga) => Api.gamelog(idAtleta, liga)));

      // 3. Combinar todo
      this.estado.jugador = candidato;
      this.estado.idJugador = idAtleta;
      this.estado.partidosJugador = Logica.combinar([base, ...respuestas].map((datos) => Logica.parsearPartidos(datos)));

      if (!this.estado.partidosJugador.length) {
        UI.mostrarEstado("ESPN no tiene estadísticas de partidos para este jugador.", true);
        return;
      }
      UI.mostrarEstado("");
      this.render();
    } catch (error) {
      UI.mostrarEstado(`Error al descargar los partidos: ${error.message}`, true);
    }
  },

  async elegirEquipo(candidato) {
    const idEquipo = Logica.idDesdeUid(candidato.uid, "t");
    if (!idEquipo) {
      UI.mostrarEstado("No se pudo obtener el id de este equipo.", true);
      return;
    }
    UI.limpiar();
    UI.mostrarEstado(`Descargando partidos de ${candidato.displayName}…`, false, true);
    try {
      // Todas las combinaciones liga x temporada en paralelo; las que fallan se ignoran
      const ligas = Logica.ligasDeEquipo(candidato.defaultLeagueSlug);
      const temporadas = Logica.temporadas();
      const consultas = [];
      for (const liga of ligas) {
        for (const temporada of temporadas) {
          consultas.push(
            Api.calendario(idEquipo, liga, temporada)
              .then((datos) => Logica.parsearCalendario(datos, idEquipo, liga))
          );
        }
      }
      const listas = await Promise.all(consultas);

      this.estado.equipo = candidato;
      this.estado.idEquipo = idEquipo;
      this.estado.partidosEquipo = Logica.combinar(listas);
      this.estado.corners = new Map(); // equipo nuevo: cache de corners fuera

      if (!this.estado.partidosEquipo.length) {
        UI.mostrarEstado("ESPN no tiene partidos recientes para este equipo.", true);
        return;
      }
      UI.mostrarEstado("");
      this.render();
    } catch (error) {
      UI.mostrarEstado(`Error al descargar los partidos: ${error.message}`, true);
    }
  },

  /** Descarga los corners que falten para las filas visibles (con cache). */
  async asegurarCorners(filas) {
    const pendientes = filas.filter((fila) => !this.estado.corners.has(fila.eventId));
    if (!pendientes.length) return;
    UI.mostrarEstado(`Descargando córners de ${pendientes.length} partidos…`, false, true);
    await Promise.all(pendientes.map(async (fila) => {
      const resumen = await Api.resumenPartido(fila.ligaSlug, fila.eventId);
      this.estado.corners.set(fila.eventId, Logica.extraerCorners(resumen, this.estado.idEquipo));
    }));
    UI.mostrarEstado("");
  },

  render() {
    const { modo } = this.estado;
    const cuantos = Number(UI.refs.selector().value);

    if (modo === "tiros" && this.estado.jugador && this.estado.partidosJugador.length) {
      UI.vistaJugador(this.estado.jugador, this.estado.idJugador, this.estado.partidosJugador.slice(0, cuantos));
    } else if (modo === "partidos" && this.estado.equipo && this.estado.partidosEquipo.length) {
      UI.vistaPartidos(this.estado.equipo, this.estado.partidosEquipo.slice(0, cuantos));
    } else if (modo === "corners" && this.estado.equipo && this.estado.partidosEquipo.length) {
      const filas = this.estado.partidosEquipo.slice(0, cuantos);
      this.asegurarCorners(filas)
        .then(() => UI.vistaCorners(this.estado.equipo, filas, this.estado.corners))
        .catch((error) => UI.mostrarEstado(`Error al descargar los córners: ${error.message}`, true));
    }
  },
};

if (typeof document !== "undefined") App.init();
