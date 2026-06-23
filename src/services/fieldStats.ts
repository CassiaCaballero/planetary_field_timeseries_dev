import type { FieldFeature } from './fieldBoundaries'
import type { BandTimeSeries, RawBands } from '../types/api'
import { searchSentinel2Items, stacItemDate } from './planetaryComputerApi'

const PC_TILER_BASE = import.meta.env.VITE_PC_TILER_BASE || 'https://planetarycomputer.microsoft.com/api/data/v1'
const BAND_NAMES = ['B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B8A', 'B11', 'B12', 'SCL'] as const
const REFLECTANCE_SCALE = 10_000

function medianFromStats(stats: any): number | null {
  if (!stats) return null
  const value = stats.percentile_50 ?? stats.median ?? stats.p50
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseStats(json: any): RawBands {
  const out = {} as RawBands
  for (const band of BAND_NAMES) {
    const stats = json?.properties?.statistics?.[band] ?? json?.statistics?.[band] ?? json?.[band]
    const value = medianFromStats(stats)
    out[band] = value == null ? null : band === 'SCL' ? value : value / REFLECTANCE_SCALE
  }
  return out
}

async function fetchItemFieldBands(item: any, field: FieldFeature, collection: string): Promise<RawBands | null> {
  const params = new URLSearchParams()
  params.set('collection', collection)
  params.set('item', item.id)
  for (const band of BAND_NAMES) params.append('assets', band)
  try {
    const res = await fetch(`${PC_TILER_BASE}/item/statistics?${params.toString()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(field),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return parseStats(await res.json())
  } catch {
    return null
  }
}

function centroid(field: FieldFeature): [number, number] {
  const coords = field.geometry.type === 'Polygon'
    ? field.geometry.coordinates[0]
    : field.geometry.coordinates[0]?.[0] ?? []
  const sum = coords.reduce((acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat], [0, 0])
  return coords.length ? [sum[0] / coords.length, sum[1] / coords.length] : [-91.5, 33.5]
}

export async function fetchFieldBandTimeSeries(
  field: FieldFeature,
  startDate: string,
  endDate: string,
  collection: string,
): Promise<BandTimeSeries> {
  const [lon, lat] = centroid(field)
  const items = await searchSentinel2Items(lon, lat, startDate, endDate, collection)
  const byDate = new Map<string, any>()
  for (const item of items) {
    const date = stacItemDate(item)
    const existing = byDate.get(date)
    if (!existing || (item.properties['eo:cloud_cover'] ?? Infinity) < (existing.properties['eo:cloud_cover'] ?? Infinity)) byDate.set(date, item)
  }
  const result: BandTimeSeries = {}
  await Promise.all([...byDate.values()].map(async item => {
    const bands = await fetchItemFieldBands(item, field, collection)
    if (bands) result[stacItemDate(item)] = bands
  }))
  return result
}
