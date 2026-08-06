"use strict";

/* ============================================================
   Datos — compone las peticiones (cuantas menos, mejor)
   ============================================================ */
const Datos = {
  /** Partidos con estadisticas de uno o varios equipos.

      Dos ahorros importantes:
      1. El marcador de una liga sirve para TODOS los equipos de esa liga, asi
         que comparar dos rivales de la misma liga cuesta lo mismo que uno.
      2. Se pide tramo a tramo (4 meses cada uno) y se para en cuanto todos
         tienen partidos suficientes: pedir los últimos 5 no descarga un año. */
  async partidosDeEquipos(equipos, { minimo = 10, alAvanzar = null } = {}) {
    const ligas = [...new Set(equipos.flatMap((equipo) => equipo.ligas))];
    const acumulado = equipos.map(() => []);
    const suficientes = () => acumulado.every((filas) => filas.length >= minimo);

    let tramosUsados = 0;
    for (let tramo = 0; tramo < CONFIG.ventana.tramosMaximos; tramo++) {
      const rango = Logica.ventana(tramo);
      if (alAvanzar) alAvanzar(tramo + 1);

      // Las ligas muertas ya se filtran solas dentro de Api.marcador
      const respuestas = await Promise.all(ligas.map((liga) => Api.marcador(liga, rango)));
      const marcadores = respuestas.filter(Boolean);

      equipos.forEach((equipo, indice) => {
        const nuevas = marcadores.map((marcador) => Logica.parsearMarcador(marcador, equipo.id));
        acumulado[indice] = Logica.combinar([acumulado[indice], ...nuevas]);
      });

      tramosUsados = tramo + 1;
      if (suficientes()) break;
    }
    // `tramosUsados` permite saber si aún se puede ampliar la ventana cuando el
    // usuario pide más partidos de los que se descargaron
    return { listas: acumulado, tramosUsados };
  },

  /** Partidos de un jugador: gamelog por defecto + el resto de competiciones. */
  async partidosDeJugador(idAtleta) {
    const base = await Api.gamelog(idAtleta, null);
    if (!base) return null;

    const { porDefecto, otras } = Logica.ligasDelClub(base);
    const pendientes = [...new Set([...otras, ...CONFIG.ligasSeleccion])]
      .filter((liga) => liga !== porDefecto);

    const respuestas = await Promise.all(pendientes.map((liga) => Api.gamelog(idAtleta, liga)));
    return Logica.combinar([base, ...respuestas].map((datos) => Logica.parsearPartidos(datos)));
  },
};
