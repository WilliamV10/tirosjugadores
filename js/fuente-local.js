"use strict";

/* JSON estático generado desde SQLite. En file:// fetch suele estar bloqueado,
   por eso cualquier fallo devuelve null y la aplicación conserva ESPN como respaldo. */
const FuenteLocal = {
  _indice: undefined,
  _archivos: new Map(),

  async indice() {
    if (this._indice !== undefined) return this._indice;
    try {
      const respuesta = await fetch("datos/indice.json", { cache: "no-cache" });
      this._indice = respuesta.ok ? await respuesta.json() : null;
    } catch {
      this._indice = null;
    }
    return this._indice;
  },

  async archivo(ruta) {
    if (!this._archivos.has(ruta)) {
      this._archivos.set(ruta, fetch(`datos/${ruta}`).then((r) => {
        if (!r.ok) throw new Error(`JSON local ${r.status}`);
        return r.json();
      }).catch(() => null));
    }
    return this._archivos.get(ruta);
  },

  candidato(entrada) {
    const liga = entrada.competiciones.find((slug) => /\.1$/.test(slug)) || entrada.competiciones[0] || "";
    return {
      uid: `s:600~t:${entrada.id}`, displayName: entrada.nombre,
      abbreviation: entrada.abreviatura || "", defaultLeagueSlug: liga,
      subtitle: liga, sport: "soccer", image: { default: entrada.escudo || "" },
    };
  },

  async buscarEquipos(texto) {
    const indice = await this.indice();
    if (!indice) return null;
    const buscado = Logica.normalizar(texto);
    return Object.values(indice.equipos)
      .filter((e) => Logica.normalizar(e.nombre).includes(buscado))
      .slice(0, 10).map((e) => this.candidato(e));
  },

  async candidatoPorId(idEquipo) {
    const indice = await this.indice();
    const entrada = indice?.equipos?.[String(idEquipo)];
    return entrada ? this.candidato(entrada) : null;
  },

  fila(partido, idEquipo, competicion) {
    const id = String(idEquipo);
    const propio = String(partido.local.id) === id ? partido.local
      : String(partido.visitante.id) === id ? partido.visitante : null;
    if (!propio || partido.estado !== "jugado" || propio.goles === null) return null;
    const rival = propio === partido.local ? partido.visitante : partido.local;
    const estadistica = propio.estadisticas || {};
    const contraria = rival.estadisticas || {};
    return {
      eventId: String(partido.id), fecha: new Date(partido.fecha), ligaSlug: competicion.slug,
      competicion: competicion.abreviatura || competicion.nombre || competicion.slug,
      rival: rival.nombre, idRival: String(rival.id), enCasa: propio === partido.local,
      golesFavor: Number(propio.goles), golesContra: Number(rival.goles),
      resultado: propio.goles > rival.goles ? "W" : propio.goles < rival.goles ? "L" : "D",
      cornersFavor: estadistica.corners, cornersContra: contraria.corners,
      tiros: estadistica.tiros, tirosPuerta: estadistica.tirosPuerta,
      tirosContra: contraria.tiros, posesion: estadistica.posesion,
    };
  },

  async partidosDeEquipo(idEquipo) {
    const indice = await this.indice();
    const equipo = indice?.equipos?.[String(idEquipo)];
    if (!equipo) return null;
    const documentos = await Promise.all(equipo.archivos.map((ruta) => this.archivo(ruta)));
    const filas = documentos.filter(Boolean).flatMap((doc) =>
      doc.partidos.map((p) => this.fila(p, idEquipo, doc.competicion)).filter(Boolean));
    return Logica.combinar([filas]);
  },

  async partidosDeEquipos(equipos) {
    const listas = await Promise.all(equipos.map((e) => this.partidosDeEquipo(e.id)));
    return listas.every(Array.isArray) ? listas : null;
  },

  async enfrentamientos(equipoA, equipoB) {
    const filas = await this.partidosDeEquipo(equipoA.id);
    if (filas === null) return null;
    return filas.filter((fila) => fila.idRival === String(equipoB.id));
  },
};
