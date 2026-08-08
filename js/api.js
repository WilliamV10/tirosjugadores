"use strict";

/* ============================================================
   Cache — evita repetir la misma llamada
   Los partidos ya jugados no cambian, asi que una respuesta sirve
   durante toda la sesion. En memoria van las respuestas grandes
   (marcadores); en sessionStorage solo lo pequeño (busquedas), que
   asi sobrevive a recargar la pagina sin arriesgar la cuota.
   ============================================================ */
const Cache = {
  memoria: new Map(),
  ligasMuertas: new Set(),   // ligas que no existen: no se vuelven a pedir
  aciertos: 0,
  peticiones: 0,
  fallos: 0,                 // caidas de red o bloqueos (403/429), no "sin datos"

  vigente(entrada) {
    return entrada && Date.now() - entrada.momento < CONFIG.cacheMinutos * 60 * 1000;
  },

  leer(clave, { persistente = false } = {}) {
    const enMemoria = this.memoria.get(clave);
    if (this.vigente(enMemoria)) return enMemoria.valor;
    if (!persistente) return undefined;
    try {
      const crudo = sessionStorage.getItem(`apuestas:${clave}`);
      if (!crudo) return undefined;
      const entrada = JSON.parse(crudo);
      if (!this.vigente(entrada)) return undefined;
      this.memoria.set(clave, entrada); // subir a memoria: la próxima es instantánea
      return entrada.valor;
    } catch {
      return undefined; // sessionStorage puede estar bloqueado; no es critico
    }
  },

  guardar(clave, valor, { persistente = false } = {}) {
    const entrada = { momento: Date.now(), valor };
    this.memoria.set(clave, entrada);
    if (!persistente) return;
    try {
      sessionStorage.setItem(`apuestas:${clave}`, JSON.stringify(entrada));
    } catch {
      // sin espacio o sin permiso: seguimos con la cache en memoria
    }
  },
};

/* ============================================================
   Api — llamadas a ESPN (sin logica de negocio)
   ============================================================ */
const Api = {
  /** Busca jugadores ("player") o equipos ("team"). Solo futbol: el buscador
      de ESPN tambien devuelve rugby, cricket, etc. */
  async buscar(nombre, tipo) {
    const clave = `buscar:${tipo}:${nombre.toLowerCase()}`;
    const guardado = Cache.leer(clave, { persistente: true });
    if (guardado !== undefined) { Cache.aciertos++; return guardado; }

    const url = `${CONFIG.buscadorBase}/apis/search/v2?query=${encodeURIComponent(nombre)}&limit=10`;
    Cache.peticiones++;
    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error(`ESPN respondió ${respuesta.status} al buscar`);
    const datos = await respuesta.json();
    const grupo = (datos.results || []).find((g) => g.type === tipo);
    const contenidos = (grupo ? grupo.contents || [] : []).filter((c) => c.sport === "soccer");

    Cache.guardar(clave, contenidos, { persistente: true });
    return contenidos;
  },

  /** Partidos y estadisticas de un jugador en una liga. */
  gamelog(idAtleta, liga) {
    if (liga && Cache.ligasMuertas.has(liga)) return Promise.resolve(null);
    const parametro = liga ? `?league=${encodeURIComponent(liga)}` : "";
    const url = `${CONFIG.buscadorBase}/apis/common/v3/sports/soccer/athletes/${idAtleta}/gamelog${parametro}`;
    return this._jsonOpcional(url, liga);
  },

  /** Resumen de un partido: eventos (goles, tarjetas, cambios), alineaciones
      y estadísticas de cada jugador. Una petición por partido. */
  resumenPartido(liga, idEvento) {
    const url = `${CONFIG.sitioBase}/apis/site/v2/sports/soccer/${encodeURIComponent(liga)}/summary?event=${idEvento}`;
    return this._jsonOpcional(url);
  },

  /** Marcador de una liga en un rango "YYYYMMDD-YYYYMMDD".
      Devuelve hasta 300 partidos CON estadisticas (corners, tiros, posesion)
      en una sola peticion: es la via barata, en vez de pedir partido a partido. */
  marcador(liga, rango) {
    if (Cache.ligasMuertas.has(liga)) return Promise.resolve(null);
    const url = `${CONFIG.sitioBase}/apis/site/v2/sports/soccer/${encodeURIComponent(liga)}/scoreboard?dates=${rango}&limit=300`;
    return this._jsonOpcional(url, liga);
  },

  /** GET que devuelve null en vez de lanzar: sirve para sondear ligas que
      quiza no existan. Distingue dos cosas que parecen iguales pero no lo son:
      - 404: esa liga no existe -> se apunta para no volver a pedirla.
      - red caida o bloqueo (403/429): se cuenta como fallo, para poder avisar
        de que el problema es la conexion y no que falten datos. */
  async _jsonOpcional(url, liga = null) {
    const guardado = Cache.leer(url);
    if (guardado !== undefined) { Cache.aciertos++; return guardado; }

    try {
      Cache.peticiones++;
      const respuesta = await fetch(url);
      if (!respuesta.ok) {
        // 400 = identificador de competición inválido, 404 = no hay nada ahí.
        // En ambos casos no tiene sentido reintentar: se apunta y no se repite.
        if (respuesta.status === 400 || respuesta.status === 404) {
          if (liga) Cache.ligasMuertas.add(liga);
          Cache.guardar(url, null);
        } else {
          Cache.fallos++; // 403/429/500: puede volver a funcionar, no se cachea
        }
        return null;
      }
      const datos = await respuesta.json();
      Cache.guardar(url, datos);
      return datos;
    } catch {
      Cache.fallos++;
      return null;
    }
  },
};
