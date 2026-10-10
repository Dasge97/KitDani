<div align="center">

<img src="web/iconos/icono-192.png" alt="KitDani icon: a green toolbox with the word DANI" width="96">

# KitDani

A Windows dashboard that watches your own tools: what starts with your PC,<br>
scheduled tasks, hooks and what runs on your server. All in one table, with phone notifications.

**English** · [Español](README.es.md)

[![Version](https://img.shields.io/github/package-json/v/Dasge97/KitDani?label=version&color=2ea44f)](https://github.com/Dasge97/KitDani/commits/main)
[![Windows 10 | 11](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4)](#installation)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![No dependencies](https://img.shields.io/badge/npm-no%20dependencies-brightgreen)](package.json)
[![ntfy](https://img.shields.io/badge/notifications-ntfy-317F6F)](https://ntfy.sh)
[![MIT License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/Dasge97/KitDani?label=last%20commit)](https://github.com/Dasge97/KitDani/commits/main)

<img src="docs/img/portada.png" alt="KitDani panel in dark mode. At the top, this PC's bar with the summary and the Import, Check and Restart buttons. Below, the table of tools on the PC, each with its status dot, message, indicators and buttons. Further down, the Codehive bar with its own table of server services." width="100%">

[![Install](https://img.shields.io/badge/Install-2ea44f?style=for-the-badge)](#installation)
&nbsp;
[![Make your tool importable](https://img.shields.io/badge/Make%20your%20tool%20importable-0969da?style=for-the-badge)](docs/kit-json.en.md)
&nbsp;
[![How it works](https://img.shields.io/badge/How%20it%20works-555?style=for-the-badge)](docs/how-it-works.md)

</div>

> The interface and the docs were written in Spanish first. The panel's buttons are in Spanish:
> **Importar** (import), **Comprobar** (check), **Reiniciar** (restart), **Arrancar** (start),
> **Parar** (stop), **Abrir** (open), **Registro** (log), **Carpeta** (folder).

## What it is for

Once you start building your own tools (a bot that starts with your PC, a script that publishes
something every two hours, a service on your server), you lose track of which ones are running,
which ones failed last night and where each one lives. KitDani puts them on one page, lets you
control them from there, and notifies your phone when something goes down.

## What it does

- **One row per tool**, with its status, what it is doing and whatever data the tool wants to show.
- **Buttons** to start, stop, open, read its log and open its folder.
- **Switches** to change a tool's setting, with an optional schedule. For example, mute some
  notifications from 23:00 to 08:00.
- **A section per server**, checked over HTTP and SSH. It includes the websites watched by
  [Uptime Kuma](https://github.com/louislam/uptime-kuma), if you use it.
- **Phone notifications** through [ntfy](https://ntfy.sh) when something goes down and when it comes
  back. Per tool, you choose everything, outages only, or nothing.
- **One notification channel.** Your tools notify through the Kit, without a token each.
  On the server, with `kit-estado` and `kit-avisar`, which work even when the PC is off.
- **Import tools.** Any tool with a `kit.json` is added by pasting its repository URL. The Kit clones
  it, checks requirements, installs it and watches it.
- **Your table.** Change each row's name, color and order from the page.
- **Its own app**, with its own icon in the taskbar, separate from your browser.

<div align="center">
<table>
<tr>
<td align="center"><img src="docs/img/detalle.png" alt="A tool's detail expanded: editable name, colors, phone notification mode, Test, Update and Remove buttons, description and what the last check saw." width="440"><br><sub>A tool's detail</sub></td>
<td align="center"><img src="docs/img/importar.png" alt="Import tool dialog, with a field for the git URL or local folder and a checkbox to run its installer." width="440"><br><sub>Import from a git URL</sub></td>
</tr>
</table>
</div>

## Colors

| | Status | When |
|:-:|---|---|
| 🟢 | Running | Both the check and the tool itself say it is fine |
| 🟡 | Warning | Something odd that is not a failure: no news for a while, or a website down on the server |
| 🔴 | Error | The tool reported a failure, or its scheduled task failed |
| ⚫ | Stopped | Not running |
| ⚪ | No data | Not checked yet |

## Installation

Requires [Node.js](https://nodejs.org) 22 or later, and [Git](https://git-scm.com) to import from a URL.

```powershell
git clone https://github.com/Dasge97/KitDani.git
cd KitDani
powershell -ExecutionPolicy Bypass -File .\instalar-arranque.ps1
```

The installer registers the `KitDani` scheduled task, which starts the panel when you log in and
restarts it if it stops. When done, it opens http://localhost:8790/.

**Taskbar icon.** In Chrome or Edge, press the install button on the right of the address bar
("Instalar KitDani"). With the window open, right-click its taskbar icon → *Pin to taskbar*.

**Update:** `git pull` in the Kit folder and press **Reiniciar** in the panel.

## Usage

**Import a tool.** Press **Importar** and paste its repository URL, or the path of a folder on your
PC. To try it: `https://github.com/Dasge97/raton-perdido.git`.

**See and change a tool.** Click its row. The detail lets you change its name, color and notification
mode, send a test notification, and has **Actualizar** (update) and **Quitar del Kit** (remove).

**Reorder.** Drag the row by the ⋮⋮ handle that shows on its left when you hover.

**Make your tool importable.** Add a `kit.json` at the root of its repository. The minimum is ten
lines. Format and examples in [docs/kit-json.en.md](docs/kit-json.en.md).

## Configuration

`config.local.json` is created on first run. It belongs to each PC and is not part of the repository.

```json
{
  "carpeta_herramientas": "C:/Users/you/tools",
  "ntfy": { "url": "https://ntfy.sh", "tema": "my-private-topic" },
  "avisar_remotos": true
}
```

| Key | Purpose |
|---|---|
| `carpeta_herramientas` | Where tools imported by URL are cloned. Defaults to the folder that holds the Kit |
| `ntfy` | Server and topic for notifications. Without them, nothing is sent. If your server needs a token, save it in `%LOCALAPPDATA%\KitDani\ntfy-token` |
| `avisar_remotos` | If you run the Kit on several PCs, set it to `true` on one only, so server notifications do not arrive twice |

After changing it, press **Reiniciar**.

## On your server

What runs on a Linux server also reports to the Kit and notifies your phone, even when the PC is off.
The [`remoto/`](remoto) folder installs three commands:

| Command | Purpose |
|---|---|
| `kit-estado <id> <ok/aviso/error/parado> "<message>"` | At the end of a script: leaves its status for the panel and notifies on failure and recovery |
| `kit-avisar <id> "<title>" "<text>"` | A one-off notification |
| `kit-kuma` | Reads Uptime Kuma and notifies when a website goes down or comes back. For cron |

Requires Python 3 on the server. Installation:

```bash
scp remoto/kit.py remoto/instalar.sh server:/tmp/
ssh server 'bash /tmp/instalar.sh https://ntfy.example.com my-topic'
ssh server 'umask 077; cat > ~/.config/kit/ntfy-token' < file-with-the-token
```

In the panel, each server script is registered as a `remoto` service with `comprobar.host` and
`comprobar.estado_remoto` pointing to `~/kit/estado/<id>.json` (absolute path).
More in [How it works](docs/how-it-works.md#phone-notifications).

## FAQ

<details>
<summary><b>Can I open it from another computer or my phone?</b></summary>

No. It only listens on `127.0.0.1`, because its buttons run commands on your PC.
Only the notifications reach your phone.
</details>

<details>
<summary><b>Is it safe to import a tool?</b></summary>

A tool's installer is that tool's code, and it runs on your PC.
Only import tools you trust, or untick "Ejecutar su instalador" and review it first.
</details>

<details>
<summary><b>What if I turn the PC off?</b></summary>

The panel stops checking, but what runs on the server keeps notifying on its own with `kit-estado`.
When you turn the PC on, the server section shows what happened meanwhile.
</details>

<details>
<summary><b>Can I have it on several PCs?</b></summary>

Yes. The Kit is the same everywhere, and each PC's data stays out of the repository. Install it on
each PC and import the tools you want there.
</details>

<details>
<summary><b>How do I uninstall it?</b></summary>

See [How it works → Uninstall](docs/how-it-works.md#uninstall).
</details>

## License

[MIT](LICENSE).

---

<div align="center">

[Make your tool importable](docs/kit-json.en.md) · [How it works](docs/how-it-works.md) · [Español](README.es.md)

</div>
