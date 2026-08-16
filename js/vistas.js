"use strict";

/* ============================================================
   Vistas — arma cada pantalla con las piezas de UI
   ============================================================ */
const Vistas = {
  pintar(...piezas) {
    UI.refs.resultados().replaceChildren(...piezas.flat());
  },

  panelSerie(titulo, analisis, etiquetaLinea) {
    if (!analisis) return [];
    const c = analisis.cumplimiento;
    const tendencia = {
      sube: ["↗", "Ascendente", "bueno"],
      baja: ["↘", "Descendente", "malo"],
      estable: ["→", "Estable", "neutro"],
    }[analisis.tendencia];
    const items = [
      c ? { etiqueta: etiquetaLinea, valor: Formato.porcentaje(c.porcentaje), detalle: `${c.veces} de ${c.n} partidos`, tono: c.porcentaje >= 60 ? "bueno" : "" } : null,
      c ? { etiqueta: "Cuota justa", valor: c.cuotaJusta ? Formato.numero(c.cuotaJusta) : "–", detalle: "sin margen de casa" } : null,
      { etiqueta: "Media ponderada", valor: Formato.numero(analisis.mediaPonderada), detalle: `simple ${Formato.numero(analisis.media)}` },
      { etiqueta: "Tendencia", valor: `${tendencia[0]} ${tendencia[1]}`, detalle: `${analisis.delta >= 0 ? "+" : ""}${Formato.numero(analisis.delta)} vs tramo anterior`, tono: tendencia[2] },
      { etiqueta: "Mediana y rango", valor: Formato.numero(analisis.mediana), detalle: `${Formato.numero(analisis.minimo)}–${Formato.numero(analisis.maximo)}` },
      { etiqueta: "Volatilidad", valor: analisis.volatilidad, detalle: `desv. ${Formato.numero(analisis.desviacion)}`, tono: analisis.volatilidad === "alta" ? "malo" : analisis.volatilidad === "baja" ? "bueno" : "" },
    ].filter(Boolean);
    return UI.tarjeta(titulo, UI.el("div", { class: "analisis-grid" }, items.map((item) =>
      UI.el("div", { class: `analisis-dato ${item.tono || ""}`.trim() }, [
        UI.el("span", { class: "analisis-etiqueta" }, [item.etiqueta]),
        UI.el("strong", {}, [item.valor]),
        UI.el("small", {}, [item.detalle]),
      ])
    )), { clase: "analisis-panel" });
  },

  panelProyeccion(ladoA, ladoB, opciones = {}) {
    const p = Logica.proyectarPartido(ladoA.filas, ladoB.filas, opciones);
    const vista = opciones.vista || "goles";
    const numero = (valor) => valor === null ? "–" : Formato.numero(valor);
    const porcentaje = (valor) => valor === null ? "–" : Formato.porcentaje(valor);
    const frecuencia = (valor) => valor === null
      ? "sin datos"
      : `${porcentaje(valor)} · justa ${valor ? Formato.numero(100 / valor) : "–"}`;
    const cuotaResultado = (valor) => valor ? `cuota justa ${Formato.numero(100 / valor)}` : "sin cuota calculable";
    const dato = (etiqueta, valor, detalle, clase = "") => UI.el("div", { class: `proyeccion-dato ${clase}`.trim() }, [
      UI.el("span", {}, [etiqueta]), UI.el("strong", {}, [valor]), UI.el("small", {}, [detalle]),
    ]);
    const resultadoConcluyente = p.resultado && p.resultado.confianza !== "baja";
    const grupos = {
      resultado: resultadoConcluyente ? [
        dato(`Gana · ${ladoA.equipo.displayName}`, porcentaje(p.resultado.victoriaA), cuotaResultado(p.resultado.victoriaA), "a"),
        dato("Empate", porcentaje(p.resultado.empate), cuotaResultado(p.resultado.empate), "central"),
        dato(`Gana · ${ladoB.equipo.displayName}`, porcentaje(p.resultado.victoriaB), cuotaResultado(p.resultado.victoriaB), "b"),
        dato("Marcador más probable", p.resultado.marcador, `${porcentaje(p.resultado.probMarcador)} individual`, "central"),
      ] : p.resultado ? [
        dato("Resultado 1X2", "No concluyente", "las muestras no permiten comparar fuerza absoluta", "central"),
        dato(`Gana · ${ladoA.equipo.displayName}`, "–", "sin porcentaje fiable", "a"),
        dato("Empate", "–", "sin porcentaje fiable", "central"),
        dato(`Gana · ${ladoB.equipo.displayName}`, "–", "sin porcentaje fiable", "b"),
      ] : [dato("Resultado", "–", "No hay suficientes goles registrados", "central")],
      goles: [
        dato(`Goles · ${ladoA.equipo.displayName}`, numero(p.golesA), "ataque A + defensa B", "a"),
        dato("Total de goles", numero(p.totalGoles), `+${String(p.lineaGoles).replace(".", ",")}: ${frecuencia(p.probGoles)}`, "central"),
        dato(`Goles · ${ladoB.equipo.displayName}`, numero(p.golesB), "ataque B + defensa A", "b"),
        dato("Ambos marcan", porcentaje(p.probAmbos), frecuencia(p.probAmbos), "central"),
      ],
      corners: [
        dato(`Córners · ${ladoA.equipo.displayName}`, numero(p.cornersA), "saca A + concede B", "a"),
        dato("Total de córners", numero(p.totalCorners), `+${String(p.lineaCorners).replace(".", ",")}: ${frecuencia(p.probCorners)}`, "central"),
        dato(`Córners · ${ladoB.equipo.displayName}`, numero(p.cornersB), "saca B + concede A", "b"),
      ],
      tiros: [
        dato(`Tiros · ${ladoA.equipo.displayName}`, numero(p.tirosA), "realizados + concedidos", "a"),
        dato("Total de tiros", numero(p.totalTiros), "proyección combinada", "central"),
        dato(`Tiros · ${ladoB.equipo.displayName}`, numero(p.tirosB), "realizados + concedidos", "b"),
        dato(`A puerta · ${ladoA.equipo.displayName}`, numero(p.tirosPuertaA), "media ponderada propia", "a"),
        dato("Total a puerta", numero(p.totalTirosPuerta), "suma ponderada de ambos", "central"),
        dato(`A puerta · ${ladoB.equipo.displayName}`, numero(p.tirosPuertaB), "media ponderada propia", "b"),
      ],
    };
    const items = grupos[vista] || grupos.goles;
    const titulos = { resultado: "Probabilidades estimadas 1X2", goles: "Proyección de goles", corners: "Proyección de córners", tiros: "Proyección de tiros" };
    const barraResultado = vista === "resultado" && resultadoConcluyente
      ? UI.el("div", {
        class: "resultado-barra",
        role: "img",
        "aria-label": `${porcentaje(p.resultado.victoriaA)} victoria local, ${porcentaje(p.resultado.empate)} empate y ${porcentaje(p.resultado.victoriaB)} victoria visitante`,
      }, [
        UI.el("span", { class: "resultado-segmento a", style: `width:${p.resultado.victoriaA}%` }, [porcentaje(p.resultado.victoriaA)]),
        UI.el("span", { class: "resultado-segmento empate", style: `width:${p.resultado.empate}%` }, [porcentaje(p.resultado.empate)]),
        UI.el("span", { class: "resultado-segmento b", style: `width:${p.resultado.victoriaB}%` }, [porcentaje(p.resultado.victoriaB)]),
      ])
      : null;
    const contextoResultado = vista === "resultado" && p.resultado
      ? `Confianza ${p.resultado.confianza} (${Formato.porcentaje(p.resultado.confianzaNumerica)}): ${p.resultado.motivoComparabilidad}. Comparabilidad ${Formato.porcentaje(p.resultado.comparabilidad)} · ${ladoA.equipo.displayName}: ${p.muestraResultadoA} ${p.usaContextoLocal ? "como local" : "generales"} · ${ladoB.equipo.displayName}: ${p.muestraResultadoB} ${p.usaContextoVisita ? "como visitante" : "generales"} · H2H: ${p.resultado.h2h} (peso ${Formato.porcentaje(p.resultado.pesoH2H)}).`
      : null;
    return UI.tarjeta(titulos[vista] || titulos.goles, [
      ...(barraResultado ? [barraResultado] : []),
      UI.el("div", { class: `proyeccion-grid vista-${vista}` }, items),
      UI.el("p", { class: "nota" }, [contextoResultado || "Estimación transparente basada en los partidos filtrados; no es xG ni garantiza un resultado."]),
      ...(vista === "resultado" ? [UI.el("p", { class: "nota advertencia-modelo" }, [p.resultado?.confianza === "baja"
        ? "Las rachas pertenecen a contextos poco comparables. El modelo oculta el 1X2 y el marcador probable porque una racha ganadora en una liga distinta no demuestra superioridad absoluta. Se necesitan competición compartida, rivales comunes o H2H suficientes."
        : "No considera alineaciones, lesiones, sanciones, árbitro, descanso ni motivación competitiva. La independencia Poisson también puede desajustar empates de pocos goles. Es una referencia sin calibración histórica, no una recomendación de apuesta."])] : []),
    ], { clase: "proyeccion-panel" });
  },

  panelPerfilTiros(perfil, n, etiquetaMetrica) {
    const porcentaje = (valor) => Formato.porcentaje(valor);
    const distribucion = perfil.distribucion;
    const items = [
      { etiqueta: "Precisión", valor: porcentaje(perfil.precision), detalle: "a puerta / tiros totales" },
      { etiqueta: "Conversión", valor: porcentaje(perfil.conversion), detalle: "goles / tiros totales" },
      { etiqueta: "Gol por tiro a puerta", valor: porcentaje(perfil.golesPorTiroPuerta), detalle: "goles / tiros a puerta" },
      { etiqueta: "Racha sobre la línea", valor: perfil.rachaLinea, detalle: perfil.rachaLinea === 1 ? "1 partido seguido" : `${perfil.rachaLinea} partidos seguidos` },
      { etiqueta: "Sin rematar", valor: `${perfil.sinRematar}/${n}`, detalle: "partidos con 0 tiros" },
    ];
    const resumenDistribucion = `0: ${distribucion.cero} · 1: ${distribucion.uno} · 2: ${distribucion.dos} · 3+: ${distribucion.tresMas}`;
    return UI.tarjeta(`Perfil de remate · ${etiquetaMetrica}`, [
      UI.el("div", { class: "analisis-grid perfil-tiros-grid" }, items.map((item) =>
        UI.el("div", { class: "analisis-dato" }, [
          UI.el("span", { class: "analisis-etiqueta" }, [item.etiqueta]),
          UI.el("strong", {}, [String(item.valor)]),
          UI.el("small", {}, [item.detalle]),
        ])
      )),
      UI.el("p", { class: "nota distribucion-tiros" }, [`Distribución en ${n} partidos (${etiquetaMetrica.toLowerCase()}): ${resumenDistribucion}.`]),
    ], { clase: "analisis-panel" });
  },

  /* ============================================================
     Vista 1 — tiros por jugador
     ============================================================ */
  jugador(jugador, idJugador, partidos, { linea = 1.5, metrica = "tiros" } = {}) {
    const resumen = Logica.resumenJugador(partidos);
    const proporcion = (veces) => (resumen.n ? veces / resumen.n : 0);

    const cabecera = UI.fichaCabecera({
      avatarUrl: Formato.fotoJugador(idJugador),
      nombre: jugador.displayName,
      etiqueta: jugador.subtitle || null,
      descripcion: [jugador.description, `últimos ${Formato.partidos(resumen.n)}`].filter(Boolean).join(" · "),
      derecha: [
        UI.rapido(resumen.goles, resumen.goles === 1 ? "gol" : "goles"),
        UI.rapido(resumen.asistencias, "asistencias"),
      ],
    });

    const tiles = UI.tiles([
      { etiqueta: "Tiros por partido", valor: Formato.numero(resumen.promedioTiros), contexto: `últimos ${resumen.n} partidos` },
      { etiqueta: "Tiros a puerta por partido", valor: Formato.numero(resumen.promedioPuerta), contexto: `últimos ${resumen.n} partidos` },
      { etiqueta: "Partidos con 1+ tiro", valor: `${resumen.conUnTiro}/${resumen.n}`, contexto: "tiro de cualquier tipo", proporcion: proporcion(resumen.conUnTiro) },
      { etiqueta: "Partidos con 1+ tiro a puerta", valor: `${resumen.conUnTiroPuerta}/${resumen.n}`, contexto: "entre los tres palos", proporcion: proporcion(resumen.conUnTiroPuerta) },
    ]);

    const grafico = UI.tarjetaGrafico({
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
            ["azul", p.tirosPuerta, "tiros a puerta"],
            ["clara", p.tiros - p.tirosPuerta, "fuera / bloqueados"],
            ["vacia", p.tiros, "tiros totales"],
          ],
        },
      })),
    });

    const maxTiros = Math.max(1, ...partidos.map((p) => p.tiros));
    const filas = partidos.map((p) => UI.el("tr", {}, [
      UI.el("td", { class: "tenue" }, [Formato.fechaLarga(p.fecha)]),
      UI.el("td", {}, [p.rival]),
      UI.el("td", { class: "tenue" }, [p.competicion]),
      UI.celdaResultado(p.resultado),
      UI.el("td", { class: "tenue" }, [p.marcador]),
      UI.celdaNum(p.goles),
      UI.celdaNum(p.asistencias),
      UI.celdaBarra(p.tiros, maxTiros),
      UI.celdaNum(p.tirosPuerta, "destacado"),
      UI.celdaNum(p.amarillas),
    ]));

    const tabla = UI.tarjeta(
      `Últimos ${partidos.length} partidos de ${jugador.displayName}`,
      UI.tabla(
        ["Fecha", "Rival", "Competición", "Res", "Marcador",
          { texto: "G", num: true }, { texto: "A", num: true }, { texto: "Tiros", num: true },
          { texto: "A puerta", num: true }, { texto: "TA", num: true }],
        filas,
      ),
    );

    const esPuerta = metrica === "tirosPuerta";
    const clave = esPuerta ? "tirosPuerta" : "tiros";
    const etiqueta = esPuerta ? "Tiros a puerta" : "Tiros totales";
    const analisis = Logica.analizarSerie(partidos, (p) => p[clave], linea);
    const perfilTiros = Logica.perfilTirosJugador(partidos, clave, linea);
    this.pintar(
      cabecera,
      tiles,
      this.panelSerie(`Probabilidad y distribución · ${etiqueta}`, analisis, `${Math.floor(linea + 1)}+ ${esPuerta ? "a puerta" : "tiros"}`),
      this.panelPerfilTiros(perfilTiros, partidos.length, etiqueta),
      UI.tarjetaLecturas(Logica.lecturasJugador(partidos, resumen)),
      grafico,
      tabla,
    );
  },

  /* ============================================================
     Vista 2 — partidos recientes de un equipo
     ============================================================ */
  partidos(equipo, partidos, { linea = 2.5 } = {}) {
    const resumen = Logica.resumenEquipo(partidos);

    const cabecera = UI.fichaCabecera({
      avatarUrl: equipo.image?.default,
      escudo: true,
      nombre: equipo.displayName,
      etiqueta: Formato.subtitulo(equipo.subtitle) || null,
      descripcion: `últimos ${Formato.partidos(resumen.n)} · todas las competiciones`,
      derecha: [UI.tiraForma(partidos)],
    });

    const tiles = UI.tiles([
      { etiqueta: "Balance V-E-D", valor: `${resumen.victorias}-${resumen.empates}-${resumen.derrotas}`, contexto: `últimos ${resumen.n} partidos` },
      { etiqueta: "Goles a favor", valor: Formato.numero(resumen.mediaFavor), contexto: "por partido" },
      { etiqueta: "Goles en contra", valor: Formato.numero(resumen.mediaContra), contexto: "por partido" },
      { etiqueta: "Porterías a cero", valor: `${resumen.porteriasCero}/${resumen.n}`, contexto: "partidos sin encajar", proporcion: resumen.n ? resumen.porteriasCero / resumen.n : 0 },
    ]);

    const grafico = UI.tarjetaGrafico({
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
            ["azul", p.golesFavor, "goles a favor"],
            ["clara", p.golesContra, "goles en contra"],
            ["vacia", p.golesFavor + p.golesContra, "goles en el partido"],
          ],
        },
      })),
    });

    const maxGoles = Math.max(1, ...partidos.map((p) => p.golesFavor + p.golesContra));
    const filas = partidos.map((p) => UI.el("tr", {}, [
      UI.el("td", { class: "tenue" }, [Formato.fechaLarga(p.fecha)]),
      UI.el("td", {}, [p.rival]),
      UI.el("td", { class: "tenue" }, [p.competicion]),
      UI.celdaSede(p.enCasa),
      UI.celdaResultado(p.resultado),
      UI.el("td", { class: "destacado" }, [`${p.golesFavor}-${p.golesContra}`]),
      UI.celdaBarra(p.golesFavor + p.golesContra, maxGoles),
    ]));

    const tabla = UI.tarjeta(
      `Últimos ${partidos.length} partidos de ${equipo.displayName}`,
      UI.tabla(
        ["Fecha", "Rival", "Competición", "Sede", "Res", "Marcador", { texto: "Goles", num: true }],
        filas,
      ),
    );

    const analisis = Logica.analizarSerie(partidos, (p) => p.golesFavor + p.golesContra, linea);
    this.pintar(cabecera, tiles, this.panelSerie("Probabilidad y distribución de goles", analisis, `Más de ${String(linea).replace(".", ",")} goles`), UI.tarjetaLecturas(Logica.lecturasEquipo(partidos, resumen)), grafico, tabla);
  },

  /* ============================================================
     Vista 3 — corners de un equipo
     ============================================================ */
  corners(equipo, partidos, { linea = 9.5 } = {}) {
    const resumen = Logica.resumenCorners(partidos);
    const tieneDatos = (p) => p.cornersFavor !== null;

    const cabecera = UI.fichaCabecera({
      avatarUrl: equipo.image?.default,
      escudo: true,
      nombre: equipo.displayName,
      etiqueta: Formato.subtitulo(equipo.subtitle) || null,
      descripcion: `córners de los últimos ${Formato.partidos(partidos.length)}`,
      derecha: [UI.tiraForma(partidos)],
    });

    const contexto = `sobre ${resumen.n} partidos con datos`;
    const tiles = UI.tiles([
      { etiqueta: "Córners a favor", valor: Formato.numero(resumen.mediaFavor), contexto: `por partido · ${contexto}` },
      { etiqueta: "Córners concedidos", valor: Formato.numero(resumen.mediaContra), contexto: `por partido · ${contexto}` },
      { etiqueta: "Córners totales", valor: Formato.numero(resumen.mediaTotal), contexto: `por partido · ${contexto}` },
      { etiqueta: "Partidos con 10+ córners", valor: `${resumen.conDiezMas}/${resumen.n}`, contexto: "total del partido", proporcion: resumen.n ? resumen.conDiezMas / resumen.n : 0 },
    ]);

    const conDatos = partidos.filter(tieneDatos);
    const grafico = UI.tarjetaGrafico({
      titulo: "Córners por partido",
      leyendaAzul: "A favor",
      leyendaClaro: "Concedidos",
      media: resumen.mediaTotal,
      etiquetaMedia: `media ${Formato.numero(resumen.mediaTotal)}`,
      filas: conDatos.map((p) => ({
        fecha: p.fecha,
        azul: p.cornersFavor,
        claro: p.cornersContra,
        tooltip: {
          titulo: `vs ${p.rival}`,
          sub: `${Formato.fechaLarga(p.fecha)} · ${p.competicion} · ${Formato.resultado(p.resultado).texto} ${p.golesFavor}-${p.golesContra}`,
          lineas: [
            ["azul", p.cornersFavor, "córners a favor"],
            ["clara", p.cornersContra, "concedidos"],
            ["vacia", p.cornersFavor + p.cornersContra, "córners totales"],
          ],
        },
      })),
    });

    const maxTotal = Math.max(1, ...conDatos.map((p) => p.cornersFavor + p.cornersContra));
    const sinDato = () => UI.el("td", { class: "num tenue" }, ["–"]);
    const filas = partidos.map((p) => UI.el("tr", {}, [
      UI.el("td", { class: "tenue" }, [Formato.fechaLarga(p.fecha)]),
      UI.el("td", {}, [p.rival]),
      UI.el("td", { class: "tenue" }, [p.competicion]),
      UI.celdaSede(p.enCasa),
      UI.celdaResultado(p.resultado),
      UI.el("td", { class: "tenue" }, [`${p.golesFavor}-${p.golesContra}`]),
      ...(tieneDatos(p)
        ? [UI.celdaNum(p.cornersFavor), UI.celdaNum(p.cornersContra), UI.celdaBarra(p.cornersFavor + p.cornersContra, maxTotal)]
        : [sinDato(), sinDato(), sinDato()]),
    ]));

    const contenido = [
      UI.tabla(
        ["Fecha", "Rival", "Competición", "Sede", "Res", "Marcador",
          { texto: "A favor", num: true }, { texto: "Concedidos", num: true }, { texto: "Total", num: true }],
        filas,
      ),
    ];
    if (resumen.sinDatos > 0) {
      contenido.push(UI.el("p", { class: "nota" }, [
        `ESPN no publica córners de ${resumen.sinDatos} de estos partidos (amistosos o rondas menores); no cuentan en las medias.`,
      ]));
    }

    const tabla = UI.tarjeta(`Córners de los últimos ${partidos.length} partidos`, contenido);
    const analisis = Logica.analizarSerie(partidos, (p) => p.cornersFavor === null ? NaN : p.cornersFavor + p.cornersContra, linea);
    this.pintar(cabecera, tiles, this.panelSerie("Probabilidad y distribución de córners", analisis, `Más de ${String(linea).replace(".", ",")} córners`), UI.tarjetaLecturas(Logica.lecturasCorners(partidos, resumen)), grafico, tabla);
  },

  /* ============================================================
     Vista 4 — agenda diaria por competición
     ============================================================ */
  hoy(ligas, alAnalizar, {
    dia = 0, alCambiarDia = () => {}, radar = {}, ligaSeleccionada = "todas",
    alCambiarLiga = () => {}, alGenerarRadar = () => {},
  } = {}) {
    const total = ligas.reduce((suma, liga) => suma + liga.partidos.length, 0);
    const pendientes = ligas.reduce((suma, liga) => suma + liga.partidos.filter((p) => p.estado === "pre").length, 0);
    const enVivoAhora = ligas.reduce((suma, liga) => suma + liga.partidos.filter((p) => p.estado === "in").length, 0);
    const proximo = ligas.flatMap((liga) => liga.partidos)
      .filter((p) => p.estado === "pre" && p.fecha > new Date())
      .sort((a, b) => a.fecha - b.fecha)[0] || null;
    const selectorLiga = UI.el("select", { class: "agenda-filtro", "aria-label": "Filtrar agenda por competición" }, [
      UI.el("option", { value: "todas" }, ["Todas las competiciones"]),
      ...ligas.map((liga) => UI.el("option", { value: liga.id }, [`${liga.nombre} (${liga.partidos.length})`])),
    ]);
    selectorLiga.value = ligaSeleccionada;
    const botonRadar = UI.el("button", { type: "button", class: "agenda-radar-boton" }, [
      radar.cargando ? "Analizando…" : "Buscar oportunidades",
    ]);
    botonRadar.disabled = Boolean(radar.cargando);
    botonRadar.addEventListener("click", () => alGenerarRadar(selectorLiga.value));
    const selectorMuestra = UI.el("select", { class: "agenda-filtro agenda-muestra", "aria-label": "Partidos usados al proyectar" }, [
      ...[5, 10, 15, 20].map((n) => UI.el("option", { value: n }, [`Muestra: últimos ${n}`])),
    ]);
    selectorMuestra.value = UI.refs.selector().value;
    selectorMuestra.addEventListener("change", () => { UI.refs.selector().value = selectorMuestra.value; });
    const selectorDia = UI.el("div", { class: "agenda-dias", role: "group", "aria-label": "Día de la agenda" },
      [[0, "Hoy"], [1, "Mañana"]].map(([valor, texto]) => {
        const boton = UI.el("button", {
          type: "button",
          class: valor === dia ? "activo" : "",
          "aria-pressed": valor === dia ? "true" : "false",
        }, [texto]);
        boton.addEventListener("click", () => { if (valor !== dia) alCambiarDia(valor); });
        return boton;
      }));
    const cabecera = UI.el("section", { class: "agenda-encabezado" }, [
      UI.el("div", { class: "agenda-titulo-fila" }, [
        UI.el("div", {}, [
          UI.el("h1", {}, [dia === 1 ? "Partidos de mañana" : "Partidos de hoy"]),
          UI.el("p", {}, [`${total} encuentros · ${ligas.length} competiciones · datos de ESPN`]),
        ]),
        UI.el("div", { class: "agenda-controles" }, [selectorDia, selectorLiga, selectorMuestra, botonRadar]),
      ]),
      UI.el("div", { class: "agenda-resumen" }, [
        UI.el("div", {}, [UI.el("strong", {}, [String(total)]), UI.el("span", {}, ["partidos publicados"])]),
        UI.el("div", {}, [UI.el("strong", {}, [String(ligas.length)]), UI.el("span", {}, ["competiciones"])]),
        UI.el("div", {}, [UI.el("strong", {}, [String(enVivoAhora)]), UI.el("span", {}, ["en vivo ahora"])]),
        UI.el("div", {}, [UI.el("strong", {}, [proximo ? Formato.hora(proximo.fecha) : "–"]), UI.el("span", {}, [proximo ? "próximo inicio" : `${pendientes} por comenzar`])]),
      ]),
    ]);

    const oportunidades = Object.values(radar.resultados || {}).filter((r) => r?.mejor)
      .sort((a, b) => (b.mejor?.probabilidad || 0) - (a.mejor?.probabilidad || 0));
    const panelRadar = oportunidades.length ? UI.tarjeta("Radar de oportunidades", [
      UI.el("p", { class: "nota" }, ["Ordenado por la frecuencia más alta de la muestra local. Es una señal estadística, no una garantía."]),
      UI.el("div", { class: "radar-lista" }, oportunidades.slice(0, 8).map((r) => UI.el("div", { class: "radar-oportunidad" }, [
        UI.el("div", {}, [UI.el("strong", {}, [r.partido]), UI.el("span", {}, [r.competicion])]),
        UI.el("div", {}, [UI.el("strong", {}, [r.mejor?.mercado || "Sin mercado"]), UI.el("span", {}, [r.mejor ? `${Formato.numero(r.mejor.probabilidad, 0)}% · confianza ${r.confianza}` : "–"])]),
      ]))),
    ], { clase: "radar-panel" }) : null;

    const primeraAbierta = Math.max(0, ligas.findIndex((liga) => liga.partidos.some((p) => p.estado === "in")));
    const bloques = ligas.map((liga, indiceLiga) => {
      const partidos = liga.partidos.map((partido) => {
        const terminado = partido.estado === "post";
        const enVivo = partido.estado === "in";
        const estado = enVivo ? "En vivo" : terminado ? (partido.detalleEstado || "Final") : Formato.hora(partido.fecha);
        const equipo = (datos, mostrarScore) => UI.el("div", { class: "agenda-equipo" }, [
          UI.avatar(datos.logo, datos.displayName, { escudo: true }),
          UI.el("span", { class: "agenda-equipo-nombre" }, [datos.displayName]),
          ...(mostrarScore ? [UI.el("strong", { class: "agenda-equipo-score" }, [datos.score ?? "–"])] : []),
        ]);
        const boton = UI.el("button", { type: "button", class: "agenda-analizar" }, ["Ver informe"]);
        boton.addEventListener("click", () => alAnalizar(partido, liga));
        const datoRadar = radar.resultados?.[String(partido.eventId)];
        const radarPartido = datoRadar ? [
          UI.el("strong", {}, [datoRadar.mejor?.mercado || "Sin señal clara"]),
          UI.el("span", {}, [datoRadar.mejor ? `${Formato.numero(datoRadar.mejor.probabilidad, 0)}% · ${datoRadar.confianza}` : "muestra insuficiente"]),
        ] : radar.cargando ? [UI.el("strong", {}, ["Calculando…"]), UI.el("span", {}, ["datos JSON locales"])] : [
          UI.el("strong", {}, ["Forma + H2H"]), UI.el("span", {}, ["informe bajo demanda"]),
        ];
        return UI.el("div", { class: "agenda-partido" }, [
          UI.el("div", { class: `agenda-estado ${enVivo ? "en-vivo" : terminado ? "final" : ""}`.trim() }, [
            UI.el("strong", {}, [estado]),
            UI.el("small", {}, [enVivo ? (partido.detalleEstado || "actualizando") : terminado ? "FT" : "programado"]),
          ]),
          UI.el("div", { class: "agenda-equipos" }, [equipo(partido.local, enVivo || terminado), equipo(partido.visitante, enVivo || terminado)]),
          UI.el("div", { class: "agenda-disponible" }, radarPartido),
          boton,
        ]);
      });
      const resumen = UI.el("summary", { class: "agenda-liga-resumen" }, [
        UI.el("span", { class: "agenda-liga-titulo" }, [liga.nombre]),
        UI.el("span", { class: "agenda-liga-cantidad" }, [`${liga.partidos.length} ${liga.partidos.length === 1 ? "partido" : "partidos"}`]),
        UI.el("span", { class: "agenda-liga-flecha", "aria-hidden": "true" }, ["⌄"]),
      ]);
      const atributos = { class: "tarjeta agenda-liga" };
      if (indiceLiga === primeraAbierta) atributos.open = "";
      const bloque = UI.el("details", atributos, [
        resumen,
        UI.el("div", { class: "agenda-liga-contenido" }, [UI.el("div", { class: "agenda-lista" }, partidos)]),
      ]);
      bloque.dataset.liga = liga.id;
      bloque.hidden = ligaSeleccionada !== "todas" && ligaSeleccionada !== liga.id;
      if (ligaSeleccionada !== "todas" && ligaSeleccionada === liga.id) bloque.open = true;
      return bloque;
    });
    selectorLiga.addEventListener("change", () => {
      alCambiarLiga(selectorLiga.value);
      for (const bloque of bloques) {
        const coincide = selectorLiga.value === "todas" || bloque.dataset.liga === selectorLiga.value;
        bloque.hidden = !coincide;
        if (selectorLiga.value !== "todas" && coincide) bloque.open = true;
      }
    });
    this.pintar(cabecera, panelRadar || [], bloques.length ? bloques : UI.tarjeta("Sin encuentros publicados", [
      UI.el("p", { class: "nota" }, [dia === 1
        ? "ESPN todavía no ha publicado partidos para mañana. Puedes volver a Hoy desde el selector superior."
        : "ESPN no tiene encuentros publicados para hoy."]),
    ], { clase: "agenda-vacia" }));
  },

  /* ============================================================
     Vista 5 — comparativa cara a cara
     lado = { equipo, id, filas, filasTodas, perfil }
     ============================================================ */
  comparacion(ladoA, ladoB, cruces = [], filtroSede = "todos") {
    const metricas = Logica.metricasComparadas(ladoA.perfil, ladoB.perfil);
    const ganadas = (cual) => metricas.filter((m) => m.gana === cual).length;

    this.pintar(
      this.duelo(ladoA, ladoB, ganadas("a"), ganadas("b")),
      this.enfrentadas(ladoA, ladoB, metricas),
      UI.tarjetaLecturas(Logica.lecturasComparacion(ladoA, ladoB, metricas, cruces)),
      this.comunes(ladoA, ladoB),
      this.historial(ladoA, cruces, filtroSede),
      this.detallePorEquipo(ladoA, ladoB),
    );
  },

  comunes(ladoA, ladoB) {
    const comunes = Logica.rivalesComunes(ladoA.filasTodas, ladoB.filasTodas);
    if (!comunes.rivales.length) return UI.tarjeta("Rivales comunes", [
      UI.el("p", { class: "nota" }, ["No hay rivales comunes en los 30 partidos recientes de ambos equipos."]),
    ]);
    const resultado = (fila) => `${Formato.resultado(fila.resultado).texto} ${fila.golesFavor}-${fila.golesContra}`;
    const filas = comunes.rivales.map((r) => UI.el("tr", {}, [
      UI.el("td", {}, [r.nombre]),
      UI.el("td", { class: "num" }, [resultado(r.a)]),
      UI.el("td", { class: "num" }, [resultado(r.b)]),
    ]));
    return UI.tarjeta(`Rivales comunes (${comunes.rivales.length})`, [
      UI.el("div", { class: "comunes-resumen" }, [
        UI.el("span", {}, [`${ladoA.equipo.displayName}: ${comunes.puntosA} pts`]),
        UI.el("span", {}, [`${ladoB.equipo.displayName}: ${comunes.puntosB} pts`]),
      ]),
      UI.tabla(["Rival", { texto: ladoA.equipo.displayName, num: true }, { texto: ladoB.equipo.displayName, num: true }], filas),
      UI.el("p", { class: "nota" }, ["Se usa el partido más reciente de cada equipo contra cada rival compartido."]),
    ]);
  },

  rankings({ competiciones = [], slug = "", limite = 10, filas = [], cargando = false }, alCambiar) {
    const selectorLiga = UI.el("select", { class: "agenda-filtro", "aria-label": "Competición del ranking" },
      competiciones.map((c) => UI.el("option", { value: c.slug }, [c.nombre])));
    selectorLiga.value = slug;
    const selectorMuestra = UI.el("select", { class: "agenda-filtro", "aria-label": "Muestra del ranking" },
      [5, 10, 15, 20].map((n) => UI.el("option", { value: n }, [`Últimos ${n}`])));
    selectorMuestra.value = String(limite);
    selectorLiga.addEventListener("change", () => alCambiar(selectorLiga.value, Number(selectorMuestra.value)));
    selectorMuestra.addEventListener("change", () => alCambiar(selectorLiga.value, Number(selectorMuestra.value)));
    const cabecera = UI.el("section", { class: "agenda-encabezado ranking-encabezado" }, [
      UI.el("div", { class: "agenda-titulo-fila" }, [
        UI.el("div", {}, [UI.el("h1", {}, ["Rankings por competición"]), UI.el("p", {}, ["Forma, producción ofensiva y mercados desde los JSON publicados."])]),
        UI.el("div", { class: "agenda-controles" }, [selectorLiga, selectorMuestra]),
      ]),
    ]);
    if (cargando) return this.pintar(cabecera, UI.el("div", { class: "esqueleto esqueleto-grafico" }));
    const tabla = UI.tablaPaginada(
      ["#", "Equipo", "PJ", "V-E-D", { texto: "Pts/PJ", num: true }, { texto: "GF-GC", num: true }, { texto: "Córners", num: true }, { texto: "Tiros", num: true }, { texto: "+2,5", num: true }, { texto: "+9,5 cór.", num: true }],
      filas,
      (r) => UI.el("tr", {}, [
        UI.el("td", { class: "ranking-pos" }, [String(r.posicion)]),
        UI.el("td", {}, [UI.el("div", { class: "ranking-equipo" }, [UI.avatar(r.escudo, r.nombre, { escudo: true }), UI.el("strong", {}, [r.nombre])])]),
        UI.el("td", {}, [String(r.pj)]), UI.el("td", {}, [`${r.v}-${r.e}-${r.d}`]),
        UI.el("td", { class: "num destacado" }, [Formato.numero(r.ppp, 2)]),
        UI.el("td", { class: "num" }, [`${r.gf}-${r.gc}`]),
        UI.el("td", { class: "num" }, [r.corners === null ? "–" : Formato.numero(r.corners, 1)]),
        UI.el("td", { class: "num" }, [r.tiros === null ? "–" : Formato.numero(r.tiros, 1)]),
        UI.el("td", { class: "num" }, [`${Formato.numero(r.over25, 0)}%`]),
        UI.el("td", { class: "num" }, [r.over95Corners === null ? "–" : `${Formato.numero(r.over95Corners, 0)}%`]),
      ]),
      { porPagina: 15, etiqueta: "equipos" },
    );
    this.pintar(cabecera, UI.tarjeta("Ranking de forma reciente", [tabla, UI.el("p", { class: "nota" }, ["Ordenado por puntos por partido; desempata diferencia de gol. Las columnas de mercados describen la muestra elegida."])]));
  },

  /** Cabecera del duelo: escudo, nombre y forma de cada lado, con el
      recuento de metricas ganadas en el centro. */
  duelo(ladoA, ladoB, ganadasA, ganadasB) {
    const lado = (datos, letra, derecha) =>
      UI.el("div", { class: derecha ? "duelo-lado derecha" : "duelo-lado" }, [
        UI.avatar(datos.equipo.image?.default, datos.equipo.displayName, { escudo: true, grande: true }),
        UI.el("div", { class: "duelo-texto" }, [
          UI.el("div", { class: "duelo-nombre" }, [
            UI.el("span", { class: `punto ${letra}` }),
            datos.equipo.displayName,
          ]),
          UI.el("div", { class: "duelo-liga" }, [
            [Formato.subtitulo(datos.equipo.subtitle), Formato.partidos(datos.perfil.n)].filter(Boolean).join(" · "),
          ]),
          UI.tiraForma(datos.filas),
        ]),
      ]);

    return UI.el("div", { class: "tarjeta duelo" }, [
      lado(ladoA, "a", false),
      UI.el("div", { class: "duelo-centro" }, [
        UI.el("div", { class: "duelo-vs" }, ["Cara a cara"]),
        UI.el("div", { class: "duelo-tanteo" }, [
          UI.el("span", { class: "a" }, [String(ganadasA)]),
          UI.el("span", { class: "guion" }, ["–"]),
          UI.el("span", { class: "b" }, [String(ganadasB)]),
        ]),
        UI.el("div", { class: "duelo-pie" }, ["métricas ganadas"]),
      ]),
      lado(ladoB, "b", true),
    ]);
  },

  /** Barras enfrentadas: cada metrica en su fila, ambos lados a la misma escala. */
  enfrentadas(ladoA, ladoB, metricas) {
    const fila = (metrica) => {
      const escala = Math.max(metrica.a, metrica.b) || 1;
      const ancho = (valor) => `width:${(valor / escala) * 100}%`;
      const valor = (numero, gana, izquierda) =>
        UI.el("span", {
          class: ["valor", izquierda ? "izq" : "", gana ? "gana" : ""].filter(Boolean).join(" "),
        }, [Formato.numero(numero, metrica.decimales ?? 1)]);

      return UI.el("div", { class: metrica.mejor === "bajo" ? "enfrentada mejor-bajo" : "enfrentada" }, [
        valor(metrica.a, metrica.gana === "a", true),
        UI.el("span", { class: "carril izq" }, [UI.el("span", { class: "barra", style: ancho(metrica.a) })]),
        UI.el("span", { class: "metrica" }, [metrica.etiqueta]),
        UI.el("span", { class: "carril der" }, [UI.el("span", { class: "barra", style: ancho(metrica.b) })]),
        valor(metrica.b, metrica.gana === "b", false),
      ]);
    };

    const leyenda = UI.el("div", { class: "leyenda" }, [
      UI.el("span", { class: "clave" }, [UI.el("span", { class: "punto a" }), ladoA.equipo.displayName]),
      UI.el("span", { class: "clave" }, [UI.el("span", { class: "punto b" }), ladoB.equipo.displayName]),
    ]);

    return UI.tarjeta("Promedios por partido", [
      UI.el("div", { class: "enfrentadas" }, metricas.map(fila)),
      UI.el("p", { class: "nota" }, [
        "↓ marca las métricas en las que menos es mejor. ESPN no publica goles esperados (xG), " +
        "así que la comparativa usa tiros, tiros a puerta y posesión como medida de dominio.",
      ]),
    ], { derecha: leyenda });
  },

  /** Historial directo entre los dos equipos (vacio si no se han cruzado). */
  historial(ladoA, cruces, filtroSede = "todos") {
    const contexto = filtroSede === "local"
      ? `${ladoA.equipo.displayName} como local`
      : filtroSede === "visita"
        ? `${ladoA.equipo.displayName} como visitante`
        : filtroSede === "partido"
          ? `${ladoA.equipo.displayName} local / rival visitante`
        : "todas las sedes";
    const titulo = `Enfrentamientos directos · ${contexto}`;
    if (!cruces.length) {
      return UI.tarjeta(titulo, UI.el("div", { class: "h2h-vacio" }, [
        UI.el("span", { class: "h2h-vacio-icono", "aria-hidden": "true" }, ["↔"]),
        UI.el("div", {}, [
          UI.el("strong", {}, ["Sin cruces en el historial reciente"]),
          UI.el("p", {}, [`No se encontraron partidos con el filtro «${contexto}» durante las últimas 6 temporadas.`]),
        ]),
      ]));
    }
    const victorias = cruces.filter((p) => p.resultado === "W").length;
    const empates = cruces.filter((p) => p.resultado === "D").length;
    const derrotas = cruces.filter((p) => p.resultado === "L").length;
    const golesFavor = cruces.reduce((total, p) => total + p.golesFavor, 0);
    const golesContra = cruces.reduce((total, p) => total + p.golesContra, 0);
    const resumen = UI.el("div", { class: "h2h-resumen" }, [
      UI.el("div", { class: "h2h-dato" }, [UI.el("strong", {}, [String(cruces.length)]), UI.el("span", {}, ["partidos"])]),
      UI.el("div", { class: "h2h-dato victoria" }, [UI.el("strong", {}, [String(victorias)]), UI.el("span", {}, ["victorias"])]),
      UI.el("div", { class: "h2h-dato" }, [UI.el("strong", {}, [String(empates)]), UI.el("span", {}, ["empates"])]),
      UI.el("div", { class: "h2h-dato derrota" }, [UI.el("strong", {}, [String(derrotas)]), UI.el("span", {}, ["derrotas"])]),
      UI.el("div", { class: "h2h-dato goles" }, [UI.el("strong", {}, [`${golesFavor}–${golesContra}`]), UI.el("span", {}, ["goles"])]),
    ]);
    const filas = cruces.map((p) => UI.el("tr", {}, [
      UI.el("td", { class: "tenue" }, [Formato.fechaLarga(p.fecha)]),
      UI.el("td", { class: "tenue" }, [p.competicion]),
      UI.celdaSede(p.enCasa),
      UI.celdaResultado(p.resultado),
      UI.el("td", { class: "destacado" }, [`${p.golesFavor}-${p.golesContra}`]),
    ]));

    return UI.tarjeta(
      `${titulo} (${cruces.length})`,
      [resumen, UI.tabla(
        ["Fecha", "Competición", "Sede", "Res", "Marcador"], filas,
      )],
      { derecha: UI.el("span", { class: "duelo-pie" }, [`vistos desde ${ladoA.equipo.displayName}`]) },
    );
  },

  /** Dos columnas con los ultimos partidos de cada equipo. */
  detallePorEquipo(ladoA, ladoB) {
    const columna = (datos, letra) => {
      const crearFila = (p) => UI.el("tr", {}, [
        UI.el("td", { class: "tenue" }, [Formato.fechaCorta(p.fecha)]),
        UI.celdaSede(p.enCasa),
        UI.el("td", {}, [p.rival]),
        UI.el("td", { class: "tenue competicion", title: p.competicion }, [p.competicion]),
        UI.celdaResultado(p.resultado),
        UI.el("td", { class: "num destacado" }, [`${p.golesFavor}-${p.golesContra}`]),
        UI.el("td", { class: "num" }, [p.cornersFavor === null ? "–" : `${p.cornersFavor}-${p.cornersContra}`]),
      ]);
      return UI.el("div", { class: "tarjeta columna-equipo" }, [
        UI.el("h3", {}, [UI.el("span", { class: `punto ${letra}` }), datos.equipo.displayName]),
        UI.tablaPaginada(
          ["Fecha", "Sede", "Rival", "Competición", "Res", { texto: "Goles", num: true }, { texto: "Córners", num: true }],
          datos.filas,
          crearFila,
          { clase: "mini-tabla", porPagina: 5, etiqueta: "partidos" },
        ),
      ]);
    };
    return UI.el("div", { class: "dos-columnas" }, [columna(ladoA, "a"), columna(ladoB, "b")]);
  },
};
