import type { NetworkBasemap } from './mapBasemaps';

export interface GoogleTilesConfiguration { key: string; authorized: string }
export interface GoogleTileSession { session: string; expiry: number }
export interface GoogleViewport { north: number; south: number; east: number; west: number; zoom: number }
export interface GoogleViewportInfo {
  copyright: string;
  maxZoomRects: { north: number; south: number; east: number; west: number; maxZoom: number }[];
}
export const GOOGLE_TILES_ORIGIN = 'https://tile.googleapis.com';

export function googleTilesEnabled(config: GoogleTilesConfiguration): boolean {
  return /^[A-Za-z0-9_-]+$/.test(config.key) && config.authorized === 'true';
}

export function googleSessionOptions(mode: NetworkBasemap) {
  if (!['streets', 'satellite', 'hybrid'].includes(mode)) throw new Error('Vista de Google Maps inválida.');
  return {
    mapType: mode === 'streets' ? 'roadmap' : 'satellite',
    language: 'es-419', region: 'PE', imageFormat: 'png',
    scale: 'scaleFactor1x', highDpi: false,
    ...(mode === 'hybrid' ? { layerTypes: ['layerRoadmap'], overlay: false } : {}),
  };
}

export function normalizeGoogleViewport(view: GoogleViewport): GoogleViewport {
  if (!Object.values(view).every(Number.isFinite)) throw new Error('Vista geográfica inválida.');
  const wrap = (n: number) => n >= -180 && n <= 180 ? n : Number(((((n + 180) % 360 + 360) % 360) - 180).toFixed(12));
  const global = view.east - view.west >= 360;
  return {
    north: Math.max(-85.05112878, Math.min(85.05112878, view.north)),
    south: Math.max(-85.05112878, Math.min(85.05112878, view.south)),
    west: global ? -180 : wrap(view.west), east: global ? 180 : wrap(view.east),
    zoom: Math.max(0, Math.min(22, Math.round(view.zoom))),
  };
}

export function googleNativeZoom(info: GoogleViewportInfo, view: GoogleViewport): number {
  const west = view.west, east = view.east;
  const center = west <= east ? (west + east) / 2 : ((west + east + 360) / 2 + 180) % 360 - 180;
  const samples = [[view.north, west], [view.north, east], [view.south, west], [view.south, east], [(view.north + view.south) / 2, center]];
  const maxima = samples.map(([lat, lng]) => Math.max(-1, ...info.maxZoomRects.filter(r =>
    lat <= r.north && lat >= r.south && (r.west <= r.east ? lng >= r.west && lng <= r.east : lng >= r.west || lng <= r.east),
  ).map(r => r.maxZoom)));
  if (maxima.some(n => n < 0)) throw new Error('No hay cobertura declarada para esta vista.');
  return Math.min(22, ...maxima);
}

/** Official 2D Map Tiles API only. No JS API scraping, persistent cache or data writes. */
export class GoogleMapTilesClient {
  private readonly sessions = new Map<NetworkBasemap, GoogleTileSession>();
  constructor(private readonly config: GoogleTilesConfiguration, private readonly transport: typeof fetch = fetch, private readonly clock = Date.now) {}

  private checkAuthorization() {
    if (!googleTilesEnabled(this.config)) throw new Error('Google Maps requiere una clave y autorización explícita del servicio.');
  }

  private async json(url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    const control = new AbortController();
    const abort = () => control.abort();
    if (signal.aborted) control.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 10000);
    try {
      const response = await this.transport(url, { ...init, signal: control.signal, credentials: 'omit' });
      if (!response.ok) throw new Error('GOOGLE_RESPONSE');
      const result: unknown = await response.json();
      if (control.signal.aborted) throw new Error('GOOGLE_ABORTED');
      return result;
    } catch {
      if (signal.aborted) throw new DOMException('Operación cancelada', 'AbortError');
      // Never propagate API error bodies or URLs containing the key/session.
      throw new Error('No se pudo validar Google Maps. Revisa acceso, cuota y conexión.');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }

  async session(mode: NetworkBasemap, signal: AbortSignal): Promise<GoogleTileSession> {
    this.checkAuthorization();
    if (signal.aborted) throw new DOMException('Operación cancelada', 'AbortError');
    const cached = this.sessions.get(mode);
    if (cached && cached.expiry * 1000 > this.clock() + 60000) return cached;
    const raw = await this.json(`${GOOGLE_TILES_ORIGIN}/v1/createSession?key=${encodeURIComponent(this.config.key)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(googleSessionOptions(mode)) }, signal) as Partial<GoogleTileSession> & { tileWidth?: number; tileHeight?: number };
    if (!raw || typeof raw !== 'object') throw new Error('Sesión de Google Maps inválida.');
    const expiry = Number(raw.expiry);
    if (typeof raw.session !== 'string' || !raw.session.trim() || /[\r\n]/.test(raw.session) || raw.session.length > 4096 || !Number.isFinite(expiry)
      || expiry * 1000 <= this.clock() + 60000 || raw.tileWidth !== 256 || raw.tileHeight !== 256) throw new Error('Sesión de Google Maps inválida.');
    const result = { session: raw.session, expiry };
    this.sessions.set(mode, result);
    return result;
  }

  async viewport(session: GoogleTileSession, view: GoogleViewport, signal: AbortSignal): Promise<GoogleViewportInfo> {
    this.checkAuthorization();
    const normalized = normalizeGoogleViewport(view);
    const query = new URLSearchParams({ session: session.session, key: this.config.key, ...Object.fromEntries(Object.entries(normalized).map(([k, v]) => [k, String(v)])) });
    const info = await this.json(`${GOOGLE_TILES_ORIGIN}/tile/v1/viewport?${query}`, {}, signal) as GoogleViewportInfo;
    if (!info || typeof info.copyright !== 'string' || !info.copyright.trim() || !Array.isArray(info.maxZoomRects)
      || !info.maxZoomRects.length || info.maxZoomRects.some(r => !r || ![r.north, r.south, r.east, r.west, r.maxZoom].every(Number.isFinite)
        || !Number.isInteger(r.maxZoom) || r.maxZoom < 0 || r.maxZoom > 22)) throw new Error('Google Maps no devolvió atribución y cobertura válidas.');
    return info;
  }

  tileTemplate(session: GoogleTileSession): string {
    this.checkAuthorization();
    return `${GOOGLE_TILES_ORIGIN}/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(session.session)}&key=${encodeURIComponent(this.config.key)}`;
  }

  clear() { this.sessions.clear(); }
}
