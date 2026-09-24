<script setup lang="ts">
import { onMounted, ref } from 'vue';

const emit = defineEmits<{ change: [blob: Blob | null] }>();

const canvasEl = ref<HTMLCanvasElement | null>(null);
const hasStroke = ref(false);
let ctx: CanvasRenderingContext2D | null = null;
let drawing = false;

function resizeCanvas() {
  const canvas = canvasEl.value;
  if (!canvas) return;
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(ratio, ratio);
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0f172a';
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

defineExpose({ clear });

onMounted(resizeCanvas);
</script>

<template>
  <div>
    <canvas
      ref="canvasEl"
      class="w-full h-40 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 touch-none"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
    ></canvas>
    <div class="flex items-center justify-between mt-1.5">
      <p class="text-[11px] text-slate-500">Firma del cliente confirmando conformidad</p>
      <button type="button" class="text-xs text-sky-600 hover:text-sky-700" @click="clear">Borrar</button>
    </div>
  </div>
</template>
