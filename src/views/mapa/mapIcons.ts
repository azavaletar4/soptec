import L from 'leaflet';
import type { InfraElementoTipo, ClientStatus } from '@/types/domain';
import type { InfraElementoWithUrl } from '@/stores/infraElementos';

export const CLIENT_COLOR: Record<ClientStatus, string> = {
  active: '#22c55e',
  suspended: '#ef4444',
  prospect: '#f59e0b',
  retired: '#64748b',
};

export const INFRA_STYLE: Record<InfraElementoTipo, { color: string; shape: 'square' | 'diamond' | 'mufa' | 'nap' | 'circle' | 'pentagon' }> = {
  caja_nap: { color: '#e2e8f0', shape: 'nap' },
  splitter: { color: '#8b5cf6', shape: 'diamond' },
  manga: { color: '#1e293b', shape: 'mufa' },
  armario: { color: '#64748b', shape: 'square' },
  poste: { color: '#92400e', shape: 'circle' },
  camara: { color: '#dc2626', shape: 'circle' },
  otro: { color: '#6366f1', shape: 'pentagon' },
};

export const INFRA_LABEL: Record<InfraElementoTipo, string> = {
  caja_nap: 'Caja NAP',
  splitter: 'Splitter',
  manga: 'Mufa',
  armario: 'Armario',
  poste: 'Poste',
  camara: 'Cámara',
  otro: 'Otro',
};

export const INACTIVE_COLOR = '#9ca3af';

export const OLT_GLYPH =
  '<rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/><circle cx="7" cy="7" r="0.5" fill="white"/><circle cx="7" cy="17" r="0.5" fill="white"/>';
export const MIKROTIK_GLYPH = '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>';

/** Icono "gota" (teardrop) para equipos activos, estilo SmartOLT. */
export function teardropIcon(color: string, glyphPath: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;background:${color};border:2px solid #0f172a;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.4)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" style="transform:rotate(45deg)">${glyphPath}</svg>
    </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30],
  });
}

/** Icono de la mufa: domo con nervaduras y puertos de cable abajo. */
function mufaIconHtml(color: string) {
  return `<svg width="16" height="22" viewBox="0 0 16 22">
    <path d="M4 2 Q4 0 8 0 Q12 0 12 2 L12 15 Q12 16.5 8 16.5 Q4 16.5 4 15 Z" fill="${color}" stroke="#0f172a" stroke-width="1"/>
    <line x1="4" y1="4.5" x2="12" y2="4.5" stroke="#0f172a" stroke-width="0.6" opacity="0.6"/>
    <line x1="4" y1="7.5" x2="12" y2="7.5" stroke="#0f172a" stroke-width="0.6" opacity="0.6"/>
    <line x1="4" y1="10.5" x2="12" y2="10.5" stroke="#0f172a" stroke-width="0.6" opacity="0.6"/>
    <line x1="4" y1="13.5" x2="12" y2="13.5" stroke="#0f172a" stroke-width="0.6" opacity="0.6"/>
    <ellipse cx="8" cy="16.5" rx="4" ry="1.5" fill="${color}" stroke="#0f172a" stroke-width="1"/>
    <rect x="5.5" y="17" width="1.8" height="4" rx="0.8" fill="${color}" stroke="#0f172a" stroke-width="0.8"/>
    <rect x="8.7" y="17" width="1.8" height="4" rx="0.8" fill="${color}" stroke="#0f172a" stroke-width="0.8"/>
  </svg>`;
}

/** Icono de la caja NAP: caja rectangular clara con pestillo y puertos de cable. */
function napIconHtml(color: string) {
  return `<svg width="20" height="20" viewBox="0 0 20 20">
    <rect x="2" y="1.5" width="16" height="13" rx="2" fill="${color}" stroke="#0f172a" stroke-width="1"/>
    <circle cx="10" cy="8" r="1" fill="#0f172a" opacity="0.7"/>
    <rect x="0.5" y="6" width="1.5" height="3" rx="0.5" fill="#0f172a" opacity="0.8"/>
    <rect x="18" y="6" width="1.5" height="3" rx="0.5" fill="#0f172a" opacity="0.8"/>
    ${[3, 5.5, 8, 10.5, 13, 15.5].map((x) => `<rect x="${x}" y="13.5" width="1.6" height="4.5" rx="0.7" fill="#0f172a"/>`).join('')}
  </svg>`;
}

export function infraIcon(el: InfraElementoWithUrl) {
  const color = el.is_active ? INFRA_STYLE[el.tipo].color : INACTIVE_COLOR;
  const shape = INFRA_STYLE[el.tipo].shape;

  if (shape === 'nap') {
    return L.divIcon({
      className: '',
      html: `<div style="filter:drop-shadow(0 1px 3px rgba(0,0,0,0.5))">${napIconHtml(color)}</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 18],
    });
  }

  if (shape === 'mufa') {
    return L.divIcon({
      className: '',
      html: `<div style="filter:drop-shadow(0 1px 3px rgba(0,0,0,0.5))">${mufaIconHtml(color)}</div>`,
      iconSize: [16, 22],
      iconAnchor: [8, 21],
    });
  }

  const base = 'width:18px;height:18px;border:2px solid #0f172a;box-shadow:0 1px 4px rgba(0,0,0,0.4);';
  const shapeCss: Record<Exclude<typeof shape, 'mufa' | 'nap'>, string> = {
    square: `${base}background:${color};border-radius:3px;`,
    diamond: `${base}background:${color};transform:rotate(45deg);`,
    circle: `${base}background:${color};border-radius:50%;`,
    pentagon: `${base}background:${color};clip-path:polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%);`,
  };
  return L.divIcon({
    className: '',
    html: `<div style="${shapeCss[shape as Exclude<typeof shape, 'mufa' | 'nap'>]}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

export function permanentLabel(text: string, sub: string) {
  return `<div style="font-size:11px"><b>${text}</b><br/><span style="color:#64748b">${sub}</span></div>`;
}
