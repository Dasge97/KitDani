' Arranca el servidor de KitDani sin ventana de consola.
' Lo usa la tarea programada "KitDani" (ver instalar-arranque.ps1).
' Argumento 1 (opcional): ruta completa de node.exe. Si no se pasa, usa node.exe del PATH.
Dim shell, fso, base, nodePath
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
If WScript.Arguments.Count > 0 Then
  nodePath = WScript.Arguments(0)
Else
  nodePath = "node.exe"
End If
shell.CurrentDirectory = base
shell.Run """" & nodePath & """ """ & base & "\servidor\index.mjs""", 0, False
