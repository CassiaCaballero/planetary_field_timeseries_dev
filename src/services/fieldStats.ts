import type { FeatureCollection } from 'geojson'
import type { FieldFeature } from './fieldBoundaries'
import type { BandTimeSeries, RawBands } from '../types/api'
import { searchSentinel2Items, stacItemDate, type PcStacItem } from './planetaryComputerApi'

const PC_TILER_BASE = import.meta.env.VITE_PC_TILER_BASE || 'https://planetarycomputer.microsoft.com/api/data/v1'
const OUTPUT_BAND_NAMES = ['B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B8A', 'B11', 'B12', 'SCL'] as const
const REQUEST_BAND_NAMES = ['B04', 'B08', 'SCL'] as const
const REFLECTANCE_SCALE = 10_000

type BandName = typeof OUTPUT_BAND_NAMES[number]

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

function meanFromStats(stats: any): number | null {
  return firstNumber(stats?.mean, stats?.avg)
}

function stddevFromStats(stats: any): number | null {
  return firstNumber(stats?.std, stats?.stddev, stats?.stdev, stats?.standard_deviation)
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

function firstStats(root: any, ...names: string[]): any {
  for (const name of names) {
    const stats = root?.[name] ?? root?.[`${name}_b1`] ?? root?.[name]?.b1 ?? root?.[name]?.['1']
    if (stats) return stats
  }
  return root?.b1 ?? root?.['1'] ?? root
}

function findStatsObject(value: any): any {
  if (!value || typeof value !== 'object') return null
  if (meanFromStats(value) != null && stddevFromStats(value) != null) return value
  for (const child of Object.values(value)) {
    const found = findStatsObject(child)
    if (found) return found
  }
  return null
}

function parseStats(json: any): RawBands {
  const root = statisticsRoot(json)
  const out = {} as RawBands
  for (const band of OUTPUT_BAND_NAMES) {
    const value = medianFromStats(statsForBand(root, band))
    out[band] = value == null ? null : band === 'SCL' ? value : value / REFLECTANCE_SCALE
  }
  return out
}

function hasAnyBand(bands: RawBands): boolean {
  return OUTPUT_BAND_NAMES.some(band => bands[band] !== null)
}

async function postStatistics(url: string, body: unknown): Promise<RawBands | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    const bands = parseStats(await res.json())
    return hasAnyBand(bands) ? bands : null
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

async function fetchItemFieldBands(item: any, field: FieldFeature, collection: string): Promise<RawBands | null> {
  const params = new URLSearchParams()
  params.set('collection', collection)
  params.set('item', item.id)
  for (const band of REQUEST_BAND_NAMES) params.append('assets', band)
  params.set('max_size', '256')

  const url = `${PC_TILER_BASE}/item/statistics?${params.toString()}`
  const safeField: FieldFeature = {
    type: 'Feature',
    geometry: field.geometry,
    properties: { fieldId: field.properties.fieldId },
  }
  const collectionBody: FeatureCollection = { type: 'FeatureCollection', features: [safeField] }

  return await postStatistics(url, collectionBody)
    ?? await postStatistics(url, safeField)
}

export interface NdviFieldSummary {
  mean: number
  stddev: number
}

function parseNdviSummary(json: any): NdviFieldSummary | null {
  const root = statisticsRoot(json)
  const stats = firstStats(root, 'expression', 'expr', 'NDVI', 'ndvi') ?? findStatsObject(root)
  const mean = meanFromStats(stats)
  const stddev = stddevFromStats(stats)
  return mean == null || stddev == null ? null : { mean, stddev }
}

function parseBandNdviSummary(json: any): NdviFieldSummary | null {
  const root = statisticsRoot(json)
  const redStats = statsForBand(root, 'B04')
  const nirStats = statsForBand(root, 'B08')
  const redMean = meanFromStats(redStats)
  const nirMean = meanFromStats(nirStats)
  if (redMean == null || nirMean == null) return null

  const red = redMean / REFLECTANCE_SCALE
  const nir = nirMean / REFLECTANCE_SCALE
  const denominator = nir + red
  if (!denominator) return null

  const redStd = (stddevFromStats(redStats) ?? 0) / REFLECTANCE_SCALE
  const nirStd = (stddevFromStats(nirStats) ?? 0) / REFLECTANCE_SCALE
  const mean = (nir - red) / denominator
  const dNir = (2 * red) / (denominator * denominator)
  const dRed = (-2 * nir) / (denominator * denominator)
  const stddev = Math.sqrt((dNir * nirStd) ** 2 + (dRed * redStd) ** 2)
  return { mean, stddev }
}

async function postNdviSummary(url: string, body: unknown): Promise<NdviFieldSummary | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    return parseNdviSummary(await res.json())
  } catch {
    return null
  }
}

async function postBandNdviSummary(url: string, body: unknown): Promise<NdviFieldSummary | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    return parseBandNdviSummary(await res.json())
  } catch {
    return null
  }
}

export async function fetchFieldNdviSummary(item: PcStacItem, field: FieldFeature): Promise<NdviFieldSummary | null> {
  const expressionParams = new URLSearchParams()
  expressionParams.set('collection', item.collection)
  expressionParams.set('item', item.id)
  expressionParams.append('assets', 'B08')
  expressionParams.append('assets', 'B04')
  expressionParams.set('asset_as_band', 'true')
  expressionParams.set('expression', '((B08*1.0)-B04)/((B08*1.0)+B04)')
  expressionParams.set('max_size', '256')

  const bandParams = new URLSearchParams()
  bandParams.set('collection', item.collection)
  bandParams.set('item', item.id)
  bandParams.append('assets', 'B08')
  bandParams.append('assets', 'B04')
  bandParams.set('max_size', '256')

  const expressionUrl = `${PC_TILER_BASE}/item/statistics?${expressionParams.toString()}`
  const bandUrl = `${PC_TILER_BASE}/item/statistics?${bandParams.toString()}`
  const safeField: FieldFeature = {
    type: 'Feature',
    geometry: field.geometry,
    properties: { fieldId: field.properties.fieldId },
  }
  const collectionBody: FeatureCollection = { type: 'FeatureCollection', features: [safeField] }

  return await postNdviSummary(expressionUrl, collectionBody)
    ?? await postNdviSummary(expressionUrl, safeField)
    ?? await postBandNdviSummary(bandUrl, collectionBody)
    ?? await postBandNdviSummary(bandUrl, safeField)
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
  await mapWithConcurrency([...byDate.values()], 3, async item => {
    const bands = await fetchItemFieldBands(item, field, collection)
    if (bands) result[stacItemDate(item)] = bands
  })
  return result
}
