"use strict";

/* JSON exportado desde SQLite para equipos; ESPN como fuente viva y respaldo. */
const Datos = {
  async partidosDelDia(fecha) {
    const datos = await Api.marcadorDelDia(fecha);
    return datos ? Logica.parsearAgendaDiaria(datos) : null;
  },

  async partidosDeEquipos(equipos, { minimo = 10, alAvanzar = null } = {}) {
    const locales = await FuenteLocal.partidosDeEquipos(equipos);
    if (locales && locales.every((filas) => filas.length > 0)) {
      return { listas: locales, tramosUsados: 0, origen: "json" };
    }
    return this._desdeRed(equipos, { minimo, alAvanzar });
  },

  async enfrentamientosHistoricos(equipoA, equipoB, { temporadas = 6 } = {}) {
    const locales = await FuenteLocal.enfrentamientos(equipoA, equipoB);
    if (locales !== null) return locales;
    const actual = new Date().getFullYear();
    const anios = Array.from({ length: temporadas }, (_, i) => actual - i);
    const calendarios = await Promise.all(
      anios.map((anio) => Api.calendarioEquipo(equipoA.id, anio))
    );
    const filas = calendarios
      .filter(Boolean)
      .flatMap((datos) => Logica.parsearCalendario(datos, equipoA.id));
    return Logica.combinar([filas]).filter((fila) => fila.idRival === String(equipoB.id));
  },

  /** Respaldo sin persistencia: descarga marcadores y los usa sólo en memoria. */
  async _desdeRed(equipos, { minimo, alAvanzar }) {
    const ligas = [...new Set(equipos.flatMap((equipo) => equipo.ligas))];
    const acumulado = equipos.map(() => []);
    let tramosUsados = 0;

    for (let tramo = 0; tramo < CONFIG.ventana.tramosMaximos; tramo++) {
      const rango = Logica.ventana(tramo);
      if (alAvanzar) alAvanzar(tramo + 1);
      const respuestas = await Promise.all(ligas.map((liga) => Api.marcador(liga, rango)));
      const marcadores = respuestas.filter(Boolean);

      equipos.forEach((equipo, indice) => {
        const nuevas = marcadores.map((marcador) => Logica.parsearMarcador(marcador, equipo.id));
        acumulado[indice] = Logica.combinar([acumulado[indice], ...nuevas]);
      });
      tramosUsados = tramo + 1;
      if (acumulado.every((filas) => filas.length >= minimo)) break;
    }
    return { listas: acumulado, tramosUsados, origen: "espn" };
  },

  /** Detalle sin persistencia: eventos, jugadores y actuaciones desde ESPN. */
  async detalleDePartido(partido) {
    const resumen = await Api.resumenPartido(partido.ligaSlug, partido.eventId);
    if (!resumen) return null;
    return { ...Logica.parsearDetalle(resumen, partido), desdeBase: false };
  },
};
