# Quita la tarea programada "KitDani" y para el servidor si está en marcha.
$ErrorActionPreference = 'SilentlyContinue'
Unregister-ScheduledTask -TaskName 'KitDani' -Confirm:$false
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*KitDani\servidor\index.mjs*' } | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force
  Write-Output "Proceso $($_.ProcessId) detenido."
}
Write-Output "Tarea 'KitDani' eliminada."
