# Servicio del Kit

Un "servicio del Kit" es una herramienta propia que corre sola (en este PC o en un
servidor) y que se quiere ver en el panel de KitDani.

Hay dos formas de registrarlo:

- **Importarlo** (lo recomendado): la herramienta lleva un `kit.json` en su carpeta y se importa
  con el botón Importar. Vale en cualquier PC. Formato en [kit-json.md](kit-json.md).
- **A mano**: escribir `servicios/<id>/servicio.json` en la carpeta del Kit. Solo vale en ese PC.

## Tipos

El tipo dice cómo se comprueba que está vivo.

| tipo | Qué es | Cómo se comprueba |
|---|---|---|
| `demonio` | Proceso que debe estar siempre corriendo en este PC | El proceso existe, o el puerto responde |
| `tarea` | Se ejecuta cada cierto tiempo y termina (Programador de tareas) | Última ejecución, resultado y próxima en el Programador |
| `hook` | Código que vive dentro de otro programa (hooks de Claude Code, skin de Rainmeter, script de Tampermonkey) | Que los ficheros y las líneas de configuración sigan existiendo |
| `contenedor` | Stack de docker compose en este PC | `docker compose ps` |
| `remoto` | Corre en un servidor | Petición HTTP, o `estado.json` traído por SSH |

## Dónde se registra

Una carpeta por servicio, dentro de la carpeta del Kit:

```
servicios/<id>/
    servicio.json    fijo. Lo escribe el Kit al importar, o se escribe a mano.
    estado.json      vivo. Lo escribe la propia herramienta cada vez que hace algo.
```

`<id>` va en minúsculas, con guiones, sin acentos. Ejemplo: `raton-perdido`.

La carpeta `servicios/` es de cada PC y no va al repositorio del Kit.

Las rutas dentro de los JSON van con barras normales (`C:/ruta/...`). Windows las acepta y así no
hay que escapar nada. Se pueden usar las variables `{dir}`, `{kit}` y `%VAR%`, descritas en
[kit-json.md](kit-json.md).

## servicio.json

```json
{
  "id": "raton-perdido",
  "nombre": "Ratón perdido",
  "descripcion": "Una línea. Qué hace y para qué sirve.",
  "tipo": "demonio",
  "proyecto": "{dir}",
  "comprobar": { },
  "acciones": {
    "arrancar": "comando o null",
    "parar": "comando o null",
    "abrir": "URL o ruta que se abre al pulsar, o null"
  },
  "registro": "ruta del fichero de log, o null",
  "caducidad_minutos": 10,
  "ntfy": null
}
```

- `comprobar` depende del tipo. Claves admitidas:
  - `demonio`: `proceso_contiene` (texto que aparece en la línea de comando del proceso), `puerto` (número), `tarea_windows` (nombre de la tarea que lo relanza, si la hay).
  - `tarea`: `tarea_windows` (nombre exacto en el Programador de tareas).
  - `hook`: `ficheros` (lista de rutas que deben existir), `fichero_contiene` (objeto `{ "fichero": ruta, "texto": cadena }`), `proceso_contiene` (opcional: el programa que aloja el hook tiene que estar abierto; si no, sale como parado).
  - `contenedor`: `compose` (ruta del docker-compose.yml), `proyecto_compose` (nombre del proyecto, el `-p`).
  - `remoto`: `host` (alias de SSH), `url` (dirección que debe responder 200), `contenedor` (nombre del contenedor docker en el servidor), `estado_remoto` (ruta en el servidor del `estado.json`, por ejemplo `~/kit/estado/<id>.json`). Opcional `sesion_remota`: fichero cuya primera línea es una hora de caducidad en segundos Unix; el panel enseña si está abierta y cuánto le queda.
- `caducidad_minutos`: si `estado.json` lleva más minutos sin actualizarse, el panel lo pinta como "sin noticias". `null` si la herramienta no escribe `estado.json` de forma periódica.
- `avisos`: modo de avisos al móvil por defecto: `"no"`, `"caidas"` (si no se pone) o `"todo"`. Se cambia en el panel. Ver [kit-json.md](kit-json.md).
- `ntfy`: tema de ntfy al que avisa la propia herramienta por su cuenta, o `null`. Es informativo.

## estado.json

Lo escribe la herramienta, no el panel. Se escribe entero cada vez, de forma atómica
(escribir en un fichero temporal y renombrar). Cuatro campos fijos y uno libre:

```json
{
  "estado": "ok",
  "actualizado": "2026-10-10T00:14:18+02:00",
  "mensaje": "Publicado. 6,5 h hoy en 3 proyectos",
  "indicadores": [
    { "etiqueta": "Horas hoy", "valor": "6,5" },
    { "etiqueta": "Última publicación", "valor": "22:44" }
  ]
}
```

- `estado`: solo `ok`, `aviso`, `error` o `parado`.
- `actualizado`: fecha ISO 8601 con zona horaria.
- `mensaje`: una línea, lo que se enseña junto al estado.
- `indicadores`: lista libre de pares etiqueta/valor. Es lo que la herramienta considera importante enseñar. Máximo 6. Los valores son texto ya formateado.

Una herramienta importada sabe dónde escribirlo por su `estado_ruta` (ver [kit-json.md](kit-json.md)).
Un servicio `remoto` lo escribe en el servidor, en la ruta de `comprobar.estado_remoto`, y el Kit lo trae por SSH.

## Interruptores

Un interruptor es un ajuste de la herramienta que se quiere cambiar desde el panel con un
clic. Por ejemplo, pausar una herramienta o apagar sus notificaciones por la noche.
Se declara en la lista `interruptores`:

```json
"interruptores": [
  {
    "id": "avisos",
    "etiqueta": "Notificaciones de Windows",
    "fichero": "%USERPROFILE%/.claude/panel-sesiones/avisos.txt",
    "encendido": "1",
    "apagado": "0",
    "si_no_existe": true,
    "despues": "comando que se ejecuta tras cambiarlo, o null",
    "horario": { "apagar": "23:00", "encender": "08:00" }
  }
]
```

- El estado del interruptor es el contenido de `fichero`. El panel escribe `encendido` o `apagado` en él.
- `si_no_existe`: valor que se enseña si el fichero no existe (`true` = encendido).
- `despues`: comando opcional, para avisar al programa de que relea el fichero. Su código de
  salida se ignora. Rainmeter.exe, por ejemplo, devuelve 1 aunque el bang funcione.
- `horario`: opcional. El panel lo apaga y lo enciende solo al entrar en cada tramo. Un cambio a
  mano dura hasta el siguiente tramo.
- La herramienta tiene que leer ese fichero cada vez que vaya a actuar, no solo al arrancar.
  Si solo lo lee al arrancar, `despues` tiene que reiniciarla o refrescarla.

## Acciones extra y Parar automático

- `acciones.extra`: lista de botones propios. Cada uno con `id`, `etiqueta`, `comando` y,
  opcional, `si`: `"bloqueada"` o `"desbloqueada"` para enseñarlo solo según `sesion_remota`.
  Un comando que necesite que el usuario escriba algo abre su propia ventana de terminal con `start`.
- Un `demonio` sin `acciones.parar` (o con `null`) tiene botón Parar igualmente: el panel mata el proceso de
  `proceso_contiene` y el que escucha en `puerto`. Si tiene `tarea_windows`, además desactiva la tarea
  para que no lo relance, y "Arrancar" la vuelve a activar. Con `"parar": false` no hay botón Parar:
  para programas de escritorio con trabajo abierto, que no conviene cerrar de golpe.

## Cómo lo enseña y lo vigila el panel

- Comprueba los servicios locales cada 30 segundos y los remotos cada 5 minutos.
- El estado final de un servicio es el peor entre lo que dice la comprobación y lo que dice su
  `estado.json`. Orden de peor a mejor: `error`, `parado`, `aviso`, `desconocido`, `ok`.
- Los servicios de este PC van bajo la barra de arriba. Los `remoto` van en una sección con su
  propia barra por cada `comprobar.host`.
- Avisa por ntfy (servidor y tema en `config.local.json`) según el modo de avisos de cada servicio:
  caídas de más de un minuto y vueltas, y en modo `todo` también los avisos. No avisa si se paró
  desde el propio panel. Una herramienta puede mandar los suyos con `POST /api/avisar`.

## Si usas Claude Code para crear herramientas

Puedes copiar esta regla en tu `CLAUDE.md` global para que Claude prepare las herramientas para el Kit:

> Cuando te pida una herramienta "para el Kit": añade en su carpeta un `kit.json` según
> `<carpeta del Kit>/docs/kit-json.md`, con rutas `{dir}` y sin rutas absolutas; haz que escriba su
> `estado.json` en la ruta de su `estado_ruta`; y regístrala importándola con
> `POST http://localhost:8790/api/importar` y el cuerpo `{ "fuente": "<carpeta>", "instalar": false }`.
> Si montas algo que encaja y no te lo he pedido para el Kit, pregúntamelo antes.
