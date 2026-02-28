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

//*********************************** */
//Rutas de configuración para guardar la carpeta madre seleccionada por el usuario
//*********************************** */ 
const CONFIG_DIR = path.join
(
  process.env.APPDATA || os.homedir(),
  'DivisorPDF'
);

//lcturaa de la ruta selecionada por el usuario
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');


/********************** */
//FuNCION: Lecura de ruta
//********************* */
function leerConfig() 
{
  try 
  {
    if (fs.existsSync(CONFIG_PATH)) 
    {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } 
  catch 
  {
    
  }
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
    // 1. Producción: extraResources copia vendor/ a resources/vendor/
    path.join(process.resourcesPath || '', 'vendor', 'pdftk.exe'),
    // 2. Desarrollo: vendor/ en raíz del proyecto (este archivo está en src/)
    path.join(__dirname, '..', 'vendor', 'pdftk.exe'),
    path.join(__dirname, 'vendor', 'pdftk.exe'),
    // 3. Fallback: instalación del sistema
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

  // Agrupar por tipo
  const tiposDocumentos = {};
  asignaciones.forEach(p => {
    if (!tiposDocumentos[p.tipo]) tiposDocumentos[p.tipo] = [];
    tiposDocumentos[p.tipo].push(p);
  });

  const resultados = [];

  for (const [tipo, paginas] of Object.entries(tiposDocumentos)) {
    const nombreArchivo = `${tipo}_${NIT}_${numeroAdmision}.pdf`;
    const outputPath = path.join(carpetaAdmision, nombreArchivo);

    const paginasPorPDF = {};
    paginas.forEach(p => {
      if (!paginasPorPDF[p.pdfIndex]) paginasPorPDF[p.pdfIndex] = [];
      paginasPorPDF[p.pdfIndex].push(p.pagina);
    });

    try {
      if (Object.keys(paginasPorPDF).length === 1) {
        const pdfIndex = Object.keys(paginasPorPDF)[0];
        await dividirPDF(pdfFiles[pdfIndex], paginasPorPDF[pdfIndex], outputPath);
      } else {
        // Múltiples orígenes: temp en os.tmpdir() que siempre es escribible
        const tempDir = path.join(os.tmpdir(), `divisor_merge_${Date.now()}`);
        asegurarDirectorio(tempDir);
        const archivosTemp = [];
        for (const [pdfIndex, paginasArr] of Object.entries(paginasPorPDF)) {
          const tempFile = path.join(tempDir, `temp_${pdfIndex}.pdf`);
          await dividirPDF(pdfFiles[pdfIndex], paginasArr, tempFile);
          archivosTemp.push(tempFile);
        }
        await combinarPDFs(archivosTemp, outputPath);
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
      }
      resultados.push({ tipo, archivo: nombreArchivo, error: null });
    } catch (err) {
      console.error(`[ERROR] Tipo ${tipo}:`, err.message);
      resultados.push({ tipo, archivo: nombreArchivo, error: err.message });
    }
  }

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