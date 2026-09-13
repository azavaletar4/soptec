// PM2 — corre el frontend y backend de desarrollo como procesos de fondo
// independientes de la terminal (asi cerrar la ventana de CMD no los mata).
// Uso: pm2 start ecosystem.config.cjs
// Ver el README ("Fase 14") — esto es la version de desarrollo del mismo
// enfoque planeado para produccion.
//
// OJO: en Windows, "script: 'npx'" NO funciona con PM2 (intenta cargar
// npx.cmd como si fuera un modulo de Node y truena con SyntaxError) —
// por eso se apunta directo al entry point JS de cada herramienta, con
// interpreter: 'node' explicito.
//
// OJO 2: NO usar "tsx watch" (args con 'watch ...') bajo PM2 en Windows.
// tsx watch hace su propio fork interno para recargar al guardar, y ese
// fork anidado dentro del fork de PM2 (ProcessContainerFork) se cuelga
// antes de arrancar el servidor — PM2 lo marca "online" con un PID real,
// pero el proceso nunca hace bind del puerto ni imprime nada (visto en
// vivo el 2026-09-12, tras un reinicio de la maquina). Por eso aqui se usa
// tsx sin watch, igual que ecosystem.production.config.cjs: reiniciar con
// "pm2 restart smartrayco-api" despues de tocar el backend.
module.exports = {
  apps: [
    {
      name: 'smartrayco-web',
      script: 'node_modules/vite/bin/vite.js',
      interpreter: 'node',
      cwd: __dirname,
      env: { NODE_ENV: 'development' },
    },
    {
      name: 'smartrayco-api',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'server/src/index.ts',
      interpreter: 'node',
      cwd: __dirname,
      env: { NODE_ENV: 'development' },
    },
  ],
};
