import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIR_WEB = path.join(RAIZ, 'web');
export const EQUIPO = os.hostname();

// ---------- Configuración de este PC ----------
// config.local.json no va al repositorio: cada PC tiene la suya. Si no existe, se crea con valores por defecto.
export const FICHERO_CONFIG = path.join(RAIZ, 'config.local.json');

const POR_DEFECTO = {
  // Dónde se clonan las herramientas que se importan por URL. Por defecto, junto a la carpeta del Kit.
  carpeta_herramientas: path.dirname(RAIZ).replace(/\\/g, '/'),
  // Avisos al móvil por ntfy. Sin url o sin token (%LOCALAPPDATA%/KitDani/ntfy-token) no se avisa.
  ntfy: { url: null, tema: null },
  // Si tienes el Kit en varios PC, deja esto a true solo en uno, para no recibir cada aviso de un remoto dos veces.
  avisar_remotos: true,
};

function leerConfig() {
  let local = {};
  try { local = JSON.parse(fs.readFileSync(FICHERO_CONFIG, 'utf8')); } catch {
    try { fs.writeFileSync(FICHERO_CONFIG, JSON.stringify(POR_DEFECTO, null, 2) + '\n', 'utf8'); } catch {}
  }
  return { ...POR_DEFECTO, ...local, ntfy: { ...POR_DEFECTO.ntfy, ...(local.ntfy || {}) } };
}
export const CONFIG = leerConfig();

// Datos de este PC: servicios registrados, nombres y colores. Tampoco van al repositorio.
export const DIR_SERVICIOS = path.join(RAIZ, 'servicios');
export const FICHERO_PANEL = path.join(RAIZ, 'panel.json');
export const FICHERO_REGISTRO = path.join(RAIZ, 'registro.log');

export const PUERTO = Number(process.env.KIT_PUERTO) || 8790;
// Solo este PC. El panel ejecuta comandos, así que no se abre a la red.
export const HOST = process.env.KIT_HOST || '127.0.0.1';

export const INTERVALO_LOCAL_MS = 30_000;
export const INTERVALO_REMOTO_MS = 300_000;

// id del propio panel. Si no está en servicios/, el servidor lo registra al arrancar.
export const ID_PROPIO = 'kitdani';

export const TIPOS = ['demonio', 'tarea', 'hook', 'contenedor', 'remoto'];
export const ESTADOS = ['ok', 'aviso', 'error', 'parado', 'desconocido'];
