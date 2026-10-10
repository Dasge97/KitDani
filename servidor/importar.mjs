// Importar herramientas al Kit desde una URL de git o una carpeta local que tenga un kit.json.
// El formato de kit.json está en docs/kit-json.md.
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { CONFIG, DIR_SERVICIOS, TIPOS, ID_PROPIO } from './config.mjs';
import { anotar, isoLocal, escribirJsonAtomico, leerJson } from './util.mjs';
import { expandir, variables } from './servicios.mjs';

const ID_VALIDO = /^[a-z0-9][a-z0-9-]{0,63}$/;

function ejecutar(comando, cwd, timeout = 300_000) {
  return new Promise((resolver) => {
    exec(comando, { cwd, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolver({ ok: !err, salida: `${stdout || ''}${stderr || ''}`.trim() });
    });
  });
}

function esUrlGit(fuente) {
  return /^(https?:\/\/|git@|ssh:\/\/)/i.test(fuente) || /\.git$/i.test(fuente);
}

function nombreRepo(url) {
  return url.replace(/[\\/]+$/, '').split(/[\\/:]/).pop().replace(/\.git$/i, '');
}

// Lee y valida kit.json. Acepta un servicio suelto (campos en la raíz) o un paquete con "servicios": [...].
export function leerKitJson(carpeta) {
  const fichero = path.join(carpeta, 'kit.json');
  if (!fs.existsSync(fichero)) throw new Error(`No hay kit.json en ${carpeta}`);
  const k = leerJson(fichero);
  if (!k || typeof k !== 'object') throw new Error('kit.json no es JSON válido');
  const comunes = ['kit', 'paquete', 'instalar', 'desinstalar', 'actualizar', 'requisitos', 'servicios'];
  let servicios;
  if (Array.isArray(k.servicios)) servicios = k.servicios;
  else servicios = [Object.fromEntries(Object.entries(k).filter(([c]) => !comunes.includes(c)))];
  if (!servicios.length) throw new Error('kit.json no declara ningún servicio');
  for (const s of servicios) {
    if (!ID_VALIDO.test(s.id || '')) throw new Error(`id "${s.id}" no válido: minúsculas, números y guiones`);
    if (s.id === ID_PROPIO) throw new Error(`el id "${ID_PROPIO}" está reservado para el propio panel`);
    if (!TIPOS.includes(s.tipo)) throw new Error(`${s.id}: tipo "${s.tipo}" no válido. Tipos: ${TIPOS.join(', ')}`);
    if (!s.nombre) throw new Error(`${s.id}: falta "nombre"`);
  }
  return {
    paquete: k.paquete || path.basename(carpeta),
    instalar: k.instalar || null,
    desinstalar: k.desinstalar || null,
    actualizar: k.actualizar || null,
    requisitos: Array.isArray(k.requisitos) ? k.requisitos : [],
    servicios,
  };
}

// Cada requisito: { "comando": "pythonw", "texto": "Python 3.10 o superior" }. Se comprueba con where.exe.
async function comprobarRequisitos(requisitos) {
  const faltan = [];
  for (const r of requisitos) {
    if (!r?.comando) continue;
    const { ok } = await ejecutar(`where.exe ${JSON.stringify(String(r.comando))}`, undefined, 15_000);
    if (!ok) faltan.push(r.texto || r.comando);
  }
  return faltan;
}

// Registra en servicios/ los servicios del kit.json de una carpeta. No ejecuta nada.
function registrar(carpeta, fuente, kit) {
  const ids = [];
  for (const s of kit.servicios) {
    // estado_ruta: fichero de la herramienta donde el Kit deja escrita la ruta de su estado.json.
    // Así la herramienta sabe dónde informar sin conocer dónde está instalado el Kit.
    if (s.estado_ruta) {
      const destino = expandir(s.estado_ruta, variables({ carpeta }));
      const estado = path.join(DIR_SERVICIOS, s.id, 'estado.json').replaceAll('\\', '/');
      // La carpeta puede no existir todavía si la crea el instalador de la herramienta (que corre después).
      try { fs.mkdirSync(path.dirname(destino), { recursive: true }); fs.writeFileSync(destino, `${estado}\n`, 'utf8'); } catch (e) { anotar(`${s.id}: no se pudo escribir ${destino}: ${e.message}`); }
    }
    escribirJsonAtomico(path.join(DIR_SERVICIOS, s.id, 'servicio.json'), {
      ...s,
      origen: {
        fuente,
        carpeta: carpeta.replace(/\\/g, '/'),
        paquete: kit.paquete,
        desinstalar: kit.desinstalar,
        actualizar: kit.actualizar,
        importado: isoLocal(),
      },
    });
    ids.push(s.id);
  }
  return ids;
}

// fuente: URL de git o carpeta local. instalar: ejecutar el "instalar" del kit.json después de registrar.
export async function importar(fuente, { instalar = true } = {}) {
  const log = [];
  fuente = String(fuente || '').trim().replace(/^"|"$/g, '');
  if (!fuente) throw new Error('Falta la URL o la carpeta');

  let carpeta;
  if (esUrlGit(fuente)) {
    const base = CONFIG.carpeta_herramientas;
    carpeta = path.join(base, nombreRepo(fuente));
    if (fs.existsSync(path.join(carpeta, '.git'))) {
      log.push(`Ya estaba clonada en ${carpeta}. Actualizando con git pull.`);
      const r = await ejecutar('git pull --ff-only', carpeta);
      log.push(r.salida);
      if (!r.ok) throw Object.assign(new Error('git pull falló'), { log });
    } else {
      if (fs.existsSync(carpeta) && fs.readdirSync(carpeta).length) {
        throw Object.assign(new Error(`${carpeta} ya existe y no es un repositorio git`), { log });
      }
      fs.mkdirSync(base, { recursive: true });
      log.push(`Clonando en ${carpeta}…`);
      const r = await ejecutar(`git clone ${JSON.stringify(fuente)} ${JSON.stringify(carpeta)}`, base);
      log.push(r.salida);
      if (!r.ok) throw Object.assign(new Error('git clone falló'), { log });
    }
  } else {
    carpeta = path.resolve(fuente);
    if (!fs.existsSync(carpeta) || !fs.statSync(carpeta).isDirectory()) throw new Error(`No existe la carpeta ${carpeta}`);
  }

  const kit = leerKitJson(carpeta);
  log.push(`kit.json: paquete "${kit.paquete}" con ${kit.servicios.length} servicio(s).`);

  const faltan = await comprobarRequisitos(kit.requisitos);
  if (faltan.length) throw Object.assign(new Error(`Faltan requisitos: ${faltan.join(', ')}`), { log });

  const ids = registrar(carpeta, fuente, kit);
  log.push(`Registrado: ${ids.join(', ')}`);
  anotar(`importado ${kit.paquete} desde ${fuente}: ${ids.join(', ')}`);

  if (instalar && kit.instalar) {
    const comando = expandir(kit.instalar, variables({ carpeta }));
    log.push(`Ejecutando el instalador: ${comando}`);
    const r = await ejecutar(comando, carpeta);
    log.push(r.salida || '(sin salida)');
    if (!r.ok) {
      log.push('El instalador ha fallado. El servicio queda registrado igualmente.');
      anotar(`  instalador de ${kit.paquete} falló`);
    }
  }
  return { ids, carpeta, log };
}

// git pull (si es un repositorio), vuelve a leer kit.json y ejecuta su "actualizar" si lo tiene.
export async function actualizar(servicio) {
  const o = servicio.origen;
  if (!o?.carpeta) throw new Error(`${servicio.id} no se importó desde un kit.json`);
  const log = [];
  if (fs.existsSync(path.join(o.carpeta, '.git'))) {
    const r = await ejecutar('git pull --ff-only', o.carpeta);
    log.push(r.salida);
    if (!r.ok) throw Object.assign(new Error('git pull falló'), { log });
  }
  const kit = leerKitJson(o.carpeta);
  const ids = registrar(o.carpeta, o.fuente, kit);
  log.push(`Registro actualizado: ${ids.join(', ')}`);
  if (kit.actualizar) {
    const comando = expandir(kit.actualizar, variables({ carpeta: o.carpeta }));
    log.push(`Ejecutando: ${comando}`);
    const r = await ejecutar(comando, o.carpeta);
    log.push(r.salida || '(sin salida)');
  }
  anotar(`actualizado ${kit.paquete}: ${ids.join(', ')}`);
  return { ids, log };
}

// Quita el servicio del Kit. Con desinstalar=true ejecuta antes el "desinstalar" del kit.json.
// La carpeta de la herramienta no se borra nunca.
export async function quitar(servicio, { desinstalar = false } = {}) {
  if (servicio.id === ID_PROPIO) throw new Error('El propio panel no se puede quitar');
  const log = [];
  const o = servicio.origen;
  if (desinstalar && o?.desinstalar) {
    const comando = expandir(o.desinstalar, variables(o));
    log.push(`Ejecutando el desinstalador: ${comando}`);
    const r = await ejecutar(comando, o.carpeta);
    log.push(r.salida || '(sin salida)');
  }
  // Si la herramienta escribía su estado para el Kit, se le quita la ruta para que deje de hacerlo.
  if (servicio.estado_ruta) { try { fs.rmSync(servicio.estado_ruta, { force: true }); } catch {} }
  fs.rmSync(path.join(DIR_SERVICIOS, servicio.id), { recursive: true, force: true });
  log.push(`Quitado ${servicio.id} del Kit. La carpeta de la herramienta sigue en su sitio.`);
  anotar(`quitado ${servicio.id}${desinstalar ? ' (con desinstalador)' : ''}`);
  return { log };
}
