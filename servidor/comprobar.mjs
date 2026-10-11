// Comprueba si cada servicio está vivo según su tipo. Devuelve, por id, un objeto:
//   { estado, detalles: [texto], indicadores: [{etiqueta, valor}] }
// estado es ok | aviso | error | parado | desconocido.
import net from 'node:net';
import fs from 'node:fs';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { anotar, horaCorta, normalizarRuta, lista } from './util.mjs';

const execFile = promisify(execFileCb);

// ---------- Datos de Windows en una sola llamada a PowerShell ----------

async function datosWindows(nombresTareas, necesitaProcesos) {
  const nombres = nombresTareas.map((n) => `'${String(n).replace(/'/g, "''")}'`).join(',');
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$procesos = @()
if (${necesitaProcesos ? '$true' : '$false'}) {
  # Algunas líneas de comando traen caracteres de control que ConvertTo-Json de PowerShell 5.1 no escapa.
  $procesos = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } |
    Select-Object ProcessId, @{ n = 'CommandLine'; e = { $_.CommandLine -replace '[\\x00-\\x1F]', ' ' } })
}
$tareas = @()
foreach ($n in @(${nombres || "''"})) {
  if (-not $n) { continue }
  $t = Get-ScheduledTask -TaskName $n
  if (-not $t) { continue }
  $i = $t | Get-ScheduledTaskInfo
  $prox = $null; if ($i.NextRunTime) { $prox = $i.NextRunTime.ToString('o') }
  $ult = $null; if ($i.LastRunTime -and $i.LastRunTime.Year -gt 2000) { $ult = $i.LastRunTime.ToString('o') }
  $tareas += [pscustomobject]@{ nombre = $n; estado = [string]$t.State; ultima = $ult; resultado = $i.LastTaskResult; proxima = $prox }
}
[pscustomobject]@{ procesos = $procesos; tareas = $tareas } | ConvertTo-Json -Depth 4 -Compress
`;
  const codificado = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', codificado],
    { timeout: 45_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
  );
  // Por si acaso: un carácter de control suelto rompería JSON.parse y dejaría todo el PC sin datos.
  // eslint-disable-next-line no-control-regex
  const datos = JSON.parse(stdout.replace(/[\u0000-\u001f]/g, ' '));
  return { procesos: lista(datos.procesos), tareas: lista(datos.tareas) };
}

function puertoAbierto(puerto, host = '127.0.0.1') {
  return new Promise((resolver) => {
    const s = net.createConnection({ port: puerto, host });
    const fin = (v) => { s.destroy(); resolver(v); };
    s.setTimeout(1500, () => fin(false));
    s.once('connect', () => fin(true));
    s.once('error', () => fin(false));
  });
}

// Resultado de una tarea de Windows: 0 ok, 267009 en ejecución, 267011 nunca ejecutada.
function tareaATexto(t) {
  const detalles = [];
  const indicadores = [];
  let estado = 'ok';
  if (t.ultima) indicadores.push({ etiqueta: 'Última ejecución', valor: horaCorta(t.ultima) });
  if (t.proxima) indicadores.push({ etiqueta: 'Próxima', valor: horaCorta(t.proxima) });
  if (t.estado === 'Disabled') { estado = 'parado'; detalles.push('Tarea desactivada en el Programador'); }
  else if (t.estado === 'Running') detalles.push('Ejecutándose ahora');
  else if (t.resultado === 267011) { estado = 'aviso'; detalles.push('Nunca se ha ejecutado'); }
  else if (t.resultado !== 0 && t.resultado !== 267009) {
    estado = 'error';
    detalles.push(`La última ejecución falló (código ${t.resultado})`);
  }
  return { estado, detalles, indicadores };
}

// ---------- Por tipo ----------

function comprobarDemonio(s, datos, puertoVivo) {
  const c = s.comprobar;
  const detalles = [];
  let vivo = null;
  if (c.proceso_contiene) {
    const patron = normalizarRuta(c.proceso_contiene);
    const procesos = datos.procesos.filter((p) => normalizarRuta(p.CommandLine).includes(patron));
    vivo = procesos.length > 0;
    if (vivo) detalles.push(`Proceso ${procesos.map((p) => p.ProcessId).join(', ')}`);
  }
  if (c.puerto) {
    if (puertoVivo) { vivo = true; detalles.push(`Responde en el puerto ${c.puerto}`); }
    else if (vivo === null) vivo = false;
    else if (vivo) detalles.push(`El proceso existe pero el puerto ${c.puerto} no responde`);
  }
  if (vivo === null) return { estado: 'desconocido', detalles: ['Sin forma de comprobarlo: falta proceso_contiene o puerto'], indicadores: [] };
  if (!vivo) {
    detalles.push('No está en marcha');
    if (c.tarea_windows) detalles.push(`La tarea "${c.tarea_windows}" lo relanza al iniciar sesión`);
    return { estado: 'parado', detalles, indicadores: [] };
  }
  if (c.puerto && !puertoVivo) return { estado: 'aviso', detalles, indicadores: [] };
  return { estado: 'ok', detalles, indicadores: [] };
}

function comprobarTarea(s, datos) {
  const nombre = s.comprobar.tarea_windows;
  if (!nombre) return { estado: 'desconocido', detalles: ['Falta tarea_windows en comprobar'], indicadores: [] };
  const t = datos.tareas.find((x) => x.nombre === nombre);
  if (!t) return { estado: 'error', detalles: [`No existe la tarea "${nombre}" en el Programador`], indicadores: [] };
  return tareaATexto(t);
}

function comprobarHook(s, datos) {
  const c = s.comprobar;
  const detalles = [];
  let estado = 'ok';
  // proceso_contiene (opcional): el programa que aloja el hook tiene que estar abierto (p. ej. Rainmeter).
  if (c.proceso_contiene) {
    const patron = normalizarRuta(c.proceso_contiene);
    if (!datos.procesos.some((p) => normalizarRuta(p.CommandLine).includes(patron))) {
      estado = 'parado';
      detalles.push(`${c.proceso_contiene} no está abierto`);
    }
  }
  for (const f of lista(c.ficheros)) {
    if (!fs.existsSync(f)) { estado = 'error'; detalles.push(`Falta ${f}`); }
  }
  if (c.fichero_contiene) {
    const { fichero, texto } = c.fichero_contiene;
    try {
      if (!fs.readFileSync(fichero, 'utf8').includes(texto)) { estado = 'error'; detalles.push(`${fichero} ya no contiene "${texto}"`); }
    } catch {
      estado = 'error'; detalles.push(`No se puede leer ${fichero}`);
    }
  }
  if (estado === 'ok') detalles.push(c.proceso_contiene ? 'Instalado y en marcha' : 'Instalado');
  return { estado, detalles, indicadores: [] };
}

async function comprobarContenedor(s) {
  const c = s.comprobar;
  if (!c.compose) return { estado: 'desconocido', detalles: ['Falta compose en comprobar'], indicadores: [] };
  const args = ['compose', '-f', c.compose];
  if (c.proyecto_compose) args.push('-p', c.proyecto_compose);
  args.push('ps', '--all', '--format', 'json');
  try {
    const { stdout } = await execFile('docker', args, { timeout: 20_000, windowsHide: true });
    const texto = stdout.trim();
    let filas = [];
    if (texto.startsWith('[')) filas = JSON.parse(texto);
    else if (texto) filas = texto.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
    if (!filas.length) return { estado: 'parado', detalles: ['Sin contenedores levantados'], indicadores: [] };
    const corriendo = filas.filter((f) => f.State === 'running');
    const detalles = filas.map((f) => `${f.Service || f.Name}: ${f.State}${f.Health ? ` (${f.Health})` : ''}`);
    const indicadores = [{ etiqueta: 'Contenedores', valor: `${corriendo.length}/${filas.length}` }];
    if (corriendo.length === filas.length) return { estado: 'ok', detalles, indicadores };
    if (corriendo.length === 0) return { estado: 'parado', detalles, indicadores };
    return { estado: 'aviso', detalles, indicadores };
  } catch (e) {
    return { estado: 'error', detalles: [`docker no responde: ${(e.stderr || e.message || '').toString().trim().split('\n')[0]}`], indicadores: [] };
  }
}

async function comprobarRemoto(s) {
  const c = s.comprobar;
  const detalles = [];
  const indicadores = [];
  let estado = 'desconocido';
  let estadoRemoto = null;

  if (c.url) {
    try {
      const r = await fetch(c.url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8000) });
      if (r.ok) { estado = 'ok'; detalles.push(`${c.url} responde ${r.status}`); }
      else { estado = 'error'; detalles.push(`${c.url} responde ${r.status}`); }
    } catch (e) {
      estado = 'error';
      detalles.push(`${c.url} no responde (${e.name === 'TimeoutError' ? 'tiempo agotado' : e.cause?.code || e.message})`);
    }
  }

  let sesionCaduca = null;
  if (c.host && (c.contenedor || c.estado_remoto || c.sesion_remota)) {
    const partes = [];
    if (c.contenedor) partes.push(`docker inspect -f '{{.State.Status}}' '${c.contenedor}' 2>/dev/null || echo sin-contenedor`);
    else partes.push('echo -');
    partes.push("echo '---KIT---'");
    if (c.estado_remoto) partes.push(`cat '${c.estado_remoto}' 2>/dev/null`);
    // sesion_remota: fichero cuya primera línea es la hora de caducidad (segundos Unix), como la sesión
    // de la bóveda en /dev/shm. Solo se lee esa línea; el resto del fichero (la clave) no sale del servidor.
    partes.push("echo '---SESION---'");
    if (c.sesion_remota) partes.push(`head -n 1 '${c.sesion_remota}' 2>/dev/null || true`);
    try {
      const { stdout } = await execFile(
        'ssh',
        ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', c.host, partes.join('; ')],
        { timeout: 25_000, windowsHide: true },
      );
      const [cab, resto = ''] = stdout.split('---KIT---');
      const [cuerpo, sesion = ''] = resto.split('---SESION---');
      if (c.sesion_remota) {
        const n = Number(sesion.trim());
        sesionCaduca = Number.isFinite(n) && n > 0 ? n * 1000 : 0;
      }
      const estadoContenedor = cab.trim();
      if (c.contenedor) {
        if (estadoContenedor === 'running') { detalles.push(`Contenedor ${c.contenedor} en marcha`); if (estado === 'desconocido') estado = 'ok'; }
        else if (estadoContenedor === 'sin-contenedor') { detalles.push(`No existe el contenedor ${c.contenedor}`); estado = 'error'; }
        else { detalles.push(`Contenedor ${c.contenedor}: ${estadoContenedor || 'estado desconocido'}`); estado = estado === 'ok' ? 'aviso' : 'parado'; }
      }
      if (c.estado_remoto && cuerpo.trim()) {
        try { estadoRemoto = JSON.parse(cuerpo); } catch { detalles.push('estado.json remoto no es JSON válido'); }
      }
      // Sin URL ni contenedor, el estado lo decide solo su estado.json: la conexión ha ido bien, así que
      // la comprobación no añade nada malo. Si el fichero aún no existe, se dice.
      if (c.estado_remoto && !c.url && !c.contenedor) {
        if (estadoRemoto) estado = 'ok';
        else if (!cuerpo.trim()) detalles.push('Todavía no ha informado de su estado');
      }
    } catch (e) {
      detalles.push(`Sin conexión SSH con ${c.host}`);
      if (estado === 'desconocido') estado = 'aviso';
    }
  }

  if (!c.url && !c.host) detalles.push('Sin forma de comprobarlo: falta url o host');
  return { estado, detalles, indicadores, estadoRemoto, sesionCaduca };
}

// ---------- Entrada ----------

export async function comprobarLocales(servicios) {
  const resultados = new Map();
  const locales = servicios.filter((s) => s.tipo !== 'remoto');
  const tareas = [];
  let necesitaProcesos = false;
  for (const s of locales) {
    if (s.tipo === 'tarea' && s.comprobar.tarea_windows) tareas.push(s.comprobar.tarea_windows);
    if ((s.tipo === 'demonio' || s.tipo === 'hook') && s.comprobar.proceso_contiene) necesitaProcesos = true;
  }
  let datos = { procesos: [], tareas: [] };
  if (tareas.length || necesitaProcesos) {
    try {
      datos = await datosWindows(tareas, necesitaProcesos);
    } catch (e) {
      anotar(`PowerShell falló al leer procesos y tareas: ${e.message.split('\n')[0]}`);
      for (const s of locales) if (s.tipo === 'tarea' || s.tipo === 'demonio') {
        resultados.set(s.id, { estado: 'desconocido', detalles: ['No se pudo consultar Windows'], indicadores: [] });
      }
    }
  }
  await Promise.all(locales.map(async (s) => {
    if (resultados.has(s.id)) return;
    try {
      if (s.tipo === 'demonio') {
        const puertoVivo = s.comprobar.puerto ? await puertoAbierto(s.comprobar.puerto) : false;
        resultados.set(s.id, comprobarDemonio(s, datos, puertoVivo));
      } else if (s.tipo === 'tarea') resultados.set(s.id, comprobarTarea(s, datos));
      else if (s.tipo === 'hook') resultados.set(s.id, comprobarHook(s, datos));
      else if (s.tipo === 'contenedor') resultados.set(s.id, await comprobarContenedor(s));
    } catch (e) {
      resultados.set(s.id, { estado: 'desconocido', detalles: [`Error al comprobar: ${e.message}`], indicadores: [] });
    }
  }));
  return resultados;
}

export async function comprobarRemotos(servicios) {
  const resultados = new Map();
  await Promise.all(servicios.filter((s) => s.tipo === 'remoto').map(async (s) => {
    try {
      resultados.set(s.id, await comprobarRemoto(s));
    } catch (e) {
      resultados.set(s.id, { estado: 'desconocido', detalles: [`Error al comprobar: ${e.message}`], indicadores: [] });
    }
  }));
  return resultados;
}
