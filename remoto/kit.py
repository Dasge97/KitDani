#!/usr/bin/env python3
"""Parte de KitDani que vive en un servidor Linux. Solo usa la biblioteca estándar de Python 3.

Se instala con remoto/instalar.sh, que crea tres comandos en ~/bin apuntando a este fichero:

  kit-estado <id> <ok|aviso|error|parado> <mensaje> [-i "Etiqueta=valor"]... [--sin-aviso]
      Escribe ~/kit/estado/<id>.json, que el Kit del PC lee por SSH. Si el estado pasa a error o
      parado (o a aviso, si el servicio está en modo "todo"), avisa al móvil. Cuando vuelve a ok,
      avisa de que se ha recuperado. --sin-aviso: solo guarda el estado.

  kit-avisar <id> <titulo> [texto] [-p prioridad] [-t tags] [--tema tema] [--click url]
      Manda un aviso al móvil en nombre del servicio <id>. Sale con 1 si ntfy no lo aceptó.

  kit-kuma [--id webs] [--contenedor nombre]
      Lee el último resultado de cada web vigilada por Uptime Kuma, escribe su estado y avisa
      cuando una web se cae o vuelve. Pensado para cron cada pocos minutos.

Ficheros:
  ~/.config/kit/config.json   { "ntfy_url": "...", "ntfy_tema": "..." }
  ~/.config/kit/ntfy-token    token de ntfy (permisos 600)
  ~/kit/avisos.json           modo de avisos por servicio ("no", "caidas", "todo"). Lo copia el Kit del PC.
  ~/kit/estado/<id>.json      estado de cada servicio
  ~/kit/avisados.json         servicios de los que ya se avisó, para avisar al volver
  ~/kit/registro.log          qué se ha enviado y qué no
"""
import argparse
import base64
import datetime
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

INICIO = os.path.expanduser('~')
DIR_KIT = os.path.join(INICIO, 'kit')
DIR_ESTADO = os.path.join(DIR_KIT, 'estado')
DIR_CONFIG = os.path.join(INICIO, '.config', 'kit')
F_CONFIG = os.path.join(DIR_CONFIG, 'config.json')
F_TOKEN = os.path.join(DIR_CONFIG, 'ntfy-token')
F_AVISOS = os.path.join(DIR_KIT, 'avisos.json')
F_AVISADOS = os.path.join(DIR_KIT, 'avisados.json')
F_ENVIOS = os.path.join(DIR_KIT, 'envios.json')
F_REGISTRO = os.path.join(DIR_KIT, 'registro.log')
ESTADOS = ('ok', 'aviso', 'error', 'parado')


# ---------- utilidades ----------

def ahora_iso():
    return datetime.datetime.now().astimezone().isoformat(timespec='seconds')


def anotar(texto):
    os.makedirs(DIR_KIT, exist_ok=True)
    with open(F_REGISTRO, 'a', encoding='utf-8') as f:
        f.write(f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} {texto}\n")


def leer_json(ruta, defecto):
    try:
        with open(ruta, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return defecto


def escribir_json(ruta, datos):
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(ruta), suffix='.tmp')
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(datos, f, ensure_ascii=False, indent=2)
        f.write('\n')
    os.chmod(tmp, 0o644)
    os.replace(tmp, ruta)


def modo(id_):
    m = leer_json(F_AVISOS, {}).get(id_)
    return m if m in ('no', 'caidas', 'todo') else 'caidas'


# ---------- ntfy ----------

def enviar(titulo, texto, prioridad=3, tags='', tema=None, click=None):
    config = leer_json(F_CONFIG, {})
    url = (config.get('ntfy_url') or '').rstrip('/')
    tema = tema or config.get('ntfy_tema')
    try:
        with open(F_TOKEN, encoding='utf-8') as f:
            token = f.read().strip()
    except OSError:
        token = ''
    if not url or not tema or not token:
        anotar(f"sin configurar ntfy (config.json o ntfy-token); no se envía: {titulo}")
        return False
    cabeceras = {
        'Authorization': f'Bearer {token}',
        # ntfy lee las cabeceras como latin-1; con RFC 2047 los acentos llegan bien.
        'Title': '=?UTF-8?B?' + base64.b64encode(titulo.encode('utf-8')).decode('ascii') + '?=',
        'Priority': str(prioridad),
    }
    if tags:
        cabeceras['Tags'] = tags
    if click:
        cabeceras['Click'] = click
    peticion = urllib.request.Request(f'{url}/{tema}', data=(texto or ' ').encode('utf-8'), headers=cabeceras, method='POST')
    try:
        with urllib.request.urlopen(peticion, timeout=10) as r:
            ok = 200 <= r.status < 300
    except Exception as e:  # noqa: BLE001 - un aviso fallido nunca debe romper el script que lo llama
        anotar(f"ntfy falló ({e}): {titulo}")
        return False
    anotar(f"enviado [{tema}] {titulo}")
    return ok


def limite_ok(id_):
    """Uno cada 10 s y 20 por hora por servicio, para que un fallo en bucle no llene el móvil."""
    envios = leer_json(F_ENVIOS, {})
    t = time.time()
    lista = [x for x in envios.get(id_, []) if t - x < 3600]
    if (lista and t - lista[-1] < 10) or len(lista) >= 20:
        return False
    lista.append(t)
    envios[id_] = lista
    escribir_json(F_ENVIOS, envios)
    return True


# ---------- comandos ----------

def cmd_avisar(a):
    if modo(a.id) == 'no':
        anotar(f"{a.id}: avisos desactivados en el Kit; no se envía: {a.titulo}")
        return 0
    if not limite_ok(a.id):
        anotar(f"{a.id}: límite de avisos; no se envía: {a.titulo}")
        return 0
    # 0 si se envió o si se decidió no enviar (modo "no", límite); 1 si ntfy falló, para que quien llama reintente.
    return 0 if enviar(f"{a.id}: {a.titulo}", a.texto or '', a.prioridad, a.tags, a.tema, a.click) else 1


def guardar_estado(id_, estado, mensaje, indicadores, sin_aviso=False, titulo=None, tema=None):
    ruta = os.path.join(DIR_ESTADO, f'{id_}.json')
    anterior = leer_json(ruta, {}).get('estado')
    escribir_json(ruta, {
        'estado': estado,
        'actualizado': ahora_iso(),
        'mensaje': mensaje,
        'indicadores': indicadores[:6],
    })
    if sin_aviso:
        return
    m = modo(id_)
    if m == 'no':
        return
    nombre = titulo or id_
    avisados = leer_json(F_AVISADOS, {})
    malo = estado in ('error', 'parado') or (m == 'todo' and estado == 'aviso')
    if malo and not avisados.get(id_):
        que = {'error': 'con error', 'parado': 'parado', 'aviso': 'con aviso'}[estado]
        if enviar(f"{nombre} {que}", mensaje, 3 if estado == 'aviso' else 4,
                  'warning' if estado == 'aviso' else 'rotating_light', tema):
            avisados[id_] = estado
            escribir_json(F_AVISADOS, avisados)
    elif estado == 'ok' and avisados.get(id_):
        if enviar(f"{nombre} vuelve a estar bien", mensaje, 2, 'white_check_mark', tema):
            avisados.pop(id_, None)
            escribir_json(F_AVISADOS, avisados)
    elif estado == 'ok' and anterior and anterior != 'ok':
        pass  # no se había avisado (modo o fallo de envío): no hay nada que recuperar


def cmd_estado(a):
    indicadores = []
    for par in a.indicador or []:
        etiqueta, _, valor = par.partition('=')
        indicadores.append({'etiqueta': etiqueta.strip(), 'valor': valor.strip()})
    guardar_estado(a.id, a.estado, a.mensaje, indicadores, a.sin_aviso, a.titulo, a.tema)
    return 0


def cmd_kuma(a):
    consulta = (
        "select m.name, m.url, h.status, h.msg from monitor m "
        "left join heartbeat h on h.id = (select id from heartbeat where monitor_id = m.id order by time desc limit 1) "
        "where m.active = 1 order by m.name"
    )
    try:
        salida = subprocess.run(
            ['docker', 'exec', a.contenedor, 'sqlite3', '-readonly', '-json', '/app/data/kuma.db', consulta],
            capture_output=True, text=True, timeout=60, check=True,
        ).stdout
        webs = json.loads(salida or '[]')
    except Exception as e:  # noqa: BLE001
        guardar_estado(a.id, 'error', f'No se pudo leer Uptime Kuma: {e}', [], titulo='Webs de codehive')
        return 1

    # status de Uptime Kuma: 0 caída, 1 en marcha, 2 pendiente, 3 mantenimiento
    caidas = sorted(w['name'] for w in webs if w.get('status') == 0)
    total = len(webs)

    # Avisos por web: solo cuando cambia el conjunto de caídas, para no repetir.
    ruta_prev = os.path.join(DIR_KIT, f'{a.id}-caidas.json')
    primera_vez = not os.path.exists(ruta_prev)
    previas = set(leer_json(ruta_prev, []))
    nuevas = [w for w in caidas if w not in previas]
    # Solo cuenta como vuelta una web que sigue vigilada y responde. Si se pausa o se borra en Uptime
    # Kuma, desaparece de la lista sin aviso.
    en_marcha = {w['name'] for w in webs if w.get('status') == 1}
    vueltas = sorted((previas - set(caidas)) & en_marcha)
    escribir_json(ruta_prev, caidas)

    if not primera_vez and modo(a.id) != 'no':
        detalle = {w['name']: f"{w.get('url')} · {w.get('msg') or 'sin respuesta'}" for w in webs}
        if nuevas:
            enviar(f"Webs caídas: {', '.join(nuevas)}", '\n'.join(detalle[n] for n in nuevas), 4, 'rotating_light')
        if vueltas:
            enviar(f"Webs que vuelven: {', '.join(vueltas)}", f"Siguen caídas: {len(caidas)} de {total}", 2, 'white_check_mark')

    mensaje = f"{total - len(caidas)} de {total} en marcha" + (f". Caídas: {', '.join(caidas)}" if caidas else '')
    indicadores = [{'etiqueta': 'En marcha', 'valor': f'{total - len(caidas)}/{total}'}]
    if caidas:
        indicadores.append({'etiqueta': 'Caídas', 'valor': str(len(caidas))})
    # Los avisos por web ya se han mandado arriba; el estado general se guarda sin aviso propio.
    guardar_estado(a.id, 'aviso' if caidas else 'ok', mensaje, indicadores, sin_aviso=True)
    return 0


def main():
    nombre = os.path.basename(sys.argv[0])
    args = sys.argv[1:]
    # Se puede llamar como kit-estado / kit-avisar / kit-kuma o como "kit.py estado ...".
    if nombre.startswith('kit-'):
        sub = nombre[4:]
    elif args:
        sub, args = args[0], args[1:]
    else:
        print(__doc__)
        return 2

    p = argparse.ArgumentParser(prog=f'kit-{sub}')
    if sub == 'estado':
        p.add_argument('id')
        p.add_argument('estado', choices=ESTADOS)
        p.add_argument('mensaje')
        p.add_argument('-i', '--indicador', action='append', help='"Etiqueta=valor". Se puede repetir.')
        p.add_argument('--titulo', help='Nombre que sale en el aviso. Por defecto, el id.')
        p.add_argument('--tema', help='Tema de ntfy distinto del de config.json')
        p.add_argument('--sin-aviso', action='store_true')
        return cmd_estado(p.parse_args(args))
    if sub == 'avisar':
        p.add_argument('id')
        p.add_argument('titulo')
        p.add_argument('texto', nargs='?', default='')
        p.add_argument('-p', '--prioridad', type=int, default=3, choices=range(1, 6))
        p.add_argument('-t', '--tags', default='')
        p.add_argument('--tema')
        p.add_argument('--click', help='URL que se abre al pulsar el aviso')
        return cmd_avisar(p.parse_args(args))
    if sub == 'kuma':
        p.add_argument('--id', default='webs')
        p.add_argument('--contenedor', default='monitoring-uptime-kuma-1')
        return cmd_kuma(p.parse_args(args))
    print(f'Comando desconocido: {sub}. Usa estado, avisar o kuma.', file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main())
