# KitDani

Un panel local para Windows donde ver y manejar tus propias herramientas que corren solas:
scripts que arrancan con el PC, tareas programadas, hooks, contenedores y servicios en un servidor.

*A local Windows dashboard to watch and control your own background tools. Tools become importable by adding a `kit.json` file. Node only, no dependencies. The docs are in Spanish.*

## Qué hace

- Una fila por herramienta: si está en marcha, su mensaje y los datos que ella misma quiera enseñar.
- Botones para arrancar, parar, abrir, ver su registro y abrir su carpeta.
- Interruptores para cambiar ajustes de una herramienta, con horario opcional.
- Los servicios de un servidor van en su propia sección, vigilados por HTTP y por SSH.
- Avisos al móvil por [ntfy](https://ntfy.sh) cuando algo se cae y cuando vuelve, elegibles por servicio.
  Las herramientas pueden mandar sus propios avisos a través del Kit, sin token propio.
- **Importar herramientas**: cualquier herramienta con un `kit.json` se añade pegando la URL de su
  repositorio o la ruta de su carpeta. El panel la clona, comprueba requisitos, la instala y la vigila.
- Nombre, color y orden de cada fila editables desde la página.
- Se instala como aplicación, con su propio icono en la barra de tareas.

## Requisitos

- Windows 10 u 11.
- [Node.js](https://nodejs.org) 22 o superior.
- [Git](https://git-scm.com), para importar herramientas desde una URL.

Sin paquetes de npm.

## Instalación

```powershell
git clone https://github.com/Dasge97/KitDani.git
cd KitDani
powershell -ExecutionPolicy Bypass -File .\instalar-arranque.ps1
```

`instalar-arranque.ps1` registra la tarea programada `KitDani`: arranca el panel al iniciar sesión y
lo relanza cada 5 minutos si se ha caído. Después abre http://localhost:8790/.

Para tenerlo con icono propio en la barra de tareas: en Chrome o Edge, botón de instalar a la derecha
de la barra de direcciones ("Instalar KitDani"). Con la ventana abierta, clic derecho en su icono de
la barra de tareas y "Anclar a la barra de tareas".

Para quitarlo: `desinstalar-arranque.ps1`.

## Importar una herramienta

Botón **Importar** en la barra de arriba. Acepta:

- La URL de un repositorio de git. Se clona en la carpeta `carpeta_herramientas` de la configuración.
- La ruta de una carpeta que ya tengas en el PC.

En los dos casos la carpeta tiene que tener un `kit.json`. Por ejemplo, para probar:

```
https://github.com/Dasge97/raton-perdido.git
```

En el detalle de cada herramienta importada (clic en su fila) están **Actualizar** (git pull y
vuelve a leer su `kit.json`) y **Quitar del Kit** (opcionalmente, ejecutando su desinstalador).

## Hacer que tu herramienta se pueda importar

Añade un `kit.json` en la raíz de su repositorio. El formato está en
[docs/kit-json.md](docs/kit-json.md). El mínimo son unas diez líneas: id, nombre, tipo,
cómo saber si está en marcha y cómo arrancarla.

## Configuración

`config.local.json` se crea solo la primera vez. Es de cada PC y no va al repositorio.

```json
{
  "carpeta_herramientas": "C:/Users/tu-usuario/herramientas",
  "ntfy": { "url": "https://ntfy.sh", "tema": "mi-tema-privado" },
  "avisar_remotos": true
}
```

- `carpeta_herramientas`: dónde se clonan las herramientas importadas por URL. Por defecto, la
  carpeta donde está el Kit.
- `ntfy`: servidor y tema para los avisos al móvil. Sin ellos no se avisa. Si tu servidor pide token,
  guárdalo en `%LOCALAPPDATA%\KitDani\ntfy-token` (un fichero de texto solo con el token).
- `avisar_remotos`: si tienes el Kit en varios PC, ponlo a `true` solo en uno. Así los avisos de los
  servicios del servidor no te llegan repetidos.

Tras cambiarla, pulsa **Reiniciar** en el panel.

## Personalizar la tabla

- Clic en una fila para desplegar su detalle. Arriba se cambia el nombre visible y el color.
- Para cambiar el orden, arrastra la fila desde el asa que aparece a la izquierda al pasar el ratón.
- Nombre, color y orden se guardan en `panel.json`. Si lo borras, todo vuelve a los nombres originales.

## Varios PC

El Kit es el mismo en todos. Lo de cada PC queda fuera del repositorio:

| Fichero | Qué guarda |
|---|---|
| `config.local.json` | Configuración de este PC |
| `servicios/` | Herramientas registradas en este PC |
| `panel.json` | Nombres, colores y orden de las filas |
| `%LOCALAPPDATA%\KitDani\` | Token de ntfy y avisos ya enviados |

En cada PC instalas el Kit e importas las herramientas que quieras tener en él.

## Seguridad

El panel solo escucha en `127.0.0.1`: no se puede abrir desde otro equipo. Sus botones ejecutan
comandos en tu PC, y un instalador importado es código de esa herramienta. Importa solo
herramientas en las que confíes.

## Ficheros

```
servidor/index.mjs       servidor HTTP, API y ciclos de comprobación
servidor/comprobar.mjs   comprobaciones por tipo (demonio, tarea, hook, contenedor, remoto)
servidor/importar.mjs    importar, actualizar y quitar herramientas con kit.json
servidor/extras.mjs      parar procesos, avisos por ntfy y horarios de interruptores
servidor/servicios.mjs   lectura de servicios, variables {dir} {kit} %VAR%, interruptores
servidor/config.mjs      configuración y config.local.json
web/                     la página (HTML, CSS y JS sin frameworks)
docs/kit-json.md         formato para que una herramienta se pueda importar
docs/servicio-del-kit.md tipos, servicio.json, estado.json, interruptores
```

## API

Solo en `http://localhost:8790`.

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/estado` | Estado de todos los servicios |
| GET | `/api/registro?id=X` | Últimas 120 líneas del log del servicio X |
| POST | `/api/accion` | `{ "id", "accion" }`: arrancar, parar, abrir, carpeta o una acción extra |
| POST | `/api/interruptor` | `{ "id", "interruptor", "valor": true / false }` |
| POST | `/api/importar` | `{ "fuente": URL o carpeta, "instalar": true / false }` |
| POST | `/api/actualizar` | `{ "id" }` |
| POST | `/api/quitar` | `{ "id", "desinstalar": true / false }` |
| POST | `/api/panel` | `{ "orden": [ids] }` o `{ "id", "nombre", "color", "avisos" }` |
| POST | `/api/avisar` | `{ "id", "titulo", "texto", "prioridad", "tags" }`: aviso al móvil en nombre de un servicio |
| POST | `/api/comprobar` | Fuerza una comprobación ahora |
| POST | `/api/reiniciar` | Reinicia el servidor |

## Licencia

MIT.
