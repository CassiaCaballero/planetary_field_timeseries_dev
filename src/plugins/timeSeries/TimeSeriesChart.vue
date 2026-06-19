<template>
  <div ref="containerRef" class="chart-container">
    <div
      v-if="tooltip.visible"
      class="chart-tooltip"
      :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
    >
      <span class="tip-date">{{ tooltip.date }}</span>
      <span class="tip-value" :style="{ color: seriesColour() }">{{ tooltip.value }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, watch } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { TimeSeriesPoint } from '../../types/api'
import type { Flags, FlagLabels } from '../../types/state'
import { buildUplotData } from '../../utils/chartData'
import { flagColour as sharedFlagColour } from '../../utils/flagColour'
import { useAppStore } from '../../stores/app'

const appStore = useAppStore()

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

const props = defineProps<{
  data: TimeSeriesPoint[]
  flags: Flags
  flagLabels: FlagLabels
  selectedDate: string | null
  yMin: number | null
  yMax: number | null
  unit: string
  color?: string
  chartType?: 'bars'
}>()

const emit = defineEmits<{
  pointClick: [date: string]
}>()

const containerRef = ref<HTMLDivElement | null>(null)
let uplot: uPlot | null = null
let resizeObserver: ResizeObserver | null = null

const tooltip = reactive({ visible: false, x: 0, y: 0, date: '', value: '' })

function flagColour(value: string): string {
  return sharedFlagColour(value, props.flagLabels, props.flags)
}

function seriesColour(): string {
  return props.color ?? cssVar('--accent')
}

function getSize(): { width: number; height: number } {
  const el = containerRef.value
  if (!el) return { width: 300, height: 200 }
  return { width: el.clientWidth || 300, height: el.clientHeight || 200 }
}

function drawAnnotations(u: uPlot) {
  const ctx = u.ctx
  ctx.save()

  // Draw flag markers
  const flagEntries = Object.entries(props.flags)
  const seenValues: string[] = []
  for (const [dateStr, flagValue] of flagEntries) {
    const ts = Date.parse(dateStr) / 1000
    const cx = Math.round(u.valToPos(ts, 'x', true))
    if (cx < u.bbox.left || cx > u.bbox.left + u.bbox.width) continue

    const colour = flagColour(flagValue)
    ctx.strokeStyle = colour
    ctx.lineWidth = 2
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(cx, u.bbox.top)
    ctx.lineTo(cx, u.bbox.top + u.bbox.height)
    ctx.stroke()

    if (!seenValues.includes(flagValue)) {
      const label = flagValue
      ctx.fillStyle = colour
      ctx.font = '11px sans-serif'
      ctx.fillText(label, cx + 4, u.bbox.top + 14)
      seenValues.push(flagValue)
    }
  }

  // Draw selected-date indicator
  if (props.selectedDate) {
    const ts = Date.parse(props.selectedDate) / 1000
    const cx = Math.round(u.valToPos(ts, 'x', true))
    if (cx >= u.bbox.left && cx <= u.bbox.left + u.bbox.width) {
      ctx.strokeStyle = cssVar('--accent')
      ctx.lineWidth = 2
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(cx, u.bbox.top)
      ctx.lineTo(cx, u.bbox.top + u.bbox.height)
      ctx.stroke()
    }
  }

  ctx.restore()
}

function drawBars(u: uPlot) {
  if (props.chartType !== 'bars') return
  const ctx = u.ctx
  const xs = u.data[0]
  const ys = u.data[1] as (number | null)[]
  if (!xs.length) return

  const barWidth = Math.max(2, (u.bbox.width / xs.length) * 0.65)
  const zeroY = u.valToPos(0, 'y', true)
  const col = seriesColour()

  ctx.save()
  ctx.fillStyle = col + 'CC'

  for (let i = 0; i < xs.length; i++) {
    if (ys[i] == null) continue
    const cx = Math.round(u.valToPos(xs[i], 'x', true))
    const cy = Math.round(u.valToPos(ys[i]!, 'y', true))
    const h = zeroY - cy
    if (Math.abs(h) < 1) continue
    ctx.fillRect(cx - barWidth / 2, Math.min(cy, zeroY), barWidth, Math.abs(h))
  }
  ctx.restore()
}

function createChart() {
  if (!containerRef.value) return
  const { width, height } = getSize()
  const isBars = props.chartType === 'bars'

  const opts: uPlot.Options = {
    width,
    height,
    scales: {
      x: { time: true },
      y: {
        range: props.yMin != null && props.yMax != null
          ? [props.yMin, props.yMax]
          : undefined,
      },
    },
    axes: [
      { stroke: cssVar('--text-muted'), ticks: { stroke: cssVar('--border') }, grid: { stroke: cssVar('--border') } },
      {
        label: props.unit,
        stroke: cssVar('--text-muted'),
        ticks: { stroke: cssVar('--border') },
        grid: { stroke: cssVar('--border') },
      },
    ],
    series: [
      {},
      {
        label: props.unit,
        stroke: seriesColour(),
        width: isBars ? 0 : 0,
        paths: () => null,
        points: isBars ? { show: false } : { show: true, size: 8, fill: seriesColour() },
      },
    ],
    hooks: {
      draw: [drawAnnotations, drawBars],
      setCursor: [
        (u: uPlot) => {
          const curLeft = u.cursor.left ?? -1
          const curTop  = u.cursor.top  ?? -1
          if (curLeft < 0 || curTop < 0) { tooltip.visible = false; return }

          const hoverTs = u.posToVal(curLeft, 'x')
          const xs = u.data[0]
          const ys = u.data[1] as (number | null)[]
          let nearest = -1
          let minDist = Infinity
          for (let i = 0; i < xs.length; i++) {
            if (ys[i] == null) continue
            const dist = Math.abs(xs[i] - hoverTs)
            if (dist < minDist) { minDist = dist; nearest = i }
          }

          if (nearest < 0 || Math.abs(u.valToPos(xs[nearest], 'x') - curLeft) > 24) {
            tooltip.visible = false
            return
          }

          const overBCR = u.over.getBoundingClientRect()
          const cBCR    = containerRef.value!.getBoundingClientRect()
          const ox = overBCR.left - cBCR.left
          const oy = overBCR.top  - cBCR.top

          const val = ys[nearest]!
          tooltip.visible = true
          tooltip.date  = new Date(xs[nearest] * 1000).toISOString().slice(0, 10)
          tooltip.value = `${typeof val === 'number' ? val.toFixed(2) : val} ${props.unit}`
          // Flip left if too close to right edge
          const tipW = 130
          const raw  = ox + curLeft + 12
          tooltip.x = raw + tipW > cBCR.width ? ox + curLeft - tipW - 6 : raw
          tooltip.y = oy + curTop - 38
        },
      ],
      ready: [
        (u: uPlot) => {
          u.over.addEventListener('mouseleave', () => { tooltip.visible = false })
          u.over.addEventListener('click', (e: MouseEvent) => {
            const clickTs = u.posToVal(e.offsetX, 'x')
            const xs = u.data[0]
            const ys = u.data[1] as (number | null)[]
            let nearest = -1
            let minDist = Infinity
            for (let i = 0; i < xs.length; i++) {
              if (ys[i] == null) continue
              const dist = Math.abs(xs[i] - clickTs)
              if (dist < minDist) { minDist = dist; nearest = i }
            }
            if (nearest >= 0) {
              const dateStr = new Date(xs[nearest] * 1000).toISOString().slice(0, 10)
              emit('pointClick', dateStr)
            }
          })
        },
      ],
    },
    legend: { show: false },
    cursor: { show: true, x: true, y: false, drag: { x: false, y: false } },
    select: { show: false, left: 0, top: 0, width: 0, height: 0 },
  }

  uplot = new uPlot(opts, buildUplotData(props.data), containerRef.value)
}

function destroyChart() {
  if (uplot) {
    uplot.destroy()
    uplot = null
  }
}

onMounted(() => {
  createChart()

  resizeObserver = new ResizeObserver(() => {
    if (uplot) {
      const { width, height } = getSize()
      uplot.setSize({ width, height })
    }
  })
  if (containerRef.value) {
    resizeObserver.observe(containerRef.value)
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  destroyChart()
})

// Update data when it changes
watch(
  () => props.data,
  () => {
    if (uplot) {
      uplot.setData(buildUplotData(props.data))
    }
  },
)

// Redraw annotations when flags or selectedDate change (fast path — no data re-draw)
watch(
  [() => props.flags, () => props.flagLabels, () => props.selectedDate],
  () => {
    if (uplot) {
      uplot.redraw(false, true)
    }
  },
  { deep: true },
)

// Recreate chart when y-limits, unit, color, chartType, or theme change
watch(
  [() => props.yMin, () => props.yMax, () => props.unit, () => props.color, () => props.chartType, () => appStore.theme],
  () => {
    destroyChart()
    createChart()
  },
)
</script>

<style scoped>
.chart-container {
  width: 100%;
  height: 100%;
  overflow: visible;
  position: relative;
}

.chart-tooltip {
  position: absolute;
  z-index: 500;
  pointer-events: none;
  padding: 5px 9px;
  background: var(--bg-elevated, #1a2236);
  border: 1px solid var(--border-strong, #3a4a5c);
  border-radius: 6px;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  white-space: nowrap;
  color: var(--text-primary, #eaeef6);
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tip-date {
  color: var(--text-secondary, #8a9bb0);
  font-size: 10px;
}

.tip-value {
  font-size: 12px;
  font-weight: 600;
}
</style>
