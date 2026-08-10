"use strict";

/* ============================================================
   Datos — de dónde salen los partidos

   Con base local el flujo es: leer de la base → pedir a ESPN solo los
   tramos que no estén cubiertos → guardar → volver a leer. Sin base
   (navegador que la bloquea) se cae al camino directo de red, y todo
   lo demás sigue funcionando igual.
   ============================================================ */
const Datos = {
  async partidosDelDia(fecha) {
    const datos = await Api.marcadorDelDia(fecha);
    return datos ? Logica.parsearAgendaDiaria(datos) : null;
  },

  /** Descarga los tramos de liga que aún no estén en la base. Devuelve
      cuántos partidos nuevos se guardaron. */
  async sincronizar(ligas, rango) {
    const pendientes = [];
    for (const liga of ligas) {
      if (!(await Repositorio.estaCubierto(liga, rango))) pendientes.push(liga);
    }
    if (!pendientes.length) return 0;

    // La red primero y fuera de cualquier transacción: una transacción de
    // IndexedDB se cierra sola en cuanto el hilo queda libre
    const respuestas = await Promise.all(pendientes.map((liga) => Api.marcador(liga, rango)));

    let guardados = 0;
    for (const [indice, datos] of respuestas.entries()) {
      if (!datos) continue; // liga inexistente o fallo de red: se reintentará
      const { partidos } = await Repositorio.guardarMarcador(datos);
      await Repositorio.marcarCobertura(pendientes[indice], rango, partidos);
      guardados += partidos;
    }
    return guardados;
  },

  /** Partidos con estadísticas de uno o varios equipos.

      Ahorros: un marcador sirve para todos los equipos de esa liga; los
      tramos se piden de cuatro en cuatro meses y se para en cuanto hay
      partidos suficientes; y lo ya guardado no se vuelve a pedir. */
  async partidosDeEquipos(equipos, { minimo = 10, alAvanzar = null } = {}) {
    if (!(await BD.lista())) return this._sinBase(equipos, { minimo, alAvanzar });

    const ligas = [...new Set(equipos.flatMap((equipo) => equipo.ligas))];
    const leer = () => Promise.all(
      equipos.map((equipo) => Repositorio.partidosDeEquipo(equipo.id, { limite: minimo }))
    );
    const suficientes = (listas) => listas.every((filas) => filas.length >= minimo);

    let tramosUsados = 0;
    let listas = [];
    for (let tramo = 0; tramo < CONFIG.ventana.tramosMaximos; tramo++) {
      if (alAvanzar) alAvanzar(tramo + 1);
      // El tramo que llega hasta hoy se refresca si caducó; los cerrados no
      await this.sincronizar(ligas, Logica.ventana(tramo));
      listas = await leer();
      tramosUsados = tramo + 1;
      if (suficientes(listas)) break;
    }
    return { listas, tramosUsados };
  },

  /** Historial directo eficiente: una peticion por temporada al calendario
      global de A, en lugar de descargar cada liga por ventanas de fechas. */
  async enfrentamientosHistoricos(equipoA, equipoB, { temporadas = 6 } = {}) {
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

  /** Camino sin base: se descarga y se usa en memoria, como antes. */
  async _sinBase(equipos, { minimo, alAvanzar }) {
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
    return { listas: acumulado, tramosUsados };
  },

  /** Partidos de un jugador: historial por competición, guardado en la base
      para que la siguiente consulta no cueste nada. */
  async partidosDeJugador(jugador) {
    const conBase = await BD.lista();
    if (conBase) {
      const guardados = await Repositorio.historialJugador(jugador.id, { limite: 20 });
      if (guardados.length >= 20) return guardados;
    }

    const base = await Api.gamelog(jugador.id, null);
    if (!base) return null;

    const { porDefecto, otras } = Logica.ligasDelClub(base);
    const pendientes = [...new Set([...otras, ...CONFIG.ligasSeleccion])]
      .filter((liga) => liga !== porDefecto);

    const respuestas = await Promise.all(pendientes.map((liga) => Api.gamelog(jugador.id, liga)));
    const filas = Logica.combinar([base, ...respuestas].map((datos) => Logica.parsearPartidos(datos)));

    if (conBase && filas.length) {
      await Repositorio.guardarHistorialJugador(jugador, filas);
    }
    return filas;
  },

  /** Detalle de un partido (eventos, alineaciones y estadísticas de cada
      jugador). Cuesta una petición por partido, así que solo se pide una
      vez: después queda en la base. */
  async detalleDePartido(partido) {
    if (!(await BD.lista())) return null;

    const guardado = await BD.obtener("partidos", partido.eventId);
    if (guardado?.detalleEn) {
      return {
        eventos: await Repositorio.eventosDePartido(partido.eventId),
        desdeBase: true,
      };
    }

    const resumen = await Api.resumenPartido(partido.ligaSlug, partido.eventId);
    if (!resumen) return null;

    await Repositorio.guardarDetalle(resumen, guardado || partido);
    return {
      eventos: await Repositorio.eventosDePartido(partido.eventId),
      desdeBase: false,
    };
  },
};
