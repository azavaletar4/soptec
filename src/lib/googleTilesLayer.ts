import L from 'leaflet';
import logo from '@/assets/providers/google-maps-attribution.svg';
import { GoogleMapTilesClient, googleNativeZoom, normalizeGoogleViewport, type GoogleTilesConfiguration } from './googleMapTiles';
import type { NetworkBasemap } from './mapBasemaps';

/** One Leaflet basemap; network overlays/editor are never rebuilt. */
export class GoogleTilesLayer {
  private readonly client: GoogleMapTilesClient;
  private mode: NetworkBasemap = 'streets';
  private layer: L.TileLayer | null = null;
  private attribution: L.Control | null = null;
  private copyright: HTMLElement | null = null;
  private request: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private epoch = 0;
  private disposed = false;
  constructor(private readonly map: L.Map, config: GoogleTilesConfiguration, private readonly failure: (message: string) => void) {
    this.client = new GoogleMapTilesClient(config);
    map.on('movestart zoomstart', this.pause);
    map.on('moveend zoomend', this.schedule);
  }

  private pause = () => {
    // Do not display tiles for a new viewport under an old copyright.
    if (this.layer) this.layer.getContainer()?.style.setProperty('visibility', 'hidden');
  };
  private schedule = () => {
    this.request?.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.refresh(); }, 180);
  };
  async setMode(mode: NetworkBasemap) {
    this.mode = mode;
    this.epoch++;
    this.request?.abort();
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.removeImagery();
    await this.refresh();
  }

  private removeImagery() {
    this.layer?.remove();
    this.layer = null;
    this.attribution?.remove();
    this.attribution = null;
    this.copyright = null;
  }

  private showAttribution(text: string) {
    if (!this.attribution) {
      const control = new L.Control({ position: 'bottomleft' });
      control.onAdd = () => {
        const box = L.DomUtil.create('div', 'google-network-attribution');
        box.style.cssText = 'background:#fff;padding:10px 10px 5px;margin:10px;max-width:min(440px,70vw);color:#333;font:11px/1.4 Arial,sans-serif;';
        const image = L.DomUtil.create('img', '', box);
        image.src = logo; image.alt = 'Google Maps';
        image.style.cssText = 'display:block;height:18px;width:auto;margin-bottom:6px;';
        this.copyright = L.DomUtil.create('div', '', box);
        const own = L.DomUtil.create('div', '', box);
        own.textContent = 'Red e infraestructura: SmartRayco';
        own.style.cssText = 'border-top:1px solid #ddd;margin-top:6px;padding-top:6px;';
        L.DomEvent.disableClickPropagation(box);
        L.DomEvent.disableScrollPropagation(box);
        return box;
      };
      this.attribution = control.addTo(this.map);
    }
    // Provider text is untrusted plain text, never innerHTML.
    if (this.copyright) this.copyright.textContent = text;
  }

  private async refresh() {
    if (this.disposed) return;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    const epoch = ++this.epoch;
    this.pause();
    try {
      const session = await this.client.session(this.mode, request.signal);
      const b = this.map.getBounds();
      const view = normalizeGoogleViewport({ north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest(), zoom: this.map.getZoom() });
      const info = await this.client.viewport(session, view, request.signal);
      if (this.disposed || request.signal.aborted || epoch !== this.epoch) return;
      const nativeZoom = googleNativeZoom(info, view);
      this.removeImagery();
      this.showAttribution(info.copyright);
      this.layer = L.tileLayer(this.client.tileTemplate(session), { tileSize: 256, minZoom: 0, maxZoom: 22, maxNativeZoom: nativeZoom, noWrap: true, updateWhenIdle: true, keepBuffer: 0 });
      this.layer.once('tileerror', () => {
        if (this.disposed || epoch !== this.epoch) return;
        this.removeImagery();
        this.failure('Google Maps no pudo cargar sus imágenes. Se conserva tu trabajo; no se cambia a otro proveedor.');
      });
      this.layer.addTo(this.map);
      this.failure('');
    } catch (e) {
      if (this.disposed || request.signal.aborted || epoch !== this.epoch) return;
      this.removeImagery();
      this.failure((e as Error).message);
    }
  }

  dispose() {
    this.disposed = true;
    this.epoch++;
    this.request?.abort();
    if (this.timer) clearTimeout(this.timer);
    this.map.off('movestart zoomstart', this.pause);
    this.map.off('moveend zoomend', this.schedule);
    this.removeImagery();
    this.client.clear();
  }
}
