# jugador.py - Ultimos N partidos de un jugador con sus estadisticas (fuente: API publica de ESPN)
# Combina TODAS las competiciones: liga, copas, Champions y selecciones (Mundial, amistosos, etc.)
# Uso:
#   python jugador.py "lamine yamal"
#   python jugador.py "mbappe" --partidos 10
#   python jugador.py "luis diaz" --indice 2
import argparse
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import requests

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
BASE = "https://site.web.api.espn.com"

# Competiciones de seleccion: ESPN no las lista en los filtros del club, hay que pedirlas aparte
LIGAS_SELECCION = [
    "fifa.world",            # Mundial
    "fifa.friendly",         # Amistosos internacionales
    "uefa.euro",             # Eurocopa
    "uefa.nations",          # UEFA Nations League
    "conmebol.america",      # Copa America
    "concacaf.gold",         # Copa Oro
    "fifa.worldq.uefa",      # Eliminatorias UEFA
    "fifa.worldq.conmebol",  # Eliminatorias CONMEBOL
    "fifa.worldq.concacaf",  # Eliminatorias CONCACAF
]


def buscar_jugador(nombre: str) -> list[dict]:
    r = requests.get(f"{BASE}/apis/search/v2", params={"query": nombre, "limit": 10}, headers=HEADERS, timeout=15)
    r.raise_for_status()
    for grupo in r.json().get("results", []):
        if grupo.get("type") == "player":
            return grupo.get("contents", [])
    return []


def gamelog(id_atleta: str, liga: str | None = None) -> dict | None:
    params = {"league": liga} if liga else {}
    try:
        r = requests.get(f"{BASE}/apis/common/v3/sports/soccer/athletes/{id_atleta}/gamelog",
                         params=params, headers=HEADERS, timeout=15)
        r.raise_for_status()
        return r.json()
    except requests.RequestException:
        return None  # liga sin datos para este jugador: se ignora


def parsear_partidos(data: dict | None) -> list[dict]:
    """Convierte una respuesta de gamelog en filas partido+estadisticas."""
    if not data or not data.get("events"):
        return []
    pos = {nombre: i for i, nombre in enumerate(data.get("names", []))}

    def stat(stats: list, nombre: str) -> int:
        try:
            return int(stats[pos[nombre]]) if nombre in pos else 0
        except (ValueError, IndexError):
            return 0

    filas = []
    for temporada in data.get("seasonTypes", []):
        for categoria in temporada.get("categories", []):
            for ev in categoria.get("events", []):
                meta = data["events"].get(str(ev["eventId"]))
                if not meta:
                    continue
                filas.append({
                    "event_id": str(ev["eventId"]),
                    "fecha": datetime.fromisoformat(meta["gameDate"].replace("Z", "+00:00")),
                    "rival": meta["opponent"]["displayName"],
                    "competicion": meta.get("leagueName", ""),
                    "resultado": meta.get("gameResult", ""),
                    "marcador": meta.get("score", ""),
                    "goles": stat(ev["stats"], "totalGoals"),
                    "asistencias": stat(ev["stats"], "goalAssists"),
                    "tiros": stat(ev["stats"], "totalShots"),
                    "tiros_puerta": stat(ev["stats"], "shotsOnTarget"),
                })
    return filas


def main() -> None:
    ap = argparse.ArgumentParser(description="Ultimos N partidos de un jugador (fuente: ESPN)")
    ap.add_argument("jugador", help="Nombre del jugador, ej: 'lamine yamal'")
    ap.add_argument("--partidos", type=int, default=5)
    ap.add_argument("--indice", type=int, default=1, help="Cual candidato usar si hay varios (1 = primero)")
    args = ap.parse_args()

    candidatos = buscar_jugador(args.jugador)
    if not candidatos:
        sys.exit(f"No se encontro ningun jugador con el nombre '{args.jugador}'.")

    print("\nJugadores encontrados:")
    for i, c in enumerate(candidatos, 1):
        marca = ">>" if i == args.indice else "  "
        print(f"{marca} {i}. {c['displayName']}  ({c.get('description', '')})")

    elegido = candidatos[args.indice - 1]
    # uid con formato "s:600~a:362150" -> id del atleta despues de "a:"
    id_atleta = elegido["uid"].split("a:")[-1]
    print(f"\nJugador: {elegido['displayName']}  (id ESPN: {id_atleta})")

    # 1. Gamelog por defecto (trae solo la liga principal del club) + lista de sus otras competiciones
    base = gamelog(id_atleta)
    if not base:
        sys.exit("ESPN no tiene partidos registrados para este jugador.")
    filas = parsear_partidos(base)

    liga_defecto = next((f.get("value") for f in base.get("filters", []) if f.get("name") == "league"), None)
    ligas_club = [o["value"] for f in base.get("filters", []) if f.get("name") == "league"
                  for o in f.get("options", [])]

    # 2. Pedir en paralelo el resto: otras competiciones del club + competiciones de seleccion
    pendientes = [l for l in dict.fromkeys(ligas_club + LIGAS_SELECCION) if l != liga_defecto]
    with ThreadPoolExecutor(max_workers=8) as ex:
        for data in ex.map(lambda l: gamelog(id_atleta, l), pendientes):
            filas.extend(parsear_partidos(data))

    if not filas:
        sys.exit("ESPN no tiene estadisticas de partidos para este jugador.")

    # 3. Quitar duplicados por id de partido y ordenar del mas reciente al mas viejo
    vistos, unicos = set(), []
    for f in sorted(filas, key=lambda x: x["fecha"], reverse=True):
        if f["event_id"] not in vistos:
            vistos.add(f["event_id"])
            unicos.append(f)
    ultimos = unicos[: args.partidos]

    print(f"\n=== Ultimos {len(ultimos)} partidos de {elegido['displayName']} (todas las competiciones) ===")
    print(f"{'Fecha':<12}{'Rival':<22}{'Competicion':<26}{'Res':<5}{'Marc':<7}{'G':>3}{'A':>3}{'Tiros':>7}{'T.Puerta':>10}")
    for f in ultimos:
        print(f"{f['fecha']:%Y-%m-%d}  {f['rival']:<22}{f['competicion']:<26}{f['resultado']:<5}{f['marcador']:<7}"
              f"{f['goles']:>3}{f['asistencias']:>3}{f['tiros']:>7}{f['tiros_puerta']:>10}")

    n = len(ultimos)
    if n:
        tot_tiros = sum(f["tiros"] for f in ultimos)
        tot_puerta = sum(f["tiros_puerta"] for f in ultimos)
        print(f"\nPromedios: {tot_tiros / n:.2f} tiros/partido | {tot_puerta / n:.2f} tiros a puerta/partido")
        print(f"Partidos con 1+ tiro: {sum(1 for f in ultimos if f['tiros'] >= 1)}/{n} | "
              f"con 1+ tiro a puerta: {sum(1 for f in ultimos if f['tiros_puerta'] >= 1)}/{n}")


if __name__ == "__main__":
    main()
