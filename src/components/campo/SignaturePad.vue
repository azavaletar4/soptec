<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

withDefaults(defineProps<{ required?: boolean; invalid?: boolean }>(), { required: false, invalid: false });
const emit = defineEmits<{ change: [blob: Blob | null] }>();

const canvasEl = ref<HTMLCanvasElement | null>(null);
const hasStroke = ref(false);
let ctx: CanvasRenderingContext2D | null = null;
let drawing = false;

function applyStrokeStyle() {
  if (!ctx) return;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0f172a';
}

function resizeCanvas() {
  const canvas = canvasEl.value;
  if (!canvas) return;
  // Cambiar canvas.width/height borra el lienzo aunque el tamaño en pantalla
  // no cambie realmente — si ya habia una firma (ej. el celular roto por
  // orientationchange a mitad de firmar), se guarda como imagen para
  // volver a dibujarla despues de redimensionar, en vez de perderla.
  const previousImage = hasStroke.value ? canvas.toDataURL('image/png') : null;

  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(ratio, ratio);
  applyStrokeStyle();

  if (previousImage) {
    const img = new Image();
    img.onload = () => ctx?.drawImage(img, 0, 0, rect.width, rect.height);
    img.src = previousImage;
  }
}

function pointFromEvent(e: PointerEvent) {
  const canvas = canvasEl.value!;
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onPointerDown(e: PointerEvent) {
  if (!ctx) return;
  drawing = true;
  const { x, y } = pointFromEvent(e);
  ctx.beginPath();
  ctx.moveTo(x, y);
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (!drawing || !ctx) return;
  const { x, y } = pointFromEvent(e);
  ctx.lineTo(x, y);
  ctx.stroke();
  hasStroke.value = true;
}

function onPointerUp() {
  if (!drawing) return;
  drawing = false;
  emitBlob();
}

function emitBlob() {
  const canvas = canvasEl.value;
  if (!canvas || !hasStroke.value) {
    emit('change', null);
    return;
  }
  canvas.toBlob((blob) => emit('change', blob), 'image/png');
}

function clear() {
  const canvas = canvasEl.value;
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  hasStroke.value = false;
  emit('change', null);
}

function scrollIntoView() {
  canvasEl.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Restaura una firma guardada (borrador local, Fase 116) dibujandola sobre
// el lienzo — no hay forma de "reproducir" los trazos originales, asi que
// se pinta como imagen fija; igual sirve de prueba visual y el tecnico
// puede "Borrar" y volver a firmar si lo necesita.
async function loadImage(blob: Blob) {
  const canvas = canvasEl.value;
  if (!canvas || !ctx) return;
  const rect = canvas.getBoundingClientRect();
  const url = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        ctx?.drawImage(img, 0, 0, rect.width, rect.height);
        resolve();
      };
      img.onerror = () => reject(new Error('No se pudo cargar la firma guardada'));
      img.src = url;
    });
    hasStroke.value = true;
  } finally {
    URL.revokeObjectURL(url);
  }
}

defineExpose({ clear, scrollIntoView, loadImage });

onMounted(() => {
  resizeCanvas();
  // Girar el celular a mitad de firmar (o cualquier resize del contenedor)
  // cambia el tamaño real del <canvas> — sin esto, el trazo quedaba
  // desalineado con el nuevo tamaño o directamente se perdia.
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', resizeCanvas);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeCanvas);
  window.removeEventListener('orientationchange', resizeCanvas);
});
</script>

<template>
  <div>
    <canvas
      ref="canvasEl"
      class="w-full h-40 rounded-lg border-2 border-dashed bg-slate-50 touch-none"
      :class="invalid ? 'border-red-400' : 'border-slate-300'"
      :aria-required="required"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
      @pointercancel="onPointerUp"
    ></canvas>
    <div class="flex items-center justify-between mt-1.5">
      <p class="text-[11px] text-slate-500">Firma del cliente confirmando conformidad</p>
      <button type="button" class="text-xs text-sky-700 hover:text-sky-700" @click="clear">Borrar</button>
    </div>
  </div>
</template>
