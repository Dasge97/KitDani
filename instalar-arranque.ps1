# Registra la tarea programada "KitDani": arranca el servidor al iniciar sesión y lo relanza
# cada 5 minutos si se ha caído (si ya hay uno escuchando, el nuevo se cierra solo).
# Ejecutar una vez:  powershell -ExecutionPolicy Bypass -File .\instalar-arranque.ps1
# Para quitarla:     powershell -ExecutionPolicy Bypass -File .\desinstalar-arranque.ps1
$ErrorActionPreference = 'Stop'
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path

$node = $null
$cmd = Get-Command node.exe -ErrorAction SilentlyContinue
if ($cmd) { $node = $cmd.Source }
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
if (-not (Test-Path $node)) { throw "No encuentro node.exe. Instala Node 22 o superior." }

$accion = New-ScheduledTaskAction -Execute 'wscript.exe' `
  -Argument "`"$aqui\iniciar-oculto.vbs`" `"$node`"" -WorkingDirectory $aqui

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$repeticion = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)).Repetition
$trigger.Repetition = $repeticion

$ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew -StartWhenAvailable

Register-ScheduledTask -TaskName 'KitDani' -Action $accion -Trigger $trigger -Settings $ajustes `
  -Description 'Servidor del panel KitDani (servicios del Kit). Puerto 8790.' -Force | Out-Null

Start-ScheduledTask -TaskName 'KitDani'
Write-Output "Tarea 'KitDani' registrada y arrancada. Panel: http://localhost:8790/"
Start-Sleep -Seconds 3
Start-Process 'http://localhost:8790/'
Write-Output "Node usado: $node"
