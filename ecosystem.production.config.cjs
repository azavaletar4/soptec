// PM2 — produccion (Fase 14). Un solo proceso: el backend Hono sirve la API
// y el frontend ya compilado (dist/), ver el bloque NODE_ENV==='production'
// en server/src/index.ts. El Cloudflare Tunnel apunta a este proceso
// (http://localhost:<PORT>).
//
// Uso:
//   npm run build                                  # genera dist/
//   pm2 start ecosystem.production.config.cjs
//   pm2 save                                        # persiste tras reinicio (con pm2-windows-startup)
//
// OJO Windows: "script: 'npx'" no funciona con PM2 (ver ecosystem.config.cjs) —
// se apunta directo al entry point de tsx con interpreter: 'node'.
module.exports = {
  apps: [
    {
      name: 'smartrayco',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'server/src/index.ts',
      interpreter: 'node',
      cwd: __dirname,
      // PORT distinto del de desarrollo (3000, ver .env) para que ambos
      // puedan correr al mismo tiempo en esta misma maquina sin chocar.
      env: { NODE_ENV: 'production', PORT: '4000' },
    },
    {
      // Cloudflare Tunnel — expone smartrayco (puerto 4000) en
      // https://panel.rayconetworks.com sin abrir puertos en el router.
      // Config: C:\Users\USER\.cloudflared\config.yml (tunnel id
      // 76dbb212-f0d8-4ad1-990c-6cce50fb3732).
      name: 'smartrayco-tunnel',
      script: 'cloudflared',
      args: 'tunnel run smartrayco-panel',
      cwd: __dirname,
    },
  ],
};
