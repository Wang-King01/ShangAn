$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$startScript = Join-Path $projectRoot "Start-Gongkao.ps1"
$openScript = Join-Path $projectRoot "Open-Gongkao.cmd"
$startupDir = [Environment]::GetFolderPath("Startup")
$desktopDir = [Environment]::GetFolderPath("Desktop")
$startupShortcutPath = Join-Path $startupDir "Gongkao Manager.lnk"
$desktopShortcutName = (-join @(
  [char]0x8003, [char]0x516C, [char]0x5907, [char]0x6218, [char]0x53F0,
  [char]0xFF08, [char]0x542F, [char]0x52A8, [char]0x6216, [char]0x4FEE,
  [char]0x590D, [char]0xFF09
)) + ".lnk"
$desktopShortcutPath = Join-Path $desktopDir $desktopShortcutName
$powershellPath = Join-Path $PSHOME "powershell.exe"

if (-not (Test-Path -LiteralPath $startScript)) {
  throw "Start script not found: $startScript"
}
if (-not (Test-Path -LiteralPath $openScript)) {
  throw "Open script not found: $openScript"
}

$shell = New-Object -ComObject WScript.Shell
$startupShortcut = $shell.CreateShortcut($startupShortcutPath)
$startupShortcut.TargetPath = $powershellPath
$startupShortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $startScript
$startupShortcut.WorkingDirectory = $projectRoot
$startupShortcut.Description = "Start Gongkao Manager on Windows sign-in"
$startupShortcut.IconLocation = "$env:SystemRoot\System32\SHELL32.dll,14"
$startupShortcut.Save()

$desktopShortcut = $shell.CreateShortcut($desktopShortcutPath)
$desktopShortcut.TargetPath = $env:ComSpec
$desktopShortcut.Arguments = '/c ""{0}""' -f $openScript
$desktopShortcut.WorkingDirectory = $projectRoot
$desktopShortcut.Description = "Start or repair Gongkao Manager"
$desktopShortcut.IconLocation = "$env:SystemRoot\System32\SHELL32.dll,14"
$desktopShortcut.Save()

Write-Output "Autostart installed: $startupShortcutPath"
Write-Output "Desktop repair shortcut installed: $desktopShortcutPath"
