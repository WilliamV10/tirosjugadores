"use strict";

/* ============================================================
   Logica — parseo, medias y comparacion
   Funciones puras: no tocan el DOM ni la red, asi son faciles de
   probar y de reutilizar entre vistas.
   ============================================================ */
const Logica = {
  /* ---------- Texto y busqueda ---------- */

  /** Extrae el id de un uid tipo "s:600~a:362150" (a = atleta, t = equipo). */
  idDesdeUid(uid, letra = "a") {
    const coincidencia = new RegExp(`${letra}:(\\d+)`).exec(uid || "");
    return coincidencia ? coincidencia[1] : null;
  },

  /** Minusculas y sin acentos, para comparar nombres escritos en español. */
  normalizar(texto) {
    return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  },

  /** "españa" -> "spain": el buscador de ESPN solo entiende ingles. */
  aliasDeBusqueda(nombre) {
    return CONFIG.aliasEquipos[this.normalizar(nombre)] || nombre;
  },

  /** Descarta femeninos y juveniles salvo que se pidan explicitamente.
      Si no queda ninguno se devuelve la lista original: mejor de mas que vacia. */
  filtrarCategoria(candidatos, texto) {
    const buscado = this.normalizar(texto);
    const pideFemenino = /\b(femenil|femenino|femenina|women|w)\b/.test(buscado);
    const pideJuvenil = /\b(sub|u\d\d)\b/.test(buscado);
    const esFemenino = (c) =>
      /\.w\.|\.w$|wworld|nwsl/i.test(c.defaultLeagueSlug || "") || /women|femenil/i.test(c.subtitle || "");
    const esJuvenil = (c) =>
      /\bU\d\d\b/i.test(c.displayName || "") || /\.u\d\d|u\d\d$|olympics/i.test(c.defaultLeagueSlug || "");

    const filtrados = candidatos.filter(
      (c) => (pideFemenino || !esFemenino(c)) && (pideJuvenil || !esJuvenil(c))
    );
    return filtrados.length ? filtrados : candidatos;
  },

  /** Deja arriba la coincidencia exacta. Si solo hay una exacta devuelve
      unicamente esa: "américa vs chivas" no deberia preguntar nada. */
  priorizarCandidatos(candidatos, texto, { filtrarCategorias = false } = {}) {
    const lista = filtrarCategorias ? this.filtrarCategoria(candidatos, texto) : candidatos;
    const buscado = this.normalizar(texto);
    const esExacto = (c) => this.normalizar(c.displayName) === buscado;
    const exactos = lista.filter(esExacto);
    if (exactos.length === 1) return exactos;
    return [...lista].sort((a, b) => Number(esExacto(b)) - Number(esExacto(a)));
  },

  /** "America vs Tigres" -> ["America", "Tigres"]. Null si no hay separador. */
  partirDuelo(texto) {
    const partes = texto.split(/\s+(?:vs\.?|v|contra|x|-|–)\s+/i);
    if (partes.length !== 2) return null;
    const [a, b] = partes.map((parte) => parte.trim());
    return a && b ? [a, b] : null;
  },

  /* ---------- Competiciones ---------- */

  /** Una seleccion tiene como liga por defecto una competicion de
      selecciones (fifa.world, uefa.euro.u19...), nunca una liga de club. */
  esSeleccion(ligaPorDefecto) {
    return /^(fifa\.|uefa\.euro|uefa\.nations|conmebol\.|concacaf\.)/.test(ligaPorDefecto || "");
  },

  /** Ligas a consultar para un equipo. Club: la suya + copas del pais + las
      de su confederacion. Seleccion: mundial, amistosos y eliminatorias. */
  ligasDeEquipo(ligaPorDefecto) {
    if (this.esSeleccion(ligaPorDefecto)) {
      return [...new Set([ligaPorDefecto, ...CONFIG.ligasSeleccion].filter(Boolean))];
    }
    const pais = (ligaPorDefecto || "").split(".")[0];
    const copas = CONFIG.copasPorPais[pais] || [];
    const continentales = CONFIG.ligasContinentales[CONFIG.confederacionPorPais[pais]] || [];
    return [...new Set(
      [ligaPorDefecto, ...copas, ...continentales, ...CONFIG.ligasClubGlobales].filter(Boolean)
    )];
  },

  /** Ligas listadas en los filtros de un gamelog (las del club del jugador). */
  ligasDelClub(datos) {
    const filtro = (datos.filters || []).find((f) => f.name === "league");
    if (!filtro) return { porDefecto: null, otras: [] };
    return {
      porDefecto: filtro.value || null,
      otras: (filtro.options || []).map((opcion) => opcion.value),
    };
  },

  /** Rango "YYYYMMDD-YYYYMMDD" del tramo numero `indice` hacia atras.
      Se piden por tramos porque el marcador devuelve 300 partidos como mucho. */
  ventana(indice, hoy = new Date()) {
    const ymd = (fecha) => [
      fecha.getFullYear(),
      String(fecha.getMonth() + 1).padStart(2, "0"),
      String(fecha.getDate()).padStart(2, "0"),
    ].join("");

    const { meses } = CONFIG.ventana;
    const fin = new Date(hoy);
    fin.setMonth(fin.getMonth() - indice * meses);
    const inicio = new Date(fin);
    inicio.setMonth(inicio.getMonth() - meses);
    return `${ymd(inicio)}-${ymd(fin)}`;
  },

  /* ---------- Parseo ---------- */

  /** Convierte una respuesta de gamelog en filas partido + estadisticas. */
  parsearPartidos(datos) {
    if (!datos || !datos.events) return [];
    const posicion = {};
    (datos.names || []).forEach((nombre, i) => { posicion[nombre] = i; });
    const stat = (stats, nombre) => {
      const valor = nombre in posicion ? Number(stats[posicion[nombre]]) : 0;
      return Number.isFinite(valor) ? valor : 0;
    };

    const filas = [];
    for (const temporada of datos.seasonTypes || []) {
      for (const categoria of temporada.categories || []) {
        for (const evento of categoria.events || []) {
          const meta = datos.events[String(evento.eventId)];
          if (!meta) continue;
          filas.push({
            eventId: String(evento.eventId),
            fecha: new Date(meta.gameDate),
            rival: meta.opponent?.displayName || "?",
            competicion: meta.leagueName || "",
            resultado: meta.gameResult || "",
            marcador: meta.score || "",
            goles: stat(evento.stats, "totalGoals"),
            asistencias: stat(evento.stats, "goalAssists"),
            tiros: stat(evento.stats, "totalShots"),
            tirosPuerta: stat(evento.stats, "shotsOnTarget"),
            amarillas: stat(evento.stats, "yellowCards"),
          });
        }
      }
    }
    return filas;
  },

  /** Lee una estadistica de un competidor del marcador. Null si no viene. */
  estadistica(competidor, nombre) {
    const encontrada = (competidor?.statistics || []).find((s) => s.name === nombre);
    const valor = encontrada ? Number(encontrada.displayValue) : NaN;
    return Number.isFinite(valor) ? valor : null;
  },

  /** Descompone un marcador de liga en las piezas que guarda la base:
      liga, equipos, partidos (neutrales) y estadisticas por equipo y partido.
      Un partido se guarda UNA vez; la vista de cada equipo se deriva luego. */
  parsearMarcadorCompleto(datos) {
    const meta = datos?.leagues?.[0];
    const vacio = { liga: null, equipos: [], partidos: [], estadisticas: [] };
    if (!meta?.slug) return vacio;

    const ligaSlug = meta.slug;
    const competicion = meta.abbreviation || meta.name || "";
    const salida = {
      liga: { slug: ligaSlug, nombre: meta.name || ligaSlug, abreviatura: meta.abbreviation || "" },
      equipos: [], partidos: [], estadisticas: [],
    };

    for (const evento of datos.events || []) {
      const enfrentamiento = evento.competitions?.[0];
      if (!enfrentamiento?.status?.type?.completed) continue;

      const competidores = enfrentamiento.competitors || [];
      const local = competidores.find((c) => c.homeAway === "home");
      const visitante = competidores.find((c) => c.homeAway === "away");
      if (!local?.team?.id || !visitante?.team?.id) continue;

      const golesLocal = Number(local.score);
      const golesVisitante = Number(visitante.score);
      if (!Number.isFinite(golesLocal) || !Number.isFinite(golesVisitante)) continue;

      const eventId = String(evento.id);
      const fecha = new Date(evento.date);
      const idLocal = String(local.team.id);
      const idVisitante = String(visitante.team.id);

      salida.partidos.push({
        eventId,
        fecha,
        ligaSlug,
        competicion,
        temporada: evento.season?.year ?? null,
        idLocal,
        idVisitante,
        golesLocal,
        golesVisitante,
        equipos: [idLocal, idVisitante], // indice multiEntry: partidos de un equipo
        detalleEn: null,                 // cuando se descarguen eventos y alineaciones
      });

      for (const [propio, contrario] of [[local, visitante], [visitante, local]]) {
        const idPropio = String(propio.team.id);
        salida.equipos.push({
          id: idPropio,
          nombre: propio.team.displayName || propio.team.name || "?",
          abreviatura: propio.team.abbreviation || "",
          escudo: propio.team.logo || "",
          ligaSlug,
        });
        salida.estadisticas.push({
          eventId,
          idEquipo: idPropio,
          idRival: String(contrario.team.id),
          nombreRival: contrario.team.displayName || "?", // desnormalizado: evita otra lectura
          fecha,
          ligaSlug,
          competicion,
          esLocal: propio.homeAway === "home",
          golesFavor: Number(propio.score),
          golesContra: Number(contrario.score),
          corners: this.estadistica(propio, "wonCorners"),
          cornersContra: this.estadistica(contrario, "wonCorners"),
          tiros: this.estadistica(propio, "totalShots"),
          tirosPuerta: this.estadistica(propio, "shotsOnTarget"),
          tirosContra: this.estadistica(contrario, "totalShots"),
          posesion: this.estadistica(propio, "possessionPct"),
          faltas: this.estadistica(propio, "foulsCommitted"),
          amarillas: this.estadistica(propio, "yellowCards"),
          rojas: this.estadistica(propio, "redCards"),
        });
      }
    }
    return salida;
  },

  /** Convierte una estadistica guardada en la fila que consumen las vistas.
      Es el unico sitio donde se pasa de "partido neutral" a "visto desde un
      equipo", asi que da igual si el dato viene de la red o de la base. */
  filaDesdeEstadistica(estadistica) {
    const { golesFavor, golesContra } = estadistica;
    return {
      eventId: estadistica.eventId,
      fecha: estadistica.fecha instanceof Date ? estadistica.fecha : new Date(estadistica.fecha),
      competicion: estadistica.competicion,
      rival: estadistica.nombreRival,
      idRival: estadistica.idRival,
      enCasa: estadistica.esLocal,
      golesFavor,
      golesContra,
      resultado: golesFavor > golesContra ? "W" : golesFavor < golesContra ? "L" : "D",
      cornersFavor: estadistica.corners,
      cornersContra: estadistica.cornersContra,
      tiros: estadistica.tiros,
      tirosPuerta: estadistica.tirosPuerta,
      posesion: estadistica.posesion,
    };
  },

  /** Filas de un equipo a partir de un marcador de liga (camino sin base). */
  parsearMarcador(datos, idEquipo) {
    return this.parsearMarcadorCompleto(datos).estadisticas
      .filter((e) => e.idEquipo === String(idEquipo))
      .map((e) => this.filaDesdeEstadistica(e));
  },

  /** Eventos, jugadores y actuaciones del resumen de un partido.
      ESPN no publica remates individuales (ni coordenadas ni xG): los tiros
      solo existen como total por equipo y por jugador. */
  parsearDetalle(resumen, partido) {
    const salida = { eventos: [], jugadores: [], actuaciones: [] };
    if (!resumen) return salida;

    const { eventId, fecha, ligaSlug } = partido;

    for (const evento of resumen.keyEvents || []) {
      const participantes = (evento.participants || [])
        .map((p) => String(p.athlete?.id || ""))
        .filter(Boolean);
      salida.eventos.push({
        id: String(evento.id),
        eventId,
        fecha,
        ligaSlug,
        tipo: evento.type?.text || "",
        idTipo: String(evento.type?.id || ""),
        minuto: evento.clock?.displayValue || "",
        periodo: evento.period?.number ?? null,
        idEquipo: evento.team?.id ? String(evento.team.id) : null,
        idJugador: participantes[0] || null,
        participantes,
        esGol: Boolean(evento.scoringPlay ?? /goal|scored/i.test(evento.type?.text || "")),
        texto: evento.text || "",
      });
    }

    for (const plantilla of resumen.rosters || []) {
      const idEquipo = String(plantilla.team?.id || "");
      for (const puesto of plantilla.roster || []) {
        const idJugador = String(puesto.athlete?.id || "");
        if (!idJugador) continue;

        salida.jugadores.push({
          id: idJugador,
          nombre: puesto.athlete?.displayName || "?",
          posicion: puesto.position?.abbreviation || "",
          idEquipo,
        });

        const stat = (nombre) => {
          const encontrada = (puesto.stats || []).find((s) => s.name === nombre);
          const valor = encontrada ? Number(encontrada.value ?? encontrada.displayValue) : NaN;
          return Number.isFinite(valor) ? valor : 0;
        };
        salida.actuaciones.push({
          eventId,
          idJugador,
          idEquipo,
          fecha,
          ligaSlug,
          titular: Boolean(puesto.starter),
          dorsal: puesto.jersey || "",
          goles: stat("totalGoals"),
          asistencias: stat("goalAssists"),
          tiros: stat("totalShots"),
          tirosPuerta: stat("shotsOnTarget"),
          amarillas: stat("yellowCards"),
          rojas: stat("redCards"),
          faltas: stat("foulsCommitted"),
          atajadas: stat("saves"),
        });
      }
    }
    return salida;
  },

  /** Quita duplicados por id de partido y ordena del mas reciente al mas viejo. */
  combinar(listasDeFilas) {
    const vistos = new Set();
    return listasDeFilas
      .flat()
      .sort((a, b) => b.fecha - a.fecha)
      .filter((fila) => !vistos.has(fila.eventId) && vistos.add(fila.eventId));
  },

  /* ---------- Medias y perfiles ---------- */

  /** Media de una clave ignorando los partidos sin ese dato. Null si no hay. */
  media(filas, clave) {
    const validos = filas.map((f) => f[clave]).filter((v) => typeof v === "number");
    if (!validos.length) return null;
    return validos.reduce((total, v) => total + v, 0) / validos.length;
  },

  /** Cuantos de los partidos cumplen algo, y en que porcentaje. */
  cuota(filas, predicado) {
    const n = filas.length;
    const veces = filas.filter(predicado).length;
    return { veces, n, porcentaje: n ? (veces / n) * 100 : 0 };
  },

  /** Perfil completo de un equipo sobre los partidos dados. */
  perfil(filas) {
    const n = filas.length;
    const cuenta = (predicado) => filas.filter(predicado).length;
    const victorias = cuenta((f) => f.resultado === "W");
    const empates = cuenta((f) => f.resultado === "D");
    return {
      n,
      victorias,
      empates,
      derrotas: cuenta((f) => f.resultado === "L"),
      puntosPorPartido: n ? (victorias * 3 + empates) / n : 0,
      golesFavor: this.media(filas, "golesFavor"),
      golesContra: this.media(filas, "golesContra"),
      cornersFavor: this.media(filas, "cornersFavor"),
      cornersContra: this.media(filas, "cornersContra"),
      tiros: this.media(filas, "tiros"),
      tirosPuerta: this.media(filas, "tirosPuerta"),
      posesion: this.media(filas, "posesion"),
      porteriasCero: cuenta((f) => f.golesContra === 0),
      ambosMarcan: cuenta((f) => f.golesFavor > 0 && f.golesContra > 0),
    };
  },

  /** Promedios y conteos de tiros de un jugador. */
  resumenJugador(partidos) {
    const n = partidos.length;
    const suma = (clave) => partidos.reduce((total, p) => total + p[clave], 0);
    const conteo = (predicado) => partidos.filter(predicado).length;
    return {
      n,
      promedioTiros: n ? suma("tiros") / n : 0,
      promedioPuerta: n ? suma("tirosPuerta") / n : 0,
      goles: suma("goles"),
      asistencias: suma("asistencias"),
      conUnTiro: conteo((p) => p.tiros >= 1),
      conUnTiroPuerta: conteo((p) => p.tirosPuerta >= 1),
      conDosPuerta: conteo((p) => p.tirosPuerta >= 2),
      conGol: conteo((p) => p.goles >= 1),
    };
  },

  /** Balance y goles de un equipo. */
  resumenEquipo(partidos) {
    const n = partidos.length;
    const suma = (clave) => partidos.reduce((total, p) => total + p[clave], 0);
    return {
      n,
      victorias: partidos.filter((p) => p.resultado === "W").length,
      empates: partidos.filter((p) => p.resultado === "D").length,
      derrotas: partidos.filter((p) => p.resultado === "L").length,
      mediaFavor: n ? suma("golesFavor") / n : 0,
      mediaContra: n ? suma("golesContra") / n : 0,
      mediaTotal: n ? (suma("golesFavor") + suma("golesContra")) / n : 0,
      porteriasCero: partidos.filter((p) => p.golesContra === 0).length,
    };
  },

  /** Medias de corners sobre los partidos que si tienen datos. */
  resumenCorners(filas) {
    const conDatos = filas.filter((f) => f.cornersFavor !== null);
    const n = conDatos.length;
    const suma = (selector) => conDatos.reduce((total, f) => total + selector(f), 0);
    return {
      n,
      sinDatos: filas.length - n,
      mediaFavor: n ? suma((f) => f.cornersFavor) / n : 0,
      mediaContra: n ? suma((f) => f.cornersContra) / n : 0,
      mediaTotal: n ? suma((f) => f.cornersFavor + f.cornersContra) / n : 0,
      conDiezMas: conDatos.filter((f) => f.cornersFavor + f.cornersContra >= 10).length,
    };
  },

  /** Racha actual: partidos seguidos (desde el mas reciente) con el mismo signo. */
  racha(filas) {
    if (!filas.length) return null;
    const gana = (f) => f.resultado === "W";
    const pierde = (f) => f.resultado === "L";

    const contarMientras = (predicado) => {
      let veces = 0;
      for (const fila of filas) {
        if (!predicado(fila)) break;
        veces++;
      }
      return veces;
    };

    const victorias = contarMientras(gana);
    if (victorias >= 2) return { tipo: "victorias", veces: victorias };
    const derrotas = contarMientras(pierde);
    if (derrotas >= 2) return { tipo: "derrotas", veces: derrotas };
    const sinPerder = contarMientras((f) => !pierde(f));
    if (sinPerder >= 3) return { tipo: "sinPerder", veces: sinPerder };
    return null;
  },

  /* ---------- Comparativa ---------- */

  /** Metricas que se enfrentan. `mejor` dice que lado gana: "alto" = mas es
      mejor, "bajo" = menos es mejor, null = solo informativo.
      Se redondea ANTES de comparar para que el ganador marcado coincida
      siempre con los numeros que se ven en pantalla. */
  metricasComparadas(perfilA, perfilB) {
    const definiciones = [
      { clave: "puntosPorPartido", etiqueta: "Puntos por partido", mejor: "alto", decimales: 2 },
      { clave: "golesFavor", etiqueta: "Goles a favor", mejor: "alto", decimales: 2 },
      { clave: "golesContra", etiqueta: "Goles en contra", mejor: "bajo", decimales: 2 },
      { clave: "cornersFavor", etiqueta: "Córners a favor", mejor: "alto", decimales: 1 },
      { clave: "cornersContra", etiqueta: "Córners concedidos", mejor: "bajo", decimales: 1 },
      { clave: "tiros", etiqueta: "Tiros", mejor: "alto", decimales: 1 },
      { clave: "tirosPuerta", etiqueta: "Tiros a puerta", mejor: "alto", decimales: 1 },
      { clave: "posesion", etiqueta: "Posesión (%)", mejor: null, decimales: 1 },
    ];
    return definiciones
      .filter(({ clave }) => perfilA[clave] !== null && perfilB[clave] !== null)
      .map((definicion) => {
        const redondear = (valor) => Number(valor.toFixed(definicion.decimales));
        const a = redondear(perfilA[definicion.clave]);
        const b = redondear(perfilB[definicion.clave]);
        let gana = null; // "a" | "b" | null (empate o metrica informativa)
        if (definicion.mejor === "alto" && a !== b) gana = a > b ? "a" : "b";
        if (definicion.mejor === "bajo" && a !== b) gana = a < b ? "a" : "b";
        return { ...definicion, a, b, gana };
      });
  },

  /** Enfrentamientos directos entre los dos equipos, desde las filas de A. */
  enfrentamientos(filasA, idB) {
    return filasA.filter((f) => f.idRival === String(idB));
  },

  /* ---------- Lecturas automaticas ----------
     Frases derivadas de los datos ya calculados. Cada una dice cuantas
     veces de cuantas, para que se pueda contrastar con la tabla. */

  lecturasJugador(partidos, resumen) {
    const lecturas = [];
    const { n } = resumen;
    if (!n) return lecturas;

    const pct = (veces) => Math.round((veces / n) * 100);
    lecturas.push({
      tono: resumen.conUnTiroPuerta / n >= 0.7 ? "bueno" : "neutro",
      texto: `Tiró a puerta en ${resumen.conUnTiroPuerta} de ${n} partidos (${pct(resumen.conUnTiroPuerta)}%).`,
    });
    if (resumen.conDosPuerta) {
      lecturas.push({
        tono: "neutro",
        texto: `Hizo 2 o más tiros a puerta en ${resumen.conDosPuerta} de ${n} (${pct(resumen.conDosPuerta)}%).`,
      });
    }
    const mejor = partidos.reduce((a, b) => (b.tiros > a.tiros ? b : a), partidos[0]);
    lecturas.push({
      tono: "neutro",
      texto: `Su tope fueron ${mejor.tiros} tiros vs ${mejor.rival}.`,
    });
    if (resumen.conGol) {
      lecturas.push({
        tono: "bueno",
        texto: `Marcó en ${resumen.conGol} de ${n} partidos (${resumen.goles} goles en total).`,
      });
    }
    return lecturas;
  },

  lecturasEquipo(filas, resumen) {
    const lecturas = [];
    const { n } = resumen;
    if (!n) return lecturas;

    const racha = this.racha(filas);
    if (racha) {
      const frases = {
        victorias: { texto: `Racha de ${racha.veces} victorias seguidas.`, tono: "bueno" },
        derrotas: { texto: `Racha de ${racha.veces} derrotas seguidas.`, tono: "malo" },
        sinPerder: { texto: `${racha.veces} partidos seguidos sin perder.`, tono: "bueno" },
      };
      lecturas.push(frases[racha.tipo]);
    }

    const masDeDosGoles = this.cuota(filas, (f) => f.golesFavor + f.golesContra >= 3);
    lecturas.push({
      tono: masDeDosGoles.porcentaje >= 60 ? "bueno" : "neutro",
      texto: `Más de 2,5 goles en ${masDeDosGoles.veces} de ${n} partidos (${Math.round(masDeDosGoles.porcentaje)}%).`,
    });

    const ambos = this.cuota(filas, (f) => f.golesFavor > 0 && f.golesContra > 0);
    lecturas.push({
      tono: "neutro",
      texto: `Ambos equipos marcaron en ${ambos.veces} de ${n} (${Math.round(ambos.porcentaje)}%).`,
    });

    if (resumen.porteriasCero) {
      lecturas.push({
        tono: "bueno",
        texto: `Dejó la portería a cero en ${resumen.porteriasCero} de ${n} partidos.`,
      });
    }
    return lecturas;
  },

  lecturasCorners(filas, resumen) {
    const lecturas = [];
    const conDatos = filas.filter((f) => f.cornersFavor !== null);
    if (!conDatos.length) return lecturas;
    const n = conDatos.length;

    const total = (f) => f.cornersFavor + f.cornersContra;
    for (const linea of [8.5, 9.5, 10.5]) {
      const cuota = this.cuota(conDatos, (f) => total(f) > linea);
      lecturas.push({
        tono: cuota.porcentaje >= 60 ? "bueno" : cuota.porcentaje <= 40 ? "malo" : "neutro",
        texto: `Más de ${String(linea).replace(".", ",")} córners totales en ${cuota.veces} de ${n} (${Math.round(cuota.porcentaje)}%).`,
      });
    }
    const cincoPropios = this.cuota(conDatos, (f) => f.cornersFavor >= 5);
    lecturas.push({
      tono: "neutro",
      texto: `Sacó 5 o más córners en ${cincoPropios.veces} de ${n} (${Math.round(cincoPropios.porcentaje)}%).`,
    });
    return lecturas;
  },

  lecturasComparacion(ladoA, ladoB, metricas, cruces) {
    const lecturas = [];
    const ganadasA = metricas.filter((m) => m.gana === "a").length;
    const ganadasB = metricas.filter((m) => m.gana === "b").length;
    const nombreA = ladoA.equipo.displayName;
    const nombreB = ladoB.equipo.displayName;

    if (ganadasA !== ganadasB) {
      const lider = ganadasA > ganadasB ? nombreA : nombreB;
      lecturas.push({
        tono: "acento",
        texto: `${lider} gana ${Math.max(ganadasA, ganadasB)} de las ${metricas.length} métricas comparadas.`,
      });
    } else {
      lecturas.push({ tono: "neutro", texto: `Igualdad: ${ganadasA} métricas para cada uno.` });
    }

    const golesEsperados = (ladoA.perfil.golesFavor ?? 0) + (ladoB.perfil.golesContra ?? 0);
    const golesEsperadosB = (ladoB.perfil.golesFavor ?? 0) + (ladoA.perfil.golesContra ?? 0);
    lecturas.push({
      tono: "neutro",
      texto: `Sumando el ataque de uno y la defensa del otro salen ${Formato.numero((golesEsperados + golesEsperadosB) / 2, 1)} goles por partido.`,
    });

    const cornersA = ladoA.perfil.cornersFavor;
    const cornersB = ladoB.perfil.cornersFavor;
    if (cornersA !== null && cornersB !== null) {
      lecturas.push({
        tono: "neutro",
        texto: `Entre los dos promedian ${Formato.numero(cornersA + cornersB, 1)} córners a favor por partido.`,
      });
    }

    if (cruces.length) {
      const victoriasA = cruces.filter((c) => c.resultado === "W").length;
      const empatesCruce = cruces.filter((c) => c.resultado === "D").length;
      const victoriasB = cruces.length - victoriasA - empatesCruce;
      const encabezado = cruces.length === 1
        ? "En su único cruce reciente"
        : `En sus ${cruces.length} cruces recientes`;
      const marcador = [
        `${victoriasA} para ${nombreA}`,
        `${empatesCruce} ${empatesCruce === 1 ? "empate" : "empates"}`,
        `${victoriasB} para ${nombreB}`,
      ].join(", ");
      lecturas.push({ tono: "acento", texto: `${encabezado}: ${marcador}.` });
    }
    return lecturas;
  },
};
