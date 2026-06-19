import type { BandTimeSeries, RawBands } from '../types/api'

const PC_STAC_BASE = import.meta.env.VITE_PC_STAC_BASE || 'https://planetarycomputer.microsoft.com/api/stac/v1'
const PC_TILER_BASE = import.meta.env.VITE_PC_TILER_BASE || 'https://planetarycomputer.microsoft.com/api/data/v1'
const S2_COLLECTION = 'sentinel-2-l2a'

const BAND_NAMES = ['B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B8A', 'B11', 'B12', 'SCL'] as const
const REFLECTANCE_SCALE = 10_000

export interface PcStacItem {
  id: string
  collection: string
  properties: {
    datetime: string
    'eo:cloud_cover'?: number
  }
}

export interface PcLayer {
  id: string
  title: string
}

interface StacSearchResponse {
  features: PcStacItem[]
  links?: Array<{ rel?: string; href?: string; method?: string }>
}

interface PointResponse {
  values: Array<number | null>
  band_names?: string[]
}

interface TileJsonResponse {
  tiles: string[]
}

export const PC_LAYERS: PcLayer[] = [
  { id: 'TRUE-COLOR', title: 'True Color' },
  { id: 'FALSE-COLOR', title: 'False Color (B08, B04, B03)' },
  { id: 'SWIR_FALSE_COLOR', title: 'False Color (B11, B08, B04)' },
  { id: 'NDVI', title: 'NDVI' },
  { id: 'NDMI', title: 'NDMI' },
]

function pointBbox(lon: number, lat: number): string {
  const eps = 0.0001
  return [lon - eps, lat - eps, lon + eps, lat + eps].join(',')
}

function dateTimeRange(startDate: string, endDate: string): string {
  return `${startDate}T00:00:00Z/${endDate}T23:59:59Z`
}

function itemDate(item: PcStacItem): string {
  return item.properties.datetime.slice(0, 10)
}

function itemCloudCover(item: PcStacItem): number {
  return item.properties['eo:cloud_cover'] ?? Number.POSITIVE_INFINITY
}

export function stacItemDate(item: PcStacItem): string {
  return itemDate(item)
}

export function stacItemCloudCover(item: PcStacItem): number {
  return itemCloudCover(item)
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const err = await response.json() as { detail?: string; message?: string; error?: string }
      message = err.detail ?? err.message ?? err.error ?? message
    } catch {
      message = await response.text().catch(() => message)
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export async function searchSentinel2Items(
  lon: number,
  lat: number,
  startDate: string,
  endDate: string,
  collection = S2_COLLECTION,
): Promise<PcStacItem[]> {
  const items: PcStacItem[] = []
  let url: string | null = (() => {
    const params = new URLSearchParams()
    params.set('collections', collection)
    params.set('bbox', pointBbox(lon, lat))
    params.set('datetime', dateTimeRange(startDate, endDate))
    params.set('limit', '100')
    return `${PC_STAC_BASE}/search?${params.toString()}`
  })()

  while (url) {
    const page = await fetchJson<StacSearchResponse>(url)
    items.push(...page.features)
    const next = page.links?.find(l => l.rel === 'next' && l.href)
    url = next?.href ?? null
  }

  return items
}

function bestItemPerDate(items: PcStacItem[]): PcStacItem[] {
  const byDate = new Map<string, PcStacItem>()
  for (const item of items) {
    const date = itemDate(item)
    const existing = byDate.get(date)
    if (!existing || itemCloudCover(item) < itemCloudCover(existing)) {
      byDate.set(date, item)
    }
  }
  return [...byDate.values()].sort((a, b) => itemDate(a).localeCompare(itemDate(b)))
}

function parsePointValues(json: PointResponse): RawBands {
  const raw = {} as RawBands
  for (const band of BAND_NAMES) raw[band] = null

  json.values.forEach((value, i) => {
    const name = json.band_names?.[i]?.replace(/_b\d+$/, '') as typeof BAND_NAMES[number] | undefined
    if (!name || !BAND_NAMES.includes(name) || value == null || !isFinite(value)) return
    raw[name] = name === 'SCL' ? value : value / REFLECTANCE_SCALE
  })

  return raw
}

async function fetchItemBands(
  item: PcStacItem,
  lon: number,
  lat: number,
  collection: string,
): Promise<RawBands | null> {
  const params = new URLSearchParams()
  params.set('collection', collection)
  params.set('item', item.id)
  for (const band of BAND_NAMES) params.append('assets', band)

  try {
    const url = `${PC_TILER_BASE}/item/point/${lon},${lat}?${params.toString()}`
    return parsePointValues(await fetchJson<PointResponse>(url))
  } catch {
    return null
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++
      results[index] = await worker(values[index])
    }
  })
  await Promise.all(runners)
  return results
}

export async function fetchRawBands(
  lon: number,
  lat: number,
  startDate: string,
  endDate: string,
  collection: string,
): Promise<BandTimeSeries> {
  const items = bestItemPerDate(await searchSentinel2Items(lon, lat, startDate, endDate, collection))
  const entries = await mapWithConcurrency(items, 5, async item => {
    const bands = await fetchItemBands(item, lon, lat, collection)
    return bands ? [itemDate(item), bands] as const : null
  })

  const result: BandTimeSeries = {}
  for (const entry of entries) {
    if (entry) result[entry[0]] = entry[1]
  }
  return result
}

export async function findBestMapItem(
  lon: number,
  lat: number,
  startDate: string,
  endDate: string,
  collection = S2_COLLECTION,
): Promise<PcStacItem | null> {
  const items = await searchSentinel2Items(lon, lat, startDate, endDate, collection)
  return items.sort((a, b) => {
    const dateCompare = itemDate(b).localeCompare(itemDate(a))
    if (dateCompare !== 0) return dateCompare
    return itemCloudCover(a) - itemCloudCover(b)
  })[0] ?? null
}

function applyLayerParams(params: URLSearchParams, layerId: string) {
  params.set('format', 'png')

  switch (layerId) {
    case 'FALSE-COLOR':
      params.append('assets', 'B08')
      params.append('assets', 'B04')
      params.append('assets', 'B03')
      params.set('asset_as_band', 'true')
      params.set('rescale', '0,5000')
      break
    case 'SWIR_FALSE_COLOR':
      params.append('assets', 'B11')
      params.append('assets', 'B08')
      params.append('assets', 'B04')
      params.set('asset_as_band', 'true')
      params.set('rescale', '0,5000')
      break
    case 'NDVI':
      params.append('assets', 'B08')
      params.append('assets', 'B04')
      params.set('asset_as_band', 'true')
      params.set('expression', '(B08_b1-B04_b1)/(B08_b1+B04_b1)')
      params.set('rescale', '-1,1')
      params.set('colormap_name', 'rdylgn')
      break
    case 'NDWI':
      params.append('assets', 'B03')
      params.append('assets', 'B08')
      params.set('asset_as_band', 'true')
      params.set('expression', '(B03_b1-B08_b1)/(B03_b1+B08_b1)')
      params.set('rescale', '-1,1')
      params.set('colormap_name', 'rdbu_r')
      break
    case 'TRUE-COLOR':
    default:
      params.append('assets', 'visual')
      params.set('asset_bidx', 'visual|1,2,3')
      params.set('nodata', '0')
      break
  }
}

function itemParams(item: PcStacItem): URLSearchParams {
  const params = new URLSearchParams()
  params.set('collection', item.collection || S2_COLLECTION)
  params.set('item', item.id)
  return params
}

export async function getTileUrl(item: PcStacItem, layerId: string): Promise<string> {
  const params = itemParams(item)
  applyLayerParams(params, layerId)

  const tileJson = await fetchJson<TileJsonResponse>(`${PC_TILER_BASE}/item/tilejson.json?${params.toString()}`)
  const tile = tileJson.tiles[0]
  if (!tile) throw new Error('Planetary Computer returned no tile URL for this item.')
  return tile
}

/** Convert WGS-84 lat/lon to Web Mercator tile indices at the given zoom. */
function latLonToTile(lat: number, lon: number, zoom: number): [number, number, number] {
  const z = zoom
  const x = Math.floor((lon + 180) / 360 * (1 << z))
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(
    (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * (1 << z),
  )
  return [z, x, y]
}

export function getPreviewUrl(
  item: PcStacItem,
  layerId: string,
  coord?: [number, number], // [lon, lat] of the clicked point
  tileZoom = 14,            // Web Mercator zoom level (10–18)
): string {
  const params = itemParams(item)
  applyLayerParams(params, layerId)

  if (coord) {
    // Request the specific XYZ tile that contains the clicked coordinate.
    // @2x returns a 512×512 tile so the crosshair at centre is exact.
    const [lon, lat] = coord
    const [z, x, y] = latLonToTile(lat, lon, tileZoom)
    return `${PC_TILER_BASE}/item/tiles/${z}/${x}/${y}@2x?${params.toString()}`
  }

  params.set('width', '512')
  params.set('height', '512')
  return `${PC_TILER_BASE}/item/preview.png?${params.toString()}`
}
