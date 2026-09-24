import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Le rendu vit dans src/renderer et se construit vers dist/, charge par
// Electron avec loadFile : les chemins doivent donc etre relatifs.
export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  // host explicite : sans lui Vite tente aussi ::1, refuse sur certaines
  // configurations Windows (plages de ports reservees par Hyper-V).
  server: { host: '127.0.0.1', port: 5500, strictPort: true },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true
  }
});
