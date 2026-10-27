// Interfaz de gestión TR-069 INDEPENDIENTE por OMCI para ONT-router (ej.
// Huawei GPT-2741GNAC) — primera preparación de este método en SmartRayco
// (2026-10-27), siguiendo exactamente el patrón de 6 Huawei GPT-2741GNAC
// reales ya configuradas en esta OLT (ver docs/TR069-GESTION-INDEPENDIENTE-HUAWEI.md).
// Lógica pura y testeable, separada de server/src/routes/olt.ts — igual
// criterio que tr069Enable.ts (verifyLivePosition) y oltDisabledReason.ts.
import {
  configureTr069ManagementWanCommands,
  removeTr069ManagementWanCommands,
  type Tr069ManagementWanParams,
  type Tr069ManagementWanPresence,
} from '../ssh/zteCommands';

/** Valores LOCALES por ONU que las 6 referencias reales usan, identicos entre si — nunca hay que coordinarlos globalmente. */
export const TR069_MANAGEMENT_WAN_DEFAULTS = {
  tcontId: 2,
  gemportId: 2,
  vportId: 2,
  iphostId: 2,
  veipId: 1,
  veipPort: 1232,
  priority: 2,
  managementMask: '255.255.255.0',
  primaryDns: '8.8.8.8',
  secondaryDns: '8.8.4.4',
  // Perfiles YA existentes en la OLT (reutilizados, nunca creados de nuevo) — mismo nombre que las 6 referencias.
  tcontProfile: 'SMARTOLT-VOIPMNG-10M',
  trafficProfile: 'SMARTOLT-VOIPMNG-10M',
} as const;

export type Tr069ManagementWanRejection =
  | 'POSITION_MISMATCH'
  | 'IP_ALREADY_USED'
  | 'ACS_CONFLICT'
  | 'ALREADY_FULLY_CONFIGURED';

export interface Tr069ManagementWanPlanInput {
  expectedSerial: string;
  liveSerial: string | null;
  candidateManagementIp: string;
  takenManagementIps: readonly string[];
  /** Texto crudo ya leído de `interface gpon-onu_S/L/P:ID` (extractOnuInterfaceBlock), o null si no existe. */
  interfaceBlock: string | null;
  /** Texto crudo ya leído de `pon-onu-mng gpon-onu_S/L/P:ID` (extractPonOnuMngBlock), o null si no existe. */
  mngBlock: string | null;
  acsUrl: string;
  managementVlan: number;
  gateway: string;
  params: Omit<Tr069ManagementWanParams, 'managementIp' | 'managementMask' | 'primaryDns' | 'secondaryDns' | 'acsUrl' | 'managementVlan' | 'gateway' | 'tcontProfile' | 'trafficProfile' | 'tcontId' | 'gemportId' | 'vportId' | 'iphostId' | 'veipId' | 'veipPort' | 'priority'>;
}

export type Tr069ManagementWanPlanResult =
  | { ok: false; rejection: Tr069ManagementWanRejection; message: string }
  | {
      ok: true;
      params: Tr069ManagementWanParams;
      presence: Tr069ManagementWanPresence;
      commands: string[];
      rollbackCommands: string[];
    };

const REJECTION_MESSAGES: Record<Tr069ManagementWanRejection, string> = {
  POSITION_MISMATCH: 'El serial en vivo de esta posición no coincide con el esperado. Deteniendo por seguridad — regla 8 de la migración OLT.',
  IP_ALREADY_USED: 'La IP de gestión candidata ya está asignada a otra ONT. Elegí otra y volvé a comprobar disponibilidad.',
  ACS_CONFLICT: 'Esta ONU ya tiene un ACS TR-069 distinto configurado. Revisar manualmente antes de continuar — no se sobrescribe automáticamente.',
  ALREADY_FULLY_CONFIGURED: 'Esta ONU ya tiene la interfaz de gestión TR-069 completa configurada. No hay nada nuevo que aplicar.',
};

function detectPresence(input: Tr069ManagementWanPlanInput, p: Tr069ManagementWanParams): Tr069ManagementWanPresence {
  const iface = input.interfaceBlock ?? '';
  const mng = input.mngBlock ?? '';
  const existingAcs = mng.match(/tr069-mgmt\s+\d+\s+acs\s+(\S+)/)?.[1] ?? null;
  return {
    interfaceBlock: new RegExp(`tcont\\s+${p.tcontId}\\s+profile`).test(iface) && new RegExp(`gemport\\s+${p.gemportId}\\s+tcont`).test(iface) && new RegExp(`service-port\\s+${p.vportId}\\b`).test(iface),
    serviceMgmt: new RegExp(`service\\s+mgmt\\s+gemport\\s+${p.gemportId}\\s+iphost\\s+${p.iphostId}\\s+vlan\\s+${p.managementVlan}\\b`).test(mng),
    switchportBind: new RegExp(`switchport-bind\\s+switch_0/1\\s+veip\\s+${p.veipId}\\b`).test(mng),
    ipHostAddress: new RegExp(`ip-host\\s+${p.iphostId}\\s+ip\\s+${p.managementIp}\\b`).test(mng),
    ipHostDns: new RegExp(`ip-host\\s+${p.iphostId}\\s+primary-dns\\b`).test(mng),
    veipPortBinding: new RegExp(`veip\\s+${p.veipId}\\s+port\\s+udp\\s+${p.veipPort}\\s+host\\s+${p.iphostId}\\b`).test(mng),
    tr069State: /tr069-mgmt\s+\d+\s+state\s+unlock/.test(mng),
    tr069Acs: existingAcs === p.acsUrl,
    tr069Tag: new RegExp(`tr069-mgmt\\s+${p.veipId}\\s+tag\\s+pri\\s+${p.priority}\\s+vlan\\s+${p.managementVlan}\\b`).test(mng),
  };
}

export function planTr069ManagementWan(input: Tr069ManagementWanPlanInput): Tr069ManagementWanPlanResult {
  const reject = (rejection: Tr069ManagementWanRejection): Tr069ManagementWanPlanResult => ({
    ok: false,
    rejection,
    message: REJECTION_MESSAGES[rejection],
  });

  if (!input.liveSerial || input.liveSerial.trim().toUpperCase() !== input.expectedSerial.trim().toUpperCase()) {
    return reject('POSITION_MISMATCH');
  }

  const params: Tr069ManagementWanParams = {
    ...input.params,
    managementVlan: input.managementVlan,
    managementIp: input.candidateManagementIp,
    managementMask: TR069_MANAGEMENT_WAN_DEFAULTS.managementMask,
    gateway: input.gateway,
    primaryDns: TR069_MANAGEMENT_WAN_DEFAULTS.primaryDns,
    secondaryDns: TR069_MANAGEMENT_WAN_DEFAULTS.secondaryDns,
    acsUrl: input.acsUrl,
    tcontProfile: TR069_MANAGEMENT_WAN_DEFAULTS.tcontProfile,
    trafficProfile: TR069_MANAGEMENT_WAN_DEFAULTS.trafficProfile,
    tcontId: TR069_MANAGEMENT_WAN_DEFAULTS.tcontId,
    gemportId: TR069_MANAGEMENT_WAN_DEFAULTS.gemportId,
    vportId: TR069_MANAGEMENT_WAN_DEFAULTS.vportId,
    iphostId: TR069_MANAGEMENT_WAN_DEFAULTS.iphostId,
    veipId: TR069_MANAGEMENT_WAN_DEFAULTS.veipId,
    veipPort: TR069_MANAGEMENT_WAN_DEFAULTS.veipPort,
    priority: TR069_MANAGEMENT_WAN_DEFAULTS.priority,
  };

  const mng = input.mngBlock ?? '';
  const existingAcs = mng.match(/tr069-mgmt\s+\d+\s+acs\s+(\S+)/)?.[1] ?? null;
  if (existingAcs && existingAcs !== params.acsUrl) return reject('ACS_CONFLICT');

  const presence = detectPresence(input, params);
  // Una IP ya "tomada" solo es un conflicto real si NO es la que esta MISMA
  // ONU ya tiene asignada (reasignarse a si misma la propia IP no es un
  // duplicado) — por eso se revisa despues de calcular presence, no antes.
  if (!presence.ipHostAddress && input.takenManagementIps.includes(input.candidateManagementIp)) {
    return reject('IP_ALREADY_USED');
  }
  if (Object.values(presence).every(Boolean)) return reject('ALREADY_FULLY_CONFIGURED');

  return {
    ok: true,
    params,
    presence,
    commands: configureTr069ManagementWanCommands(params, presence),
    // El rollback deshace exactamente lo que ESTA operacion agregaria de nuevo
    // (nunca lo que ya existia antes) — "applied" = lo contrario de "presence".
    rollbackCommands: removeTr069ManagementWanCommands(params, {
      interfaceBlock: !presence.interfaceBlock,
      serviceMgmt: !presence.serviceMgmt,
      switchportBind: !presence.switchportBind,
      ipHostAddress: !presence.ipHostAddress,
      ipHostDns: !presence.ipHostDns,
      veipPortBinding: !presence.veipPortBinding,
      tr069State: !presence.tr069State,
      tr069Acs: !presence.tr069Acs,
      tr069Tag: !presence.tr069Tag,
    }),
  };
}
