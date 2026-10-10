# kit.json: cómo hacer que una herramienta se pueda importar en KitDani

Cualquier herramienta que tenga un fichero `kit.json` en la raíz de su carpeta (o de su
repositorio de git) se puede importar en KitDani con el botón **Importar**. El panel la clona si
hace falta, comprueba sus requisitos, ejecuta su instalador y la empieza a vigilar.

## Ejemplo mínimo

Un programa en Python que corre siempre en segundo plano:

```json
{
  "kit": 1,
  "id": "mi-herramienta",
  "nombre": "Mi herramienta",
  "descripcion": "Qué hace, en una línea.",
  "tipo": "demonio",
  "proyecto": "{dir}",
  "comprobar": { "proceso_contiene": "mi_herramienta.pyw" },
  "acciones": { "arrancar": "pythonw \"{dir}/mi_herramienta.pyw\"" }
}
```

Con eso el panel ya sabe si está en marcha, puede arrancarla y pararla, y abrir su carpeta.

## Ejemplo completo

Es el `kit.json` de [Ratón perdido](https://github.com/Dasge97/raton-perdido):

```json
{
  "kit": 1,
  "paquete": "raton-perdido",
  "requisitos": [
    { "comando": "pythonw", "texto": "Python 3.10 o superior, con pythonw en el PATH" }
  ],
  "instalar": "powershell -NoProfile -ExecutionPolicy Bypass -File \"{dir}/instalar-inicio.ps1\"",
  "desinstalar": "powershell -NoProfile -ExecutionPolicy Bypass -File \"{dir}/desinstalar-inicio.ps1\"",

  "id": "raton-perdido",
  "nombre": "Ratón perdido",
  "descripcion": "Agita el ratón de lado a lado y el cursor se hace grande un momento.",
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
    { "id": "activo", "etiqueta": "Detectar agitado", "fichero": "{dir}/activo.txt",
      "encendido": "1", "apagado": "0", "si_no_existe": true }
  ]
}
```

## Variables

Se pueden usar en cualquier texto. Así el mismo `kit.json` vale en cualquier PC y para cualquier usuario.

| Variable | Qué vale |
|---|---|
| `{dir}` | Carpeta de la herramienta, con barras `/` |
| `{kit}` | Carpeta de KitDani |
| `%VAR%` | Variable de entorno de Windows, por ejemplo `%USERPROFILE%` o `%LOCALAPPDATA%` |

No escribas rutas absolutas como `C:/Users/fulano/...`. En otro PC no existen.

## Campos del paquete

Van en la raíz de `kit.json` y se aplican a la herramienta entera.

| Campo | Obligatorio | Qué es |
|---|---|---|
| `kit` | sí | Versión del formato. Ahora `1`. |
| `paquete` | no | Nombre del paquete. Por defecto, el nombre de la carpeta. |
| `requisitos` | no | Lista de `{ "comando", "texto" }`. Si `comando` no está en el PATH, no se importa y se enseña `texto`. |
| `instalar` | no | Comando que se ejecuta al importar, si el usuario lo marca. Lo normal: registrar el arranque con Windows y arrancarla. |
| `desinstalar` | no | Comando que se ejecuta al quitarla del Kit, si el usuario lo pide. Lo normal: quitar el arranque con Windows y pararla. |
| `actualizar` | no | Comando que se ejecuta después de `git pull` al pulsar **Actualizar**. Por ejemplo, reiniciarla. |

## Campos de cada servicio

Una herramienta con un solo servicio pone estos campos en la raíz, junto a los del paquete.
Un paquete con varios servicios los pone en una lista: `"servicios": [ { ... }, { ... } ]`.

Son los mismos campos de `servicio.json`, descritos en [servicio-del-kit.md](servicio-del-kit.md):
`id`, `nombre`, `descripcion`, `tipo`, `proyecto`, `comprobar`, `acciones`, `registro`,
`caducidad_minutos`, `interruptores`, `ntfy`. Más uno propio de `kit.json`:

| Campo | Qué es |
|---|---|
| `estado_ruta` | Fichero de la herramienta donde el Kit escribe, al importarla, la ruta donde ella debe dejar su `estado.json`. Así la herramienta no necesita saber dónde está instalado el Kit. Al quitarla del Kit, ese fichero se borra y la herramienta deja de informar. |

Reglas del `id`: minúsculas, números y guiones. `kitdani` está reservado.

## Informar de su estado (opcional, recomendado)

Sin escribir nada, el panel ya sabe si la herramienta está en marcha. Si además quieres que enseñe
datos propios (cuántas veces se ha usado hoy, última ejecución, errores), la herramienta escribe un
`estado.json` en la ruta que lee de su `estado_ruta`:

```json
{
  "estado": "ok",
  "actualizado": "2026-10-10T00:14:18+02:00",
  "mensaje": "Una línea con lo que está pasando",
  "indicadores": [ { "etiqueta": "Veces hoy", "valor": "7" } ]
}
```

`estado` es `ok`, `aviso`, `error` o `parado`. Escríbelo de forma atómica: a un fichero temporal y
después renombrar. Si no existe el fichero de `estado_ruta`, la herramienta no escribe nada.

## Comprobar que un kit.json es válido

Importa la carpeta local en el panel con "Ejecutar su instalador" desmarcado. Si algo falla, el
diálogo dice qué campo está mal. Para quitarla después, **Quitar del Kit** en su detalle.
