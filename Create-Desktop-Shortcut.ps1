$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $projectRoot 'Start-Hamtaraz.bat'
$icon = Join-Path $projectRoot 'hamtaraz.ico'

if (-not (Test-Path $launcher)) { throw "Launcher not found: $launcher" }
if (-not (Test-Path $icon)) { throw "Icon not found: $icon" }

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Hamtaraz.lnk'
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = "$icon,0"
$shortcut.Description = 'Start Hamtaraz Reconciliation Service'
$shortcut.Save()

Write-Host "Desktop shortcut created: $shortcutPath" -ForegroundColor Green
