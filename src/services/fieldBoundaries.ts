import type { Feature, FeatureCollection, Geometry, Polygon, MultiPolygon } from 'geojson'

export const MISSISSIPPI_FIELDS_PARQUET_URL =
  'https://pub-ae42f8c1a3e34c4c8485710526e233ab.r2.dev/2025_N33W091.parquet'

export type FieldFeature = Feature<Polygon | MultiPolygon, Record<string, unknown> & { fieldId: string }>

const GEOMETRY_COLUMNS = ['geometry', 'geom', 'wkb_geometry', 'wkb']

function readUInt32(view: DataView, offset: number, little: boolean) {
  return view.getUint32(offset, little)
}

function readDouble(view: DataView, offset: number, little: boolean) {
  return view.getFloat64(offset, little)
}

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Array.isArray(value)) return new Uint8Array(value as number[])
  if (typeof value === 'string') {
    const hex = value.startsWith('0x') ? value.slice(2) : value
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
      const bytes = new Uint8Array(hex.length / 2)
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
      return bytes
    }
    try {
      return new TextEncoder().encode(value)
    } catch {
      return null
    }
  }
  return null
}

function parseWkb(value: unknown): Polygon | MultiPolygon | null {
  const bytes = toBytes(value)
  if (!bytes) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  function parseGeometry(offset: number): { geometry: Geometry | null; offset: number } {
    const little = view.getUint8(offset) === 1
    const rawType = readUInt32(view, offset + 1, little)
    const type = rawType % 1000
    offset += 5

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
          offset += 16
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
    const geometry = parseWkb(row[column])
    if (geometry) return geometry
  }
  return null
}

function featureId(row: Record<string, unknown>, index: number): string {
  for (const key of ['field_id', 'fieldId', 'id', 'ID', 'fid']) {
    const value = row[key]
    if (value != null) return String(value)
  }
  return `field-${index + 1}`
}

export async function loadMississippiFields(): Promise<FeatureCollection<Polygon | MultiPolygon>> {
  const { asyncBufferFromUrl, parquetRead } = await import(/* @vite-ignore */ 'https://esm.sh/hyparquet@1.17.1') as any
  const file = await asyncBufferFromUrl({ url: MISSISSIPPI_FIELDS_PARQUET_URL })
  const rows: Record<string, unknown>[] = await new Promise((resolve, reject) => {
    parquetRead({
      file,
      rowFormat: 'object',
      onComplete: (data: Record<string, unknown>[]) => resolve(data),
      onError: reject,
    })
  })

  const features: FieldFeature[] = []
  rows.forEach((row, index) => {
    const geometry = rowGeometry(row)
    if (!geometry) return
    const properties = { ...row, fieldId: featureId(row, index) }
    for (const column of GEOMETRY_COLUMNS) delete properties[column]
    features.push({ type: 'Feature', geometry, properties })
  })
  return { type: 'FeatureCollection', features }
}
