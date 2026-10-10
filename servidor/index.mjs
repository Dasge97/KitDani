// Servidor del panel KitDani. Sin dependencias: http, fs y child_process de Node.
//   GET  /                     la página
//   GET  /api/estado           estado de todos los servicios
//   GET  /api/registro?id=X    últimas líneas del log del servicio X
//   POST /api/accion           { id, accion: arrancar | parar | abrir | carpeta }
//   POST /api/interruptor      { id, interruptor, valor: true | false }
//   POST /api/comprobar        fuerza una comprobación ahora
//   POST /api/panel            { orden: [ids] } o { id, nombre, color }: ajustes de la página (panel.json)
//   POST /api/reiniciar        reinicio completo del servidor
//   POST /api/importar         { fuente: URL de git o carpeta, instalar }: importa una herramienta con kit.json
//   POST /api/actualizar       { id }: git pull y vuelve a leer su kit.json
//   POST /api/quitar           { id, desinstalar }: la quita del Kit (no borra su carpeta)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec, spawn } from 'node:child_process';
import {
  RAIZ, PUERTO, HOST, DIR_WEB, INTERVALO_LOCAL_MS, INTERVALO_REMOTO_MS, ID_PROPIO, EQUIPO, FICHERO_PANEL, CONFIG,
} from './config.mjs';
import { anotar, isoLocal, horaCorta, colaFichero, peorEstado, pesoEstado, leerJson, escribirJsonAtomico } from './util.mjs';
import {
  cargarServicios, leerEstadoHerramienta, escribirEstadoHerramienta, leerInterruptor, escribirInterruptor, asegurarServicioPropio,
} from './servicios.mjs';
import { comprobarLocales, comprobarRemotos } from './comprobar.mjs';
import { importar, actualizar, quitar } from './importar.mjs';
import { pararProcesos, revisarAvisos, marcarParadoAMano, aplicarHorarios, enTramoApagado } from './extras.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

asegurarServicioPropio();
const ARRANCADO = isoLocal();          // la página lo usa para saber que el reinicio ha terminado
let servicios = cargarServicios();
const chequeos = new Map();           // id -> resultado de la última comprobación
let ultimaLocal = null;
let ultimaRemota = null;
let comprobandoLocal = false;
let comprobandoRemoto = false;
let temporizadorRecheck = null;

// ---------- Ciclos de comprobación ----------

async function cicloLocal() {
  if (comprobandoLocal) return;
  comprobandoLocal = true;
  try {
    servicios = cargarServicios();
    const r = await comprobarLocales(servicios);
    for (const [id, v] of r) chequeos.set(id, { ...v, comprobado: Date.now() });
    ultimaLocal = Date.now();
    escribirEstadoPropio();
    await aplicarHorarios(servicios, ejecutar);
    await revisarAvisos(servicios.filter((s) => s.id !== ID_PROPIO && s.tipo !== 'remoto').map(estadoDeServicio));
  } catch (e) {
    anotar(`Fallo en el ciclo local: ${e.message}`);
  } finally {
    comprobandoLocal = false;
  }
}

async function cicloRemoto() {
  if (comprobandoRemoto) return;
  comprobandoRemoto = true;
  try {
    const r = await comprobarRemotos(servicios);
    for (const [id, v] of r) chequeos.set(id, { ...v, comprobado: Date.now() });
    ultimaRemota = Date.now();
    if (CONFIG.avisar_remotos !== false) await revisarAvisos(servicios.filter((s) => s.tipo === 'remoto').map(estadoDeServicio));
  } catch (e) {
    anotar(`Fallo en el ciclo remoto: ${e.message}`);
  } finally {
    comprobandoRemoto = false;
  }
}

function escribirEstadoPropio() {
  const propio = servicios.find((s) => s.id === ID_PROPIO);
  if (!propio) return;
  const resumen = resumenEstados();
  escribirEstadoHerramienta(propio, {
    estado: 'ok',
    actualizado: isoLocal(),
    mensaje: `${servicios.length} servicios. ${resumen.error + resumen.parado} con problemas`,
    indicadores: [
      { etiqueta: 'Servicios', valor: String(servicios.length) },
      { etiqueta: 'Con problemas', valor: String(resumen.error + resumen.parado) },
      { etiqueta: 'Puerto', valor: String(PUERTO) },
    ],
  });
}

function programarRecheck(ms = 3000, remoto = false) {
  clearTimeout(temporizadorRecheck);
  temporizadorRecheck = setTimeout(() => { cicloLocal(); if (remoto) cicloRemoto(); }, ms);
}

// Un demonio sin "parar" propio se puede parar matando su proceso (o el que escucha en su puerto).
function puedePararSolo(s) {
  return s.tipo === 'demonio' && s.id !== ID_PROPIO && !s.acciones.parar && Boolean(s.comprobar.proceso_contiene || s.comprobar.puerto);
}

function duracionCorta(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(min / 60);
  return h ? `${h} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`;
}

// ---------- Estado combinado ----------

function estadoDeServicio(s) {
  const chequeo = chequeos.get(s.id) || { estado: 'desconocido', detalles: ['Todavía sin comprobar'], indicadores: [], comprobado: null };
  const propio = leerEstadoHerramienta(s) || chequeo.estadoRemoto || null;
  let estado = chequeo.estado;
  const detalles = [...chequeo.detalles];
  let indicadores = [...(propio?.indicadores || []), ...chequeo.indicadores];
  let mensaje = propio?.mensaje || '';
  let actualizado = propio?.actualizado || null;

  if (propio) {
    estado = peorEstado(estado, propio.estado);
    if (s.caducidad_minutos && actualizado) {
      const edad = (Date.now() - new Date(actualizado).getTime()) / 60000;
      if (edad > s.caducidad_minutos) {
        estado = peorEstado(estado, 'aviso');
        detalles.push(`Sin noticias desde las ${horaCorta(actualizado)}`);
      }
    }
  }
  // Sesión con caducidad (la bóveda): bloqueada o cuánto le queda. Se calcula en cada petición.
  let sesion = null;
  if (s.comprobar.sesion_remota && chequeo.sesionCaduca !== undefined && chequeo.sesionCaduca !== null) {
    const queda = chequeo.sesionCaduca - Date.now();
    if (queda > 0) {
      sesion = { abierta: true, caduca: new Date(chequeo.sesionCaduca).toISOString(), queda: duracionCorta(queda) };
      indicadores.unshift({ etiqueta: 'Desbloqueada, quedan', valor: sesion.queda });
      if (!mensaje) mensaje = `Desbloqueada hasta las ${horaCorta(chequeo.sesionCaduca)}`;
      if (queda < 15 * 60000) estado = peorEstado(estado, 'aviso');
    } else {
      sesion = { abierta: false };
      indicadores.unshift({ etiqueta: 'Sesión', valor: 'bloqueada' });
      if (!mensaje) mensaje = 'Bloqueada. Los scripts que usan la bóveda no funcionan';
      estado = peorEstado(estado, 'aviso');
    }
  }
  indicadores = indicadores.slice(0, 8);

  const ajustes = leerPanel().servicios[s.id] || {};
  return {
    id: s.id,
    nombre: ajustes.nombre || s.nombre,
    nombre_original: s.nombre,
    color: ajustes.color || null,
    descripcion: s.descripcion || '',
    tipo: s.tipo,
    proyecto: s.proyecto || null,
    estado,
    mensaje,
    detalles,
    indicadores,
    actualizado,
    comprobado: chequeo.comprobado ? new Date(chequeo.comprobado).toISOString() : null,
    importado: Boolean(s.origen?.carpeta),
    paquete: s.origen?.paquete || null,
    seccion: s.tipo === 'remoto' ? (s.comprobar.host || 'remoto') : 'pc',
    sesion,
    acciones: {
      arrancar: Boolean(s.acciones.arrancar),
      parar: Boolean(s.acciones.parar) || puedePararSolo(s),
      extra: (Array.isArray(s.acciones.extra) ? s.acciones.extra : []).map((x) => ({ id: x.id, etiqueta: x.etiqueta || x.id, si: x.si || null })),
      abrir: s.acciones.abrir || null,
      carpeta: Boolean(s.proyecto),
      registro: Boolean(s.registro),
    },
    interruptores: s.interruptores.map((i) => ({
      id: i.id, etiqueta: i.etiqueta || i.id, valor: leerInterruptor(i),
      horario: i.horario ? { apagar: i.horario.apagar, encender: i.horario.encender, ahora_apagado: enTramoApagado(i.horario) } : null,
    })),
    ntfy: s.ntfy || null,
  };
}

function resumenEstados() {
  const r = { ok: 0, aviso: 0, error: 0, parado: 0, desconocido: 0 };
  for (const s of servicios) r[(chequeos.get(s.id) || {}).estado || 'desconocido']++;
  return r;
}

function estadoCompleto() {
  const lista = servicios.map(estadoDeServicio)
    .sort((a, b) => pesoEstado(b.estado) - pesoEstado(a.estado) || a.nombre.localeCompare(b.nombre, 'es'));
  const resumen = { ok: 0, aviso: 0, error: 0, parado: 0, desconocido: 0 };
  for (const s of lista) resumen[s.estado]++;
  return {
    ahora: isoLocal(),
    arrancado: ARRANCADO,
    equipo: EQUIPO,
    ultima_comprobacion_local: ultimaLocal ? new Date(ultimaLocal).toISOString() : null,
    ultima_comprobacion_remota: ultimaRemota ? new Date(ultimaRemota).toISOString() : null,
    resumen,
    orden: leerPanel().orden,
    servicios: lista,
  };
}

// ---------- Ajustes del panel (panel.json) ----------
// Lo que se cambia desde la página y no es de la herramienta: nombre visible, color y orden.
// Va aparte de servicio.json para que Claude pueda reescribir servicio.json sin pisarlo.

const COLOR_VALIDO = /^#[0-9a-f]{6}$/i;

function leerPanel() {
  const p = leerJson(FICHERO_PANEL) || {};
  return {
    orden: Array.isArray(p.orden) ? p.orden.map(String) : [],
    servicios: p.servicios && typeof p.servicios === 'object' ? p.servicios : {},
  };
}

function cambiarPanel({ orden, id, nombre, color }) {
  const p = leerPanel();
  if (Array.isArray(orden)) p.orden = orden.map(String).slice(0, 500);
  if (id) {
    const a = { ...(p.servicios[id] || {}) };
    if (nombre !== undefined) {
      const limpio = String(nombre || '').trim().slice(0, 80);
      if (limpio) a.nombre = limpio; else delete a.nombre;
    }
    if (color !== undefined) {
      if (color && COLOR_VALIDO.test(color)) a.color = color.toLowerCase(); else delete a.color;
    }
    if (Object.keys(a).length) p.servicios[id] = a; else delete p.servicios[id];
  }
  escribirJsonAtomico(FICHERO_PANEL, p);
  return p;
}

// ---------- Acciones ----------

function ejecutar(comando, cwd) {
  return new Promise((resolver) => {
    exec(comando, { cwd: cwd && fs.existsSync(cwd) ? cwd : undefined, timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => {
      resolver({ ok: !err, salida: `${stdout || ''}${stderr || ''}`.trim().slice(-2000), error: err ? err.message.split('\n')[0] : null });
    });
  });
}

async function accion(id, nombre) {
  const s = servicios.find((x) => x.id === id);
  if (!s) return { estado: 404, cuerpo: { error: `No existe el servicio ${id}` } };
  let comando = null;
  const extra = (Array.isArray(s.acciones.extra) ? s.acciones.extra : []).find((x) => x.id === nombre);
  if (nombre === 'parar' && !s.acciones.parar && puedePararSolo(s)) {
    // Si una tarea de Windows lo relanza, se desactiva para que siga parado; "Arrancar" la reactiva.
    if (s.comprobar.tarea_windows) await ejecutar(`schtasks /Change /TN "${s.comprobar.tarea_windows}" /DISABLE`);
    marcarParadoAMano(s.id);
    let salida;
    try { salida = await pararProcesos(s.comprobar.proceso_contiene, s.comprobar.puerto); } catch (e) { salida = `falló: ${e.message}`; }
    anotar(`acción parar en ${id}: ${salida}`);
    programarRecheck(1500);
    return { estado: 200, cuerpo: { ok: true, salida } };
  }
  if (nombre === 'arrancar' && s.acciones.arrancar && s.comprobar.tarea_windows) {
    comando = `schtasks /Change /TN "${s.comprobar.tarea_windows}" /ENABLE >nul & ${s.acciones.arrancar}`;
  } else if (nombre === 'arrancar' || nombre === 'parar') comando = s.acciones[nombre];
  else if (extra) comando = extra.comando;
  else if (nombre === 'abrir' && s.acciones.abrir && !/^https?:/i.test(s.acciones.abrir)) comando = `start "" "${s.acciones.abrir}"`;
  else if (nombre === 'carpeta' && s.proyecto) comando = `explorer.exe "${s.proyecto.replace(/\//g, '\\')}"`;
  if (!comando) return { estado: 400, cuerpo: { error: `El servicio ${id} no tiene la acción ${nombre}` } };
  anotar(`acción ${nombre} en ${id}: ${comando}`);
  if (nombre === 'parar') marcarParadoAMano(s.id);
  const r = await ejecutar(comando, s.proyecto);
  if (!r.ok) anotar(`  falló: ${r.error}`);
  programarRecheck(3000, s.tipo === 'remoto');
  // Acciones que abren un terminal (desbloquear la bóveda): se vuelve a mirar cuando el usuario ya ha escrito.
  if (s.tipo === 'remoto' && extra) for (const ms of [20_000, 45_000, 90_000]) setTimeout(cicloRemoto, ms);
  return { estado: r.ok ? 200 : 500, cuerpo: r };
}

async function interruptor(id, idInterruptor, valor) {
  const s = servicios.find((x) => x.id === id);
  if (!s) return { estado: 404, cuerpo: { error: `No existe el servicio ${id}` } };
  const i = s.interruptores.find((x) => x.id === idInterruptor);
  if (!i) return { estado: 404, cuerpo: { error: `El servicio ${id} no tiene el interruptor ${idInterruptor}` } };
  try {
    escribirInterruptor(i, Boolean(valor));
  } catch (e) {
    return { estado: 500, cuerpo: { error: `No se pudo escribir ${i.fichero}: ${e.message}` } };
  }
  anotar(`interruptor ${idInterruptor} de ${id}: ${valor ? 'encendido' : 'apagado'}`);
  // El comando "despues" es de cortesía (p. ej. refrescar una skin de Rainmeter). Su código de salida no
  // decide nada: Rainmeter.exe devuelve 1 aunque el bang funcione. Solo se anota si imprime algo.
  let despues = null;
  if (i.despues) {
    despues = await ejecutar(i.despues);
    if (despues.salida) anotar(`  despues: ${despues.salida.split('\n')[0]}`);
  }
  return { estado: 200, cuerpo: { valor: leerInterruptor(i), despues: despues ? { ejecutado: true, salida: despues.salida } : null } };
}

// Reinicio completo: este proceso termina y un cmd independiente lanza uno nuevo un segundo después,
// por la tarea programada "KitDani" o, si no existe, con iniciar-oculto.vbs. El nuevo proceso vuelve
// a leer servicios/ y empieza las comprobaciones de cero.
function reiniciar() {
  anotar('reinicio pedido desde el panel');
  const vbs = path.join(RAIZ, 'iniciar-oculto.vbs');
  const orden = `timeout /t 1 /nobreak >nul & schtasks /Run /TN KitDani >nul 2>&1 || wscript.exe "${vbs}" "${process.execPath}"`;
  const hijo = spawn('cmd.exe', ['/d', '/s', '/c', `"${orden}"`], {
    detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true, cwd: RAIZ,
  });
  hijo.unref();
  setTimeout(() => process.exit(0), 300);
}

// ---------- HTTP ----------

function responderJson(res, estado, cuerpo) {
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(cuerpo));
}

function leerCuerpo(req) {
  return new Promise((resolver, rechazar) => {
    let datos = '';
    req.on('data', (c) => { datos += c; if (datos.length > 64 * 1024) { rechazar(new Error('Cuerpo demasiado grande')); req.destroy(); } });
    req.on('end', () => { try { resolver(datos ? JSON.parse(datos) : {}); } catch (e) { rechazar(e); } });
    req.on('error', rechazar);
  });
}

function servirEstatico(res, ruta) {
  let rel = decodeURIComponent(ruta === '/' ? '/index.html' : ruta);
  const fichero = path.normalize(path.join(DIR_WEB, rel));
  if (!fichero.startsWith(DIR_WEB) || !fs.existsSync(fichero) || fs.statSync(fichero).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fichero).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(fichero).pipe(res);
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/estado') return responderJson(res, 200, estadoCompleto());
    if (req.method === 'GET' && url.pathname === '/api/registro') {
      const s = servicios.find((x) => x.id === url.searchParams.get('id'));
      if (!s || !s.registro) return responderJson(res, 404, { error: 'Ese servicio no tiene registro' });
      if (!fs.existsSync(s.registro)) return responderJson(res, 200, { fichero: s.registro, lineas: ['(el fichero todavía no existe)'] });
      return responderJson(res, 200, { fichero: s.registro, lineas: colaFichero(s.registro, 120) });
    }
    if (req.method === 'POST' && url.pathname === '/api/accion') {
      const { id, accion: nombre } = await leerCuerpo(req);
      const r = await accion(String(id), String(nombre));
      return responderJson(res, r.estado, r.cuerpo);
    }
    if (req.method === 'POST' && url.pathname === '/api/interruptor') {
      const { id, interruptor: idI, valor } = await leerCuerpo(req);
      const r = await interruptor(String(id), String(idI), valor);
      return responderJson(res, r.estado, r.cuerpo);
    }
    if (req.method === 'POST' && url.pathname === '/api/comprobar') {
      await Promise.all([cicloLocal(), cicloRemoto()]);
      return responderJson(res, 200, estadoCompleto());
    }
    if (req.method === 'POST' && url.pathname === '/api/panel') {
      const cuerpo = await leerCuerpo(req);
      if (cuerpo.id && !servicios.some((s) => s.id === cuerpo.id)) return responderJson(res, 404, { error: `No existe el servicio ${cuerpo.id}` });
      return responderJson(res, 200, cambiarPanel(cuerpo));
    }
    if (req.method === 'POST' && url.pathname === '/api/importar') {
      const { fuente, instalar } = await leerCuerpo(req);
      try {
        const r = await importar(fuente, { instalar: instalar !== false });
        programarRecheck(2000, true);
        return responderJson(res, 200, r);
      } catch (e) {
        return responderJson(res, 400, { error: e.message, log: e.log || [] });
      }
    }
    if (req.method === 'POST' && (url.pathname === '/api/actualizar' || url.pathname === '/api/quitar')) {
      const { id, desinstalar } = await leerCuerpo(req);
      const s = servicios.find((x) => x.id === id);
      if (!s) return responderJson(res, 404, { error: `No existe el servicio ${id}` });
      try {
        const r = url.pathname === '/api/actualizar' ? await actualizar(s) : await quitar(s, { desinstalar: Boolean(desinstalar) });
        programarRecheck(1500, s.tipo === 'remoto');
        return responderJson(res, 200, r);
      } catch (e) {
        return responderJson(res, 400, { error: e.message, log: e.log || [] });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/reiniciar') {
      responderJson(res, 200, { ok: true, arrancado: ARRANCADO });
      reiniciar();
      return;
    }
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return servirEstatico(res, url.pathname);
    responderJson(res, 404, { error: 'Ruta desconocida' });
  } catch (e) {
    anotar(`Error en ${req.method} ${url.pathname}: ${e.message}`);
    responderJson(res, 500, { error: e.message });
  }
});

servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // Ya hay otro KitDani escuchando. La tarea programada lo relanza cada 5 min; aquí no hay nada que hacer.
    process.stdout.write(`El puerto ${PUERTO} ya está en uso. Hay otro KitDani en marcha.\n`);
    process.exit(0);
  }
  anotar(`Error del servidor: ${e.message}`);
  process.exit(1);
});

servidor.listen(PUERTO, HOST, () => {
  anotar(`KitDani escuchando en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PUERTO} con ${servicios.length} servicios`);
  cicloLocal();
  cicloRemoto();
  setInterval(cicloLocal, INTERVALO_LOCAL_MS);
  setInterval(cicloRemoto, INTERVALO_REMOTO_MS);
});

for (const señal of ['SIGINT', 'SIGTERM']) {
  process.on(señal, () => { anotar('KitDani se detiene'); process.exit(0); });
}
