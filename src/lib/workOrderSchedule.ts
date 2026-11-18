/** Programación de órdenes. Los timestamps se interpretan siempre en Perú. */
export const SCHEDULE_TIME_ZONE = 'America/Lima';
export interface ScheduleFields {
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  rescheduled_to?: string | null;
  status?: string;
}
export type ScheduleKind = 'ticket' | 'installation' | 'routine';
type SchedulePatch = Omit<ScheduleFields, 'status' | 'rescheduled_to'>;

export function limaDate(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHEDULE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(iso));
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function limaTime(iso: string): string {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: SCHEDULE_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso));
}
export function peruDateTimeToIso(date: string, time: string): string {
  return new Date(`${date}T${time.slice(0, 5)}:00-05:00`).toISOString();
}

export function scheduleTimestamps(kind: ScheduleKind, order: ScheduleFields) {
  // Cliente ausente tiene una cita posterior independiente del turno original.
  const rescheduled = kind === 'ticket' && order.status === 'rescheduled' && !!order.rescheduled_to;
  const start = rescheduled ? order.rescheduled_to : order.scheduled_start_at;
  const aligned = start && order.scheduled_start_at && new Date(start).getTime() === new Date(order.scheduled_start_at).getTime();
  const end = rescheduled && !aligned ? null : order.scheduled_end_at;
  return { start: start || null, end: end || null, rescheduled };
}
export function scheduleValues(kind: ScheduleKind, order: ScheduleFields) {
  const { start, end, rescheduled } = scheduleTimestamps(kind, order);
  return {
    date: start ? limaDate(start) : order.scheduled_date || '',
    time: start ? limaTime(start) : kind === 'installation' ? order.scheduled_time?.slice(0, 5) || '' : '',
    endTime: end ? limaTime(end) : '',
    endDate: end ? limaDate(end) : '',
    rescheduled,
  };
}
function displayDate(date: string): string {
  return new Date(`${date}T12:00:00-05:00`).toLocaleDateString('es-PE', {
    timeZone: SCHEDULE_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric',
  });
}
export function scheduleLabel(kind: ScheduleKind, order: ScheduleFields): string {
  const s = scheduleValues(kind, order);
  if (!s.date) return s.time ? `Sin fecha programada · ${s.time}` : 'Sin programación';
  const end = s.endTime
    ? `–${s.endDate !== s.date ? displayDate(s.endDate) + ' ' : ''}${s.endTime}` : '';
  return `${displayDate(s.date)} · ${s.time ? s.time + end : 'Sin horario programado'}`;
}

/** Solo campos de programación: nunca estados, asignaciones ni datos de cierre. */
export function schedulePatch(kind: ScheduleKind, date: string, time: string, endTime = '', endDate = date): SchedulePatch {
  if (time && !date) throw new Error('Selecciona la fecha programada.');
  if (endTime && !time) throw new Error('Selecciona la hora de inicio.');
  const start = date && time ? peruDateTimeToIso(date, time) : null;
  const end = date && endTime ? peruDateTimeToIso(endDate || date, endTime) : null;
  if (start && end && end <= start) throw new Error('La hora de fin debe ser después de la hora de inicio.');
  return {
    ...(kind !== 'ticket' ? { scheduled_date: date || null } : {}),
    ...(kind === 'installation' ? { scheduled_time: time || null } : {}),
    scheduled_start_at: start,
    scheduled_end_at: end,
  };
}

export const EXISTING_SCHEDULE = '__existing';
export function routineTurno(order: ScheduleFields): string {
  const s = scheduleValues('routine', order);
  // Mantener también rangos incompletos, personalizados o que cruzan medianoche.
  return s.time || s.endTime ? EXISTING_SCHEDULE : '';
}
export function routineSchedulePatch(order: ScheduleFields | null, date: string, turno: string): SchedulePatch {
  if (turno !== EXISTING_SCHEDULE) {
    const [start = '', end = ''] = turno.split('-');
    return schedulePatch('routine', date, start, end);
  }
  const s = scheduleValues('routine', order!);
  if (date === s.date) return {
    scheduled_date: date || null,
    scheduled_start_at: order!.scheduled_start_at ?? null,
    scheduled_end_at: order!.scheduled_end_at ?? null,
  };
  if (!date) return schedulePatch('routine', '', '');
  const delta = new Date(`${date}T00:00:00Z`).getTime() - new Date(`${s.date}T00:00:00Z`).getTime();
  const shift = (iso?: string | null) => iso ? new Date(new Date(iso).getTime() + delta).toISOString() : null;
  return { scheduled_date: date, scheduled_start_at: shift(order!.scheduled_start_at), scheduled_end_at: shift(order!.scheduled_end_at) };
}
