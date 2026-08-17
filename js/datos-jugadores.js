"use strict";

/* Fuente exclusiva de jugadores.
   Sus actuaciones no están en los JSON publicados: se consultan siempre
   en el gamelog vivo de ESPN y sólo se cachean durante la sesión. */
const DatosJugadores = {
  async partidos(jugador) {
    const base = await Api.gamelog(jugador.id, null);
    if (!base) return null;
    const { porDefecto, otras } = Logica.ligasDelClub(base);
    const pendientes = [...new Set([...otras, ...CONFIG.ligasSeleccion])]
      .filter((liga) => liga !== porDefecto);
    const respuestas = await Promise.all(
      pendientes.map((liga) => Api.gamelog(jugador.id, liga))
    );
    return Logica.combinar(
      [base, ...respuestas].filter(Boolean).map((datos) => Logica.parsearPartidos(datos))
    );
  },
};
