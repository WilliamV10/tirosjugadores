"use strict";

/* ============================================================
   App — controlador: estado y flujo
   ============================================================ */
const App = {
  estado: {
    modo: null,             // "tiros" | "partidos" | "corners" | "comparar"
    jugador: null,          // { candidato, id, filas }
    equipo: null,           // { equipo, id, filas }
    duelo: null,            // { a: lado, b: lado }
  },

  init() {
    for (const boton of UI.refs.modos().querySelectorAll(".modo")) {
      boton.addEventListener("click", () => this.seleccionarModo(boton.dataset.modo));
    }
    UI.refs.formulario().addEventListener("submit", (evento) => {
      evento.preventDefault();
      this.buscar(UI.refs.entrada().value.trim());
    });
    UI.refs.selector().addEventListener("change", () => this.cambiarCantidad());
    this.revisarBase();
  },

  /** Estado de la base local: si está disponible y qué guarda. */
  async revisarBase() {
    if (!(await BD.lista())) {
      UI.mostrarBase({ activa: false });
      return;
    }
    BD.pedirPersistencia(); // que el navegador no borre los datos sin avisar
    const { inventario, espacio } = await Repositorio.resumenAlmacen();
    UI.mostrarBase({
      activa: true,
      partidos: inventario.partidos,
      equipos: inventario.equipos,
      usados: espacio.usados,
    });
  },

  seleccionarModo(modo) {
    if (this.estado.modo === modo) return;
    this.estado.modo = modo;
    UI.activarModo(modo);
    UI.renderEjemplos(modo, (texto) => {
      UI.refs.entrada().value = texto;
      this.buscar(texto);
    });
    UI.mostrarEstado("");
    UI.limpiar();
    this.render(); // si ya hay datos en cache para este modo, se pintan directamente
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
    const encontrados = await Api.buscar(consulta, tipo);
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
          minimo: this.minimoPedido(),
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
    const { resultado, peticiones, fallos } = await this.midiendo(() =>
      Datos.partidosDeEquipos([ladoA, ladoB], {
        minimo: this.minimoPedido(),
        alAvanzar: (tramo) => UI.mostrarEstado(
          `Comparando ${equipoA.displayName} y ${equipoB.displayName}… (tramo ${tramo})`,
          { cargando: true },
        ),
      })
    );
    const [filasA, filasB] = resultado.listas;
    if (!filasA.length || !filasB.length) {
      const vacio = !filasA.length ? equipoA.displayName : equipoB.displayName;
      this.avisarVacio(fallos, `ESPN no tiene partidos recientes de ${vacio}.`);
      return;
    }

    this.estado.duelo = {
      a: { ...ladoA, filas: filasA },
      b: { ...ladoB, filas: filasB },
      tramosUsados: resultado.tramosUsados,
    };
    this.anunciarCoste(filasA.length + filasB.length, peticiones);
    this.render();
  },

  /** Deja claro lo que costó: peticiones reales y cuántas se ahorraron. */
  anunciarCoste(partidos, peticiones) {
    if (!peticiones) {
      UI.mostrarEstado(`${partidos} partidos servidos desde la base local, sin pedir nada a ESPN.`);
    } else {
      UI.mostrarEstado(`${partidos} partidos con ${peticiones} ${peticiones === 1 ? "petición" : "peticiones"} a ESPN.`);
    }
    this.revisarBase(); // el pie refleja lo que acaba de entrar en la base
  },

  /* ---------- Cambio de cantidad ---------- */

  /** Al pedir más partidos de los descargados se amplía la ventana de fechas.
      Como las respuestas ya vistas están en caché, ampliar cuesta solo los
      tramos nuevos; si ya se agotaron, se pinta con lo que haya. */
  async cambiarCantidad() {
    const { modo, equipo, duelo } = this.estado;
    const cuantos = Number(UI.refs.selector().value);
    const agotado = (tramosUsados) => tramosUsados >= CONFIG.ventana.tramosMaximos;

    try {
      if ((modo === "partidos" || modo === "corners") && equipo
          && equipo.filas.length < cuantos && !agotado(equipo.tramosUsados)) {
        UI.mostrarEstado("Ampliando la búsqueda a más meses…", { cargando: true });
        const { resultado, peticiones } = await this.midiendo(() =>
          Datos.partidosDeEquipos([equipo], { minimo: cuantos })
        );
        equipo.filas = resultado.listas[0];
        equipo.tramosUsados = resultado.tramosUsados;
        this.anunciarCoste(equipo.filas.length, peticiones);
      } else if (modo === "comparar" && duelo
          && (duelo.a.filas.length < cuantos || duelo.b.filas.length < cuantos)
          && !agotado(duelo.tramosUsados)) {
        UI.mostrarEstado("Ampliando la búsqueda a más meses…", { cargando: true });
        const { resultado, peticiones } = await this.midiendo(() =>
          Datos.partidosDeEquipos([duelo.a, duelo.b], { minimo: cuantos })
        );
        [duelo.a.filas, duelo.b.filas] = resultado.listas;
        duelo.tramosUsados = resultado.tramosUsados;
        this.anunciarCoste(duelo.a.filas.length + duelo.b.filas.length, peticiones);
      }
    } catch (error) {
      UI.mostrarEstado(`Error al ampliar la búsqueda: ${error.message}`, { error: true });
    }
    this.render();
  },

  /* ---------- Render ---------- */

  render() {
    const { modo, jugador, equipo, duelo } = this.estado;
    const cuantos = Number(UI.refs.selector().value);

    if (modo === "tiros" && jugador) {
      Vistas.jugador(jugador.candidato, jugador.id, jugador.filas.slice(0, cuantos));
    } else if (modo === "partidos" && equipo) {
      Vistas.partidos(equipo.equipo, equipo.filas.slice(0, cuantos));
    } else if (modo === "corners" && equipo) {
      Vistas.corners(equipo.equipo, equipo.filas.slice(0, cuantos));
    } else if (modo === "comparar" && duelo) {
      // Recortar y recalcular: cambiar el número de partidos no vuelve a descargar
      const conPerfil = (lado) => {
        const filas = lado.filas.slice(0, cuantos);
        // filasTodas conserva la descarga completa: los enfrentamientos directos
        // se buscan ahí, no solo entre los partidos mostrados
        return { ...lado, filas, filasTodas: lado.filas, perfil: Logica.perfil(filas) };
      };
      Vistas.comparacion(conPerfil(duelo.a), conPerfil(duelo.b));
    }
  },
};

if (typeof document !== "undefined") App.init();
