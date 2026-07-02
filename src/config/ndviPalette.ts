export const NDVI_PALETTE_COLORS = [
  '#a50026',
  '#b71126',
  '#c82227',
  '#d9342a',
  '#e64a33',
  '#f46d43',
  '#fa8c59',
  '#fdae61',
  '#fec980',
  '#fee08b',
  '#ffffbf',
  '#e6f598',
  '#d9ef8b',
  '#c5e67e',
  '#a6d96a',
  '#82c966',
  '#66bd63',
  '#41ab5d',
  '#1a9850',
  '#0b7d42',
  '#006837',
]

export const NDVI_SCALE_BACKGROUND = `linear-gradient(to right, ${NDVI_PALETTE_COLORS.map((color, index) => {
  const start = (index / NDVI_PALETTE_COLORS.length) * 100
  const end = ((index + 1) / NDVI_PALETTE_COLORS.length) * 100
  return `${color} ${start}% ${end}%`
}).join(', ')})`

export const NDVI_VERTICAL_SCALE_BACKGROUND = `linear-gradient(to top, ${NDVI_PALETTE_COLORS.map((color, index) => {
  const start = (index / NDVI_PALETTE_COLORS.length) * 100
  const end = ((index + 1) / NDVI_PALETTE_COLORS.length) * 100
  return `${color} ${start}% ${end}%`
}).join(', ')})`

export const NDVI_SCALE_TICKS = NDVI_PALETTE_COLORS.map((_, index) => {
  const value = Number((-1 + index * 0.1).toFixed(1))
  return {
    label: value.toString(),
    left: `${((index + 0.5) / NDVI_PALETTE_COLORS.length) * 100}%`,
  }
})

export const NDVI_TITILER_COLORMAP = NDVI_PALETTE_COLORS.reduce<Record<string, string>>((colormap, color, index) => {
  colormap[String(Math.floor(index * 255 / (NDVI_PALETTE_COLORS.length - 1)))] = color
  return colormap
}, {})
