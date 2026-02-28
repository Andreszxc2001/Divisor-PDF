const fs = require('fs');
const path = require('path');

// ========================
// CONFIGURACIÓN Y PERSISTENCIA
// ========================

const PREFIJOS_DISPONIBLES = {
  CRC: 'CRC_900795851_',
  OPF: 'OPF_900795851_',
  HAM: 'HAM_900795851_',
  FEV: 'FEV_900795851_',
  PDX: 'PDX_900795851_',
  HEV: 'HEV_900795851_',
  PDE: 'PDE_900795851_'
};

const ADMISIONES_CONFIG_PATH = process.env.NODE_ENV === 'development'
  ? path.join(__dirname, '../admisiones_config.json')
  : path.join(process.resourcesPath, 'admisiones_config.json');

function leerConfigAdmisiones() {
  if (fs.existsSync(ADMISIONES_CONFIG_PATH)) {
    try {
      const data = fs.readFileSync(ADMISIONES_CONFIG_PATH, 'utf8');
      return JSON.parse(data);
    } catch (e) { return {}; }
  }
  return {};
}

function guardarConfigAdmisiones(config) {
  fs.writeFileSync(ADMISIONES_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function getCarpetaMadreAdmisiones() {
  const config = leerConfigAdmisiones();
  return config.carpetaMadre || '';
}

function setCarpetaMadreAdmisiones(nuevaRuta) {
  const config = leerConfigAdmisiones();
  config.carpetaMadre = nuevaRuta;
  guardarConfigAdmisiones(config);
}

// ========================
// FUNCIÓN PRINCIPAL
// ========================

/**
 * Valida las carpetas de admisiones en una ruta dada.
 * @param {string} rutaLocal - Ruta de la carpeta madre
 * @param {string[]} tiposSeleccionados - Tipos a validar, ej: ['CRC', 'OPF', 'HAM']
 * @returns {{ resultados, archivosEliminados, resumen }}
 */
function validarAdmisiones(rutaLocal, tiposSeleccionados) {
  if (!fs.existsSync(rutaLocal) || !fs.statSync(rutaLocal).isDirectory()) {
    throw new Error(`La ruta no existe o no es una carpeta: ${rutaLocal}`);
  }

  if (!tiposSeleccionados || tiposSeleccionados.length === 0) {
    throw new Error('Debes seleccionar al menos un tipo de archivo.');
  }

  // Leer subcarpetas que sean solo números (admisiones)
  const entradas = fs.readdirSync(rutaLocal);
  const carpetas = entradas.filter(nombre => {
    const rutaCompleta = path.join(rutaLocal, nombre);
    return /^\d+$/.test(nombre) && fs.statSync(rutaCompleta).isDirectory();
  });

  const resultados = {};
  const archivosEliminados = [];

  for (const nombreCarpeta of carpetas) {
    const rutaCarpeta = path.join(rutaLocal, nombreCarpeta);

    // Leer TODOS los archivos (no solo .pdf)
    const archivos = fs.readdirSync(rutaCarpeta).filter(f => {
      return fs.statSync(path.join(rutaCarpeta, f)).isFile();
    });

    const archivosValidos = [];
    const archivosNoSolicitados = []; // tiene prefijo válido pero no fue seleccionado
    const problemasEnCarpeta = [];
    const wapisEncontrados = [];
    const tiposEncontrados = [];

    for (const nombreArchivo of archivos) {
      const rutaArchivo = path.join(rutaCarpeta, nombreArchivo);

      // Buscar si tiene alguno de los prefijos válidos
      let tienePrefijoValido = false;
      let tipoEncontrado = null;

      for (const [tipo, prefijo] of Object.entries(PREFIJOS_DISPONIBLES)) {
        if (nombreArchivo.startsWith(prefijo)) {
          tienePrefijoValido = true;
          tipoEncontrado = tipo;
          break;
        }
      }

      if (!tienePrefijoValido) {
        // No tiene prefijo válido → eliminar
        try {
          fs.unlinkSync(rutaArchivo);
          archivosEliminados.push(`${nombreCarpeta}/${nombreArchivo}`);
        } catch (err) {
          problemasEnCarpeta.push(`⚠️ No se pudo eliminar: ${nombreArchivo} (${err.message})`);
        }
        continue;
      }

      // Tiene prefijo válido — verificar si fue seleccionado para validación
      if (tiposSeleccionados.includes(tipoEncontrado)) {
        // Extraer número de admisión del nombre
        const prefijo = PREFIJOS_DISPONIBLES[tipoEncontrado];
        const match = nombreArchivo.match(
          new RegExp(`^${escapeRegex(prefijo)}(\\d+)\\.pdf$`, 'i')
        );
        if (match) {
          wapisEncontrados.push(match[1]);
          tiposEncontrados.push(tipoEncontrado);
          archivosValidos.push(nombreArchivo);
        } else {
          // Tiene el prefijo pero el nombre está mal formado
          problemasEnCarpeta.push(`❌ Nombre mal formado: ${nombreArchivo}`);
        }
      } else {
        // Tiene prefijo válido pero NO fue seleccionado → notificar, NO eliminar
        archivosNoSolicitados.push({ archivo: nombreArchivo, tipo: tipoEncontrado });
      }
    }

    // ── Validaciones ──

    // 1. Números de admisión inconsistentes entre archivos
    const wapisUnicos = [...new Set(wapisEncontrados)];
    if (wapisUnicos.length > 1) {
      problemasEnCarpeta.push(`❌ Números de admisión inconsistentes en archivos: ${wapisUnicos.join(', ')}`);
    }

    // 2. Número de admisión del archivo vs nombre de carpeta
    if (wapisUnicos.length === 1 && wapisUnicos[0] !== nombreCarpeta) {
      problemasEnCarpeta.push(
        `❌ El número de admisión en los archivos (${wapisUnicos[0]}) no coincide con la carpeta (${nombreCarpeta})`
      );
    }

    // 3. Tipos faltantes (seleccionados pero no encontrados)
    const tiposUnicos = [...new Set(tiposEncontrados)];
    const tiposFaltantes = tiposSeleccionados.filter(t => !tiposUnicos.includes(t));
    if (tiposFaltantes.length > 0) {
      problemasEnCarpeta.push(`❌ Archivos faltantes: ${tiposFaltantes.join(', ')}`);
    }

    // 4. Notificar tipos presentes que no fueron seleccionados (no se eliminan)
    if (archivosNoSolicitados.length > 0) {
      const lista = archivosNoSolicitados.map(a => `${a.tipo} (${a.archivo})`).join(', ');
      problemasEnCarpeta.push(`ℹ️ Archivos con prefijo válido no solicitados (no eliminados): ${lista}`);
    }

    const estado = problemasEnCarpeta.length === 0 ? 'VALIDO' : 'ERROR';

    resultados[nombreCarpeta] = {
      archivosValidos,
      archivosNoSolicitados,
      tiposEncontrados: tiposUnicos,
      tiposFaltantes,
      wapisEncontrados: wapisUnicos,
      problemas: problemasEnCarpeta,
      estado
    };
  }

  const totalCarpetas = Object.keys(resultados).length;
  const carpetasValidas = Object.values(resultados).filter(r => r.estado === 'VALIDO').length;

  return {
    resultados,
    archivosEliminados,
    resumen: {
      totalCarpetas,
      carpetasValidas,
      carpetasConError: totalCarpetas - carpetasValidas,
      totalEliminados: archivosEliminados.length
    }
  };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  validarAdmisiones,
  PREFIJOS_DISPONIBLES,
  getCarpetaMadreAdmisiones,
  setCarpetaMadreAdmisiones
};