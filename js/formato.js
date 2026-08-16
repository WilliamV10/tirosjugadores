"use strict";

/* ============================================================
   Formato — fechas, numeros y etiquetas en es-ES
   ============================================================ */
const Formato = {
  numero: (valor, decimales = 2) => {
    const maximo = Math.max(0, Math.min(20, Number(decimales) || 0));
    return valor.toLocaleString("es-ES", {
      minimumFractionDigits: Math.min(1, maximo),
      maximumFractionDigits: maximo,
    });
  },

  porcentaje: (valor) => `${Math.round(valor)}%`,

  fechaCorta: (fecha) => fecha.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }),
  fechaLarga: (fecha) => fecha.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }),
  hora: (fecha) => fecha.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),

  /** ESPN devuelve W/D/L; en español V (victoria) / E (empate) / D (derrota). */
  resultado(codigo) {
    const mapa = {
      W: { texto: "V", clase: "chip-v", nombre: "victoria" },
      D: { texto: "E", clase: "chip-e", nombre: "empate" },
      L: { texto: "D", clase: "chip-d", nombre: "derrota" },
      T: { texto: "E", clase: "chip-e", nombre: "empate" },
    };
    return mapa[codigo] || { texto: codigo || "–", clase: "chip-e", nombre: "" };
  },

  fotoJugador: (id) => `https://a.espncdn.com/i/headshots/soccer/players/full/${id}.png`,

  /** Traduce los subtitulos en ingles que ESPN pone a las selecciones. */
  subtitulo(texto) {
    const mapa = {
      "Men's soccer team": "Selección masculina",
      "Women's soccer team": "Selección femenina",
    };
    return mapa[texto] || texto || "";
  },

  /** "12 partidos" / "1 partido" */
  partidos: (n) => `${n} ${n === 1 ? "partido" : "partidos"}`,
};
