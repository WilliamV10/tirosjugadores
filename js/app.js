"use strict";

/* ============================================================
   App — controlador: estado y flujo
   ============================================================ */
const App = {
  estado: {
    modo: null,             // "tiros" | "partidos" | "corners" | "comparar" | "hoy"
    jugador: null,          // { candidato, id, filas }
    equipo: null,           // { equipo, id, filas }
    duelo: null,            // { a: lado, b: lado }
    agenda: null,           // ligas y partidos del día visible
    agendaDia: 0,           // 0 = hoy, 1 = mañana
    agendas: {},            // agendas normalizadas por fecha; evita repetir peticiones
    vistaProyeccion: "resultado",
  },

  init() {
    for (const boton of UI.refs.modos().querySelectorAll(".modo")) {
      boton.addEventListener("click", () => this.seleccionarModo(boton.dataset.modo));
    }
    UI.refs.formulario().addEventListener("submit", (evento) => {
      evento.preventDefault();
      this.buscar(UI.refs.entrada().value.trim());
    });
    // Los filtros trabajan exclusivamente sobre los datos ya cargados.
    // Cambiarlos nunca debe provocar una nueva peticion a ESPN.
    UI.refs.selector().addEventListener("change", () => this.render());
    UI.refs.selectorSede().addEventListener("change", () => this.render());
    UI.refs.selectorCompeticion().addEventListener("change", () => this.render());
    UI.refs.selectorLinea().addEventListener("change", () => this.render());
    UI.refs.selectorMetricaTiros().addEventListener("change", () => {
      UI.configurarLineas("tiros");
      this.render();
    });
    UI.refs.botonProyeccion().addEventListener("click", () => {
      if (!this.estado.duelo) return;
      this.actualizarTabsProyeccion();
      this.renderProyeccion();
      UI.refs.modalProyeccion().showModal();
    });
    UI.refs.cerrarProyeccion().addEventListener("click", () => UI.refs.modalProyeccion().close());
    for (const select of [UI.refs.selectorProyeccionGoles(), UI.refs.selectorProyeccionCorners()]) {
      select.addEventListener("change", () => this.renderProyeccion());
    }
    for (const tab of UI.refs.tabsProyeccion()) {
      tab.addEventListener("click", () => {
        this.estado.vistaProyeccion = tab.dataset.vista;
        this.actualizarTabsProyeccion();
        this.renderProyeccion();
      });
    }
    UI.refs.modalProyeccion().addEventListener("click", (evento) => {
      if (evento.target === UI.refs.modalProyeccion()) UI.refs.modalProyeccion().close();
    });
  },

  seleccionarModo(modo) {
    if (this.estado.modo === modo) return;
    this.estado.modo = modo;
    UI.activarModo(modo);
    UI.refs.botonProyeccion().disabled = modo !== "comparar" || !this.estado.duelo;
    UI.renderEjemplos(modo, (texto) => {
      UI.refs.entrada().value = texto;
      this.buscar(texto);
    });
    UI.mostrarEstado("");
    UI.limpiar();
    if (modo === "hoy") this.cargarPartidosHoy();
    else this.render(); // si ya hay datos en cache para este modo, se pintan directamente
  },

  fechaLocalYmd(desplazamiento = 0) {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + desplazamiento);
    return [fecha.getFullYear(), String(fecha.getMonth() + 1).padStart(2, "0"), String(fecha.getDate()).padStart(2, "0")].join("");
  },

  async cargarPartidosHoy() {
    return this.cargarAgenda(0);
  },

  async cargarAgenda(dia = 0) {
    const etiqueta = dia === 1 ? "mañana" : "hoy";
    const fecha = this.fechaLocalYmd(dia);
    this.estado.agendaDia = dia;
    if (this.estado.agendas[fecha]) {
      this.estado.agenda = this.estado.agendas[fecha];
      UI.mostrarEstado("");
      this.render();
      this.subirAAgenda();
      return;
    }
    UI.limpiar();
    UI.mostrarEsqueleto();
    UI.mostrarEstado(`Consultando los partidos de ${etiqueta}…`, { cargando: true });
    try {
      const { resultado: ligas, peticiones, fallos } = await this.midiendo(() => Datos.partidosDelDia(fecha));
      if (!ligas) {
        this.avisarVacio(fallos, `ESPN no devolvió la agenda de ${etiqueta}.`);
        return;
      }
      this.estado.agendas[fecha] = ligas;
      this.estado.agenda = ligas;
      const total = ligas.reduce((suma, liga) => suma + liga.partidos.length, 0);
      if (!total) {
        UI.mostrarEstado(`No hay partidos de fútbol publicados para ${etiqueta}.`);
        this.render();
        this.subirAAgenda();
        return;
      }
      this.anunciarCoste(total, peticiones);
      this.render();
      this.subirAAgenda();
    } catch (error) {
      UI.limpiar();
      UI.mostrarEstado(`Error al cargar la agenda: ${error.message}`, { error: true });
    }
  },

  subirAAgenda() {
    // Al sustituir contenido, algunos navegadores móviles conservan el anclaje inferior.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const resultados = UI.refs.resultados();
      const destino = resultados.getBoundingClientRect().top + window.scrollY - 76;
      window.scrollTo({ top: Math.max(0, destino), behavior: "auto" });
    }));
  },

  async analizarPartidoHoy(partido, liga) {
    const respaldo = (equipo) => ({
      uid: equipo.uid,
      displayName: equipo.displayName,
      abbreviation: equipo.abbreviation,
      defaultLeagueSlug: liga.slug,
      subtitle: liga.nombre,
      image: { default: equipo.logo },
    });
    this.seleccionarModo("comparar");
    UI.refs.selectorSede().value = "partido";
    UI.refs.entrada().value = `${partido.local.displayName} vs ${partido.visitante.displayName}`;
    UI.refs.boton().disabled = true;
    UI.refs.botonProyeccion().disabled = true;
    UI.mostrarEstado("Identificando los equipos y cargando su forma reciente…", { cargando: true });
    try {
      // La agenda indica la competición del partido, pero no siempre la liga
      // habitual del club (p. ej. Leagues Cup). La búsqueda aporta esa liga
      // principal y evita analizar únicamente el torneo del encuentro.
      const resolver = async (equipo) => {
        const local = await FuenteLocal.candidatoPorId(equipo.id);
        if (local) return local;
        const candidatos = await this.candidatosDe(equipo.displayName, "team");
        return candidatos.find((c) => Logica.idDesdeUid(c.uid, "t") === equipo.id)
          || candidatos[0]
          || respaldo(equipo);
      };
      const [local, visitante] = await Promise.all([resolver(partido.local), resolver(partido.visitante)]);
      await this.compararEquipos(local, visitante);
    } catch (error) {
      UI.mostrarEstado(`No se pudo analizar el partido: ${error.message}`, { error: true });
    } finally {
      UI.refs.boton().disabled = false;
    }
  },

  /** Ejecuta una tarea contando lo que costó: peticiones hechas y fallos de red. */
  async midiendo(tarea) {
    const peticionesAntes = Cache.peticiones;
    const fallosAntes = Cache.fallos;
    const resultado = await tarea();
    return {
      resultado,
      peticiones: Cache.peticiones - peticionesAntes,
      fallos: Cache.fallos - fallosAntes,
    };
  },

  /** Un resultado vacío puede ser "no hay datos" o "no se pudo conectar":
      hay que decir cuál de los dos, porque el remedio es distinto. */
  avisarVacio(fallos, mensajeSinDatos) {
    UI.limpiar();
    if (fallos > 0) {
      UI.mostrarEstado(
        "No se pudo conectar con ESPN (puede estar limitando las peticiones). Inténtalo de nuevo en unos minutos.",
        { error: true },
      );
    } else {
      UI.mostrarEstado(mensajeSinDatos, { error: true });
    }
  },

  buscar(texto) {
    if (!texto) return;
    if (this.estado.modo === "comparar") return this.compararDesdeTexto(texto);
    return this.buscarComo(texto, CONFIG.modos[this.estado.modo].tipo);
  },

  /** Busca, traduce el nombre si hace falta ("españa" -> "spain") y prioriza:
      la coincidencia exacta gana, y en equipos se ocultan femeninos y
      juveniles a menos que se hayan pedido. */
  async candidatosDe(nombre, tipo) {
    const esEquipo = tipo === "team";
    const consulta = esEquipo ? Logica.aliasDeBusqueda(nombre) : nombre;
    const locales = esEquipo ? await FuenteLocal.buscarEquipos(consulta) : null;
    const encontrados = locales?.length ? locales : await Api.buscar(consulta, tipo);
    return Logica.priorizarCandidatos(encontrados, consulta, { filtrarCategorias: esEquipo });
  },

  async buscarComo(nombre, tipo) {
    UI.limpiar();
    UI.refs.boton().disabled = true;
    UI.mostrarEstado(`Buscando "${nombre}"…`, { cargando: true });
    try {
      const candidatos = await this.candidatosDe(nombre, tipo);
      if (!candidatos.length) {
        const que = tipo === "player" ? "jugador" : "equipo";
        UI.mostrarEstado(`No se encontró ningún ${que} con el nombre "${nombre}".`, { error: true });
        return;
      }
      if (candidatos.length === 1) {
        await this.elegir(candidatos[0]);
        return;
      }
      UI.mostrarEstado("Se encontraron varios resultados — elige uno:");
      UI.renderCandidatos(candidatos, tipo, (candidato) => this.elegir(candidato));
    } catch (error) {
      UI.mostrarEstado(`Error al buscar: ${error.message}`, { error: true });
    } finally {
      UI.refs.boton().disabled = false;
    }
  },

  /** Muestra la lista de candidatos y resuelve con el que elija el usuario. */
  elegirEntre(candidatos, etiqueta) {
    if (candidatos.length === 1) return Promise.resolve(candidatos[0]);
    UI.mostrarEstado(`Varios resultados para "${etiqueta}" — elige uno:`);
    return new Promise((resolver) => {
      UI.renderCandidatos(candidatos, "team", (candidato) => {
        UI.refs.candidatos().replaceChildren();
        resolver(candidato);
      });
    });
  },

  elegir(candidato) {
    return this.estado.modo === "tiros" ? this.elegirJugador(candidato) : this.elegirEquipo(candidato);
  },

  /* ---------- Jugador ---------- */

  async elegirJugador(candidato) {
    const id = Logica.idDesdeUid(candidato.uid, "a");
    if (!id) {
      UI.mostrarEstado("No se pudo obtener el id de este jugador.", { error: true });
      return;
    }
    UI.limpiar();
    UI.mostrarEsqueleto();
    UI.mostrarEstado(`Descargando partidos de ${candidato.displayName}…`, { cargando: true });
    try {
      const jugador = { id, nombre: candidato.displayName, idEquipo: null };
      const { resultado: filas, peticiones, fallos } = await this.midiendo(() => Datos.partidosDeJugador(jugador));
      if (!filas) {
        this.avisarVacio(fallos, "ESPN no tiene partidos registrados para este jugador.");
        return;
      }
      if (!filas.length) {
        this.avisarVacio(fallos, "ESPN no tiene estadísticas de partidos para este jugador.");
        return;
      }
      this.estado.jugador = { candidato, id, filas };
      this.anunciarCoste(filas.length, peticiones);
      this.render();
    } catch (error) {
      UI.limpiar();
      UI.mostrarEstado(`Error al descargar los partidos: ${error.message}`, { error: true });
    }
  },

  /* ---------- Equipo ---------- */

  /** { equipo, id, ligas } — lo que necesita la capa de datos. */
  ladoDeEquipo(candidato, { conAmistosos = true } = {}) {
    const id = Logica.idDesdeUid(candidato.uid, "t");
    if (!id) return null;
    const ligas = Logica.ligasDeEquipo(candidato.defaultLeagueSlug)
      .filter((liga) => conAmistosos || !liga.includes("friendly"));
    return { equipo: candidato, id, ligas };
  },

  /** Partidos que hay que traer como mínimo: los que se van a mostrar. */
  minimoPedido() {
    return Number(UI.refs.selector().value) || 10;
  },

  /** Se precarga una sola vez un conjunto amplio. Así los filtros posteriores
      son instantáneos y no dependen de la red. */
  minimoDescarga() {
    return CONFIG.ventana.precargaEquipos;
  },

  filtroSedeActivo() {
    return UI.refs.selectorSede()?.value || "todos";
  },

  filtrarPorSede(filas, lado = null) {
    const filtro = this.filtroSedeActivo();
    if (filtro === "local") return filas.filter((fila) => fila.enCasa);
    if (filtro === "visita") return filas.filter((fila) => !fila.enCasa);
    if (filtro === "partido" && lado === "a") return filas.filter((fila) => fila.enCasa);
    if (filtro === "partido" && lado === "b") return filas.filter((fila) => !fila.enCasa);
    return filas;
  },

  filtrarCompeticion(filas) {
    const competicion = UI.refs.selectorCompeticion().value;
    return competicion === "todos" ? filas : filas.filter((fila) => fila.competicion === competicion);
  },

  filtrar(filas, { sede = true, lado = null } = {}) {
    const porCompeticion = this.filtrarCompeticion(filas);
    return sede ? this.filtrarPorSede(porCompeticion, lado) : porCompeticion;
  },

  async elegirEquipo(candidato) {
    const lado = this.ladoDeEquipo(candidato);
    if (!lado) {
      UI.mostrarEstado("No se pudo obtener el id de este equipo.", { error: true });
      return;
    }
    UI.limpiar();
    UI.mostrarEsqueleto();
    try {
      const { resultado, peticiones, fallos } = await this.midiendo(() =>
        Datos.partidosDeEquipos([lado], {
          minimo: this.minimoDescarga(),
          alAvanzar: (tramo) => UI.mostrarEstado(
            `Descargando partidos de ${candidato.displayName}… (${tramo === 1 ? "últimos meses" : `ampliando a ${tramo * CONFIG.ventana.meses} meses`})`,
            { cargando: true },
          ),
        })
      );
      const [filas] = resultado.listas;
      if (!filas.length) {
        this.avisarVacio(fallos, "ESPN no tiene partidos recientes para este equipo.");
        return;
      }
      this.estado.equipo = { ...lado, filas, tramosUsados: resultado.tramosUsados };
      this.anunciarCoste(filas.length, peticiones);
      this.render();
    } catch (error) {
      UI.limpiar();
      UI.mostrarEstado(`Error al descargar los partidos: ${error.message}`, { error: true });
    }
  },

  /* ---------- Comparar ---------- */

  async compararDesdeTexto(texto) {
    const partes = Logica.partirDuelo(texto);
    if (!partes) {
      UI.mostrarEstado('Escribe los dos equipos separados por «vs», por ejemplo: "América vs Tigres".', { error: true });
      return;
    }
    const [nombreA, nombreB] = partes;
    UI.refs.botonProyeccion().disabled = true;
    UI.limpiar();
    UI.refs.boton().disabled = true;
    try {
      UI.mostrarEstado(`Buscando "${nombreA}" y "${nombreB}"…`, { cargando: true });
      const [candidatosA, candidatosB] = await Promise.all([
        this.candidatosDe(nombreA, "team"),
        this.candidatosDe(nombreB, "team"),
      ]);
      const sinResultados = !candidatosA.length ? nombreA : !candidatosB.length ? nombreB : null;
      if (sinResultados) {
        UI.mostrarEstado(`No se encontró ningún equipo con el nombre "${sinResultados}".`, { error: true });
        return;
      }
      // Si hay ambigüedad se elige primero un equipo y luego el otro
      const equipoA = await this.elegirEntre(candidatosA, nombreA);
      const equipoB = await this.elegirEntre(candidatosB, nombreB);
      await this.compararEquipos(equipoA, equipoB);
    } catch (error) {
      UI.mostrarEstado(`Error al comparar: ${error.message}`, { error: true });
    } finally {
      UI.refs.boton().disabled = false;
    }
  },

  async compararEquipos(equipoA, equipoB) {
    // Los amistosos no dicen nada del rendimiento: fuera de la comparativa
    const ladoA = this.ladoDeEquipo(equipoA, { conAmistosos: false });
    const ladoB = this.ladoDeEquipo(equipoB, { conAmistosos: false });
    if (!ladoA || !ladoB) {
      UI.mostrarEstado("No se pudo obtener el id de uno de los equipos.", { error: true });
      return;
    }

    UI.mostrarEsqueleto();
    const { resultado, peticiones, fallos } = await this.midiendo(async () => {
      const [recientes, cruces] = await Promise.all([
        Datos.partidosDeEquipos([ladoA, ladoB], {
          minimo: this.minimoDescarga(),
          alAvanzar: (tramo) => UI.mostrarEstado(
            `Comparando ${equipoA.displayName} y ${equipoB.displayName}… (forma reciente)`,
            { cargando: true },
          ),
        }),
        Datos.enfrentamientosHistoricos(ladoA, ladoB, { temporadas: 6 }),
      ]);
      return { recientes, cruces };
    });
    const [filasA, filasB] = resultado.recientes.listas;
    if (!filasA.length || !filasB.length) {
      const vacio = !filasA.length ? equipoA.displayName : equipoB.displayName;
      this.avisarVacio(fallos, `ESPN no tiene partidos recientes de ${vacio}.`);
      return;
    }

      this.estado.duelo = {
      a: { ...ladoA, filas: filasA },
      b: { ...ladoB, filas: filasB },
      cruces: resultado.cruces,
      tramosUsados: resultado.recientes.tramosUsados,
    };
    UI.refs.botonProyeccion().disabled = false;
    this.anunciarCoste(filasA.length + filasB.length, peticiones);
    this.render();
  },

  /** Deja claro lo que costó: peticiones reales y cuántas se ahorraron. */
  anunciarCoste(partidos, peticiones) {
    if (!peticiones) {
      UI.mostrarEstado(`${partidos} partidos servidos desde datos locales, sin pedir nada a ESPN.`);
    } else {
      UI.mostrarEstado(`${partidos} partidos con ${peticiones} ${peticiones === 1 ? "petición" : "peticiones"} a ESPN.`);
    }
  },

  /* ---------- Render ---------- */

  renderProyeccion() {
    const { duelo } = this.estado;
    if (!duelo) return;
    const cuantos = Number(UI.refs.selector().value);
    const lado = (datos, letra) => {
      const filas = this.filtrar(datos.filas, { lado: letra }).slice(0, cuantos);
      return { ...datos, filas, perfil: Logica.perfil(filas) };
    };
    const soloCompeticion = (filas) => this.filtrarCompeticion(filas);
    const localesA = soloCompeticion(duelo.a.filas).filter((fila) => fila.enCasa).slice(0, cuantos);
    const visitasB = soloCompeticion(duelo.b.filas).filter((fila) => !fila.enCasa).slice(0, cuantos);
    const cruces = soloCompeticion(duelo.cruces || []);
    const crucesMismaSede = cruces.filter((fila) => fila.enCasa);
    const panel = Vistas.panelProyeccion(lado(duelo.a, "a"), lado(duelo.b, "b"), {
      lineaGoles: Number(UI.refs.selectorProyeccionGoles().value),
      lineaCorners: Number(UI.refs.selectorProyeccionCorners().value),
      vista: this.estado.vistaProyeccion,
      filasResultadoA: localesA,
      filasResultadoB: visitasB,
      cruces: crucesMismaSede.length >= 2 ? crucesMismaSede : cruces,
    });
    UI.refs.contenidoProyeccion().replaceChildren(panel);
  },

  actualizarTabsProyeccion() {
    const vista = this.estado.vistaProyeccion;
    for (const tab of UI.refs.tabsProyeccion()) {
      const activo = tab.dataset.vista === vista;
      tab.classList.toggle("activo", activo);
      tab.setAttribute("aria-selected", String(activo));
    }
    UI.refs.controlLineaGoles().hidden = vista !== "goles";
    UI.refs.controlLineaCorners().hidden = vista !== "corners";
  },

  render() {
    const { modo, jugador, equipo, duelo } = this.estado;
    const cuantos = Number(UI.refs.selector().value);

    const disponibles = modo === "tiros" && jugador ? jugador.filas
      : (modo === "partidos" || modo === "corners") && equipo ? equipo.filas
        : modo === "comparar" && duelo ? (() => {
          const enB = new Set(duelo.b.filas.map((fila) => fila.competicion));
          return duelo.a.filas.filter((fila) => enB.has(fila.competicion));
        })() : [];
    if (disponibles.length) UI.actualizarCompeticiones(disponibles);

    const linea = Number(UI.refs.selectorLinea().value);
    if (modo === "tiros" && jugador) {
      Vistas.jugador(jugador.candidato, jugador.id, this.filtrar(jugador.filas, { sede: false }).slice(0, cuantos), {
        linea,
        metrica: UI.refs.selectorMetricaTiros().value,
      });
    } else if (modo === "partidos" && equipo) {
      Vistas.partidos(equipo.equipo, this.filtrar(equipo.filas).slice(0, cuantos), { linea });
    } else if (modo === "corners" && equipo) {
      Vistas.corners(equipo.equipo, this.filtrar(equipo.filas).slice(0, cuantos), { linea });
    } else if (modo === "comparar" && duelo) {
      // Recortar y recalcular: cambiar el número de partidos no vuelve a descargar
      const conPerfil = (lado, letra) => {
        const filas = this.filtrar(lado.filas, { lado: letra }).slice(0, cuantos);
        // filasTodas conserva la descarga completa: los enfrentamientos directos
        // se buscan ahí, no solo entre los partidos mostrados
        return { ...lado, filas, filasTodas: lado.filas, perfil: Logica.perfil(filas) };
      };
      Vistas.comparacion(
        conPerfil(duelo.a, "a"),
        conPerfil(duelo.b, "b"),
        this.filtrar(duelo.cruces || [], { lado: "a" }),
        this.filtroSedeActivo(),
      );
      if (UI.refs.modalProyeccion().open) this.renderProyeccion();
    } else if (modo === "hoy" && this.estado.agenda) {
      Vistas.hoy(
        this.estado.agenda,
        (partido, liga) => this.analizarPartidoHoy(partido, liga),
        { dia: this.estado.agendaDia, alCambiarDia: (dia) => this.cargarAgenda(dia) },
      );
    }
  },
};

if (typeof document !== "undefined") App.init();
