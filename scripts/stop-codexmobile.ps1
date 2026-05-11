Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$CodexNode = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin\node.exe'

if (Test-Path -LiteralPath $CodexNode) {
  $NodePath = $CodexNode
} else {
  $NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $NodeCommand) {
    throw 'node.exe was not found. Install Node.js or run this from a Codex environment that includes node.exe.'
  }
  $NodePath = $NodeCommand.Source
}

$StopScript = Join-Path $ProjectRoot 'scripts\stop-server.mjs'

Push-Location $ProjectRoot
try {
  Write-Host "Stopping CodexMobile with node: $NodePath"
  & $NodePath $StopScript codexmobile
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}
