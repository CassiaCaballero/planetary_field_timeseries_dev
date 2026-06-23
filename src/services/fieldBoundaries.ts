import type { Feature, FeatureCollection, Geometry, Polygon, MultiPolygon } from 'geojson'

const R2_MISSISSIPPI_FIELDS_PARQUET_URL =
  'https://pub-ae42f8c1a3e34c4c8485710526e233ab.r2.dev/merged_fields_ms.parquet'

const VERCEL_FIELDS_PARQUET_PATH = '/field-boundaries/merged_fields_ms.parquet'

export const MISSISSIPPI_FIELDS_PARQUET_URL =
  import.meta.env.VITE_FIELDS_PARQUET_URL || VERCEL_FIELDS_PARQUET_PATH

export type FieldFeature = Feature<Polygon | MultiPolygon, Record<string, unknown> & { fieldId: string }>

const GEOMETRY_COLUMNS = ['geometry', 'geom', 'wkb_geometry', 'wkb']
const EWKB_SRID_FLAG = 0x20000000
const EWKB_Z_FLAG = 0x80000000
const EWKB_M_FLAG = 0x40000000

let cachedFields: Promise<FeatureCollection<Polygon | MultiPolygon>> | null = null

function readUInt32(view: DataView, offset: number, little: boolean) {
  return view.getUint32(offset, little)
}

function readDouble(view: DataView, offset: number, little: boolean) {
  return view.getFloat64(offset, little)
}

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (Array.isArray(value)) return new Uint8Array(value as number[])
  if (typeof value === 'string') {
    const hex = value.startsWith('0x') ? value.slice(2) : value
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
      const bytes = new Uint8Array(hex.length / 2)
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
      return bytes
    }
  }
  return null
}

function parseGeoJson(value: unknown): Polygon | MultiPolygon | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    const geometry = (parsed as Feature)?.type === 'Feature' ? (parsed as Feature).geometry : parsed as Geometry
    return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon' ? geometry : null
  } catch {
    return null
  }
}

function parseWkb(value: unknown): Polygon | MultiPolygon | null {
  const bytes = toBytes(value)
  if (!bytes || bytes.byteLength < 5) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  function parseGeometry(offset: number): { geometry: Geometry | null; offset: number } {
    const little = view.getUint8(offset) === 1
    const rawType = readUInt32(view, offset + 1, little)
    const hasSrid = (rawType & EWKB_SRID_FLAG) !== 0
    const hasEwkbZ = (rawType & EWKB_Z_FLAG) !== 0
    const hasEwkbM = (rawType & EWKB_M_FLAG) !== 0
    const normalizedType = rawType & ~(EWKB_SRID_FLAG | EWKB_Z_FLAG | EWKB_M_FLAG)
    const type = normalizedType % 1000
    const isoDim = Math.floor(normalizedType / 1000)
    const dimensions = hasEwkbZ && hasEwkbM ? 4 : hasEwkbZ || hasEwkbM || isoDim === 1 ? 3 : isoDim >= 2 ? 4 : 2
    offset += 5
    if (hasSrid) offset += 4

    if (type === 3) {
      const ringCount = readUInt32(view, offset, little)
      offset += 4
      const coordinates: number[][][] = []
      for (let r = 0; r < ringCount; r++) {
        const pointCount = readUInt32(view, offset, little)
        offset += 4
        const ring: number[][] = []
        for (let p = 0; p < pointCount; p++) {
          ring.push([readDouble(view, offset, little), readDouble(view, offset + 8, little)])
          offset += dimensions * 8
        }
        coordinates.push(ring)
      }
      return { geometry: { type: 'Polygon', coordinates }, offset }
    }

    if (type === 6) {
      const polygonCount = readUInt32(view, offset, little)
      offset += 4
      const coordinates: number[][][][] = []
      for (let i = 0; i < polygonCount; i++) {
        const parsed = parseGeometry(offset)
        offset = parsed.offset
        if (parsed.geometry?.type === 'Polygon') coordinates.push(parsed.geometry.coordinates)
      }
      return { geometry: { type: 'MultiPolygon', coordinates }, offset }
    }

    return { geometry: null, offset }
  }

  const geometry = parseGeometry(0).geometry
  return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon' ? geometry : null
}

function rowGeometry(row: Record<string, unknown>): Polygon | MultiPolygon | null {
  for (const column of GEOMETRY_COLUMNS) {
    const geometry = parseGeoJson(row[column]) ?? parseWkb(row[column])
    if (geometry) return geometry
  }
  return null
}

function sanitizeProperty(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return undefined
  if (Array.isArray(value)) return value.map(sanitizeProperty).filter(v => v !== undefined)
  if (value && typeof value === 'object') {
    const cleaned: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      const sanitized = sanitizeProperty(nestedValue)
      if (sanitized !== undefined) cleaned[key] = sanitized
    }
    return cleaned
  }
  return value
}

function sanitizeProperties(row: Record<string, unknown>, fieldId: string): Record<string, unknown> & { fieldId: string } {
  const properties: Record<string, unknown> & { fieldId: string } = { fieldId }
  for (const [key, value] of Object.entries(row)) {
    if (GEOMETRY_COLUMNS.includes(key)) continue
    const sanitized = sanitizeProperty(value)
    if (sanitized !== undefined) properties[key] = sanitized
  }
  return properties
}

function featureId(row: Record<string, unknown>, index: number): string {
  for (const key of ['field_id', 'fieldId', 'id', 'ID', 'fid']) {
    const value = row[key]
    if (value != null) return String(value)
  }
  return `field-${index + 1}`
}

async function loadHyparquet(): Promise<any> {
  return import(/* @vite-ignore */ 'https://esm.sh/hyparquet@1.17.1')
}

async function readRows(): Promise<Record<string, unknown>[]> {
  const response = await fetch(MISSISSIPPI_FIELDS_PARQUET_URL)
  if (response.ok) return readParquetRows(await response.arrayBuffer())

  if (MISSISSIPPI_FIELDS_PARQUET_URL !== R2_MISSISSIPPI_FIELDS_PARQUET_URL) {
    const fallback = await fetch(R2_MISSISSIPPI_FIELDS_PARQUET_URL)
    if (fallback.ok) return readParquetRows(await fallback.arrayBuffer())
  }

  throw new Error(`HTTP ${response.status} while loading field parquet`)
}

async function readParquetRows(file: ArrayBuffer): Promise<Record<string, unknown>[]> {
  const { parquetRead } = await loadHyparquet()
  return new Promise((resolve, reject) => {
    parquetRead({
      file,
      rowFormat: 'object',
      // Keep unannotated BYTE_ARRAY columns as bytes so WKB geometry is not
      // corrupted by UTF-8 decoding before parseWkb() sees it. GeoParquet
      // geometry columns are still decoded by hyparquet when metadata exists.
      utf8: false,
      onComplete: (data: Record<string, unknown>[]) => resolve(data),
      onError: reject,
    })
  })
}

async function loadFields(): Promise<FeatureCollection<Polygon | MultiPolygon>> {
  const rows = await readRows()
  const features: FieldFeature[] = []
  rows.forEach((row, index) => {
    const geometry = rowGeometry(row)
    if (!geometry) return
    const properties = sanitizeProperties(row, featureId(row, index))
    features.push({ type: 'Feature', geometry, properties })
  })
  if (!features.length) throw new Error('No polygon geometries were found in the field parquet')
  return { type: 'FeatureCollection', features }
}

export function loadMississippiFields(): Promise<FeatureCollection<Polygon | MultiPolygon>> {
  cachedFields ??= loadFields().catch(error => {
    cachedFields = null
    throw error
  })
  return cachedFields
}
