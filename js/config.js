"use strict";

/* ============================================================
   Configuracion — URLs, competiciones y alias
   Se carga primero: el resto de modulos lee de aqui.
   ============================================================ */
const CONFIG = {
  buscadorBase: "https://site.web.api.espn.com",
  sitioBase: "https://site.api.espn.com",

  // Cuanto vale una respuesta guardada antes de volver a pedirla
  cacheMinutos: 30,

  // Ventanas de fecha del marcador: 4 meses cada tramo, hasta 3 tramos
  ventana: { meses: 4, tramosMaximos: 3 },

  // Competiciones de seleccion: ESPN no las lista en los filtros del club
  ligasSeleccion: [
    "fifa.world", "fifa.friendly", "uefa.euro", "uefa.nations",
    "conmebol.america", "concacaf.gold",
    "fifa.worldq.uefa", "fifa.worldq.conmebol", "fifa.worldq.concacaf",
  ],

  // Competiciones continentales por confederacion, para no pedir Champions a
  // un equipo mexicano ni Concachampions a uno español
  ligasContinentales: {
    uefa: ["uefa.champions", "uefa.europa", "uefa.europa.conf", "uefa.super_cup"],
    concacaf: ["concacaf.champions", "concacaf.leagues_cup"],
    conmebol: ["conmebol.libertadores", "conmebol.sudamericana"],
  },

  // A que confederacion pertenece cada pais (prefijo de la liga)
  confederacionPorPais: {
    esp: "uefa", eng: "uefa", ita: "uefa", ger: "uefa", fra: "uefa",
    por: "uefa", ned: "uefa", sco: "uefa", bel: "uefa", tur: "uefa",
    mex: "concacaf", usa: "concacaf",
    arg: "conmebol", bra: "conmebol", col: "conmebol", chi: "conmebol",
    uru: "conmebol", per: "conmebol", ecu: "conmebol", par: "conmebol",
  },

  // Copas nacionales por prefijo de la liga por defecto ("esp.1" -> "esp").
  // Una liga inexistente devuelve error y se ignora (y se apunta como muerta).
  copasPorPais: {
    esp: ["esp.copa_del_rey", "esp.super_cup"],
    eng: ["eng.fa", "eng.league_cup"],
    ita: ["ita.coppa_italia", "ita.super_cup"],
    ger: ["ger.dfb_pokal", "ger.super_cup"],
    fra: ["fra.coupe_de_france", "fra.super_cup"],
    por: ["por.taca_de_portugal", "por.liga_cup"],
    ned: ["ned.knvb_cup"],
    mex: ["mex.copa_mx"],
    arg: ["arg.copa"],
    bra: ["bra.copa_do_brazil"],
  },

  // Torneos de clubes sin pais concreto
  ligasClubGlobales: ["club.friendly", "fifa.cwc"],

  // El buscador de ESPN solo entiende nombres en ingles
  aliasEquipos: {
    "españa": "spain", "espana": "spain", "francia": "france", "alemania": "germany",
    "italia": "italy", "inglaterra": "england", "paises bajos": "netherlands",
    "holanda": "netherlands", "belgica": "belgium", "brasil": "brazil",
    "japon": "japan", "marruecos": "morocco", "croacia": "croatia",
    "suiza": "switzerland", "turquia": "turkey", "estados unidos": "usa",
    "escocia": "scotland", "gales": "wales", "irlanda": "ireland",
    "polonia": "poland", "suecia": "sweden", "noruega": "norway",
    "dinamarca": "denmark", "grecia": "greece", "republica checa": "czechia",
    "ucrania": "ukraine", "egipto": "egypt", "camerun": "cameroon",
    "argelia": "algeria", "tunez": "tunisia", "arabia saudita": "saudi arabia",
    "corea del sur": "south korea", "costa de marfil": "ivory coast",
  },

  // Que pide cada modo y con que ejemplos se presenta en la portada
  modos: {
    tiros: {
      tipo: "player",
      placeholder: "Nombre del jugador, ej: Lamine Yamal",
      ejemplos: ["Lamine Yamal", "Haaland", "Vinícius Júnior"],
    },
    partidos: {
      tipo: "team",
      placeholder: "Equipo o selección, ej: Real Madrid, España",
      ejemplos: ["Real Madrid", "América", "España"],
    },
    corners: {
      tipo: "team",
      placeholder: "Equipo o selección, ej: Real Madrid, España",
      ejemplos: ["Barcelona", "Tigres", "Liverpool"],
    },
    comparar: {
      tipo: "duelo",
      placeholder: "Dos equipos separados por «vs», ej: América vs Tigres",
      ejemplos: ["América vs Tigres", "Real Madrid vs Barcelona", "Chivas vs Cruz Azul"],
    },
  },
};
