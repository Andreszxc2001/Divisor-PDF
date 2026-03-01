const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_PATH = app.getAppPath();

const { verificarPDFtk, procesarDivisionPDF, getCarpetaMadre, setCarpetaMadre } =
  require(path.join(APP_PATH, 'src', 'dividir_pdf'));

const { validarAdmisiones, getCarpetaMadreAdmisiones, setCarpetaMadreAdmisiones } =
  require(path.join(APP_PATH, 'src', 'validar_admisiones'));

const TEMP_DIR = path.join(os.tmpdir(), 'divisor_pdf_temp');

const WIN_OPTIONS = {
  width: 1200,
  height: 800,
  webPreferences: {
    preload: path.join(APP_PATH, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false
  }
};

let mainWin = null;

function createWindow() {
  mainWin = new BrowserWindow(WIN_OPTIONS);
  mainWin.loadFile(path.join(APP_PATH, 'index.html'));
  // mainWin.webContents.openDevTools(); // descomentar para debug
  mainWin.on('closed', () => { mainWin = null; });
}

app.whenReady().then(() => {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  createWindow();
});

app.on('window-all-closed', () => {
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  if (process.platform !== 'darwin') app.quit();
});

// ════════════════════════════════════════
// IPC HANDLERS
// ════════════════════════════════════════

// 1. Navegación
ipcMain.handle('navegar', (event, archivo) => {
  if (mainWin) mainWin.loadFile(path.join(APP_PATH, archivo));
});

// 2. Verificar PDFtk
ipcMain.handle('verificar-pdftk', () => {
  return verificarPDFtk();
});

// 3. Guardar PDF temporal en disco
// FIX: normalizar nombre para eliminar ñ, tildes y caracteres especiales
// PDFtk falla si la ruta de entrada tiene caracteres no ASCII
ipcMain.handle('guardar-temporal', (event, { nombre, buffer }) => {
  try {
    const nombreNormalizado = nombre
      .normalize('NFD')                      // descomponer tildes: á → a + acento
      .replace(/[\u0300-\u036f]/g, '')       // eliminar diacríticos
      .replace(/[\u00f1\u00d1]/g, 'n')       // ñ/Ñ → n
      .replace(/[^a-zA-Z0-9._-]/g, '_');    // todo lo demás → _

    const rutaTemp = path.join(TEMP_DIR, `${Date.now()}_${nombreNormalizado}`);
    fs.writeFileSync(rutaTemp, Buffer.from(buffer));
    console.log('[TEMP] Guardado:', rutaTemp, `(${fs.statSync(rutaTemp).size} bytes)`);
    return { ok: true, ruta: rutaTemp };
  } catch (err) {
    console.error('[TEMP] Error:', err.message);
    return { ok: false, error: err.message };
  }
});

// 4. Procesar división de PDF
ipcMain.handle('procesar-division-pdf', async (event, { rutasPDFs, asignaciones, numeroAdmision }) => {
  try {
    const resultado = await procesarDivisionPDF({
      pdfFiles: rutasPDFs,
      asignaciones,
      numeroAdmision
    });
    return { ok: true, resultado };
  } catch (err) {
    console.error('[IPC] Error procesar-division-pdf:', err.message);
    return { ok: false, error: err.message };
  }
});

// 5. Limpiar temporales
ipcMain.handle('limpiar-temporales', () => {
  try {
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// 6. Validar admisiones
ipcMain.handle('validar-admisiones', (event, { rutaLocal, tiposSeleccionados }) => {
  try {
    const resultado = validarAdmisiones(rutaLocal, tiposSeleccionados);
    return { ok: true, resultado };
  } catch (err) {
    console.error('[IPC] Error validar-admisiones:', err.message);
    return { ok: false, error: err.message };
  }
});

// 7. Carpeta madre - PDF
ipcMain.handle('get-carpeta-madre-pdf', () => getCarpetaMadre());
ipcMain.handle('set-carpeta-madre-pdf', (event, nuevaRuta) => {
  setCarpetaMadre(nuevaRuta);
  return true;
});

// 8. Carpeta madre - Admisiones
ipcMain.handle('get-carpeta-madre-admisiones', () => getCarpetaMadreAdmisiones());
ipcMain.handle('set-carpeta-madre-admisiones', (event, nuevaRuta) => {
  setCarpetaMadreAdmisiones(nuevaRuta);
  return true;
});

// 9. Selector de carpeta nativo
ipcMain.handle('seleccionar-carpeta-madre', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (canceled || !filePaths[0]) return null;
  return filePaths[0];
});