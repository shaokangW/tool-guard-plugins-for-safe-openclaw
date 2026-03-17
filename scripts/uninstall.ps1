$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $HOME ".openclaw\openclaw.json"

if (-not (Test-Path $configPath)) {
  throw "OpenClaw config not found at $configPath"
}

$config = Get-Content $configPath -Raw | ConvertFrom-Json

if ($config.plugins) {
  if ($config.plugins.allow) {
    $config.plugins.allow = @($config.plugins.allow | Where-Object { $_ -ne "tool-guard" })
  }

  if ($config.plugins.load -and $config.plugins.load.paths) {
    $config.plugins.load.paths = @($config.plugins.load.paths | Where-Object { $_ -ne $projectRoot })
  }

  if ($config.plugins.entries -and $config.plugins.entries."tool-guard") {
    $config.plugins.entries.PSObject.Properties.Remove("tool-guard")
  }
}

$config | ConvertTo-Json -Depth 100 | Set-Content -Path $configPath -Encoding UTF8

Write-Host "Updated OpenClaw config."
Write-Host "Uninstalling plugin registration"
openclaw plugins uninstall tool-guard | Out-Host

Write-Host "Validating OpenClaw config"
openclaw config validate | Out-Host

Write-Host "tool-guard uninstall complete."
