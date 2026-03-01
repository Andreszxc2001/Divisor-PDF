const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const NIT = '900795851';

// ════════════════════════════════════════
// CONFIG PERSISTIDA EN APPDATA
// process.resourcesPath es de solo lectura
// APPDATA siempre es escribible en cualquier PC
// ════════════════════════════════════════
const CONFIG_DIR = path.join(
  process.env.APPDATA || os.homedir(),
  'DivisorPDF'
);
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

function leerConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch {}
  return {};
}

function guardarConfig(data) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function getCarpetaMadre() {
  return leerConfig().carpetaMadre || null;
}

function setCarpetaMadre(nuevaRuta) {
  const config = leerConfig();
  config.carpetaMadre = nuevaRuta;
  guardarConfig(config);
}

// ════════════════════════════════════════
// RUTA A PDFTK
// Orden: extraResources → vendor dev → sistema
// ════════════════════════════════════════
function encontrarPDFtk() {
  const posiblesRutas = [
    path.join(process.resourcesPath || '', 'vendor', 'pdftk.exe'),
    path.join(__dirname, '..', 'vendor', 'pdftk.exe'),
    path.join(__dirname, 'vendor', 'pdftk.exe'),
    'C:/PDFtk/bin/pdftk.exe',
    'C:/Program Files (x86)/PDFtk/bin/pdftk.exe',
    'C:/Program Files/PDFtk Server/bin/pdftk.exe',
    'C:/Program Files (x86)/PDFtk Server/bin/pdftk.exe'
  ];

  const encontrado = posiblesRutas.find(p => {
    try { return fs.existsSync(p); } catch { return false; }
  });

  if (!encontrado) {
    console.error('[PDFtk] No encontrado. Rutas buscadas:\n', posiblesRutas.join('\n'));
    return null;
  }
  console.log('[PDFtk] Usando:', encontrado);
  return encontrado;
}

function asegurarDirectorio(ruta) {
  if (!fs.existsSync(ruta)) fs.mkdirSync(ruta, { recursive: true });
}

// ════════════════════════════════════════
// DIVIDIR PDF
// ════════════════════════════════════════
function dividirPDF(pdfPath, paginas, outputPath) {
  return new Promise((resolve, reject) => {
    const pdftk = encontrarPDFtk();
    if (!pdftk) return reject(new Error('PDFtk no encontrado. Verifica la carpeta vendor/.'));

    const paginasParam = paginas.join(' ');
    const comando = `"${pdftk}" "${pdfPath}" cat ${paginasParam} output "${outputPath}"`;
    console.log('[PDFtk] Ejecutando:', comando);

    exec(comando, (error) => {
      if (error) return reject(error);
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        return reject(new Error('PDFtk no generó el archivo de salida'));
      }
      console.log('[PDFtk] Creado:', outputPath, `(${fs.statSync(outputPath).size} bytes)`);
      resolve(outputPath);
    });
  });
}

// ════════════════════════════════════════
// COMBINAR PDFs
// ════════════════════════════════════════
function combinarPDFs(archivosEntrada, outputPath) {
  return new Promise((resolve, reject) => {
    const pdftk = encontrarPDFtk();
    if (!pdftk) return reject(new Error('PDFtk no encontrado'));

    const inputFiles = archivosEntrada.map(f => `"${f}"`).join(' ');
    const comando = `"${pdftk}" ${inputFiles} cat output "${outputPath}"`;
    console.log('[PDFtk] Combinando:', comando);

    exec(comando, (error) => {
      archivosEntrada.forEach(f => { try { fs.unlinkSync(f); } catch {} });
      if (error) return reject(error);
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        return reject(new Error('No se pudo combinar los PDFs'));
      }
      resolve(outputPath);
    });
  });
}

// ════════════════════════════════════════
// PROCESAR DIVISIÓN GLOBAL
// ════════════════════════════════════════
async function procesarDivisionPDF({ pdfFiles, asignaciones, numeroAdmision, carpetaMadre }) {
  const carpetaBase = carpetaMadre || getCarpetaMadre();
  if (!carpetaBase) throw new Error('No se ha configurado la carpeta de destino.');

  const carpetaAdmision = path.join(carpetaBase, numeroAdmision);
  asegurarDirectorio(carpetaAdmision);

  const tiposDocumentos = {};
  asignaciones.forEach(p => {
    if (!tiposDocumentos[p.tipo]) tiposDocumentos[p.tipo] = [];
    tiposDocumentos[p.tipo].push(p);
  });

  const resultados = [];

  // ── FIX CARACTERES ESPECIALES ──────────────────────────
  // PDFtk falla si el outputPath tiene ñ, tildes, espacios
  // con encoding raro, etc. Solución: PDFtk escribe en una
  // ruta temporal 100% ASCII (os.tmpdir()) y luego Node
  // mueve el archivo al destino final — Node sí maneja
  // rutas con caracteres especiales sin problema.
  // ───────────────────────────────────────────────────────
  const SAFE_OUTPUT_DIR = path.join(os.tmpdir(), `divisor_output_${Date.now()}`);
  asegurarDirectorio(SAFE_OUTPUT_DIR);

  for (const [tipo, paginas] of Object.entries(tiposDocumentos)) {
    const nombreArchivo = `${tipo}_${NIT}_${numeroAdmision}.pdf`;
    const outputFinal = path.join(carpetaAdmision, nombreArchivo);
    // Ruta temporal sin caracteres especiales para PDFtk
    const outputTemp = path.join(SAFE_OUTPUT_DIR, `${tipo}_${numeroAdmision}.pdf`);

    const paginasPorPDF = {};
    paginas.forEach(p => {
      if (!paginasPorPDF[p.pdfIndex]) paginasPorPDF[p.pdfIndex] = [];
      paginasPorPDF[p.pdfIndex].push(p.pagina);
    });

    try {
      if (Object.keys(paginasPorPDF).length === 1) {
        const pdfIndex = Object.keys(paginasPorPDF)[0];
        await dividirPDF(pdfFiles[pdfIndex], paginasPorPDF[pdfIndex], outputTemp);
      } else {
        // Múltiples orígenes → extraer fragmentos y combinar
        const tempDir = path.join(os.tmpdir(), `divisor_merge_${Date.now()}`);
        asegurarDirectorio(tempDir);
        const archivosTemp = [];
        for (const [pdfIndex, paginasArr] of Object.entries(paginasPorPDF)) {
          const tempFile = path.join(tempDir, `temp_${pdfIndex}.pdf`);
          await dividirPDF(pdfFiles[pdfIndex], paginasArr, tempFile);
          archivosTemp.push(tempFile);
        }
        await combinarPDFs(archivosTemp, outputTemp);
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
      }

      // Mover de temp al destino final — Node maneja ñ y tildes sin problema
      fs.copyFileSync(outputTemp, outputFinal);
      fs.unlinkSync(outputTemp);

      resultados.push({ tipo, archivo: nombreArchivo, error: null });
    } catch (err) {
      console.error(`[ERROR] Tipo ${tipo}:`, err.message);
      resultados.push({ tipo, archivo: nombreArchivo, error: err.message });
    }
  }

  // Limpiar carpeta de output temporal
  try { fs.rmSync(SAFE_OUTPUT_DIR, { recursive: true, force: true }); } catch {}

  return {
    carpeta: carpetaAdmision,
    resultados,
    totalCreados: resultados.filter(r => !r.error).length
  };
}

function verificarPDFtk() {
  return encontrarPDFtk() !== null;
}

module.exports = {
  dividirPDF,
  combinarPDFs,
  procesarDivisionPDF,
  verificarPDFtk,
  encontrarPDFtk,
  getCarpetaMadre,
  setCarpetaMadre
};