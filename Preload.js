const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Navegación — reemplaza los <a href> entre páginas
  navegar: (archivo) => ipcRenderer.invoke('navegar', archivo),

  // Verificar si PDFtk está instalado
  verificarPDFtk: () => ipcRenderer.invoke('verificar-pdftk'),

  // Procesar la división del PDF
  procesarDivisionPDF: (datos) => ipcRenderer.invoke('procesar-division-pdf', datos),

  // Guardar archivos PDF temporales en disco
  guardarTemporal: (nombre, buffer) => ipcRenderer.invoke('guardar-temporal', { nombre, buffer }),

  // Limpiar temporales
  limpiarTemporales: () => ipcRenderer.invoke('limpiar-temporales'),

  // Validar carpeta de admisiones
  validarAdmisiones: (datos) => ipcRenderer.invoke('validar-admisiones', datos),

  // Carpeta madre genérica (para dividir PDF o admisiones)
  getCarpetaMadre: (tipo) => {
    if (tipo === 'admisiones') return ipcRenderer.invoke('get-carpeta-madre-admisiones');
    if (tipo === 'pdf') return ipcRenderer.invoke('get-carpeta-madre-pdf');
    return null;
  },
  setCarpetaMadre: (tipo, ruta) => {
    if (tipo === 'admisiones') return ipcRenderer.invoke('set-carpeta-madre-admisiones', ruta);
    if (tipo === 'pdf') return ipcRenderer.invoke('set-carpeta-madre-pdf', ruta);
    return null;
  },
  seleccionarCarpetaMadre: async (tipo) => {
    const ruta = await ipcRenderer.invoke('seleccionar-carpeta-madre');
    if (ruta) await (tipo === 'admisiones'
      ? ipcRenderer.invoke('set-carpeta-madre-admisiones', ruta)
      : ipcRenderer.invoke('set-carpeta-madre-pdf', ruta));
    return ruta;
  },
});