export function requireWorkOrderPoints(value: unknown, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(integer ? 'Ingresa puntos enteros mayores a 0.' : 'Ingresa puntos mayores a 0.');
  }
  return value;
}

export function pointsAreEditable(status: string): boolean {
  return ['open', 'pending', 'scheduled', 'assigned', 'in_progress', 'rescheduled'].includes(status);
}
