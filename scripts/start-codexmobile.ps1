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

$NodeDir = Split-Path -Parent $NodePath
$CodexBinary = Join-Path $NodeDir 'codex.exe'
$StopScript = Join-Path $ProjectRoot 'scripts\stop-server.mjs'
$ServerScript = Join-Path $ProjectRoot 'server\index.js'
$LogDir = Join-Path $ProjectRoot '.codexmobile'
$OutLog = Join-Path $LogDir 'server.out.log'
$ErrLog = Join-Path $LogDir 'server.err.log'
$PidFile = Join-Path $LogDir 'server.pid'
$Port = if ($env:PORT) { [int]$env:PORT } else { 3321 }
$previousPath = $null
$previousCodexBinary = $null

Push-Location $ProjectRoot
try {
  New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
  & $NodePath $StopScript codexmobile
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  $previousPath = $env:Path
  $previousCodexBinary = $env:CODEXMOBILE_CODEX_BINARY
  $env:Path = "$NodeDir;$env:Path"
  if ((Test-Path -LiteralPath $CodexBinary) -and -not $env:CODEXMOBILE_CODEX_BINARY) {
    $env:CODEXMOBILE_CODEX_BINARY = $CodexBinary
  }
  [Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
  [Environment]::SetEnvironmentVariable('Path', $env:Path, 'Process')

  Write-Host "Starting CodexMobile with node: $NodePath"
  $process = Start-Process `
    -FilePath $NodePath `
    -ArgumentList @($ServerScript, '--codexmobile-service=codexmobile') `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog `
    -PassThru

  @{
    pid = $process.Id
    serviceName = 'codexmobile'
    root = $ProjectRoot
    port = $Port
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $PidFile -Encoding UTF8

  Start-Sleep -Milliseconds 700
  if ($process.HasExited) {
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    throw "CodexMobile exited during startup with code $($process.ExitCode). Check $ErrLog"
  }
  Write-Host "CodexMobile server started in background, pid=$($process.Id)"
  Write-Host "Service: codexmobile"
  Write-Host "Logs: $OutLog"
} finally {
  if ($null -ne $previousPath) {
    [Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
    [Environment]::SetEnvironmentVariable('Path', $previousPath, 'Process')
  }
  if ($null -ne $previousCodexBinary) {
    $env:CODEXMOBILE_CODEX_BINARY = $previousCodexBinary
  } else {
    Remove-Item Env:\CODEXMOBILE_CODEX_BINARY -ErrorAction SilentlyContinue
  }
  Pop-Location
}
