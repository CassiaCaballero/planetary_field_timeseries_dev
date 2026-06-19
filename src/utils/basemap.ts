export type BasemapId = 'satellite' | 'dark' | 'terrain'

export interface BasemapDefinition {
  id: BasemapId
  label: string
  url: string
  options: {
    maxZoom: number
    attribution: string
  }
  labelUrl?: string
}

export const BASEMAPS: BasemapDefinition[] = [
  {
    id: 'satellite',
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    labelUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    options: {
      maxZoom: 19,
      attribution: 'Imagery (c) Esri, Maxar, Earthstar Geographics',
    },
  },
  {
    id: 'dark',
    label: 'Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    options: {
      maxZoom: 20,
      attribution: '(c) OpenStreetMap contributors (c) CARTO',
    },
  },
  {
    id: 'terrain',
    label: 'Terrain',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
    labelUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    options: {
      maxZoom: 13,
      attribution: 'Tiles (c) Esri',
    },
  },
]

export function getBasemap(id: BasemapId): BasemapDefinition {
  return BASEMAPS.find(b => b.id === id) ?? BASEMAPS[0]
}

export function basemapUrl(id: BasemapId = 'satellite'): string {
  return getBasemap(id).url
}
