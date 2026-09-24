<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import QrScanner from 'qr-scanner';
import QrScannerWorkerPath from 'qr-scanner/qr-scanner-worker.min.js?url';

QrScanner.WORKER_PATH = QrScannerWorkerPath;

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; scan: [value: string] }>();

const videoEl = ref<HTMLVideoElement | null>(null);
const error = ref<string | null>(null);
let scanner: QrScanner | null = null;

async function start() {
  error.value = null;
  if (!videoEl.value) return;

  // getUserMedia esta bloqueado por el navegador fuera de un contexto seguro
  // (HTTPS o localhost) — acceder por IP de red local en http:// (como en
  // pruebas de campo por WiFi) cae aqui, y NO es un permiso que el celular
  // pueda conceder: hace falta HTTPS. Se distingue de un permiso realmente
  // denegado para no mandar al tecnico a buscar un ajuste que no existe.
  if (!window.isSecureContext) {
    error.value =
      'El navegador bloquea la cámara en esta dirección porque no usa HTTPS. Escribe el serial manualmente por ahora.';
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    error.value = 'Este navegador no soporta acceso a la cámara.';
    return;
  }

  try {
    const hasCamera = await QrScanner.hasCamera();
    if (!hasCamera) {
      error.value = 'No se detectó ninguna cámara en este dispositivo.';
      return;
    }
    scanner = new QrScanner(videoEl.value, (result) => handleResult(result.data), {
      highlightScanRegion: true,
      highlightCodeOutline: true,
      preferredCamera: 'environment',
    });
    await scanner.start();
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotAllowedError') {
      error.value = 'Permiso de cámara denegado. Actívalo en los ajustes del navegador para este sitio e inténtalo de nuevo.';
    } else if (e instanceof DOMException && e.name === 'NotFoundError') {
      error.value = 'No se encontró una cámara disponible.';
    } else {
      error.value = e instanceof Error ? e.message : 'No se pudo acceder a la cámara';
    }
  }
}

function handleResult(value: string) {
  emit('scan', value);
  stop();
  emit('close');
}

function stop() {
  scanner?.stop();
  scanner?.destroy();
  scanner = null;
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      await new Promise((r) => setTimeout(r, 50)); // deja montar el <video> antes de pedir la camara
      await start();
    } else {
      stop();
    }
  },
);

onBeforeUnmount(stop);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[60] bg-slate-950 flex flex-col">
      <div class="flex items-center justify-between px-4 py-3 text-white">
        <h2 class="text-sm font-semibold">Escanear serial de la ONT</h2>
        <button class="p-2 rounded-lg hover:bg-white/10" @click="stop(); emit('close')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
          </svg>
        </button>
      </div>
      <div class="flex-1 relative overflow-hidden">
        <video ref="videoEl" class="w-full h-full object-cover"></video>
      </div>
      <div class="p-4 text-center">
        <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
        <p v-else class="text-xs text-white/70">Apunta al código QR o de barras de la ONT</p>
      </div>
    </div>
  </Teleport>
</template>
