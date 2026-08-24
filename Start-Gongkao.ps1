[CmdletBinding()]
param(
  [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$baseUrl = "http://127.0.0.1:4137"
$healthUrl = "$baseUrl/api/health"
$logDir = Join-Path $projectRoot "logs"
$pidPath = Join-Path $logDir "server.pid"
$statusPath = Join-Path $logDir "last-start-status.txt"

function Test-GongkaoServer {
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    return $health.ok -eq $true
  } catch {
    return $false
  }
}

function Get-GongkaoListenerPid {
  $line = netstat -ano -p tcp | Select-String -Pattern '^\s*TCP\s+\S+:4137\s+\S+\s+LISTENING\s+(\d+)\s*$' | Select-Object -First 1
  if (-not $line) {
    return $null
  }
  return [int]$line.Matches[0].Groups[1].Value
}

function Test-IsRecordedGongkaoProcess([int]$processId) {
  if (-not (Test-Path -LiteralPath $pidPath)) {
    return $false
  }
  $recordedPid = 0
  if (-not [int]::TryParse((Get-Content -Raw -LiteralPath $pidPath).Trim(), [ref]$recordedPid)) {
    return $false
  }
  if ($recordedPid -ne $processId) {
    return $false
  }
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  return $processInfo.Name -eq "node.exe" -and [string]$processInfo.CommandLine -match '(?i)(^|[\\/\s"])server\.js([\s"]|$)'
}

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if (-not (Test-GongkaoServer)) {
  $listenerPid = Get-GongkaoListenerPid
  if ($listenerPid) {
    if (Test-IsRecordedGongkaoProcess $listenerPid) {
      Stop-Process -Id $listenerPid -Force
      Start-Sleep -Milliseconds 500
    } else {
      throw "Port 4137 is occupied by another program (PID $listenerPid). Restart Windows, then run this repair shortcut again."
    }
  }

  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw "Node.js was not found. Install Node.js 20 or newer, then run this repair shortcut again."
  }
  $nodePath = $nodeCommand.Source
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $stdoutPath = Join-Path $logDir "server-$stamp.out.log"
  $stderrPath = Join-Path $logDir "server-$stamp.err.log"
  $server = Start-Process `
    -FilePath $nodePath `
    -ArgumentList "server.js" `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru

  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    if (Test-GongkaoServer) {
      $ready = $true
      break
    }
    if ($server.HasExited) {
      break
    }
  }

  if (-not $ready) {
    $details = if (Test-Path -LiteralPath $stderrPath) {
      (Get-Content -Raw -LiteralPath $stderrPath).Trim()
    } else {
      "No error log was produced."
    }
    $errorReport = Join-Path $logDir "last-start-error.txt"
    Set-Content -LiteralPath $errorReport -Value "$(Get-Date -Format s)`r`n$details"
    throw "Gongkao server failed to start. See $errorReport. $details"
  }

  Set-Content -LiteralPath $pidPath -Value $server.Id
}

$currentHealth = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 5
Set-Content -LiteralPath $statusPath -Value @(
  "time=$(Get-Date -Format s)"
  "status=healthy"
  "pid=$($currentHealth.pid)"
  "url=$baseUrl"
)

if ($OpenBrowser) {
  Start-Process $baseUrl
}

Write-Output "Gongkao Manager is healthy (PID $($currentHealth.pid)): $baseUrl"
