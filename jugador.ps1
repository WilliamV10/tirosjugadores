# jugador.ps1 - Ultimos N partidos de un jugador con sus estadisticas (fuente: API publica de ESPN)
# Combina TODAS las competiciones: liga, copas, Champions y selecciones (Mundial, amistosos, etc.)
# Uso:
#   .\jugador.ps1 -Jugador "lamine yamal"
#   .\jugador.ps1 -Jugador "mbappe" -Partidos 10
#   .\jugador.ps1 -Jugador "vinicius" -Csv            (exporta a CSV ademas de mostrar la tabla)
#   .\jugador.ps1 -Jugador "james rodriguez" -Indice 2 (si hay varios jugadores con ese nombre, elige el numero 2)

param(
    [Parameter(Mandatory = $true)]
    [string]$Jugador,

    [int]$Partidos = 5,

    [int]$Indice = 1,

    [switch]$Csv
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$headers = @{ 'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }

# Competiciones de seleccion: ESPN no las lista en los filtros del club, hay que pedirlas aparte
$ligasSeleccion = @(
    'fifa.world', 'fifa.friendly', 'uefa.euro', 'uefa.nations',
    'conmebol.america', 'concacaf.gold',
    'fifa.worldq.uefa', 'fifa.worldq.conmebol', 'fifa.worldq.concacaf'
)

# ---------- 1. Buscar el jugador por nombre ----------
$q = [uri]::EscapeDataString($Jugador)
$busqueda = Invoke-RestMethod -Uri "https://site.web.api.espn.com/apis/search/v2?query=$q&limit=10" -Headers $headers

$grupoJugadores = $busqueda.results | Where-Object { $_.type -eq 'player' }
if (-not $grupoJugadores) {
    Write-Host "No se encontro ningun jugador con el nombre '$Jugador'." -ForegroundColor Red
    exit 1
}

$candidatos = @($grupoJugadores.contents)
Write-Host ""
Write-Host "Jugadores encontrados:" -ForegroundColor Cyan
for ($i = 0; $i -lt $candidatos.Count; $i++) {
    $marca = if (($i + 1) -eq $Indice) { '>>' } else { '  ' }
    Write-Host ("{0} {1}. {2}  ({3})" -f $marca, ($i + 1), $candidatos[$i].displayName, $candidatos[$i].description)
}

if ($Indice -lt 1 -or $Indice -gt $candidatos.Count) {
    Write-Host "El indice $Indice no existe. Usa -Indice entre 1 y $($candidatos.Count)." -ForegroundColor Red
    exit 1
}
$elegido = $candidatos[$Indice - 1]

# El uid tiene el formato "s:600~a:362150" -> el id del atleta va despues de "a:"
if ($elegido.uid -notmatch 'a:(\d+)') {
    Write-Host "No se pudo extraer el id del jugador desde uid '$($elegido.uid)'." -ForegroundColor Red
    exit 1
}
$idAtleta = $Matches[1]
Write-Host ""
Write-Host ("Jugador: {0}  (id ESPN: {1})" -f $elegido.displayName, $idAtleta) -ForegroundColor Green

# ---------- 2. Descargar gamelogs (liga por defecto + resto de competiciones) ----------
function Get-Gamelog($id, $liga) {
    $url = "https://site.web.api.espn.com/apis/common/v3/sports/soccer/athletes/$id/gamelog"
    if ($liga) { $url += "?league=$liga" }
    try { return Invoke-RestMethod -Uri $url -Headers $headers } catch { return $null }
}

function ConvertTo-Filas($data) {
    $filas = @()
    if (-not $data -or -not $data.events) { return $filas }
    $pos = @{}
    for ($i = 0; $i -lt $data.names.Count; $i++) { $pos[$data.names[$i]] = $i }
    foreach ($temporada in $data.seasonTypes) {
        foreach ($categoria in $temporada.categories) {
            foreach ($ev in $categoria.events) {
                $meta = $data.events.($ev.eventId)
                if (-not $meta) { continue }
                $filas += [pscustomobject]@{
                    EventId     = [string]$ev.eventId
                    Fecha       = ([datetime]$meta.gameDate)
                    Rival       = $meta.opponent.displayName
                    Competicion = $meta.leagueName
                    Resultado   = $meta.gameResult
                    Marcador    = $meta.score
                    Goles       = if ($pos.ContainsKey('totalGoals'))    { [int]$ev.stats[$pos['totalGoals']] }    else { 0 }
                    Asistencias = if ($pos.ContainsKey('goalAssists'))   { [int]$ev.stats[$pos['goalAssists']] }   else { 0 }
                    Tiros       = if ($pos.ContainsKey('totalShots'))    { [int]$ev.stats[$pos['totalShots']] }    else { 0 }
                    TirosPuerta = if ($pos.ContainsKey('shotsOnTarget')) { [int]$ev.stats[$pos['shotsOnTarget']] } else { 0 }
                    Amarillas   = if ($pos.ContainsKey('yellowCards'))   { [int]$ev.stats[$pos['yellowCards']] }   else { 0 }
                }
            }
        }
    }
    return $filas
}

$base = Get-Gamelog $idAtleta $null
if (-not $base) {
    Write-Host "ESPN no tiene partidos registrados para este jugador." -ForegroundColor Yellow
    exit 1
}
$filas = @(ConvertTo-Filas $base)

$ligaDefecto = ($base.filters | Where-Object { $_.name -eq 'league' }).value
$ligasClub = @(($base.filters | Where-Object { $_.name -eq 'league' }).options | ForEach-Object { $_.value })

$pendientes = @(($ligasClub + $ligasSeleccion) | Select-Object -Unique | Where-Object { $_ -and $_ -ne $ligaDefecto })
Write-Host ("Consultando {0} competiciones..." -f ($pendientes.Count + 1))
foreach ($liga in $pendientes) {
    $filas += ConvertTo-Filas (Get-Gamelog $idAtleta $liga)
}

if (-not $filas) {
    Write-Host "ESPN no tiene estadisticas de partidos para este jugador." -ForegroundColor Yellow
    exit 1
}

# ---------- 3. Quitar duplicados por id de partido y ordenar del mas reciente al mas viejo ----------
$filas = $filas | Sort-Object Fecha -Descending | Group-Object EventId | ForEach-Object { $_.Group[0] } | Sort-Object Fecha -Descending
$ultimos = @($filas | Select-Object -First $Partidos)

# ---------- 4. Mostrar resultados ----------
Write-Host ""
Write-Host ("=== Ultimos {0} partidos de {1} (todas las competiciones) ===" -f $ultimos.Count, $elegido.displayName) -ForegroundColor Cyan

$ultimos |
    Select-Object @{n='Fecha';e={$_.Fecha.ToString('yyyy-MM-dd')}}, Rival, Competicion, Resultado, Marcador, Goles, Asistencias, Tiros, TirosPuerta, Amarillas |
    Format-Table -AutoSize

# Promedios de tiros: lo importante para apuestas
$n = $ultimos.Count
if ($n -gt 0) {
    $totTiros  = ($ultimos | Measure-Object Tiros -Sum).Sum
    $totPuerta = ($ultimos | Measure-Object TirosPuerta -Sum).Sum
    $totGoles  = ($ultimos | Measure-Object Goles -Sum).Sum
    Write-Host ("Promedios en estos {0} partidos:" -f $n) -ForegroundColor Cyan
    Write-Host ("  Tiros totales:   {0}  (promedio {1})" -f $totTiros,  [math]::Round($totTiros / $n, 2))
    Write-Host ("  Tiros a puerta:  {0}  (promedio {1})" -f $totPuerta, [math]::Round($totPuerta / $n, 2))
    Write-Host ("  Goles:           {0}  (promedio {1})" -f $totGoles,  [math]::Round($totGoles / $n, 2))
    $conUnTiro = @($ultimos | Where-Object { $_.Tiros -ge 1 }).Count
    $conUnTiroPuerta = @($ultimos | Where-Object { $_.TirosPuerta -ge 1 }).Count
    Write-Host ("  Partidos con 1+ tiro: {0}/{1}   |   con 1+ tiro a puerta: {2}/{3}" -f $conUnTiro, $n, $conUnTiroPuerta, $n)
}

# ---------- 5. Exportar a CSV (opcional) ----------
if ($Csv) {
    $nombreArchivo = ($elegido.displayName -replace '[^\w\- ]', '' -replace ' ', '_') + '_ultimos_' + $n + '.csv'
    $ruta = Join-Path $PSScriptRoot $nombreArchivo
    $ultimos | Select-Object * -ExcludeProperty EventId | Export-Csv -Path $ruta -NoTypeInformation -Encoding UTF8
    Write-Host ""
    Write-Host "CSV guardado en: $ruta" -ForegroundColor Green
}
