// Compartido entre server/src/routes/olt.ts, server/src/routes/dashboard.ts y
// server/src/services/oltSyncService.ts — vive aparte para que el servicio de
// sync no tenga que importar de routes/olt.ts (evita el ciclo
// routes/olt.ts -> services/oltSyncService.ts -> routes/olt.ts).

export interface OltDeviceRow {
  id: string;
  name: string;
  host: string;
  telnet_port: number;
  username: string;
  password: string;
  brand: string;
}

// La OLT ZTE C300 solo tiene Telnet habilitado (SSH resetea la conexion,
// confirmado manualmente). Ver server/src/telnet/client.ts.
export function telnetTargetFor(device: OltDeviceRow) {
  return { host: device.host, port: device.telnet_port, username: device.username, password: device.password };
}
