"use strict";

/* ============================================================
   UI — piezas de interfaz reutilizables
   Regla: siempre textContent (nunca innerHTML con datos de la API).
   ============================================================ */
const UI = {
  /** Crea un elemento: el("div", { class: "x" }, [hijos o textos]). */
  el(etiqueta, atributos = {}, hijos = []) {
    const nodo = document.createElement(etiqueta);
    for (const [clave, valor] of Object.entries(atributos)) nodo.setAttribute(clave, valor);
    for (const hijo of hijos) nodo.append(hijo); // string -> nodo de texto (seguro)
    return nodo;
  },

  /** Icono SVG a partir de una lista de trazados. */
  icono(trazados, tamaño = 16) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", tamaño);
    svg.setAttribute("height", tamaño);
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.9");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    for (const d of trazados) {
      const trazado = document.createElementNS("http://www.w3.org/2000/svg", "path");
      trazado.setAttribute("d", d);
      svg.append(trazado);
    }
    return svg;
  },

  refs: {
    cuerpo: () => document.body,
    hero: () => document.getElementById("hero"),
    modos: () => document.getElementById("modos"),
    formulario: () => document.getElementById("formulario"),
    entrada: () => document.getElementById("entrada-nombre"),
    selector: () => document.getElementById("selector-partidos"),
    selectorSede: () => document.getElementById("selector-sede"),
    selectorCompeticion: () => document.getElementById("selector-competicion"),
    selectorMetricaTiros: () => document.getElementById("selector-metrica-tiros"),
    selectorLinea: () => document.getElementById("selector-linea"),
    botonProyeccion: () => document.getElementById("boton-proyeccion"),
    modalProyeccion: () => document.getElementById("modal-proyeccion"),
    cerrarProyeccion: () => document.getElementById("cerrar-proyeccion"),
    tabsProyeccion: () => document.querySelectorAll(".modal-tab"),
    controlLineaGoles: () => document.getElementById("control-linea-goles"),
    controlLineaCorners: () => document.getElementById("control-linea-corners"),
    selectorProyeccionGoles: () => document.getElementById("selector-proyeccion-goles"),
    selectorProyeccionCorners: () => document.getElementById("selector-proyeccion-corners"),
    contenidoProyeccion: () => document.getElementById("contenido-proyeccion"),
    boton: () => document.getElementById("boton-buscar"),
    ejemplos: () => document.getElementById("ejemplos"),
    estado: () => document.getElementById("estado"),
    estadoBase: () => document.getElementById("estado-base"),
    candidatos: () => document.getElementById("candidatos"),
    resultados: () => document.getElementById("resultados"),
    tooltip: () => document.getElementById("tooltip"),
  },

  /* ---------- Estado de la pagina ---------- */

  mostrarEstado(mensaje, { error = false, cargando = false } = {}) {
    const nodo = this.refs.estado();
    nodo.textContent = mensaje;
    nodo.classList.toggle("error", error);
    nodo.classList.toggle("cargando", cargando);
    nodo.hidden = !mensaje;
  },

  limpiar() {
    this.refs.candidatos().replaceChildren();
    this.refs.resultados().replaceChildren();
  },

  /** Qué hay guardado en la base local, en el pie de la página. */
  mostrarBase({ activa, partidos = 0, equipos = 0, usados = 0 }) {
    const nodo = this.refs.estadoBase();
    if (!nodo) return;
    if (!activa) {
      nodo.textContent = "Base local no disponible en este navegador — se consulta siempre a ESPN.";
      return;
    }
    if (!partidos) {
      nodo.textContent = "Base local activa · vacía todavía.";
      return;
    }
    const mb = usados / 1024 / 1024;
    const tamaño = mb >= 0.1 ? `${mb.toFixed(1)} MB` : `${Math.round(usados / 1024)} KB`;
    nodo.textContent = `Base local: ${partidos} partidos y ${equipos} equipos guardados (${tamaño}).`;
  },

  /** Bloques grises mientras llegan los datos: la página no salta al cargar. */
  mostrarEsqueleto() {
    const bloque = (clase) => this.el("div", { class: `esqueleto ${clase}` });
    this.refs.resultados().replaceChildren(
      bloque("esqueleto-ficha"),
      this.el("div", { class: "tiles" }, [bloque("esqueleto-tile"), bloque("esqueleto-tile"), bloque("esqueleto-tile"), bloque("esqueleto-tile")]),
      bloque("esqueleto-grafico"),
    );
  },

  /** Modo activo: compacta la portada y tiñe la interfaz con su color. */
  activarModo(modo) {
    const ajustes = CONFIG.modos[modo];
    this.refs.cuerpo().dataset.modo = modo;
    this.refs.hero().classList.add("compacto");
    this.refs.modos().classList.add("compacto");
    for (const boton of this.refs.modos().querySelectorAll(".modo")) {
      const activo = boton.dataset.modo === modo;
      boton.classList.toggle("activo", activo);
      boton.setAttribute("aria-pressed", String(activo));
    }
    this.refs.formulario().hidden = modo === "hoy";
    this.refs.selectorSede().hidden = ajustes.tipo === "player";
    const opcionPartido = this.refs.selectorSede().querySelector('option[value="partido"]');
    opcionPartido.hidden = modo !== "comparar";
    if (modo !== "comparar" && this.refs.selectorSede().value === "partido") this.refs.selectorSede().value = "todos";
    this.refs.selectorMetricaTiros().hidden = modo !== "tiros";
    this.configurarLineas(modo);
    this.refs.botonProyeccion().hidden = modo !== "comparar";
    if (modo !== "comparar" && this.refs.modalProyeccion().open) this.refs.modalProyeccion().close();
    this.refs.entrada().placeholder = ajustes.placeholder;
    if (modo !== "hoy") this.refs.entrada().focus();
  },

  configurarLineas(modo) {
    const principal = this.refs.selectorLinea();
    const aPuerta = modo === "tiros" && this.refs.selectorMetricaTiros().value === "tirosPuerta";
    const opciones = modo === "tiros"
      ? aPuerta
        ? [[0.5, "1+ a puerta"], [1.5, "2+ a puerta"], [2.5, "3+ a puerta"], [3.5, "4+ a puerta"]]
        : [[0.5, "1+ tiros"], [1.5, "2+ tiros"], [2.5, "3+ tiros"], [3.5, "4+ tiros"]]
      : modo === "corners"
        ? [[8.5, "Más de 8,5 córners"], [9.5, "Más de 9,5 córners"], [10.5, "Más de 10,5 córners"], [11.5, "Más de 11,5 córners"]]
        : [[1.5, "Más de 1,5 goles"], [2.5, "Más de 2,5 goles"], [3.5, "Más de 3,5 goles"]];
    const llenar = (select, items, elegido) => {
      select.replaceChildren(...items.map(([valor, texto]) => this.el("option", { value: valor }, [texto])));
      select.value = String(elegido);
    };
    principal.hidden = modo === "comparar";
    llenar(principal, opciones, modo === "tiros" ? (aPuerta ? 0.5 : 1.5) : modo === "corners" ? 9.5 : 2.5);
  },

  actualizarCompeticiones(filas) {
    const select = this.refs.selectorCompeticion();
    const anterior = select.value;
    const nombres = [...new Set(filas.map((fila) => fila.competicion).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "es"));
    select.replaceChildren(
      this.el("option", { value: "todos" }, ["Todas las competiciones"]),
      ...nombres.map((nombre) => this.el("option", { value: nombre }, [nombre])),
    );
    select.value = nombres.includes(anterior) ? anterior : "todos";
  },

  /** Atajos de ejemplo bajo el buscador, para no empezar con la página vacía. */
  renderEjemplos(modo, alPulsar) {
    const botones = CONFIG.modos[modo].ejemplos.map((texto) => {
      const boton = this.el("button", { type: "button", class: "ejemplo" }, [texto]);
      boton.addEventListener("click", () => alPulsar(texto));
      return boton;
    });
    this.refs.ejemplos().replaceChildren(
      this.el("span", { class: "ejemplos-etiqueta" }, ["Prueba con"]),
      ...botones,
    );
  },

  /* ---------- Piezas basicas ---------- */

  /** Foto/escudo con inicial de reserva si la imagen no carga. */
  avatar(url, nombre, { escudo = false, grande = false } = {}) {
    const clases = ["avatar", escudo ? "escudo" : "", grande ? "grande" : ""].filter(Boolean);
    const contenedor = this.el("span", { class: clases.join(" ") });
    const reserva = () => contenedor.replaceChildren(
      this.el("span", { class: "monograma" }, [(nombre || "?").trim().charAt(0).toUpperCase()])
    );
    if (url) {
      const imagen = this.el("img", { src: url, alt: "", loading: "lazy" });
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

  /** Tarjeta con cabecera (titulo + algo a la derecha) y contenido. */
  tarjeta(titulo, contenido, { derecha = null, clase = "" } = {}) {
    const piezas = [];
    if (titulo || derecha) {
      piezas.push(this.el("div", { class: "tarjeta-cabecera" }, [
        this.el("h2", {}, [titulo || ""]),
        ...(derecha ? [derecha] : []),
      ]));
    }
    piezas.push(...(Array.isArray(contenido) ? contenido : [contenido]));
    return this.el("div", { class: `tarjeta ${clase}`.trim() }, piezas);
  },

  fichaCabecera({ avatarUrl, escudo, nombre, descripcion, etiqueta = null, derecha = [] }) {
    const titulo = [this.el("span", { class: "ficha-nombre" }, [nombre])];
    if (etiqueta) titulo.push(this.el("span", { class: "insignia" }, [etiqueta]));
    return this.el("div", { class: "tarjeta ficha" }, [
      this.avatar(avatarUrl, nombre, { escudo, grande: true }),
      this.el("div", { class: "ficha-texto" }, [
        this.el("div", { class: "ficha-titulo" }, titulo),
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
      return this.el("span", {
        class: `chip ${res.clase}`,
        title: `${res.nombre} vs ${p.rival} (${p.golesFavor}-${p.golesContra})`,
      }, [res.texto]);
    });
    return this.el("div", { class: "forma" }, [
      this.el("span", { class: "forma-etiqueta" }, ["Forma"]),
      ...fichas,
    ]);
  },

  /** Fila de tiles. Cada uno: { etiqueta, valor, contexto, proporcion?, tono? } */
  tiles(definiciones) {
    const tile = ({ etiqueta, valor, contexto, proporcion = null, tono = "" }) => {
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
      return this.el("div", { class: `tile ${tono}`.trim() }, hijos);
    };
    return this.el("div", { class: "tiles" }, definiciones.map(tile));
  },

  /** Tarjeta de lecturas: lo que dicen los datos, en frases contrastables. */
  tarjetaLecturas(lecturas) {
    if (!lecturas.length) return [];
    const marca = {
      bueno: ["M20 6L9 17l-5-5"],
      malo: ["M18 6L6 18", "M6 6l12 12"],
      acento: ["M12 2l2.4 7.4H22l-6 4.6 2.3 7.4-6.3-4.6L5.7 21.4 8 14 2 9.4h7.6z"],
      neutro: ["M5 12h14"],
    };
    const filas = lecturas.map(({ texto, tono }) =>
      this.el("li", { class: `lectura ${tono}` }, [
        this.el("span", { class: "lectura-marca" }, [this.icono(marca[tono] || marca.neutro, 14)]),
        this.el("span", {}, [texto]),
      ])
    );
    return [this.tarjeta("Lo que dicen los datos", this.el("ul", { class: "lecturas" }, filas))];
  },

  /* ---------- Celdas de tabla ---------- */

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

  celdaResultado(codigo) {
    const res = Formato.resultado(codigo);
    return this.el("td", {}, [this.el("span", { class: `chip ${res.clase}`, title: res.nombre }, [res.texto])]);
  },

  /** Tabla completa: cabeceras (texto o {texto, num:true}) + filas ya creadas. */
  tabla(cabeceras, filas, { clase = "" } = {}) {
    const encabezado = this.el("tr", {}, cabeceras.map((c) => {
      const { texto, num } = typeof c === "string" ? { texto: c, num: false } : c;
      return this.el("th", num ? { class: "num" } : {}, [texto]);
    }));
    return this.el("div", { class: "tabla-envoltura" }, [
      this.el("table", clase ? { class: clase } : {}, [
        this.el("thead", {}, [encabezado]),
        this.el("tbody", {}, filas),
      ]),
    ]);
  },

  /* ---------- Grafico de columnas apiladas (generico) ----------
     filas: [{ fecha, azul, claro, tooltip: { titulo, sub, lineas } }]
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
      }, [this.el("span", { class: "tick" }, [String(valor)])]));
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
        pila.append(this.el("div", { class: "segmento seg-clara", style: `height:${(fila.claro / techo) * 100}%` }));
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
      const total = fila.azul + fila.claro;
      columnas.append(this.el("div", { class: "columna" }, [
        this.el("span", { class: "valor-columna", style: `bottom:calc(${(total / techo) * 100}% + 7px)` }, [String(total)]),
        pila,
        hit,
        this.el("div", { class: ocultarFecha ? "etiqueta-x oculta" : "etiqueta-x" }, [Formato.fechaCorta(fila.fecha)]),
      ]));
    });
    grafico.append(columnas);

    const leyenda = this.el("div", { class: "leyenda" }, [
      this.el("span", { class: "clave" }, [this.el("span", { class: "muestra azul" }), leyendaAzul]),
      this.el("span", { class: "clave" }, [this.el("span", { class: "muestra clara" }), leyendaClaro]),
    ]);

    return this.tarjeta(titulo, grafico, { derecha: leyenda, clase: "grafico-envoltura" });
  },

  conectarTooltip(hit, contenido) {
    const tooltip = this.refs.tooltip();
    const fila = ([clase, valor, etiqueta]) =>
      this.el("div", { class: "fila" }, [
        this.el("span", { class: `clave-linea ${clase}` }),
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
};
