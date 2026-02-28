  pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    // ════════════════════════════════════════
    // ESTADO
    // ════════════════════════════════════════
    // ════════════════════════════════════════
    // RUTA MADRE DIVIDIR PDF (persistente)
    // ════════════════════════════════════════
    window.addEventListener('DOMContentLoaded', () => {
      // Obtener la ruta madre actual al cargar
      if (window.electronAPI?.getCarpetaMadrePDF) {
        window.electronAPI.getCarpetaMadrePDF().then(ruta => {
          const inputRuta = document.getElementById('input-carpeta-madre');
          if (inputRuta) inputRuta.value = ruta || '';
        });
      }

      // Cambiar la ruta madre
      const btnCambiar = document.getElementById('btn-cambiar-carpeta-madre');
      if (btnCambiar && window.electronAPI?.seleccionarCarpetaMadrePDF) {
        btnCambiar.addEventListener('click', async () => {
          const ruta = await window.electronAPI.seleccionarCarpetaMadrePDF();
          if (ruta) {
            const inputRuta = document.getElementById('input-carpeta-madre');
            if (inputRuta) inputRuta.value = ruta;
          }
        });
      }
    });
    const TIPOS_COLORES = {
      CRC: '#34d399', OPF: '#60a5fa', HAM: '#fb923c',
      FEV: '#a78bfa', PDX: '#f87171', HEV: '#2dd4bf', PDE: '#fbbf24'
    };

    let pdfsDocs = [];       // documentos PDF.js
    let pdfsMeta = [];       // { nombre, paginas, tempPath }
    let tipoActivo = null;
    let asignaciones = {};   // { "0_3": { pdfIndex, pagina, tipo } }

    // Modal
    let modalPdfIndex = 0;
    let modalPagina = 1;

    // ════════════════════════════════════════
    // VERIFICAR PDFTK (via IPC / fetch)
    // ════════════════════════════════════════
    async function verificarPDFtk() {
      try {
        // Si usas Electron con contextBridge:
        if (window.electronAPI?.verificarPDFtk) {
          const ok = await window.electronAPI.verificarPDFtk();
          setStatus(ok, ok ? 'PDFtk listo' : 'PDFtk no encontrado');
          return;
        }
        // Si usas un servidor Express local:
        const res = await fetch('/api/verificar-pdftk');
        const data = await res.json();
        setStatus(data.ok, data.ok ? 'PDFtk listo' : 'PDFtk no encontrado');
      } catch {
        setStatus(false, 'Sin conexión al servidor');
      }
    }

    function setStatus(ok, msg) {
      document.getElementById('statusDot').className = 'status-dot' + (ok ? ' ok' : '');
      document.getElementById('statusText').textContent = msg;
    }

    verificarPDFtk();

    // ════════════════════════════════════════
    // UPLOAD DE PDFs
    // ════════════════════════════════════════
    const inputFiles = document.getElementById('pdfFiles');
    const uploadZone = document.getElementById('uploadZone');

    inputFiles.addEventListener('change', e => cargarArchivos(e.target.files));

    uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
    uploadZone.addEventListener('drop', e => {
      e.preventDefault();
      uploadZone.classList.remove('drag-over');
      const pdfs = [...e.dataTransfer.files].filter(f => f.type === 'application/pdf');
      if (pdfs.length) cargarArchivos(pdfs);
    });

    async function cargarArchivos(files) {
      pdfsDocs = [];
      pdfsMeta = [];
      asignaciones = {};
      document.getElementById('pageGrid').innerHTML = '';
      document.getElementById('pdfBadges').innerHTML = '';

      const arr = [...files];
      for (let i = 0; i < arr.length; i++) {
        const file = arr[i];
        try {
          const ab = await file.arrayBuffer();
          const doc = await pdfjsLib.getDocument({ data: ab }).promise;
          pdfsDocs.push(doc);
          pdfsMeta.push({ nombre: file.name, paginas: doc.numPages, file });
          agregarBadge(i, file.name, doc.numPages);
        } catch (e) {
          toast('error', 'Error al cargar', `No se pudo leer ${file.name}`);
        }
      }

      if (pdfsDocs.length > 0) {
        await renderizarTodasLasPaginas();
      }

      actualizarResumen();
    }

    function agregarBadge(index, nombre, paginas) {
      const badge = document.createElement('div');
      badge.className = 'pdf-badge';
      badge.innerHTML = `
        <span>📄 PDF ${index + 1}: ${nombre}</span>
        <span class="badge-pages">${paginas} págs</span>
      `;
      document.getElementById('pdfBadges').appendChild(badge);
    }

    // ════════════════════════════════════════
    // RENDERIZAR PÁGINAS
    // ════════════════════════════════════════
    async function renderizarTodasLasPaginas() {
      const grid = document.getElementById('pageGrid');
      const section = document.getElementById('pageSection');
      grid.innerHTML = '';
      section.style.display = 'block';

      let totalPags = pdfsMeta.reduce((s, p) => s + p.paginas, 0);
      document.getElementById('pageCount').textContent = `${totalPags} páginas · ${pdfsMeta.length} PDF(s)`;

      for (let pi = 0; pi < pdfsDocs.length; pi++) {
        const doc = pdfsDocs[pi];
        for (let pag = 1; pag <= doc.numPages; pag++) {
          const card = crearCard(pi, pag);
          grid.appendChild(card);
          // render async sin bloquear
          renderMiniatura(card, doc, pag);
        }
      }

      activarDragAndDrop();
    }

    function crearCard(pdfIndex, pagina) {
      const id = `${pdfIndex}_${pagina}`;
      const card = document.createElement('div');
      card.className = 'page-card';
      card.dataset.pdfIndex = pdfIndex;
      card.dataset.pagina = pagina;
      card.dataset.id = id;
      card.draggable = true;

      card.innerHTML = `
        <div class="page-thumb" data-pdf="${pdfIndex}" data-page="${pagina}">
          <span>📄</span>
          <span class="zoom-hint">🔍 Ver</span>
        </div>
        <div class="page-info">
          <div class="page-label">PDF ${pdfIndex + 1} · Pág. ${pagina}</div>
          <span class="page-tipo-tag">Sin asignar</span>
        </div>
      `;

      // Clic en thumbnail → modal
      card.querySelector('.page-thumb').addEventListener('click', e => {
        e.stopPropagation();
        abrirModal(pdfIndex, pagina);
      });

      // Clic en card → asignar tipo
      card.addEventListener('click', () => asignarPagina(card));

      return card;
    }

    async function renderMiniatura(card, doc, pagina) {
      try {
        const page = await doc.getPage(pagina);
        const vp = page.getViewport({ scale: 0.6 });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

        const thumb = card.querySelector('.page-thumb');
        thumb.innerHTML = '<span class="zoom-hint">🔍 Ver</span>';
        thumb.insertBefore(canvas, thumb.firstChild);
      } catch {}
    }

    // ════════════════════════════════════════
    // ASIGNACIÓN DE TIPOS
    // ════════════════════════════════════════
    document.querySelectorAll('.tipo-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tipo-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        tipoActivo = btn.dataset.tipo;
      });
    });

    function asignarPagina(card) {
      if (!tipoActivo) {
        toast('info', 'Selecciona un tipo', 'Primero elige CRC, OPF, HAM, etc.');
        return;
      }

      const id = card.dataset.id;
      const pdfIndex = parseInt(card.dataset.pdfIndex);
      const pagina = parseInt(card.dataset.pagina);
      const tag = card.querySelector('.page-tipo-tag');

      // Toggle: si ya tiene este tipo, quitar
      if (asignaciones[id] && asignaciones[id].tipo === tipoActivo) {
        delete asignaciones[id];
        tag.textContent = 'Sin asignar';
        tag.style.background = '';
        tag.style.color = '';
        tag.classList.remove('set');
        card.style.borderColor = '';
        card.style.background = '';
        card.classList.remove('assigned');
      } else {
        asignaciones[id] = { pdfIndex, pagina, tipo: tipoActivo };
        const color = TIPOS_COLORES[tipoActivo];
        tag.textContent = tipoActivo;
        tag.style.background = color;
        tag.style.color = '#0e0e11';
        tag.classList.add('set');
        card.style.borderColor = color;
        card.style.background = color + '12';
        card.classList.add('assigned');
      }

      actualizarResumen();
    }

    function actualizarResumen() {
      const conteo = {};
      Object.values(asignaciones).forEach(a => {
        conteo[a.tipo] = (conteo[a.tipo] || 0) + 1;
      });

      const resumen = document.getElementById('resumen');
      resumen.innerHTML = Object.entries(TIPOS_COLORES).map(([tipo, color]) => {
        const n = conteo[tipo] || 0;
        return `
          <div class="resumen-item ${n > 0 ? 'has-pages' : ''}" style="--c:${color}">
            <span style="color:${n > 0 ? color : 'var(--muted)'}">${tipo}</span>
            <span class="resumen-count">${n > 0 ? n + ' pág' + (n > 1 ? 's' : '') : '—'}</span>
          </div>
        `;
      }).join('');

      const total = Object.keys(asignaciones).length;
      const btnG = document.getElementById('btnGuardar');
      btnG.disabled = total === 0;
    }

    actualizarResumen();

    // ════════════════════════════════════════
    // GUARDAR PDFs
    // ════════════════════════════════════════
    document.getElementById('btnGuardar').addEventListener('click', async () => {
      const numeroAdmision = document.getElementById('numeroAdmision').value.trim();
      if (!numeroAdmision) {
        toast('error', 'Falta el número', 'Ingresa el número de admisión antes de guardar.');
        return;
      }

      const asignacionesArr = Object.values(asignaciones);
      if (asignacionesArr.length === 0) {
        toast('error', 'Sin asignaciones', 'Asigna al menos una página a un tipo.');
        return;
      }

      // Confirmar
      const resumen = {};
      asignacionesArr.forEach(a => { resumen[a.tipo] = (resumen[a.tipo] || 0) + 1; });
      const resumenTexto = Object.entries(resumen).map(([t, n]) => `${t}: ${n} pág`).join('\n');
      if (!confirm(`¿Confirmar guardar?\n\n${resumenTexto}`)) return;

      const btn = document.getElementById('btnGuardar');
      btn.disabled = true;
      btn.classList.add('loading');
      btn.textContent = '⏳ Procesando…';

      try {
        // ── ELECTRON IPC ──
        // Paso 1: guardar cada PDF en disco temporal (el renderer no puede escribir)
        toast('info', 'Preparando archivos…', 'Guardando PDFs temporales');
        const rutasPDFs = [];

        for (let i = 0; i < pdfsMeta.length; i++) {
          const ab = await pdfsMeta[i].file.arrayBuffer();
          // Convertir ArrayBuffer a Array normal para poder enviarlo por IPC
          const respuesta = await window.electronAPI.guardarTemporal(
            pdfsMeta[i].nombre,
            Array.from(new Uint8Array(ab))
          );
          if (!respuesta.ok) throw new Error(`No se pudo guardar temporal: ${respuesta.error}`);
          rutasPDFs.push(respuesta.ruta);
        }

        // Paso 2: procesar la división con PDFtk
        toast('info', 'Dividiendo PDFs…', 'Ejecutando PDFtk');
        const respuesta = await window.electronAPI.procesarDivisionPDF({
          rutasPDFs,
          asignaciones: asignacionesArr,
          numeroAdmision
        });

        if (!respuesta.ok) throw new Error(respuesta.error);
        mostrarResultado(respuesta.resultado);

        // Limpiar temporales
        await window.electronAPI.limpiarTemporales();

      } catch (e) {
        toast('error', 'Error al procesar', e.message);
      } finally {
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.textContent = '💾 Guardar PDFs';
      }
    });

    function mostrarResultado(resultado) {
      const panel = document.getElementById('resultPanel');
      document.getElementById('resultPath').textContent = '📁 ' + resultado.carpeta;

      const filesEl = document.getElementById('resultFiles');
      filesEl.innerHTML = resultado.resultados.map(r => `
        <div class="result-file ${r.error ? 'fail' : 'ok'}">
          ${r.error ? '❌' : '✅'}
          <span>${r.archivo}</span>
          ${r.error ? `<span style="color:var(--red);font-size:11px;margin-left:auto">${r.error}</span>` : ''}
        </div>
      `).join('');

      panel.classList.add('show');
      panel.scrollIntoView({ behavior: 'smooth' });

      toast('success', `${resultado.totalCreados} PDF(s) creados`, `Guardados en: ${resultado.carpeta}`);
    }

    document.getElementById('btnReset').addEventListener('click', () => {
      pdfsDocs = []; pdfsMeta = []; asignaciones = {};
      document.getElementById('pageGrid').innerHTML = '';
      document.getElementById('pdfBadges').innerHTML = '';
      document.getElementById('pageSection').style.display = 'none';
      document.getElementById('resultPanel').classList.remove('show');
      document.getElementById('numeroAdmision').value = '';
      document.querySelectorAll('.tipo-btn').forEach(b => b.classList.remove('active'));
      tipoActivo = null;
      actualizarResumen();
      document.getElementById('pdfFiles').value = '';
    });

    // ════════════════════════════════════════
    // DRAG & DROP REORDENAR
    // ════════════════════════════════════════
    function activarDragAndDrop() {
      let dragged = null;
      const grid = document.getElementById('pageGrid');

      grid.addEventListener('dragstart', e => {
        const card = e.target.closest('.page-card');
        if (card) { dragged = card; card.classList.add('dragging'); }
      });
      grid.addEventListener('dragend', e => {
        if (dragged) { dragged.classList.remove('dragging'); dragged = null; }
        document.querySelectorAll('.drag-over-card').forEach(c => c.classList.remove('drag-over-card'));
      });
      grid.addEventListener('dragover', e => {
        e.preventDefault();
        const card = e.target.closest('.page-card');
        if (card && card !== dragged) {
          document.querySelectorAll('.drag-over-card').forEach(c => c.classList.remove('drag-over-card'));
          card.classList.add('drag-over-card');
        }
      });
      grid.addEventListener('drop', e => {
        e.preventDefault();
        const target = e.target.closest('.page-card');
        if (target && dragged && target !== dragged) {
          const cards = [...grid.children];
          const iDragged = cards.indexOf(dragged);
          const iTarget = cards.indexOf(target);
          if (iDragged < iTarget) grid.insertBefore(dragged, target.nextSibling);
          else grid.insertBefore(dragged, target);
        }
        document.querySelectorAll('.drag-over-card').forEach(c => c.classList.remove('drag-over-card'));
      });
    }

    // ════════════════════════════════════════
    // MODAL PREVIEW
    // ════════════════════════════════════════
    async function abrirModal(pdfIndex, pagina) {
      modalPdfIndex = pdfIndex;
      modalPagina = pagina;
      document.getElementById('modal').classList.add('open');
      await renderizarModal();
    }

    async function renderizarModal() {
      const doc = pdfsDocs[modalPdfIndex];
      if (!doc) return;
      const page = await doc.getPage(modalPagina);
      const scale = Math.min(2.0, (window.innerWidth * 0.8) / page.getViewport({ scale: 1 }).width);
      const vp = page.getViewport({ scale });
      const canvas = document.getElementById('modalCanvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      document.getElementById('modalInfo').textContent =
        `PDF ${modalPdfIndex + 1} · Página ${modalPagina} de ${doc.numPages}`;
    }

    document.getElementById('modalClose').addEventListener('click', () => {
      document.getElementById('modal').classList.remove('open');
    });
    document.getElementById('modal').addEventListener('click', e => {
      if (e.target === document.getElementById('modal'))
        document.getElementById('modal').classList.remove('open');
    });
    document.getElementById('prevPage').addEventListener('click', async () => {
      if (modalPagina > 1) { modalPagina--; await renderizarModal(); }
    });
    document.getElementById('nextPage').addEventListener('click', async () => {
      const doc = pdfsDocs[modalPdfIndex];
      if (doc && modalPagina < doc.numPages) { modalPagina++; await renderizarModal(); }
    });
    document.addEventListener('keydown', e => {
      if (document.getElementById('modal').classList.contains('open')) {
        if (e.key === 'Escape') document.getElementById('modal').classList.remove('open');
        if (e.key === 'ArrowLeft') document.getElementById('prevPage').click();
        if (e.key === 'ArrowRight') document.getElementById('nextPage').click();
      }
    });

    // ════════════════════════════════════════
    // TOASTS
    // ════════════════════════════════════════
    function toast(type, title, msg = '') {
      const icons = { success: '✅', error: '❌', info: 'ℹ️' };
      const el = document.createElement('div');
      el.className = `toast ${type}`;
      el.innerHTML = `
        <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
        <div class="toast-body"><strong>${title}</strong><p>${msg}</p></div>
      `;
      document.getElementById('toasts').appendChild(el);
      setTimeout(() => el.remove(), 4000);
    }