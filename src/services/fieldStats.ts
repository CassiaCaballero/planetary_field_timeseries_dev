import type { FeatureCollection } from 'geojson'
import type { FieldFeature } from './fieldBoundaries'
import type { BandTimeSeries, RawBands } from '../types/api'
import { searchSentinel2Items, stacItemDate } from './planetaryComputerApi'

const PC_TILER_BASE = import.meta.env.VITE_PC_TILER_BASE || 'https://planetarycomputer.microsoft.com/api/data/v1'
const BAND_NAMES = ['B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B8A', 'B11', 'B12', 'SCL'] as const
const REFLECTANCE_SCALE = 10_000

type BandName = typeof BAND_NAMES[number]

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function medianFromStats(stats: any): number | null {
  if (!stats) return null
  return firstNumber(
    stats.percentile_50,
    stats.percentiles?.['50'],
    stats.percentiles?.[50],
    stats.p50,
    stats.median,
    // Some TiTiler deployments do not return percentiles unless explicitly
    // configured. Mean is still a field aggregate and is better than dropping
    // the whole date from the available-scene list.
    stats.mean,
  )
}

function statisticsRoot(json: any): any {
  return json?.features?.[0]?.properties?.statistics
    ?? json?.features?.[0]?.properties
    ?? json?.properties?.statistics
    ?? json?.statistics
    ?? json
}

function statsForBand(root: any, band: BandName): any {
  return root?.[band]
    ?? root?.[`${band}_b1`]
    ?? root?.[band]?.b1
    ?? root?.[band]?.['1']
}

function parseStats(json: any): RawBands {
  const root = statisticsRoot(json)
  const out = {} as RawBands
  for (const band of BAND_NAMES) {
    const value = medianFromStats(statsForBand(root, band))
    out[band] = value == null ? null : band === 'SCL' ? value : value / REFLECTANCE_SCALE
  }
  return out
}

function hasAnyBand(bands: RawBands): boolean {
  return BAND_NAMES.some(band => bands[band] !== null)
}

async function postStatistics(url: string, body: unknown): Promise<RawBands | null> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return null
  const bands = parseStats(await res.json())
  return hasAnyBand(bands) ? bands : null
}

async function fetchItemFieldBands(item: any, field: FieldFeature, collection: string): Promise<RawBands | null> {
  const params = new URLSearchParams()
  params.set('collection', collection)
  params.set('item', item.id)
  for (const band of BAND_NAMES) params.append('assets', band)

  const url = `${PC_TILER_BASE}/item/statistics?${params.toString()}`
  const collectionBody: FeatureCollection = { type: 'FeatureCollection', features: [field] }

  return await postStatistics(url, collectionBody)
    ?? await postStatistics(url, field)
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
