import fs from 'node:fs';
import path from 'node:path';
import { DIR_SERVICIOS, TIPOS, ESTADOS, RAIZ, PUERTO, ID_PROPIO } from './config.mjs';
import { anotar, leerJson, escribirJsonAtomico } from './util.mjs';

// Variables que se pueden usar en cualquier texto de servicio.json o kit.json:
//   {dir}   carpeta de la herramienta (la que se clonó o se importó)
//   {kit}   carpeta de KitDani
//   %VAR%   variable de entorno de Windows, p. ej. %USERPROFILE% o %LOCALAPPDATA%
// Así un mismo kit.json vale en cualquier PC y para cualquier usuario.
export function expandir(valor, vars) {
  if (typeof valor === 'string') {
    return valor
      .replace(/\{(dir|kit)\}/g, (_, k) => vars[k] ?? `{${k}}`)
      .replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, k) => (process.env[k] ?? m).replaceAll('\\', '/'));
  }
  if (Array.isArray(valor)) return valor.map((v) => expandir(v, vars));
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, expandir(v, vars)]));
  }
  return valor;
}

export function variables(origen) {
  return {
    dir: origen?.carpeta ? String(origen.carpeta).replaceAll('\\', '/') : undefined,
    kit: RAIZ.replaceAll('\\', '/'),
  };
}

// El propio panel se registra solo, para que un Kit recién instalado ya se vea a sí mismo.
export function asegurarServicioPropio() {
  const fichero = path.join(DIR_SERVICIOS, ID_PROPIO, 'servicio.json');
  if (fs.existsSync(fichero)) return;
  escribirJsonAtomico(fichero, {
    id: ID_PROPIO,
    nombre: 'Panel del Kit',
    descripcion: `Este panel. Comprueba los servicios del Kit y sirve la página en el puerto ${PUERTO}.`,
    tipo: 'demonio',
    proyecto: '{kit}',
    comprobar: { proceso_contiene: 'servidor/index.mjs', puerto: PUERTO, tarea_windows: 'KitDani' },
    acciones: { arrancar: 'schtasks /Run /TN KitDani', parar: null, abrir: `http://localhost:${PUERTO}/` },
    registro: '{kit}/registro.log',
    caducidad_minutos: 5,
    ntfy: null,
  });
}

// Lee servicios/*/servicio.json. Devuelve la lista válida y anota los que no lo son.
export function cargarServicios() {
  const resultado = [];
  if (!fs.existsSync(DIR_SERVICIOS)) return resultado;
  for (const nombre of fs.readdirSync(DIR_SERVICIOS, { withFileTypes: true })) {
    if (!nombre.isDirectory()) continue;
    const carpeta = path.join(DIR_SERVICIOS, nombre.name);
    const fichero = path.join(carpeta, 'servicio.json');
    if (!fs.existsSync(fichero)) continue;
    const crudo = leerJson(fichero);
    if (!crudo) {
      anotar(`servicio ${nombre.name}: servicio.json no es JSON válido, se ignora`);
      continue;
    }
    const s = expandir(crudo, variables(crudo.origen));
    if (!TIPOS.includes(s.tipo)) {
      anotar(`servicio ${nombre.name}: tipo "${s.tipo}" desconocido, se ignora`);
      continue;
    }
    resultado.push({
      ...s,
      id: s.id || nombre.name,
      nombre: s.nombre || nombre.name,
      comprobar: s.comprobar || {},
      acciones: s.acciones || {},
      interruptores: Array.isArray(s.interruptores) ? s.interruptores : [],
      origen: crudo.origen || null,
      carpeta,
    });
  }
  return resultado.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export function rutaEstado(servicio) {
  return path.join(servicio.carpeta, 'estado.json');
}

// estado.json que escribe la propia herramienta. null si no existe o no vale.
export function leerEstadoHerramienta(servicio) {
  const e = leerJson(rutaEstado(servicio));
  if (!e || typeof e !== 'object') return null;
  return {
    estado: ESTADOS.includes(e.estado) ? e.estado : 'desconocido',
    actualizado: e.actualizado || null,
    mensaje: typeof e.mensaje === 'string' ? e.mensaje : '',
    indicadores: Array.isArray(e.indicadores)
      ? e.indicadores.filter((i) => i && i.etiqueta !== undefined).slice(0, 6)
          .map((i) => ({ etiqueta: String(i.etiqueta), valor: String(i.valor ?? '') }))
      : [],
  };
}

export function escribirEstadoHerramienta(servicio, estado) {
  escribirJsonAtomico(rutaEstado(servicio), estado);
}

// Valor actual de un interruptor: lee su fichero. Si no existe, vale si_no_existe (true por defecto).
export function leerInterruptor(interruptor) {
  try {
    const texto = fs.readFileSync(interruptor.fichero, 'utf8').trim();
    return texto !== String(interruptor.apagado ?? '0');
  } catch {
    return interruptor.si_no_existe !== false;
  }
}

export function escribirInterruptor(interruptor, encendido) {
  fs.mkdirSync(path.dirname(interruptor.fichero), { recursive: true });
  const valor = encendido ? String(interruptor.encendido ?? '1') : String(interruptor.apagado ?? '0');
  fs.writeFileSync(interruptor.fichero, valor, 'utf8');
}
