"use strict";

/* ============================================================
   Repositorio — consultas de dominio sobre la base

   Aquí viven las "sentencias": guardar lo que llega de ESPN y sacar
   de la base exactamente lo que piden las vistas. Es la única capa
   que conoce a la vez el modelo relacional y el formato de las filas.
   ============================================================ */
const Repositorio = {
  /** Rango completo de una clave compuesta [id, fecha].
      Un array es mayor que cualquier fecha en el orden de IndexedDB,
      así que [id] … [id, []] cubre todas las fechas de ese id. */
  _rangoDe(id) {
    return IDBKeyRange.bound([id], [id, []]);
  },

  /* ============================================================
     Escritura
     ============================================================ */

  /** Guarda un marcador de liga entero: liga, equipos, participaciones,
      partidos y estadísticas por equipo. Todo en una sola transacción. */
  async guardarMarcador(datosMarcador) {
    const { liga, equipos, partidos, estadisticas } = Logica.parsearMarcadorCompleto(datosMarcador);
    if (!liga || !partidos.length) return { partidos: 0 };

    // Un equipo aparece en muchos partidos: se deja uno solo de cada
    const porId = new Map(equipos.map((equipo) => [equipo.id, equipo]));
    const participaciones = [...porId.keys()].map((idEquipo) => ({
      idEquipo,
      ligaSlug: liga.slug,
      vistoEn: new Date(),
    }));

    await BD.guardar({
      ligas: [liga],
      equipos: [...porId.values()],
      participaciones,
      partidos,
      estadisticas,
    });
    return { partidos: partidos.length, equipos: porId.size };
  },

  /** Guarda eventos, jugadores y actuaciones de un partido, y lo marca
      como que ya tiene el detalle descargado. */
  async guardarDetalle(resumen, partido) {
    const { eventos, jugadores, actuaciones } = Logica.parsearDetalle(resumen, partido);
    const porId = new Map(jugadores.map((jugador) => [jugador.id, jugador]));

    await BD.guardar({
      eventos,
      jugadores: [...porId.values()],
      actuaciones,
      partidos: [{ ...partido, detalleEn: new Date() }],
    });
    return { eventos: eventos.length, jugadores: porId.size, actuaciones: actuaciones.length };
  },

  /** Guarda el historial de un jugador (sus tiros partido a partido).
      Se fusiona porque el mismo partido puede haber llegado ya desde el
      resumen, con la alineación. */
  async guardarHistorialJugador(jugador, filas) {
    if (!filas.length) return 0;
    const actuaciones = filas.map((fila) => ({
      eventId: fila.eventId,
      idJugador: String(jugador.id),
      fecha: fila.fecha,
      ligaSlug: fila.ligaSlug || null,
      competicion: fila.competicion,
      rival: fila.rival,
      marcador: fila.marcador,
      resultado: fila.resultado,
      goles: fila.goles,
      asistencias: fila.asistencias,
      tiros: fila.tiros,
      tirosPuerta: fila.tirosPuerta,
      amarillas: fila.amarillas,
      origen: "historial",
    }));

    await BD.guardar({ jugadores: [{ id: String(jugador.id), nombre: jugador.nombre, idEquipo: jugador.idEquipo || null }] });
    await BD.fusionar("actuaciones", actuaciones);
    return actuaciones.length;
  },

  /** Historial de un jugador tal y como lo espera la vista de tiros. */
  async historialJugador(idJugador, { limite = 20 } = {}) {
    const actuaciones = await this.actuacionesDeJugador(idJugador, { limite });
    return actuaciones
      .filter((a) => a.origen === "historial")
      .map((a) => ({
        eventId: a.eventId,
        fecha: a.fecha instanceof Date ? a.fecha : new Date(a.fecha),
        rival: a.rival,
        competicion: a.competicion,
        resultado: a.resultado,
        marcador: a.marcador,
        goles: a.goles,
        asistencias: a.asistencias,
        tiros: a.tiros,
        tirosPuerta: a.tirosPuerta,
        amarillas: a.amarillas,
      }));
  },

  /* ============================================================
     Cobertura — que se ha descargado ya
     ============================================================ */

  /** Un tramo ya cerrado en el pasado no cambia nunca; el que llega hasta
      hoy sí, porque pueden jugarse partidos nuevos. */
  async estaCubierto(ligaSlug, rango) {
    const registro = await BD.obtener("cobertura", [ligaSlug, rango]);
    if (!registro) return false;

    const finTexto = String(rango).split("-")[1] || "";
    const fin = new Date(
      `${finTexto.slice(0, 4)}-${finTexto.slice(4, 6)}-${finTexto.slice(6, 8)}T23:59:59`
    );
    const yaPasado = Number.isFinite(fin.getTime()) && fin < new Date();
    if (yaPasado) return true; // histórico: vale para siempre

    const edad = Date.now() - new Date(registro.descargadoEn).getTime();
    return edad < CONFIG.cacheMinutos * 60 * 1000;
  },

  marcarCobertura(ligaSlug, rango, partidos) {
    return BD.guardar({
      cobertura: [{ ligaSlug, rango, descargadoEn: new Date(), partidos }],
    });
  },

  /* ============================================================
     Lectura — lo que consumen las vistas
     ============================================================ */

  /** Últimos partidos de un equipo, ya ordenados del más reciente al más
      viejo. Una sola consulta gracias al índice [idEquipo, fecha]. */
  async partidosDeEquipo(idEquipo, { limite = 20 } = {}) {
    const estadisticas = await BD.consultar("estadisticas", {
      indice: "porEquipoFecha",
      rango: this._rangoDe(String(idEquipo)),
      descendente: true,
      limite,
    });
    return estadisticas.map((estadistica) => Logica.filaDesdeEstadistica(estadistica));
  },

  /** Cuantos partidos guardados tiene un equipo. */
  contarPartidosDeEquipo(idEquipo) {
    return BD.contar("estadisticas", {
      indice: "porEquipoFecha",
      rango: this._rangoDe(String(idEquipo)),
    });
  },

  /** Todos los equipos vistos en una competición. */
  async equiposDeLiga(ligaSlug) {
    const participaciones = await BD.consultar("participaciones", {
      indice: "porLiga",
      rango: IDBKeyRange.only(ligaSlug),
    });
    const equipos = await Promise.all(
      participaciones.map((p) => BD.obtener("equipos", p.idEquipo))
    );
    return equipos.filter(Boolean).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  },

  /** Partidos de una competición entre dos fechas (para análisis de liga). */
  async partidosDeLiga(ligaSlug, { desde = new Date(0), hasta = new Date(), limite = Infinity } = {}) {
    return BD.consultar("partidos", {
      indice: "porLigaFecha",
      rango: IDBKeyRange.bound([ligaSlug, desde], [ligaSlug, hasta]),
      descendente: true,
      limite,
    });
  },

  /** Estadísticas de todos los equipos de una liga en un periodo: es la
      base de rankings ("quién saca más córners en Liga MX"). */
  async estadisticasDeLiga(ligaSlug, { desde = new Date(0), hasta = new Date() } = {}) {
    return BD.consultar("estadisticas", {
      indice: "porLigaFecha",
      rango: IDBKeyRange.bound([ligaSlug, desde], [ligaSlug, hasta]),
    });
  },

  /** Últimas actuaciones de un jugador (sus tiros partido a partido). */
  async actuacionesDeJugador(idJugador, { limite = 20 } = {}) {
    return BD.consultar("actuaciones", {
      indice: "porJugadorFecha",
      rango: this._rangoDe(String(idJugador)),
      descendente: true,
      limite,
    });
  },

  /** Eventos de un partido (goles, tarjetas, cambios) en orden. */
  async eventosDePartido(eventId) {
    const eventos = await BD.consultar("eventos", {
      indice: "porPartido",
      rango: IDBKeyRange.only(String(eventId)),
    });
    const minuto = (evento) => parseInt(String(evento.minuto).replace(/\D/g, ""), 10) || 0;
    return eventos.sort((a, b) => minuto(a) - minuto(b));
  },

  /** Goles de un jugador guardados en la base. */
  async golesDeJugador(idJugador) {
    const eventos = await BD.consultar("eventos", {
      indice: "porJugador",
      rango: IDBKeyRange.only(String(idJugador)),
    });
    return eventos.filter((evento) => evento.esGol);
  },

  /** Enfrentamientos directos entre dos equipos, desde la base. */
  async enfrentamientos(idEquipoA, idEquipoB) {
    const partidos = await this.partidosDeEquipo(idEquipoA, { limite: Infinity });
    return partidos.filter((partido) => partido.idRival === String(idEquipoB));
  },

  /** Resumen de lo guardado, para poder enseñarlo en la interfaz. */
  async resumenAlmacen() {
    const [inventario, espacio] = await Promise.all([BD.inventario(), BD.espacio()]);
    return { inventario, espacio };
  },
};
