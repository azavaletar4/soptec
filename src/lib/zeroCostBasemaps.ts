import type { NetworkBasemap } from './mapBasemaps';

export interface FreeMapLayer {
  url: string;
  attribution: string;
  maxNativeZoom: number;
  zIndex: number;
}

const osmCredit = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
const eoxCredit = '<a href="https://cloudless.eox.at">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016) · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> · <a href="https://maps.eox.at">EOX::Maps</a>';

// Owner policy: S/0. No environment flag, key, trial, account or paid fallback.
// WMTS capabilities identify s2cloudless_3857 as the 2016 CC BY 4.0 mosaic.
// Never replace it with the commercially restricted 2018+ public layers.
export function zeroCostBasemaps(mode: NetworkBasemap): FreeMapLayer[] {
  if (mode === 'streets') return [{
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: osmCredit, maxNativeZoom: 19, zIndex: 0,
  }];
  const layers: FreeMapLayer[] = [{
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg',
    attribution: eoxCredit, maxNativeZoom: 14, zIndex: 0,
  }];
  if (mode === 'hybrid') layers.push({
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/overlay_bright_3857/default/g/{z}/{y}/{x}.png',
    attribution: `${osmCredit} · Rendering &copy; <a href="https://eox.at">EOX</a> and <a href="https://github.com/mapserver/basemaps">MapServer</a>`,
    maxNativeZoom: 14, zIndex: 1,
  });
  return layers;
}
