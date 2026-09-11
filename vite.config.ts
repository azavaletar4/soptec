import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// El proxy /api toma el puerto de Hono desde la misma variable PORT del
// .env que usa server/src/index.ts, para que nunca queden desincronizados.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = env.PORT || '3001';

  return {
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      // host: true expone el dev server en la red local (no solo localhost),
      // asi un celular en la misma WiFi puede entrar por la IP de esta PC.
      host: true,
      // Necesario para el Cloudflare Quick Tunnel: Vite rechaza por defecto
      // cualquier Host que no sea localhost/la IP local (proteccion contra
      // DNS rebinding). Solo para pruebas externas temporales.
      allowedHosts: true,
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
