"use strict";

/* ============================================================
   Configuracion
   ============================================================ */
const CONFIG = {
  apiBase: "https://site.web.api.espn.com",
  // Competiciones de seleccion: ESPN no las lista en los filtros del club
  ligasSeleccion: [
    "fifa.world", "fifa.friendly", "uefa.euro", "uefa.nations",
    "conmebol.america", "concacaf.gold",
    "fifa.worldq.uefa", "fifa.worldq.conmebol", "fifa.worldq.concacaf",
  ],
};

/* ============================================================
   Api — llamadas a ESPN (sin logica de negocio)
   ============================================================ */
const Api = {
  async buscarJugadores(nombre) {
    const url = `${CONFIG.apiBase}/apis/search/v2?query=${encodeURIComponent(nombre)}&limit=10`;
    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error(`ESPN respondió ${respuesta.status} al buscar`);
    const datos = await respuesta.json();
    const grupo = (datos.results || []).find((g) => g.type === "player");
    return grupo ? grupo.contents || [] : [];
  },

  async gamelog(idAtleta, liga) {
    const parametro = liga ? `?league=${encodeURIComponent(liga)}` : "";
    const url = `${CONFIG.apiBase}/apis/common/v3/sports/soccer/athletes/${idAtleta}/gamelog${parametro}`;
    try {
      const respuesta = await fetch(url);
      if (!respuesta.ok) return null; // liga sin datos para este jugador: se ignora
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
  /** Extrae el id de atleta de un uid tipo "s:600~a:362150". */
  idDesdeUid(uid) {
    const coincidencia = /a:(\d+)/.exec(uid || "");
    return coincidencia ? coincidencia[1] : null;
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

  /** Ligas listadas en los filtros de la respuesta (las del club). */
  ligasDelClub(datos) {
    const filtro = (datos.filters || []).find((f) => f.name === "league");
    if (!filtro) return { porDefecto: null, otras: [] };
    return {
      porDefecto: filtro.value || null,
      otras: (filtro.options || []).map((opcion) => opcion.value),
    };
  },

  /** Quita duplicados por id de partido y ordena del mas reciente al mas viejo. */
  combinar(listasDeFilas) {
    const vistos = new Set();
    return listasDeFilas
      .flat()
      .sort((a, b) => b.fecha - a.fecha)
      .filter((fila) => !vistos.has(fila.eventId) && vistos.add(fila.eventId));
  },

  /** Promedios y conteos sobre los partidos mostrados. */
  resumen(partidos) {
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
    const mapa = { W: { texto: "V", clase: "chip-v" }, D: { texto: "E", clase: "chip-e" }, L: { texto: "D", clase: "chip-d" }, T: { texto: "E", clase: "chip-e" } };
    return mapa[codigo] || { texto: codigo || "–", clase: "chip-e" };
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
    formulario: () => document.getElementById("formulario"),
    entrada: () => document.getElementById("entrada-nombre"),
    selector: () => document.getElementById("selector-partidos"),
    boton: () => document.getElementById("boton-buscar"),
    estado: () => document.getElementById("estado"),
    vacio: () => document.getElementById("vacio"),
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
    this.refs.vacio().hidden = true;
    this.refs.candidatos().replaceChildren();
    this.refs.resultados().replaceChildren();
  },

  renderCandidatos(candidatos, alElegir) {
    const lista = candidatos.map((candidato) =>
      this.el("button", { type: "button" }, [
        this.el("span", {}, [candidato.displayName]),
        this.el("span", { class: "liga" }, [candidato.description || ""]),
      ])
    );
    lista.forEach((boton, i) => boton.addEventListener("click", () => alElegir(candidatos[i])));
    this.refs.candidatos().replaceChildren(...lista);
  },

  renderResultados(jugador, partidos) {
    const resumen = Logica.resumen(partidos);
    this.refs.resultados().replaceChildren(
      this.cabeceraJugador(jugador, resumen),
      this.tiles(resumen),
      this.tarjetaGrafico(partidos, resumen),
      this.tarjetaTabla(jugador, partidos),
    );
  },

  /* ---------- Cabecera del jugador ---------- */
  cabeceraJugador(jugador, resumen) {
    const rapido = (valor, etiqueta) =>
      this.el("div", { class: "rapido" }, [
        this.el("div", { class: "rapido-valor" }, [String(valor)]),
        this.el("div", { class: "rapido-etiqueta" }, [etiqueta]),
      ]);
    return this.el("div", { class: "tarjeta jugador-cabecera" }, [
      this.el("div", {}, [
        this.el("div", { class: "jugador-nombre" }, [jugador.displayName]),
        this.el("div", { class: "jugador-desc" }, [
          [jugador.description, `últimos ${resumen.n} partidos · todas las competiciones`]
            .filter(Boolean).join(" · "),
        ]),
      ]),
      this.el("div", { class: "rapidos" }, [
        rapido(resumen.goles, resumen.goles === 1 ? "gol" : "goles"),
        rapido(resumen.asistencias, resumen.asistencias === 1 ? "asistencia" : "asistencias"),
      ]),
    ]);
  },

  /* ---------- Fila de tiles ---------- */
  tiles(resumen) {
    const tile = (etiqueta, valor, contexto, proporcion = null) => {
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
    return this.el("div", { class: "tiles" }, [
      tile("Tiros por partido", Formato.numero(resumen.promedioTiros), `últimos ${resumen.n} partidos`),
      tile("Tiros a puerta por partido", Formato.numero(resumen.promedioPuerta), `últimos ${resumen.n} partidos`),
      tile("Partidos con 1+ tiro", `${resumen.conUnTiro}/${resumen.n}`, "tiro de cualquier tipo", resumen.n ? resumen.conUnTiro / resumen.n : 0),
      tile("Partidos con 1+ tiro a puerta", `${resumen.conUnTiroPuerta}/${resumen.n}`, "tiro entre los tres palos", resumen.n ? resumen.conUnTiroPuerta / resumen.n : 0),
    ]);
  },

  /* ---------- Grafico de columnas apiladas (a puerta / fuera) ---------- */
  tarjetaGrafico(partidos, resumen) {
    const cronologico = [...partidos].reverse(); // izquierda = mas viejo, derecha = mas reciente
    const maximo = Math.max(1, ...cronologico.map((p) => p.tiros));
    const techo = Math.ceil(maximo / 2) * 2; // eje con numeros limpios (pares)

    const grafico = this.el("div", { class: "grafico" });

    // Gridlines horizontales con su tick; los pasos siempre dividen el techo
    const pasos = techo <= 4 ? techo : (techo % 4 === 0 ? 4 : techo % 3 === 0 ? 3 : 2);
    for (let i = 0; i <= pasos; i++) {
      const valor = (techo / pasos) * i;
      const linea = this.el("div", {
        class: valor === 0 ? "gridline base" : "gridline",
        style: `bottom:${(valor / techo) * 100}%`,
      }, [
        this.el("span", { class: "tick" }, [String(valor)]),
      ]);
      grafico.append(linea);
    }

    // Linea de referencia: media de tiros en los partidos mostrados
    if (resumen.n > 1) {
      const alturaMedia = (resumen.promedioTiros / techo) * 100;
      grafico.append(
        this.el("div", { class: "linea-media", style: `bottom:${alturaMedia}%` }),
        this.el("span", { class: "etiqueta-media", style: `bottom:calc(${alturaMedia}% + 3px)` },
          [`media ${Formato.numero(resumen.promedioTiros)}`]),
      );
    }

    const columnas = this.el("div", { class: "columnas" });
    const saltarEtiquetas = cronologico.length > 12; // con muchas columnas, fecha si / fecha no
    cronologico.forEach((partido, i) => {
      const fuera = partido.tiros - partido.tirosPuerta;
      const pila = this.el("div", { class: "pila" });
      if (fuera > 0) {
        pila.append(this.el("div", {
          class: "segmento seg-fuera",
          style: `height:${(fuera / techo) * 100}%`,
        }));
      }
      if (partido.tirosPuerta > 0) {
        const clase = fuera > 0 ? "segmento seg-puerta" : "segmento seg-puerta tope";
        pila.append(this.el("div", { class: clase, style: `height:${(partido.tirosPuerta / techo) * 100}%` }));
      }

      const hit = this.el("div", { class: "hit", tabindex: "0", role: "img", "aria-label": this.textoTooltip(partido) });
      this.conectarTooltip(hit, partido);

      const ocultarFecha = saltarEtiquetas && (cronologico.length - 1 - i) % 2 !== 0;
      columnas.append(this.el("div", { class: "columna" }, [
        pila,
        hit,
        this.el("div", { class: ocultarFecha ? "etiqueta-x oculta" : "etiqueta-x" }, [Formato.fechaCorta(partido.fecha)]),
      ]));
    });
    grafico.append(columnas);

    const leyenda = this.el("div", { class: "leyenda" }, [
      this.el("span", { class: "clave" }, [this.el("span", { class: "muestra", style: "background:var(--acento)" }), "A puerta"]),
      this.el("span", { class: "clave" }, [this.el("span", { class: "muestra", style: "background:var(--serie-fuera)" }), "Fuera / bloqueado"]),
    ]);

    return this.el("div", { class: "tarjeta grafico-envoltura" }, [
      this.el("div", { class: "tarjeta-cabecera" }, [
        this.el("h2", {}, ["Tiros por partido"]),
        leyenda,
      ]),
      grafico,
    ]);
  },

  textoTooltip(partido) {
    return `vs ${partido.rival}, ${Formato.fechaLarga(partido.fecha)}: ${partido.tiros} tiros, ${partido.tirosPuerta} a puerta`;
  },

  conectarTooltip(hit, partido) {
    const tooltip = this.refs.tooltip();
    const fila = (color, valor, etiqueta) =>
      this.el("div", { class: "fila" }, [
        this.el("span", { class: "clave-linea", style: `background:${color}` }),
        this.el("strong", {}, [String(valor)]),
        this.el("span", {}, [etiqueta]),
      ]);
    const mostrar = () => {
      tooltip.replaceChildren(
        this.el("div", { class: "titulo" }, [`vs ${partido.rival}`]),
        this.el("div", { class: "sub" }, [`${Formato.fechaLarga(partido.fecha)} · ${partido.competicion} · ${Formato.resultado(partido.resultado).texto} ${partido.marcador}`]),
        fila("var(--acento)", partido.tirosPuerta, "tiros a puerta"),
        fila("var(--serie-fuera)", partido.tiros - partido.tirosPuerta, "fuera / bloqueados"),
        fila("transparent", partido.tiros, "tiros totales"),
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

  /* ---------- Tabla de partidos ---------- */
  tarjetaTabla(jugador, partidos) {
    const maxTiros = Math.max(1, ...partidos.map((p) => p.tiros));
    const cabecera = this.el("tr", {}, [
      ...["Fecha", "Rival", "Competición", "Res", "Marcador"].map((texto) => this.el("th", {}, [texto])),
      ...["G", "A", "Tiros", "A puerta", "TA"].map((texto) => this.el("th", { class: "num" }, [texto])),
    ]);
    const celdaTiros = (tiros) =>
      this.el("td", { class: "num destacado" }, [
        this.el("span", { class: "celda-barra" }, [
          this.el("span", { class: "pista" }, [
            this.el("span", { class: "relleno", style: `width:${(tiros / maxTiros) * 100}%;display:block` }),
          ]),
          String(tiros),
        ]),
      ]);
    const filas = partidos.map((partido) => {
      const res = Formato.resultado(partido.resultado);
      return this.el("tr", {}, [
        this.el("td", { class: "tenue" }, [Formato.fechaLarga(partido.fecha)]),
        this.el("td", {}, [partido.rival]),
        this.el("td", { class: "tenue" }, [partido.competicion]),
        this.el("td", {}, [this.el("span", { class: `chip ${res.clase}` }, [res.texto])]),
        this.el("td", { class: "tenue" }, [partido.marcador]),
        this.el("td", { class: "num" }, [String(partido.goles)]),
        this.el("td", { class: "num" }, [String(partido.asistencias)]),
        celdaTiros(partido.tiros),
        this.el("td", { class: "num destacado" }, [String(partido.tirosPuerta)]),
        this.el("td", { class: "num" }, [String(partido.amarillas)]),
      ]);
    });
    return this.el("div", { class: "tarjeta" }, [
      this.el("div", { class: "tarjeta-cabecera" }, [
        this.el("h2", {}, [`Últimos ${partidos.length} partidos de ${jugador.displayName}`]),
      ]),
      this.el("div", { class: "tabla-envoltura" }, [
        this.el("table", {}, [this.el("thead", {}, [cabecera]), this.el("tbody", {}, filas)]),
      ]),
    ]);
  },
};

/* ============================================================
   App — controlador: estado + flujo
   ============================================================ */
const App = {
  estado: {
    jugador: null,     // candidato elegido { displayName, uid, ... }
    partidos: [],      // todas las filas combinadas (cache: cambiar N no refetchea)
  },

  init() {
    UI.refs.formulario().addEventListener("submit", (evento) => {
      evento.preventDefault();
      this.buscar(UI.refs.entrada().value.trim());
    });
    UI.refs.selector().addEventListener("change", () => this.render());
    document.querySelectorAll(".sugerencias button").forEach((boton) => {
      boton.addEventListener("click", () => {
        UI.refs.entrada().value = boton.textContent;
        this.buscar(boton.textContent);
      });
    });
  },

  async buscar(nombre) {
    if (!nombre) return;
    UI.limpiar();
    UI.refs.boton().disabled = true;
    UI.mostrarEstado(`Buscando "${nombre}"…`, false, true);
    try {
      const candidatos = await Api.buscarJugadores(nombre);
      if (!candidatos.length) {
        UI.mostrarEstado(`No se encontró ningún jugador con el nombre "${nombre}".`, true);
        return;
      }
      if (candidatos.length === 1) {
        await this.elegir(candidatos[0]);
        return;
      }
      UI.mostrarEstado("Se encontraron varios jugadores — elige uno:");
      UI.renderCandidatos(candidatos, (candidato) => this.elegir(candidato));
    } catch (error) {
      UI.mostrarEstado(`Error al buscar: ${error.message}`, true);
    } finally {
      UI.refs.boton().disabled = false;
    }
  },

  async elegir(candidato) {
    const idAtleta = Logica.idDesdeUid(candidato.uid);
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
      this.estado.partidos = Logica.combinar([base, ...respuestas].map((datos) => Logica.parsearPartidos(datos)));

      if (!this.estado.partidos.length) {
        UI.mostrarEstado("ESPN no tiene estadísticas de partidos para este jugador.", true);
        return;
      }
      UI.mostrarEstado("");
      this.render();
    } catch (error) {
      UI.mostrarEstado(`Error al descargar los partidos: ${error.message}`, true);
    }
  },

  render() {
    if (!this.estado.jugador || !this.estado.partidos.length) return;
    const cuantos = Number(UI.refs.selector().value);
    UI.renderResultados(this.estado.jugador, this.estado.partidos.slice(0, cuantos));
  },
};

if (typeof document !== "undefined") App.init();
