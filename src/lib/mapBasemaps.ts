export type NetworkBasemap = 'streets' | 'satellite' | 'hybrid';
export interface BasemapDefinition { url: string; attribution: string; maxNativeZoom: number }

export function satelliteConfigured(key: string, licensed: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(key) && licensed === 'true';
}

export function networkBasemap(mode: NetworkBasemap, key = '', licensed = ''): BasemapDefinition {
  if (mode === 'streets') return {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    maxNativeZoom: 19,
  };
  if (!satelliteConfigured(key, licensed)) throw new Error('Satélite e Híbrido requieren un proveedor habilitado.');
  // Official MapTiler raster Maps API. No private URLs, demo keys or extra SDK.
  const style = mode === 'satellite' ? 'satellite-v4' : 'hybrid-v4';
  return {
    url: `https://api.maptiler.com/maps/${style}/256/{z}/{x}/{y}.jpg?key=${encodeURIComponent(key)}`,
    attribution: '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a>' + (mode === 'hybrid' ? ' &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' : ''),
    maxNativeZoom: 19,
  };
}
