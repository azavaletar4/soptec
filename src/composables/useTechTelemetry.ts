import { onUnmounted, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { supabase } from '@/lib/supabase';

// Fase 115: autoreporte de bateria/GPS desde el dispositivo del tecnico —
// alimenta las tarjetas de "Tecnicos activos" en Operaciones de Hoy.
//
// OJO — esto es un reporte en PRIMER PLANO (la app/WebView tiene que estar
// abierta), no un servicio nativo en 2do plano: el panel es un sitio web
// (dentro de un WebView en el APK, ver mobile_app/) y MIUI ya mata el
// proceso cuando pasa a 2do plano (ver memoria del proyecto) — ningun
// codigo JS sobrevive eso. Un servicio nativo que si sobreviva requeriria
// plugins Flutter (geolocator/battery_plus + flutter_background_service) y
// el permiso de ubicacion en 2do plano de Android, que es un desarrollo
// nativo aparte, no algo que se resuelva desde este composable web.
//
// navigator.getBattery() esta deprecado/restringido en navegadores de
// escritorio modernos por fingerprinting, pero puede seguir disponible en
// el WebView de Android del APK — se detecta la funcion y si no esta (o
// falla), simplemente se manda null (el RPC conserva el ultimo valor
// conocido via coalesce, ver migracion Fase 115).
const PING_INTERVAL_MS = 4 * 60 * 1000; // dentro del rango 3-5 min pedido

async function readBatteryLevel(): Promise<number | null> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> };
  if (typeof nav.getBattery !== 'function') return null;
  try {
    const battery = await nav.getBattery();
    return Math.round(battery.level * 100);
  } catch {
    return null;
  }
}

function readPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  });
}

async function sendTelemetryPing() {
  const [batteryLevel, position] = await Promise.all([readBatteryLevel(), readPosition()]);
  await supabase.rpc('update_own_telemetry', {
    p_battery_level: batteryLevel,
    p_latitude: position?.coords.latitude ?? null,
    p_longitude: position?.coords.longitude ?? null,
  });
}

/** Montar UNA vez en App.vue (vive toda la sesion, no por vista) — arranca/para solo segun el rol logueado. */
export function useTechTelemetry() {
  const auth = useAuthStore();
  let timer: ReturnType<typeof setInterval> | null = null;

  function start() {
    if (timer) return;
    void sendTelemetryPing();
    timer = setInterval(() => void sendTelemetryPing(), PING_INTERVAL_MS);
  }
  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  watch(
    () => auth.role === 'TECNICO_RED' && !!auth.user,
    (active) => (active ? start() : stop()),
    { immediate: true },
  );

  onUnmounted(stop);
}
