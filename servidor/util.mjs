import fs from 'node:fs';
import path from 'node:path';
import { FICHERO_REGISTRO } from './config.mjs';

const dos = (n) => String(n).padStart(2, '0');

// Fecha ISO 8601 con la zona horaria local, p. ej. 2026-10-10T00:14:18+02:00
export function isoLocal(d = new Date()) {
  const desfase = -d.getTimezoneOffset();
  const signo = desfase >= 0 ? '+' : '-';
  const abs = Math.abs(desfase);
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}${signo}${dos(Math.floor(abs / 60))}:${dos(abs % 60)}`;
}

export function fechaRegistro(d = new Date()) {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
}

// "HH:MM" si es hoy, "dd/mm HH:MM" si no. Para enseñar en el panel.
export function horaCorta(valor) {
  if (!valor) return null;
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return String(valor);
  const hoy = new Date();
  const hm = `${dos(d.getHours())}:${dos(d.getMinutes())}`;
  if (d.toDateString() === hoy.toDateString()) return hm;
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)} ${hm}`;
}

export function anotar(texto) {
  const linea = `${fechaRegistro()} ${texto}\n`;
  try {
    if (fs.existsSync(FICHERO_REGISTRO) && fs.statSync(FICHERO_REGISTRO).size > 1_000_000) {
      fs.renameSync(FICHERO_REGISTRO, FICHERO_REGISTRO + '.1');
    }
    fs.appendFileSync(FICHERO_REGISTRO, linea, 'utf8');
  } catch {}
  process.stdout.write(linea);
}

// Escritura atómica: fichero temporal y renombrar, para que nadie lea un JSON a medias.
export function escribirJsonAtomico(fichero, datos) {
  fs.mkdirSync(path.dirname(fichero), { recursive: true });
  const tmp = `${fichero}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(datos, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, fichero);
}

export function leerJson(fichero) {
  try {
    return JSON.parse(fs.readFileSync(fichero, 'utf8'));
  } catch {
    return null;
  }
}

// Últimas líneas de un fichero de texto sin leerlo entero.
export function colaFichero(fichero, lineas = 80, maxBytes = 128 * 1024) {
  const fd = fs.openSync(fichero, 'r');
  try {
    const tam = fs.fstatSync(fd).size;
    const leer = Math.min(tam, maxBytes);
    const buf = Buffer.alloc(leer);
    fs.readSync(fd, buf, 0, leer, tam - leer);
    const texto = buf.toString('utf8');
    const todas = texto.split(/\r?\n/);
    if (todas.length && todas[todas.length - 1] === '') todas.pop();
    return todas.slice(-lineas);
  } finally {
    fs.closeSync(fd);
  }
}

const PESO = { error: 4, parado: 3, aviso: 2, desconocido: 1, ok: 0 };
export function peorEstado(a, b) {
  return (PESO[a] ?? 1) >= (PESO[b] ?? 1) ? a : b;
}
export function pesoEstado(e) {
  return PESO[e] ?? 1;
}

export function normalizarRuta(r) {
  return String(r || '').replace(/\//g, '\\').toLowerCase();
}

export function lista(x) {
  if (Array.isArray(x)) return x;
  if (x === null || x === undefined) return [];
  return [x];
}
