"use strict";

/* ============================================================
   BD — capa fina sobre IndexedDB

   IndexedDB es asíncrona y basada en eventos; aquí se envuelve en
   promesas y se define el esquema en un solo sitio. El resto de la
   aplicación no vuelve a ver un `onsuccess`.

   Regla de oro de IndexedDB: una transacción se cierra sola en cuanto
   el hilo queda libre. Por eso NUNCA se hace `await` de red dentro de
   una transacción: primero se descarga, luego se abre y se escribe.
   ============================================================ */
const BD = {
  nombre: "apuestas",
  version: 1,
  _conexion: null,      // promesa de conexión, se reutiliza
  disponible: true,     // false si el navegador la bloquea (modo privado, Safari…)

  /** Definicion del esquema. Cada almacen es una "tabla" y cada indice
      una consulta que se quiere poder hacer sin recorrerlo todo. */
  esquema: {
    ligas: { clave: "slug", indices: {} },

    equipos: {
      clave: "id",
      indices: { porLiga: { campo: "ligaSlug" } },
    },

    // Union equipo <-> competicion: un equipo juega liga, copa y continental
    participaciones: {
      clave: ["idEquipo", "ligaSlug"],
      indices: {
        porLiga: { campo: "ligaSlug" },
        porEquipo: { campo: "idEquipo" },
      },
    },

    // El partido, una sola vez y en forma neutral (local / visitante)
    partidos: {
      clave: "eventId",
      indices: {
        porFecha: { campo: "fecha" },
        porLigaFecha: { campo: ["ligaSlug", "fecha"] },
        porEquipo: { campo: "equipos", multiEntry: true },
      },
    },

    // Una fila por equipo y partido: córners, tiros, posesión, faltas…
    estadisticas: {
      clave: ["eventId", "idEquipo"],
      indices: {
        porPartido: { campo: "eventId" },
        porEquipoFecha: { campo: ["idEquipo", "fecha"] }, // últimos N de un equipo, ya ordenados
        porLigaFecha: { campo: ["ligaSlug", "fecha"] },
      },
    },

    // Goles, penaltis, tarjetas y cambios, con minuto y jugador
    eventos: {
      clave: "id",
      indices: {
        porPartido: { campo: "eventId" },
        porJugador: { campo: "idJugador" },
        porTipo: { campo: "tipo" },
      },
    },

    jugadores: {
      clave: "id",
      indices: { porEquipo: { campo: "idEquipo" } },
    },

    // Una fila por jugador y partido: sus tiros, goles y tarjetas
    actuaciones: {
      clave: ["eventId", "idJugador"],
      indices: {
        porPartido: { campo: "eventId" },
        porJugadorFecha: { campo: ["idJugador", "fecha"] },
        porEquipo: { campo: "idEquipo" },
      },
    },

    // Que rangos de que ligas ya se han descargado (y cuando)
    cobertura: {
      clave: ["ligaSlug", "rango"],
      indices: { porLiga: { campo: "ligaSlug" } },
    },
  },

  /* ---------- Conexion ---------- */

  abrir() {
    if (this._conexion) return this._conexion;

    this._conexion = new Promise((resolver, rechazar) => {
      if (typeof indexedDB === "undefined" || !indexedDB) {
        rechazar(new Error("Este navegador no expone IndexedDB"));
        return;
      }
      const peticion = indexedDB.open(this.nombre, this.version);

      peticion.onupgradeneeded = () => this._crearEsquema(peticion.result, peticion.transaction);
      peticion.onsuccess = () => resolver(peticion.result);
      peticion.onerror = () => rechazar(peticion.error || new Error("No se pudo abrir la base"));
      peticion.onblocked = () => rechazar(new Error("Hay otra pestaña con una versión anterior abierta"));
    }).catch((error) => {
      this.disponible = false;
      this._conexion = null; // permite reintentar más adelante
      throw error;
    });

    return this._conexion;
  },

  /** Crea almacenes e indices que falten. Se ejecuta solo al subir version. */
  _crearEsquema(base, transaccion) {
    for (const [nombre, definicion] of Object.entries(this.esquema)) {
      const almacen = base.objectStoreNames.contains(nombre)
        ? transaccion.objectStore(nombre)
        : base.createObjectStore(nombre, { keyPath: definicion.clave });

      for (const [nombreIndice, indice] of Object.entries(definicion.indices)) {
        if (almacen.indexNames.contains(nombreIndice)) continue;
        almacen.createIndex(nombreIndice, indice.campo, {
          multiEntry: Boolean(indice.multiEntry),
          unique: false,
        });
      }
    }
  },

  /** Comprueba si se puede usar la base, sin lanzar. */
  async lista() {
    if (!this.disponible) return false;
    try {
      await this.abrir();
      return true;
    } catch {
      return false;
    }
  },

  /* ---------- Escritura ---------- */

  /** Guarda varios registros en varios almacenes en UNA sola transacción:
      o entra todo, o no entra nada. `lotes` = { almacen: [registros] } */
  async guardar(lotes) {
    const base = await this.abrir();
    const almacenes = Object.keys(lotes).filter((nombre) => lotes[nombre]?.length);
    if (!almacenes.length) return 0;

    return new Promise((resolver, rechazar) => {
      const transaccion = base.transaction(almacenes, "readwrite");
      let escritos = 0;
      for (const nombre of almacenes) {
        const almacen = transaccion.objectStore(nombre);
        for (const registro of lotes[nombre]) {
          almacen.put(registro);
          escritos++;
        }
      }
      transaccion.oncomplete = () => resolver(escritos);
      transaccion.onerror = () => rechazar(transaccion.error);
      transaccion.onabort = () => rechazar(transaccion.error || new Error("Transacción cancelada"));
    });
  },

  /** Como `guardar`, pero conservando los campos que ya hubiera: un mismo
      registro puede llegar de dos fuentes distintas (el resumen del partido
      trae la alineación, el historial del jugador trae el marcador) y
      ninguna debe borrar lo que aportó la otra. */
  async fusionar(almacen, registros) {
    if (!registros?.length) return 0;
    const base = await this.abrir();

    return new Promise((resolver, rechazar) => {
      const transaccion = base.transaction(almacen, "readwrite");
      const destino = transaccion.objectStore(almacen);
      const clavePrimaria = destino.keyPath;

      for (const registro of registros) {
        const clave = Array.isArray(clavePrimaria)
          ? clavePrimaria.map((campo) => registro[campo])
          : registro[clavePrimaria];
        const lectura = destino.get(clave);
        // Se encadena dentro de la misma transacción: no sale del hilo
        lectura.onsuccess = () => destino.put({ ...(lectura.result || {}), ...registro });
      }
      transaccion.oncomplete = () => resolver(registros.length);
      transaccion.onerror = () => rechazar(transaccion.error);
      transaccion.onabort = () => rechazar(transaccion.error || new Error("Transacción cancelada"));
    });
  },

  /* ---------- Lectura ---------- */

  async obtener(almacen, clave) {
    const base = await this.abrir();
    return new Promise((resolver, rechazar) => {
      const peticion = base.transaction(almacen).objectStore(almacen).get(clave);
      peticion.onsuccess = () => resolver(peticion.result);
      peticion.onerror = () => rechazar(peticion.error);
    });
  },

  /** Consulta con indice, rango, orden y limite — el equivalente a un
      SELECT ... WHERE ... ORDER BY ... LIMIT de toda la vida. */
  async consultar(almacen, { indice = null, rango = null, descendente = false, limite = Infinity } = {}) {
    const base = await this.abrir();
    return new Promise((resolver, rechazar) => {
      const origen = base.transaction(almacen).objectStore(almacen);
      const fuente = indice ? origen.index(indice) : origen;
      const peticion = fuente.openCursor(rango, descendente ? "prev" : "next");
      const resultados = [];

      peticion.onsuccess = () => {
        const cursor = peticion.result;
        if (!cursor || resultados.length >= limite) { resolver(resultados); return; }
        resultados.push(cursor.value);
        cursor.continue();
      };
      peticion.onerror = () => rechazar(peticion.error);
    });
  },

  async contar(almacen, { indice = null, rango = null } = {}) {
    const base = await this.abrir();
    return new Promise((resolver, rechazar) => {
      const origen = base.transaction(almacen).objectStore(almacen);
      const peticion = (indice ? origen.index(indice) : origen).count(rango);
      peticion.onsuccess = () => resolver(peticion.result);
      peticion.onerror = () => rechazar(peticion.error);
    });
  },

  /* ---------- Mantenimiento ---------- */

  async vaciar() {
    const base = await this.abrir();
    const almacenes = Object.keys(this.esquema);
    return new Promise((resolver, rechazar) => {
      const transaccion = base.transaction(almacenes, "readwrite");
      for (const nombre of almacenes) transaccion.objectStore(nombre).clear();
      transaccion.oncomplete = () => resolver(true);
      transaccion.onerror = () => rechazar(transaccion.error);
    });
  },

  /** Cuantos registros hay en cada almacen, para poder enseñarlo. */
  async inventario() {
    const nombres = Object.keys(this.esquema);
    const totales = await Promise.all(nombres.map((nombre) => this.contar(nombre)));
    return Object.fromEntries(nombres.map((nombre, i) => [nombre, totales[i]]));
  },

  /** Pide al navegador que no borre los datos si le falta espacio. */
  async pedirPersistencia() {
    try {
      if (navigator.storage?.persist) return await navigator.storage.persist();
    } catch { /* no disponible: los datos siguen siendo best-effort */ }
    return false;
  },

  async espacio() {
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      return { usados: usage, disponibles: quota };
    } catch {
      return { usados: 0, disponibles: 0 };
    }
  },
};
