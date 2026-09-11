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
      args: 'watch server/src/index.ts',
      interpreter: 'node',
      cwd: __dirname,
      env: { NODE_ENV: 'development' },
    },
  ],
};
