// Funciones del servidor que no son comprobar: parar procesos, avisos por ntfy y horarios de interruptores.
import fs from 'node:fs';
import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { anotar, leerJson, escribirJsonAtomico, normalizarRuta } from './util.mjs';
import { CONFIG, PUERTO } from './config.mjs';
import { leerInterruptor, escribirInterruptor } from './servicios.mjs';

const execFile = promisify(execFileCb);

// Datos locales del Kit que no van al repositorio: token de ntfy y avisos ya enviados.
export const DIR_LOCAL = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '.', 'AppData', 'Local'), 'KitDani');

// ---------- Parar un demonio ----------

// Mata los procesos cuya línea de comando contiene proceso_contiene y el que escucha en puerto.
export async function pararProcesos(patron, puerto) {
  const p = normalizarRuta(patron || '').replace(/'/g, "''");
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$ids = @()
$patron = '${p}'
if ($patron) {
  $ids += Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Replace('/', '\\').ToLower().Contains($patron) } | ForEach-Object { $_.ProcessId }
}
${puerto ? `$ids += Get-NetTCPConnection -State Listen -LocalPort ${Number(puerto)} | ForEach-Object { $_.OwningProcess }` : ''}
$ids = @($ids | Where-Object { $_ -and $_ -ne $PID -and $_ -ne ${process.pid} -and $_ -gt 4 } | Sort-Object -Unique)
foreach ($i in $ids) { Stop-Process -Id $i -Force }
if ($ids.Count) { "Detenidos: " + ($ids -join ', ') } else { "No había ningún proceso que parar" }
`;
  const { stdout } = await execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { timeout: 30_000, windowsHide: true },
  );
  return stdout.trim();
}

// ---------- Avisos por ntfy ----------

const FICHERO_TOKEN = path.join(DIR_LOCAL, 'ntfy-token');
const FICHERO_AVISADOS = path.join(DIR_LOCAL, 'avisados.json');
// Servidor y tema de ntfy: config.local.json ("ntfy": { "url", "tema" }). Sin ellos no se avisa.
const NTFY_URL = (CONFIG.ntfy?.url || '').replace(/\/+$/, '');
const NTFY_TEMA = CONFIG.ntfy?.tema || '';
const MALOS = new Set(['error', 'parado']);
const MARGEN_MS = 60_000;   // un servicio tiene que llevar un minuto mal antes de avisar

let tokenCache;
function token() {
  if (tokenCache === undefined) {
    try { tokenCache = fs.readFileSync(FICHERO_TOKEN, 'utf8').trim() || null; } catch { tokenCache = null; }
  }
  return tokenCache;
}

export async function enviarNtfy(titulo, texto, { prioridad = 3, tags = '' } = {}) {
  if (!NTFY_URL || !NTFY_TEMA) return false;
  const t = token();
  if (!t) { anotar(`ntfy sin token (${FICHERO_TOKEN}); no se envía: ${titulo}`); return false; }
  try {
    const r = await fetch(`${NTFY_URL}/${NTFY_TEMA}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${t}`,
        // ntfy lee las cabeceras como latin-1; los acentos van mejor codificados en RFC 2047.
        Title: `=?UTF-8?B?${Buffer.from(titulo, 'utf8').toString('base64')}?=`,
        Priority: String(prioridad),
        Tags: tags,
        Click: `http://localhost:${PUERTO}/`,
      },
      body: texto,
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) { anotar(`ntfy respondió ${r.status} al enviar: ${titulo}`); return false; }
    anotar(`aviso ntfy enviado: ${titulo}`);
    return true;
  } catch (e) {
    anotar(`ntfy falló: ${e.message}`);
    return false;
  }
}

// avisados: { id: 'caido' | 'manual' }. Se guarda en disco para no repetir avisos tras un reinicio.
const avisados = leerJson(FICHERO_AVISADOS) || {};
const malDesde = new Map();

function guardarAvisados() {
  try { escribirJsonAtomico(FICHERO_AVISADOS, avisados); } catch {}
}

// Cuando alguien para un servicio desde el panel, no se avisa de que está caído.
export function marcarParadoAMano(id) {
  avisados[id] = 'manual';
  guardarAvisados();
}

// Modos de aviso por servicio (se eligen en el panel; por defecto, el "avisos" de su servicio.json o "caidas"):
//   no      nunca avisa, ni de caídas ni de lo que mande la herramienta
//   caidas  avisa cuando lleva un minuto en error o parado, y cuando vuelve
//   todo    además avisa cuando pasa a "aviso" (p. ej. la bóveda bloqueada)
// En los tres casos menos "no", la herramienta puede mandar sus propios avisos con POST /api/avisar.
export const MODOS_AVISO = ['no', 'caidas', 'todo'];

// Recibe la lista que devuelve estadoDeServicio y avisa de caídas y recuperaciones.
export async function revisarAvisos(lista) {
  const ahora = Date.now();
  for (const s of lista) {
    if (s.estado === 'desconocido') continue;
    if (s.avisos === 'no') {
      malDesde.delete(s.id);
      if (avisados[s.id]) { delete avisados[s.id]; guardarAvisados(); }
      continue;
    }
    const malo = MALOS.has(s.estado) || (s.avisos === 'todo' && s.estado === 'aviso');
    if (malo) {
      if (!malDesde.has(s.id)) malDesde.set(s.id, ahora);
      if (!avisados[s.id] && ahora - malDesde.get(s.id) >= MARGEN_MS) {
        const motivo = s.mensaje || s.detalles[0] || s.estado;
        const que = { parado: 'parado', error: 'con error', aviso: 'con aviso' }[s.estado];
        const prioridad = s.estado === 'aviso' ? 3 : 4;
        if (await enviarNtfy(`KitDani: ${s.nombre} ${que}`, motivo, { prioridad, tags: s.estado === 'aviso' ? 'warning' : 'rotating_light' })) {
          avisados[s.id] = 'caido';
          guardarAvisados();
        }
      }
    } else {
      malDesde.delete(s.id);
      if (s.estado === 'ok' && avisados[s.id]) {
        const eraCaida = avisados[s.id] === 'caido';
        delete avisados[s.id];
        guardarAvisados();
        if (eraCaida) await enviarNtfy(`KitDani: ${s.nombre} vuelve a estar en marcha`, s.mensaje || s.detalles[0] || 'En marcha', { prioridad: 2, tags: 'white_check_mark' });
      }
    }
  }
}

// Aviso que manda la propia herramienta (POST /api/avisar). Límite: uno cada 10 s y 20 por hora por
// servicio, para que un bucle con un fallo no llene el móvil.
const enviosPorServicio = new Map();
export async function avisoDeHerramienta(s, { titulo, texto, prioridad = 3, tags = '' }) {
  if (s.avisos === 'no') return { enviado: false, motivo: 'Este servicio tiene los avisos desactivados en el panel' };
  if (!NTFY_URL || !NTFY_TEMA) return { enviado: false, motivo: 'ntfy no está configurado en config.local.json' };
  const ahora = Date.now();
  const recientes = (enviosPorServicio.get(s.id) || []).filter((t) => ahora - t < 3_600_000);
  if (recientes.length && ahora - recientes[recientes.length - 1] < 10_000) return { enviado: false, motivo: 'Demasiado seguido: espera 10 segundos' };
  if (recientes.length >= 20) return { enviado: false, motivo: 'Límite de 20 avisos por hora alcanzado' };
  const p = Math.min(5, Math.max(1, Number(prioridad) || 3));
  const ok = await enviarNtfy(`${s.nombre}: ${String(titulo || 'Aviso').slice(0, 120)}`, String(texto || '').slice(0, 2000) || ' ', { prioridad: p, tags: String(tags || '').slice(0, 100) });
  if (ok) { recientes.push(ahora); enviosPorServicio.set(s.id, recientes); }
  return ok ? { enviado: true } : { enviado: false, motivo: 'ntfy no aceptó el aviso; mira registro.log' };
}

// ---------- Horarios de interruptores ----------
// "horario": { "apagar": "23:00", "encender": "08:00" }. Fuera de ese tramo, encendido.
// Solo se actúa cuando cambia el tramo (o al arrancar), así un cambio a mano dura hasta el siguiente tramo.

function minutos(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function enTramoApagado(horario, d = new Date()) {
  const a = minutos(horario?.apagar);
  const e = minutos(horario?.encender);
  if (a === null || e === null || a === e) return false;
  const n = d.getHours() * 60 + d.getMinutes();
  return a < e ? n >= a && n < e : n >= a || n < e;
}

const tramoAnterior = new Map();

export async function aplicarHorarios(servicios, ejecutar) {
  for (const s of servicios) {
    for (const i of s.interruptores) {
      if (!i.horario) continue;
      const clave = `${s.id}/${i.id}`;
      const deberia = !enTramoApagado(i.horario);
      if (tramoAnterior.get(clave) === deberia) continue;
      tramoAnterior.set(clave, deberia);
      if (leerInterruptor(i) === deberia) continue;
      try {
        escribirInterruptor(i, deberia);
        anotar(`horario: ${i.id} de ${s.id} ${deberia ? 'encendido' : 'apagado'}`);
        if (i.despues) await ejecutar(i.despues);
      } catch (e) {
        anotar(`horario: no se pudo cambiar ${i.id} de ${s.id}: ${e.message}`);
      }
    }
  }
}
