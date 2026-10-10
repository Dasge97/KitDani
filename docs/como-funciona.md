# Cómo funciona

[English](how-it-works.md) · **Español**

## Piezas

```
servidor/index.mjs       servidor HTTP, API y ciclos de comprobación
servidor/comprobar.mjs   comprobaciones por tipo (demonio, tarea, hook, contenedor, remoto)
servidor/importar.mjs    importar, actualizar y quitar herramientas con kit.json
servidor/extras.mjs      parar procesos, avisos por ntfy y horarios de interruptores
servidor/servicios.mjs   lectura de servicios, variables {dir} {kit} %VAR%, interruptores
servidor/config.mjs      configuración y config.local.json
remoto/                  kit-estado, kit-avisar y kit-kuma para un servidor Linux
web/                     la página (HTML, CSS y JS sin frameworks), instalable como aplicación
docs/kit-json.md         formato para que una herramienta se pueda importar
docs/servicio-del-kit.md tipos, servicio.json, estado.json, interruptores
```

Node.js sin paquetes de npm. El servidor escucha solo en `127.0.0.1:8790`.

## Ciclo de comprobación

- Cada 30 segundos comprueba los servicios de este PC: procesos, puertos, tareas programadas,
  ficheros de los hooks y contenedores de docker. Los procesos y las tareas se leen de una vez con
  una sola llamada a PowerShell.
- Cada 5 minutos comprueba los servicios remotos: una petición HTTP y, por SSH, el estado del
  contenedor y el `estado.json` que haya dejado `kit-estado`.
- El estado de cada fila es el peor entre lo que ve la comprobación y lo que dice la herramienta en
  su `estado.json`. Orden de peor a mejor: error, parado, aviso, sin datos, en marcha.
- Si `estado.json` lleva más de `caducidad_minutos` sin cambiar, la fila pasa a aviso.

## Avisos al móvil

Los avisos salen siempre por el Kit, con un solo token de ntfy.

| Dónde corre la herramienta | Cómo avisa |
|---|---|
| En este PC | Escribe su `estado.json` (el Kit avisa si pasa a error) o llama a `POST /api/avisar` |
| En un servidor | `kit-estado` o `kit-avisar`, que avisan aunque el PC esté apagado |

Cada servicio tiene un modo, que se elige en su detalle: no avisar, solo caídas (por defecto) o
caídas y avisos. El Kit copia esos modos a cada servidor, a `~/kit/avisos.json`, para que allí se
respeten igual.

Reglas para no repetir avisos:

- Una caída se avisa cuando lleva un minuto. Una vez avisada, no se repite hasta que vuelve.
- Si paras un servicio desde el panel, no se avisa de que está parado.
- De los servicios remotos con `estado_remoto` avisa el servidor, no el PC.
- Las herramientas tienen un límite: un aviso cada 10 segundos y 20 por hora.

## Importar

1. Si es una URL, la clona en `carpeta_herramientas` (o hace `git pull` si ya estaba).
2. Lee y valida su `kit.json`.
3. Comprueba los requisitos con `where.exe`.
4. Escribe `servicios/<id>/servicio.json` con las variables sin sustituir y un bloque `origen`.
5. Si tiene `estado_ruta`, escribe ahí la ruta de su `estado.json`.
6. Si se marcó, ejecuta su `instalar`.

**Actualizar** hace `git pull`, vuelve a leer `kit.json` y ejecuta su `actualizar`.
**Quitar del Kit** borra el registro y el fichero de `estado_ruta`. Si se pide, ejecuta antes su
`desinstalar`. La carpeta de la herramienta no se borra nunca.

## Ficheros de cada PC

No van al repositorio.

| Fichero | Qué guarda |
|---|---|
| `config.local.json` | Carpeta de herramientas, ntfy y si este PC avisa de los remotos |
| `servicios/` | Un `servicio.json` y un `estado.json` por herramienta |
| `panel.json` | Nombre, color, orden y modo de avisos de cada fila |
| `registro.log` | Qué ha hecho el servidor. Rota al pasar de 1 MB |
| `%LOCALAPPDATA%\KitDani\ntfy-token` | Token de ntfy |
| `%LOCALAPPDATA%\KitDani\avisados.json` | Caídas ya avisadas, para avisar cuando vuelven |

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
| POST | `/api/avisar` | `{ "id", "titulo", "texto", "prioridad", "tags" }` |
| POST | `/api/comprobar` | Fuerza una comprobación ahora |
| POST | `/api/reiniciar` | Reinicia el servidor |

## Enlaces directos

- `http://localhost:8790/#detalle=<id>` abre la página con el detalle de ese servicio desplegado.
- `http://localhost:8790/#importar` abre la página con el diálogo de importar.

## Desinstalar

1. `desinstalar-arranque.ps1` quita la tarea programada y para el servidor.
2. Borra la carpeta del Kit y `%LOCALAPPDATA%\KitDani`.
3. Si lo instalaste como aplicación, quítala desde `chrome://apps`.

Las herramientas importadas siguen instaladas. Para quitarlas también, usa antes **Quitar del Kit**
con su desinstalador en cada una.
