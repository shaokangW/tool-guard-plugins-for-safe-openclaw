$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $HOME ".openclaw\openclaw.json"
$rulesRoot = Join-Path $projectRoot "examples\rules"

if (-not (Test-Path $configPath)) {
  throw "OpenClaw config not found at $configPath"
}

Write-Host "Installing tool-guard plugin from $projectRoot"
openclaw plugins install -l $projectRoot | Out-Host

$config = Get-Content $configPath -Raw | ConvertFrom-Json

if (-not $config.plugins) {
  $config | Add-Member -NotePropertyName plugins -NotePropertyValue ([pscustomobject]@{})
}

if (-not $config.plugins.allow) {
  $config.plugins | Add-Member -NotePropertyName allow -NotePropertyValue @()
}

if (-not ($config.plugins.allow -contains "tool-guard")) {
  $config.plugins.allow += "tool-guard"
}

if (-not $config.plugins.load) {
  $config.plugins | Add-Member -NotePropertyName load -NotePropertyValue ([pscustomobject]@{ paths = @() })
}
if (-not $config.plugins.load.paths) {
  $config.plugins.load | Add-Member -NotePropertyName paths -NotePropertyValue @()
}
if (-not ($config.plugins.load.paths -contains $projectRoot)) {
  $config.plugins.load.paths += $projectRoot
}

if (-not $config.plugins.entries) {
  $config.plugins | Add-Member -NotePropertyName entries -NotePropertyValue ([pscustomobject]@{})
}

$userHome = [Environment]::GetFolderPath("UserProfile")
$entryConfig = [pscustomobject]@{
  blockedCommandRulesFile = (Join-Path $rulesRoot "dangerous-commands.json")
  confirmCommandRulesFile = (Join-Path $rulesRoot "warning-commands.json")
  sensitiveContentRulesFile = (Join-Path $rulesRoot "sensitive-content.json")
  blockedCommandSubstrings = @(
    "rm -rf",
    "del /f /s /q",
    "remove-item -recurse -force",
    "format ",
    "shutdown ",
    "invoke-webrequest ",
    "iex "
  )
  blockedPathPrefixes = @(
    (Join-Path $userHome ".ssh"),
    (Join-Path $userHome ".openclaw"),
    "C:\Windows",
    ".git"
  )
  blockMessageWrites = $true
  blockMessageSending = $true
  redactToolResults = $true
  confirmTtlMs = 600000
}

if ($config.plugins.entries.PSObject.Properties.Name -contains "tool-guard") {
  $config.plugins.entries.PSObject.Properties.Remove("tool-guard")
}

$config.plugins.entries | Add-Member -NotePropertyName "tool-guard" -NotePropertyValue ([pscustomobject]@{
  enabled = $true
  config = $entryConfig
})

$config | ConvertTo-Json -Depth 100 | Set-Content -Path $configPath -Encoding UTF8

Write-Host "Validating OpenClaw config"
openclaw config validate | Out-Host

Write-Host "Restarting OpenClaw gateway"
$logDir = Join-Path $HOME ".openclaw\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdout = Join-Path $logDir "tool-guard-install.out.log"
$stderr = Join-Path $logDir "tool-guard-install.err.log"
Start-Process -FilePath "openclaw.cmd" -ArgumentList "gateway","run","--force" -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr | Out-Null
Start-Sleep -Seconds 6

Write-Host "tool-guard installation complete."
Write-Host "Rules directory: $rulesRoot"
Write-Host "OpenClaw config: $configPath"
