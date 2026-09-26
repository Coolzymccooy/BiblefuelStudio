# Start the Biblefuel vocal-removal worker automatically when you log on.
#
#   powershell -ExecutionPolicy Bypass -File server\scripts\install-stems-worker.ps1
#
# Registers a Task Scheduler task for the current user only (no admin rights),
# which runs `npm run stems-worker` in the server folder, hidden, and restarts
# it if it stops. Remove it with:
#   Unregister-ScheduledTask -TaskName "Biblefuel vocal removal" -Confirm:$false

$ErrorActionPreference = 'Stop'
$serverDir = Resolve-Path (Join-Path $PSScriptRoot '..')
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$logFile = Join-Path $serverDir 'stems-worker.log'

$action = New-ScheduledTaskAction -Execute 'cmd.exe' `
  -Argument "/c `"`"$npm`" run stems-worker >> `"$logFile`" 2>&1`"" `
  -WorkingDirectory $serverDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable -Hidden

Register-ScheduledTask -TaskName 'Biblefuel vocal removal' -Action $action -Trigger $trigger `
  -Settings $settings -Description 'Removes vocals on this laptop for biblefuel.tiwaton.co.uk' -Force | Out-Null
Start-ScheduledTask -TaskName 'Biblefuel vocal removal'
Write-Host "Installed and started. Progress is logged to $logFile"
