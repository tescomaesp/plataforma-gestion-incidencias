import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // En GitHub Pages la app vive en /<repositorio>/; en local o Netlify, en /.
  base: process.env.VITE_BASE || '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',            // las 9 tiendas reciben las actualizaciones solas
      includeAssets: ['logo-tescoma.png', 'icono-192.png'],
      manifest: {
        name: 'Tescoma · Incidencias de garantía',
        short_name: 'Incidencias',
        description: 'Gestión de incidencias de garantía entre tiendas y central',
        lang: 'es',
        theme_color: '#D40019',
        background_color: '#F5F7F8',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icono-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Los datos van siempre a Supabase en vivo: solo se guarda en caché la app.
      workbox: { runtimeCaching: [] },
    }),
  ],
});
