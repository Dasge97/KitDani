# kit.json: how to make a tool importable into KitDani

**English** · [Español](kit-json.md)

Any tool with a `kit.json` file at the root of its folder (or of its git repository) can be imported
into KitDani with the **Importar** button. The panel clones it if needed, checks its requirements,
runs its installer and starts watching it.

Field names are in Spanish because the project was written in Spanish. Each one is explained below.

## Minimal example

A Python program that always runs in the background:

```json
{
  "kit": 1,
  "id": "my-tool",
  "nombre": "My tool",
  "descripcion": "What it does, in one line.",
  "tipo": "demonio",
  "proyecto": "{dir}",
  "comprobar": { "proceso_contiene": "my_tool.pyw" },
  "acciones": { "arrancar": "pythonw \"{dir}/my_tool.pyw\"" }
}
```

With that, the panel already knows whether it is running, can start and stop it, and can open its folder.

## Full example

This is the `kit.json` of [Ratón perdido](https://github.com/Dasge97/raton-perdido):

```json
{
  "kit": 1,
  "paquete": "raton-perdido",
  "requisitos": [
    { "comando": "pythonw", "texto": "Python 3.10 or later, with pythonw on the PATH" }
  ],
  "instalar": "powershell -NoProfile -ExecutionPolicy Bypass -File \"{dir}/instalar-inicio.ps1\"",
  "desinstalar": "powershell -NoProfile -ExecutionPolicy Bypass -File \"{dir}/desinstalar-inicio.ps1\"",

  "id": "raton-perdido",
  "nombre": "Ratón perdido",
  "descripcion": "Shake the mouse side to side and the cursor grows for a moment.",
  "tipo": "demonio",
  "proyecto": "{dir}",
  "estado_ruta": "{dir}/estado-ruta.txt",
  "comprobar": { "proceso_contiene": "raton_perdido.pyw" },
  "acciones": {
    "arrancar": "pythonw \"{dir}/raton_perdido.pyw\"",
    "parar": "powershell -NoProfile -ExecutionPolicy Bypass -File \"{dir}/detener.ps1\""
  },
  "registro": "{dir}/raton-perdido.log",
  "interruptores": [
    { "id": "activo", "etiqueta": "Detect shaking", "fichero": "{dir}/activo.txt",
      "encendido": "1", "apagado": "0", "si_no_existe": true }
  ]
}
```

## Variables

They can be used in any text value, so the same `kit.json` works on any PC and for any user.

| Variable | Value |
|---|---|
| `{dir}` | The tool's folder, with `/` separators |
| `{kit}` | The KitDani folder |
| `%VAR%` | A Windows environment variable, such as `%USERPROFILE%` or `%LOCALAPPDATA%` |

Do not write absolute paths like `C:/Users/someone/...`. They do not exist on another PC.

## Package fields

At the root of `kit.json`, for the whole tool.

| Field | Required | Meaning |
|---|---|---|
| `kit` | yes | Format version. Now `1`. |
| `paquete` | no | Package name. Defaults to the folder name. |
| `requisitos` | no | List of `{ "comando", "texto" }`. If `comando` is not on the PATH, import stops and shows `texto`. |
| `instalar` | no | Command run on import, if the user ticks it. Usually: register start with Windows and start it. Must not wait for input. |
| `desinstalar` | no | Command run when removing it from the Kit, if the user asks. Usually: remove start with Windows and stop it. |
| `actualizar` | no | Command run after `git pull` when pressing **Actualizar**. For example, restart it. |

## Service fields

A tool with a single service puts these fields at the root, next to the package fields.
A package with several services lists them: `"servicios": [ { ... }, { ... } ]`.

| Field | Meaning |
|---|---|
| `id` | Lowercase letters, digits and dashes. `kitdani` is reserved. |
| `nombre` | Name shown in the panel |
| `descripcion` | One line |
| `tipo` | How it is checked: `demonio` (always-running process), `tarea` (Windows scheduled task), `hook` (code inside another program), `contenedor` (local docker compose), `remoto` (runs on a server) |
| `proyecto` | Folder opened by the **Carpeta** button. Usually `{dir}` |
| `comprobar` | What to check. Keys per type are listed below |
| `acciones` | `arrancar` (start), `parar` (stop), `abrir` (URL or path to open), `extra` (custom buttons) |
| `registro` | Log file shown by the **Registro** button |
| `caducidad_minutos` | If `estado.json` is older than this, the row turns to warning |
| `interruptores` | Switches the panel can flip: a file holding `encendido` or `apagado`, optional `horario` |
| `avisos` | Default phone-notification mode: `no`, `caidas` (default) or `todo` |
| `estado_ruta` | File where the Kit writes, on import, the path where the tool must write its `estado.json`. The tool never needs to know where the Kit lives. On removal this file is deleted and the tool stops reporting. |

`comprobar` keys:

| Type | Keys |
|---|---|
| `demonio` | `proceso_contiene` (text in the process command line), `puerto`, `tarea_windows` |
| `tarea` | `tarea_windows` (exact name in Task Scheduler) |
| `hook` | `ficheros` (paths that must exist), `fichero_contiene` (`{ "fichero", "texto" }`), `proceso_contiene` (host program must be running) |
| `contenedor` | `compose` (path to docker-compose.yml), `proyecto_compose` |
| `remoto` | `host` (SSH alias), `url` (must answer 200), `contenedor` (docker container on the server), `estado_remoto` (path of its `estado.json` on the server), `sesion_remota` |

## Reporting status (optional, recommended)

Without writing anything, the panel already knows whether the tool is running. To show its own data
(how many times it was used today, last run, errors), the tool writes an `estado.json` at the path
read from its `estado_ruta` file:

```json
{
  "estado": "ok",
  "actualizado": "2026-10-10T00:14:18+02:00",
  "mensaje": "One line about what is going on",
  "indicadores": [ { "etiqueta": "Uses today", "valor": "7" } ]
}
```

`estado` is `ok`, `aviso` (warning), `error` or `parado` (stopped). Write it atomically: to a temporary
file, then rename. If the `estado_ruta` file does not exist, the tool writes nothing.

## Phone notifications

If the Kit has ntfy configured, each service has a notification mode, chosen in its detail:

| Mode | Notifies |
|---|---|
| `no` | Nothing |
| `caidas` | When it has been in `error` or `parado` for a minute, and when it comes back. Default. |
| `todo` | Also when it turns to `aviso` |

A tool can also send its own notifications through the Kit, without its own ntfy token:

```powershell
Invoke-RestMethod -Method Post http://localhost:8790/api/avisar -ContentType 'application/json' `
  -Body '{ "id": "my-tool", "titulo": "Publish failed", "texto": "git push rejected", "prioridad": 4 }'
```

```python
import json, urllib.request
data = json.dumps({"id": "my-tool", "titulo": "Publish failed", "texto": "git push rejected", "prioridad": 4}).encode()
urllib.request.urlopen(urllib.request.Request("http://localhost:8790/api/avisar", data, {"Content-Type": "application/json"}), timeout=5)
```

- `prioridad` is 1 to 5. `tags` takes ntfy emoji names separated by commas.
- Answers 200 if sent, and 409 with a `motivo` (reason) if not: notifications off, ntfy not set up,
  or the limit (one every 10 seconds and 20 per hour per service).
- Wrap it in a try: if the Kit is not running, the tool must keep working.

On a Linux server, use `kit-estado` and `kit-avisar` from the `remoto/` folder instead.
See [How it works](how-it-works.md).

## Checking that a kit.json is valid

Import the local folder in the panel with "Ejecutar su instalador" unticked. If something is wrong,
the dialog says which field. To remove it afterwards, use **Quitar del Kit** in its detail.
