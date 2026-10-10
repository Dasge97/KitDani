// Página del panel. Pide /api/estado cada 10 s y pinta una fila por servicio.
// El propio panel (id "kitdani") no va en la tabla: su estado se enseña en la barra de arriba.
(() => {
  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const contenedor = $('#secciones');
  const barraEstado = $('#barra-estado');
  const barraReloj = $('#barra-reloj');
  const modal = $('#modal');
  const aviso = $('#aviso');

  const ID_PROPIO = 'kitdani';
  const TEXTO_ESTADO = { ok: 'En marcha', aviso: 'Aviso', error: 'Error', parado: 'Parado', desconocido: 'Sin datos' };
  const INTERVALO_MS = 10000;
  const abiertos = new Set();
  let temporizador = null;
  let temporizadorAviso = null;

  function h(etiqueta, atributos = {}, ...hijos) {
    const el = document.createElement(etiqueta);
    for (const [k, v] of Object.entries(atributos)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const hijo of hijos.flat()) {
      if (hijo === null || hijo === undefined || hijo === false) continue;
      el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
    }
    return el;
  }

  function horaCorta(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const hoy = new Date();
    const hm = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === hoy.toDateString() ? hm : `${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })} ${hm}`;
  }

  function mostrarAviso(texto, ms = 3500) {
    aviso.textContent = texto;
    aviso.classList.remove('oculto');
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => aviso.classList.add('oculto'), ms);
  }

  async function api(ruta, cuerpo) {
    const r = await fetch(ruta, cuerpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) } : undefined);
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(datos.error || `HTTP ${r.status}`);
    return datos;
  }

  function abrirModal(titulo, sub, texto) {
    $('#modal-titulo').textContent = titulo;
    $('#modal-sub').textContent = sub || '';
    $('#modal-texto').textContent = texto;
    modal.classList.remove('oculto');
    const caja = $('#modal-texto');
    caja.scrollTop = caja.scrollHeight;
  }
  function cerrarModal() { modal.classList.add('oculto'); }
  $('#modal-cerrar').addEventListener('click', cerrarModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) cerrarModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarModal(); });

  async function ejecutarAccion(boton, servicio, accion) {
    boton.disabled = true;
    const textoOriginal = boton.textContent;
    boton.textContent = '…';
    try {
      const r = await api('/api/accion', { id: servicio.id, accion });
      mostrarAviso(`${servicio.nombre}: ${accion} hecho`);
      if (r.salida) console.log(`[${servicio.id}] ${accion}:`, r.salida);
      setTimeout(cargar, 3500);
    } catch (e) {
      mostrarAviso(`${servicio.nombre}: ${accion} falló. ${e.message}`, 6000);
    } finally {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  }

  async function verRegistro(servicio) {
    try {
      const r = await api(`/api/registro?id=${encodeURIComponent(servicio.id)}`);
      abrirModal(`Registro de ${servicio.nombre}`, r.fichero, r.lineas.join('\n') || '(vacío)');
    } catch (e) {
      mostrarAviso(`No se pudo leer el registro: ${e.message}`, 5000);
    }
  }

  // Los botones no deben desplegar la fila al pulsarlos.
  const parar = (fn) => (e) => { e.stopPropagation(); fn(e); };

  function botones(s) {
    const lista = [];
    for (const i of s.interruptores) {
      const input = h('input', { type: 'checkbox' });
      input.checked = i.valor;
      const horario = i.horario ? h('span', { class: 'horario', title: `Se apaga solo a las ${i.horario.apagar} y se enciende a las ${i.horario.encender}` }, `${i.horario.apagar}–${i.horario.encender}`) : null;
      const etiqueta = h('label', { class: 'interruptor', title: i.etiqueta, onclick: (e) => e.stopPropagation() },
        h('span', {}, i.etiqueta), horario, input, h('span', { class: 'palanca', 'aria-hidden': 'true' }));
      input.addEventListener('change', async () => {
        etiqueta.classList.add('ocupado');
        try {
          const r = await api('/api/interruptor', { id: s.id, interruptor: i.id, valor: input.checked });
          input.checked = r.valor;
          mostrarAviso(`${i.etiqueta}: ${r.valor ? 'activadas' : 'desactivadas'}`);
        } catch (e) {
          input.checked = !input.checked;
          mostrarAviso(`No se pudo cambiar ${i.etiqueta}: ${e.message}`, 6000);
        } finally {
          etiqueta.classList.remove('ocupado');
        }
      });
      lista.push(etiqueta);
    }
    for (const x of s.acciones.extra || []) {
      // Sin datos de la sesión todavía (codehive aún sin comprobar) se ofrece Desbloquear.
      if (x.si === 'bloqueada' && s.sesion?.abierta === true) continue;
      if (x.si === 'desbloqueada' && !s.sesion?.abierta) continue;
      lista.push(h('button', { class: 'boton', type: 'button', onclick: parar((e) => ejecutarAccion(e.currentTarget, s, x.id)) }, x.etiqueta));
    }
    if (s.acciones.arrancar) lista.push(h('button', { class: 'boton', type: 'button', onclick: parar((e) => ejecutarAccion(e.currentTarget, s, 'arrancar')) }, s.estado === 'ok' ? 'Relanzar' : 'Arrancar'));
    if (s.acciones.parar && s.estado !== 'parado') lista.push(h('button', { class: 'boton', type: 'button', onclick: parar((e) => {
      if (confirm(`¿Parar ${s.nombre}?`)) ejecutarAccion(e.currentTarget, s, 'parar');
    }) }, 'Parar'));
    if (s.acciones.abrir) {
      if (/^https?:/i.test(s.acciones.abrir)) lista.push(h('a', { class: 'boton', href: s.acciones.abrir, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, 'Abrir'));
      else lista.push(h('button', { class: 'boton', type: 'button', onclick: parar((e) => ejecutarAccion(e.currentTarget, s, 'abrir')) }, 'Abrir'));
    }
    if (s.acciones.registro) lista.push(h('button', { class: 'boton', type: 'button', onclick: parar(() => verRegistro(s)) }, 'Registro'));
    if (s.acciones.carpeta) lista.push(h('button', { class: 'boton boton-suave', type: 'button', title: s.proyecto, onclick: parar((e) => ejecutarAccion(e.currentTarget, s, 'carpeta')) }, 'Carpeta'));
    return lista;
  }

  // ---------- Ajustes de la página: nombre, color y orden (se guardan en panel.json) ----------

  const COLORES = [
    { valor: null, nombre: 'Sin color' },
    { valor: '#46b36f', nombre: 'Verde' },
    { valor: '#4f8ff7', nombre: 'Azul' },
    { valor: '#2ec4d6', nombre: 'Cian' },
    { valor: '#9b7bf2', nombre: 'Morado' },
    { valor: '#e86fb4', nombre: 'Rosa' },
    { valor: '#f08a3c', nombre: 'Naranja' },
    { valor: '#e4c341', nombre: 'Amarillo' },
    { valor: '#e05656', nombre: 'Rojo' },
  ];
  // Mientras se edita o se arrastra no se repinta la tabla, para no perder el foco ni la fila.
  let ocupado = false;

  async function guardarPanel(cambio) {
    try {
      await api('/api/panel', cambio);
    } catch (e) {
      mostrarAviso(`No se pudo guardar: ${e.message}`, 6000);
    }
  }

  function editor(s) {
    const entrada = h('input', { class: 'campo', type: 'text', value: s.nombre, maxlength: '80', placeholder: s.nombre_original, 'aria-label': 'Nombre' });
    entrada.addEventListener('focus', () => { ocupado = true; });
    const guardarNombre = async () => {
      ocupado = false;
      const nuevo = entrada.value.trim();
      if (nuevo === s.nombre) return;
      // Vacío o igual al original: se quita el nombre personalizado.
      await guardarPanel({ id: s.id, nombre: nuevo && nuevo !== s.nombre_original ? nuevo : '' });
      mostrarAviso('Nombre guardado');
      cargar();
    };
    entrada.addEventListener('blur', guardarNombre);
    entrada.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') entrada.blur();
      if (e.key === 'Escape') { entrada.value = s.nombre; entrada.blur(); }
    });
    const muestras = COLORES.map((c) => h('button', {
      class: `muestra${(c.valor || null) === (s.color || null) ? ' elegida' : ''}${c.valor ? '' : ' muestra-nada'}`,
      type: 'button', title: c.nombre, 'aria-label': c.nombre,
      style: c.valor ? `--muestra:${c.valor}` : null,
      onclick: async (e) => {
        e.stopPropagation();
        await guardarPanel({ id: s.id, color: c.valor || '' });
        cargar();
      },
    }));
    return h('div', { class: 'editor', onclick: (e) => e.stopPropagation() },
      h('label', { class: 'clave' }, 'Nombre'), entrada,
      h('span', { class: 'clave' }, 'Color'), h('span', { class: 'muestras' }, muestras),
      s.nombre !== s.nombre_original ? h('span', { class: 'clave original' }, `Original: ${s.nombre_original}`) : null,
      h('span', { class: 'barra-hueco' }),
      s.importado ? h('button', { class: 'boton', type: 'button', title: 'git pull y vuelve a leer su kit.json', onclick: (e) => actualizarHerramienta(e.currentTarget, s) }, 'Actualizar') : null,
      s.id !== ID_PROPIO ? h('button', { class: 'boton boton-peligro', type: 'button', onclick: () => quitarHerramienta(s) }, 'Quitar del Kit') : null,
    );
  }

  async function actualizarHerramienta(boton, s) {
    boton.disabled = true; boton.textContent = 'Actualizando…';
    try {
      const r = await api('/api/actualizar', { id: s.id });
      abrirModal(`Actualizar ${s.nombre}`, s.paquete ? `Paquete ${s.paquete}` : '', r.log.join('\n'));
      cargar();
    } catch (e) {
      mostrarAviso(`No se pudo actualizar: ${e.message}`, 6000);
    } finally {
      boton.disabled = false; boton.textContent = 'Actualizar';
    }
  }

  async function quitarHerramienta(s) {
    if (!confirm(`¿Quitar ${s.nombre} del Kit?\n\nDeja de verse en el panel. La carpeta de la herramienta no se borra.`)) return;
    const desinstalar = s.importado && confirm('¿Ejecutar también su desinstalador?\n\nAceptar: la desinstala del PC (quita su arranque automático).\nCancelar: solo la quita del panel.');
    try {
      const r = await api('/api/quitar', { id: s.id, desinstalar });
      mostrarAviso(r.log[r.log.length - 1] || 'Quitado');
      abiertos.delete(s.id);
      cargar();
    } catch (e) {
      mostrarAviso(`No se pudo quitar: ${e.message}`, 6000);
    }
  }

  // ---------- Importar ----------
  const modalImportar = $('#modal-importar');
  const logImportar = $('#importar-log');
  function cerrarImportar() { modalImportar.classList.add('oculto'); }
  $('#btn-importar').addEventListener('click', () => {
    logImportar.classList.add('oculto');
    logImportar.textContent = '';
    modalImportar.classList.remove('oculto');
    $('#importar-fuente').focus();
  });
  $('#importar-cerrar').addEventListener('click', cerrarImportar);
  modalImportar.addEventListener('click', (e) => { if (e.target === modalImportar) cerrarImportar(); });
  $('#form-importar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const boton = $('#importar-enviar');
    boton.disabled = true; boton.textContent = 'Importando…';
    logImportar.classList.remove('oculto');
    logImportar.textContent = 'Trabajando. Clonar e instalar puede tardar un poco…';
    try {
      const r = await fetch('/api/importar', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fuente: $('#importar-fuente').value, instalar: $('#importar-instalar').checked }) });
      const d = await r.json();
      logImportar.textContent = [...(d.log || []), r.ok ? '\nHecho.' : `\nError: ${d.error}`].join('\n');
      if (r.ok) { $('#importar-fuente').value = ''; mostrarAviso(`Importado: ${d.ids.join(', ')}`); cargar(); }
    } catch (err) {
      logImportar.textContent = `Error: ${err.message}`;
    } finally {
      boton.disabled = false; boton.textContent = 'Importar';
    }
  });

  // Arrastrar: solo desde el asa. La fila se mueve en vivo y al soltar se guarda el orden.
  let arrastrada = null;
  function prepararArrastre(f, asa) {
    asa.addEventListener('mousedown', () => { f.draggable = true; });
    asa.addEventListener('mouseup', () => { f.draggable = false; });
    asa.addEventListener('click', (e) => e.stopPropagation());
    f.addEventListener('dragstart', (e) => {
      arrastrada = f; ocupado = true;
      f.classList.add('arrastrando');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', f.dataset.id);
    });
    f.addEventListener('dragover', (e) => {
      if (!arrastrada || arrastrada === f || arrastrada.dataset.seccion !== f.dataset.seccion) return;
      e.preventDefault();
      const caja = f.getBoundingClientRect();
      const antes = e.clientY < caja.top + caja.height / 2;
      f.parentNode.insertBefore(arrastrada, antes ? f : f.nextSibling);
    });
    f.addEventListener('dragend', async () => {
      f.classList.remove('arrastrando');
      f.draggable = false;
      arrastrada = null;
      const orden = [...contenedor.querySelectorAll('.fila-servicio')].map((x) => x.dataset.id);
      await guardarPanel({ orden });
      ocupado = false;
      cargar();
    });
  }

  function fila(s) {
    const abierto = abiertos.has(s.id);
    const resumen = s.mensaje || s.detalles[0] || '';
    const detalle = h('div', { class: `detalle${abierto ? ' abierto' : ''}` },
      editor(s),
      h('div', {},
        s.descripcion ? h('p', {}, s.descripcion) : null,
        s.detalles.length ? h('ul', {}, s.detalles.map((d) => h('li', {}, d))) : null,
      ),
      h('div', {},
        s.proyecto ? h('p', {}, h('span', { class: 'clave' }, 'Proyecto '), h('span', { class: 'ruta' }, s.proyecto)) : null,
        h('p', {}, h('span', { class: 'clave' }, 'Comprobado '), s.comprobado ? horaCorta(s.comprobado) : 'todavía no'),
        s.actualizado ? h('p', {}, h('span', { class: 'clave' }, 'La herramienta informó '), horaCorta(s.actualizado)) : null,
        s.ntfy ? h('p', {}, h('span', { class: 'clave' }, 'Avisa por ntfy en '), s.ntfy) : null,
      ),
    );
    const asa = h('span', { class: 'asa', title: 'Arrastra para cambiar el orden', 'aria-hidden': 'true' }, '⋮⋮');
    const f = h('div', {
      class: `fila fila-servicio${s.color ? ' con-color' : ''}`, role: 'row', 'data-estado': s.estado, 'data-id': s.id, 'data-seccion': s.seccion, 'aria-expanded': String(abierto),
      style: s.color ? `--color-servicio:${s.color}` : null,
      onclick: () => {
        const ahora = !abiertos.has(s.id);
        if (ahora) abiertos.add(s.id); else abiertos.delete(s.id);
        f.setAttribute('aria-expanded', String(ahora));
        detalle.classList.toggle('abierto', ahora);
      },
    },
      h('span', { class: 'celda-punto', role: 'cell' }, asa, h('span', { class: 'punto', title: TEXTO_ESTADO[s.estado] })),
      h('div', { class: 'celda-nombre', role: 'cell' }, h('div', { class: 'nombre' }, s.nombre), h('div', { class: 'tipo' }, s.tipo)),
      h('div', { class: 'estado', role: 'cell' }, h('span', { class: 'estado-texto' }, TEXTO_ESTADO[s.estado] || s.estado), h('span', { class: 'estado-mensaje', title: resumen }, resumen)),
      h('div', { class: 'indicadores', role: 'cell' }, s.indicadores.map((i) => h('span', { class: 'indicador' }, `${i.etiqueta} `, h('b', {}, i.valor)))),
      h('div', { class: 'acciones', role: 'cell' }, botones(s)),
      detalle,
    );
    prepararArrastre(f, asa);
    return f;
  }

  const malo = (s) => s.estado === 'error' || s.estado === 'parado';

  // "5 servicios · todo en marcha" o "5 servicios · 1 con problemas · 1 con aviso"
  function resumen(lista) {
    const problemas = lista.filter(malo).length;
    const avisos = lista.filter((s) => s.estado === 'aviso').length;
    const partes = [h('b', {}, lista.length), lista.length === 1 ? ' servicio' : ' servicios'];
    if (problemas) partes.push(' · ', h('span', { class: 'mal' }, `${problemas} con problemas`));
    if (avisos) partes.push(' · ', `${avisos} con aviso`);
    if (!problemas && !avisos) partes.push(' · todo en marcha');
    return partes;
  }

  // La barra de arriba es la de este PC; cada servidor remoto tiene su propia barra encima de su tabla.
  function pintarBarra(datos, propio, deEstePc) {
    const partes = resumen(deEstePc);
    if (propio) {
      const puerto = propio.indicadores.find((i) => i.etiqueta === 'Puerto');
      if (puerto) partes.push(' · puerto ', puerto.valor);
    }
    barraEstado.replaceChildren(...partes);
    if (datos.equipo) $('#barra-equipo').textContent = datos.equipo;
    barraReloj.textContent = datos.ultima_comprobacion_local ? `comprobado ${horaCorta(datos.ultima_comprobacion_local)}` : 'comprobando…';
    const problemas = datos.servicios.filter((s) => s.id !== ID_PROPIO && malo(s)).length;
    document.title = problemas ? `(${problemas}) KitDani` : 'KitDani';
  }

  function tabla(lista, etiqueta) {
    return h('div', { class: 'tabla', role: 'table', 'aria-label': etiqueta },
      h('div', { class: 'fila fila-cabecera', role: 'row' },
        h('span', { role: 'columnheader' }), h('span', { role: 'columnheader' }, 'Servicio'),
        h('span', { role: 'columnheader' }, 'Estado'), h('span', { role: 'columnheader' }, 'Indicadores'),
        h('span', { role: 'columnheader' })),
      h('div', { role: 'rowgroup', class: 'filas' }, lista.map(fila)),
    );
  }

  function barraRemota(nombre, lista, datos) {
    const boton = h('button', { class: 'boton', type: 'button', onclick: async () => {
      boton.disabled = true; boton.textContent = 'Comprobando…';
      try { pintar(await api('/api/comprobar', {})); } catch (e) { mostrarAviso(`No se pudo comprobar: ${e.message}`, 5000); }
    } }, 'Comprobar');
    return h('div', { class: 'barra barra-seccion' },
      h('span', { class: 'barra-titulo' }, nombre),
      h('span', { class: 'barra-estado' }, resumen(lista)),
      h('span', { class: 'barra-hueco' }),
      h('span', { class: 'barra-reloj' }, datos.ultima_comprobacion_remota ? `comprobado ${horaCorta(datos.ultima_comprobacion_remota)}` : 'comprobando…'),
      boton,
    );
  }

  function pintar(datos) {
    const propio = datos.servicios.find((s) => s.id === ID_PROPIO) || null;
    // Orden guardado primero; los servicios nuevos que no estén en él van al final, por nombre.
    const posicion = new Map((datos.orden || []).map((id, i) => [id, i]));
    const lista = datos.servicios
      .filter((s) => s.id !== ID_PROPIO)
      .sort((a, b) => (posicion.get(a.id) ?? 1e6) - (posicion.get(b.id) ?? 1e6) || a.nombre.localeCompare(b.nombre, 'es'));
    const deEstePc = lista.filter((s) => s.seccion === 'pc');
    pintarBarra(datos, propio, deEstePc);
    if (ocupado) return;
    if (!lista.length) {
      contenedor.replaceChildren(h('p', { class: 'vacio' }, 'No hay servicios registrados en la carpeta servicios/.'));
      return;
    }
    const bloques = [];
    if (deEstePc.length) bloques.push(h('section', { class: 'seccion' }, tabla(deEstePc, 'Servicios de este PC')));
    for (const sec of [...new Set(lista.filter((s) => s.seccion !== 'pc').map((s) => s.seccion))]) {
      const deSec = lista.filter((s) => s.seccion === sec);
      const nombre = sec.charAt(0).toUpperCase() + sec.slice(1);
      bloques.push(h('section', { class: 'seccion seccion-remota' }, barraRemota(nombre, deSec, datos), tabla(deSec, `Servicios de ${nombre}`)));
    }
    contenedor.replaceChildren(...bloques);
  }

  async function cargar() {
    clearTimeout(temporizador);
    let espera = INTERVALO_MS;
    try {
      const datos = await api('/api/estado');
      pintar(datos);
      // Recién arrancado y sin comprobación todavía: consultar más a menudo hasta que la haya.
      if (!datos.ultima_comprobacion_local) espera = 2000;
    } catch (e) {
      barraEstado.textContent = `Sin conexión con el servidor del Kit (${e.message})`;
      espera = 3000;
    } finally {
      temporizador = setTimeout(cargar, espera);
    }
  }

  $('#btn-comprobar').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = 'Comprobando…';
    try {
      pintar(await api('/api/comprobar', {}));
    } catch (err) {
      mostrarAviso(`No se pudo comprobar: ${err.message}`, 5000);
    } finally {
      b.disabled = false;
      b.textContent = 'Comprobar';
    }
  });

  // Reinicio completo: el servidor termina y vuelve a arrancar. Se espera a que responda un proceso
  // nuevo (cambia "arrancado") y entonces se recarga la página entera, para coger también los ficheros web nuevos.
  $('#btn-reiniciar').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    clearTimeout(temporizador);
    let anterior = null;
    try {
      anterior = (await api('/api/reiniciar', {})).arrancado;
    } catch (err) {
      mostrarAviso(`No se pudo pedir el reinicio: ${err.message}`, 6000);
      b.disabled = false;
      temporizador = setTimeout(cargar, INTERVALO_MS);
      return;
    }
    barraEstado.textContent = 'Reiniciando el servidor…';
    const limite = Date.now() + 40000;
    while (Date.now() < limite) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const d = await api('/api/estado');
        // Proceso nuevo y con la primera comprobación local ya hecha: recargar con todo pintado.
        if (d.arrancado && d.arrancado !== anterior && d.ultima_comprobacion_local) { location.reload(); return; }
        if (d.arrancado && d.arrancado !== anterior) barraEstado.textContent = 'Servidor reiniciado. Comprobando servicios…';
      } catch {}
    }
    barraEstado.textContent = 'El servidor no ha vuelto. Mira registro.log o ejecuta instalar-arranque.ps1.';
    b.disabled = false;
  });

  document.addEventListener('visibilitychange', () => { if (!document.hidden) cargar(); });
  cargar();
})();
