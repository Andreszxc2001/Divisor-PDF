
# PDF Tools (Divisor PDF)

**Versión:** 1.0.0

Aplicación de escritorio para dividir PDFs y validar carpetas de admisiones, desarrollada con Electron.

## Características
- Divide archivos PDF en partes según prefijos (CRC, OPF, HAM, FEV, PDX, HEV, PDE).
- Valida carpetas de admisiones y elimina archivos inválidos.
- Interfaz moderna y fácil de usar.
- No requiere Node.js ni dependencias externas para el usuario final.

## Instalación y uso
1. Clona este repositorio:
   ```
   git clone https://github.com/Andreszxc2001/Divisor-PDF.git
   cd divisor-pdf
   ```
2. Instala dependencias:
   ```
   npm install
   ```
3. Ejecuta en modo desarrollo:
   ```
   npm start
   ```
4. Para empaquetar la app (Windows):
   ```
   npx electron-builder --win
   ```

## Estructura del proyecto
- `src/` — Lógica principal (dividir PDF, validar admisiones)
- `view/` — Archivos HTML de las pantallas
- `assets/` — CSS, imágenes, JS de frontend
- `vendor/` — Binarios como pdftk.exe

## Autor
Desarrollado por Arnaldo Pushaina
