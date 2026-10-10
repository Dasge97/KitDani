# How it works

**English** · [Español](como-funciona.md)

## Parts

```
servidor/index.mjs       HTTP server, API and check cycles
servidor/comprobar.mjs   checks per type (demonio, tarea, hook, contenedor, remoto)
servidor/importar.mjs    import, update and remove tools that have a kit.json
servidor/extras.mjs      stopping processes, ntfy notifications and switch schedules
servidor/servicios.mjs   reading services, {dir} {kit} %VAR% variables, switches
servidor/config.mjs      settings and config.local.json
remoto/                  kit-estado, kit-avisar and kit-kuma for a Linux server
web/                     the page (HTML, CSS and JS, no frameworks), installable as an app
docs/kit-json.md         format that makes a tool importable (Spanish)
docs/servicio-del-kit.md types, servicio.json, estado.json, switches (Spanish)
```

Node.js with no npm packages. The server only listens on `127.0.0.1:8790`.

The file and field names are in Spanish, because the project was written in Spanish.
The main ones: `servicio` (service), `estado` (status), `comprobar` (check), `acciones` (actions),
`arrancar` / `parar` / `abrir` (start / stop / open), `interruptores` (switches), `avisos` (notifications).

## Check cycle

- Every 30 seconds it checks the services on this PC: processes, ports, scheduled tasks, hook
  files and docker containers. Processes and tasks are read at once with a single PowerShell call.
- Every 5 minutes it checks remote services: an HTTP request and, over SSH, the container state and
  the `estado.json` left by `kit-estado`.
- Each row's status is the worst of what the check sees and what the tool says in its `estado.json`.
  From worst to best: error, stopped, warning, no data, running.
- If `estado.json` has not changed for more than `caducidad_minutos`, the row turns to warning.

## Phone notifications

Notifications always go out through the Kit, with a single ntfy token.

| Where the tool runs | How it notifies |
|---|---|
| On this PC | Writes its `estado.json` (the Kit notifies when it turns to error) or calls `POST /api/avisar` |
| On a server | `kit-estado` or `kit-avisar`, which notify even when the PC is off |

Each service has a mode, chosen in its detail: no notifications, outages only (default), or outages
and warnings. The Kit copies those modes to each server, to `~/kit/avisos.json`, so they apply there too.

Rules to avoid repeated notifications:

- An outage is notified after one minute. It is not repeated until the service comes back.
- If you stop a service from the panel, there is no outage notification.
- For remote services with `estado_remoto`, the server notifies, not the PC.
- Tools have a limit: one notification every 10 seconds and 20 per hour.

## Import

1. If it is a URL, clones it into `carpeta_herramientas` (or runs `git pull` if it was already there).
2. Reads and validates its `kit.json`.
3. Checks the requirements with `where.exe`.
4. Writes `servicios/<id>/servicio.json` with the variables unexpanded and an `origen` block.
5. If it has `estado_ruta`, writes there the path of its `estado.json`.
6. If ticked, runs its `instalar` command.

**Update** runs `git pull`, reads `kit.json` again and runs its `actualizar` command.
**Remove from the Kit** deletes the registration and the `estado_ruta` file. If asked, runs its
`desinstalar` command first. The tool's folder is never deleted.

## Per-PC files

Not part of the repository.

| File | What it keeps |
|---|---|
| `config.local.json` | Tools folder, ntfy, and whether this PC notifies about remote services |
| `servicios/` | One `servicio.json` and one `estado.json` per tool |
| `panel.json` | Name, color, order and notification mode of each row |
| `registro.log` | What the server did. Rotates at 1 MB |
| `%LOCALAPPDATA%\KitDani\ntfy-token` | ntfy token |
| `%LOCALAPPDATA%\KitDani\avisados.json` | Outages already notified, to notify when they come back |

## API

Only on `http://localhost:8790`.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/estado` | Status of every service |
| GET | `/api/registro?id=X` | Last 120 lines of service X's log |
| POST | `/api/accion` | `{ "id", "accion" }`: arrancar, parar, abrir, carpeta or an extra action |
| POST | `/api/interruptor` | `{ "id", "interruptor", "valor": true / false }` |
| POST | `/api/importar` | `{ "fuente": URL or folder, "instalar": true / false }` |
| POST | `/api/actualizar` | `{ "id" }` |
| POST | `/api/quitar` | `{ "id", "desinstalar": true / false }` |
| POST | `/api/panel` | `{ "orden": [ids] }` or `{ "id", "nombre", "color", "avisos" }` |
| POST | `/api/avisar` | `{ "id", "titulo", "texto", "prioridad", "tags" }` |
| POST | `/api/comprobar` | Runs a check now |
| POST | `/api/reiniciar` | Restarts the server |

## Direct links

- `http://localhost:8790/#detalle=<id>` opens the page with that service's detail expanded.
- `http://localhost:8790/#importar` opens the page with the import dialog.

## Uninstall

1. `desinstalar-arranque.ps1` removes the scheduled task and stops the server.
2. Delete the Kit folder and `%LOCALAPPDATA%\KitDani`.
3. If you installed it as an app, remove it from `chrome://apps`.

Imported tools stay installed. To remove them too, first use **Quitar del Kit** with its
uninstaller on each one.
