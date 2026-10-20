# Instala o VB-CABLE a partir do pacote original.
#
# Extrai o zip da VB-Audio sem alterá-lo e executa o instalador oficial deles.
# Chamado pelo instalador do soundFrog (build/installer.nsh) e também pelo
# botão dentro do app (src/main/cable.js), que tem seu próprio caminho em JS.
#
# Embutir este pacote foi autorizado por Vincent Burel (VB-Audio) para uso
# estritamente não comercial. Veja vendor/README.md.

param(
  [Parameter(Mandatory = $true)][string]$Zip
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Zip)) {
  Write-Error "Pacote do VB-CABLE nao encontrado em: $Zip"
  exit 2
}

# Se o cabo ja existe, nao mexe: reinstalar exigiria outro reboot a toa.
$existing = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'CABLE (Input|Output)|VB-Audio' }
if ($existing) {
  Write-Output 'VB-CABLE ja esta instalado.'
  exit 0
}

$dir = Join-Path $env:TEMP 'soundfrog-vbcable'
if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
Expand-Archive -LiteralPath $Zip -DestinationPath $dir -Force

# PowerShell 5.1 nao aceita 'if' como expressao, entao resolve antes.
$exe = 'VBCABLE_Setup.exe'
if ([Environment]::Is64BitOperatingSystem) { $exe = 'VBCABLE_Setup_x64.exe' }
$setup = Join-Path $dir $exe
if (-not (Test-Path -LiteralPath $setup)) {
  Write-Error 'Instalador do VB-CABLE nao encontrado dentro do pacote.'
  exit 3
}

# -Verb RunAs: o driver precisa de administrador. Se a pessoa recusar o UAC,
# o Start-Process lanca excecao e saimos com codigo proprio.
try {
  $proc = Start-Process -FilePath $setup -Verb RunAs -PassThru -Wait
} catch {
  Write-Output 'Instalacao cancelada pelo usuario.'
  exit 1223
}

Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
exit $proc.ExitCode
