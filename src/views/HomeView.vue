<template>
  <div class="tp-shell">
    <header class="topbar">
      <div class="brand" aria-label="Satellite Time Series Browser">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="6.5" fill="var(--accent)" />
          <ellipse cx="16" cy="16" rx="13.5" ry="6" stroke="var(--accent)" stroke-width="1.6" opacity=".82" transform="rotate(-28 16 16)" />
          <circle cx="27" cy="9.5" r="1.8" fill="var(--accent-2)" />
        </svg>
        <div class="brand-title">Satellite Time Series Browser</div>
      </div>

      <form class="search" @submit.prevent="runSearch">
        <span class="search-icon">⌕</span>
        <input
          ref="searchInput"
          v-model="searchQuery"
          type="search"
          placeholder="Search place or lat,lng"
          aria-label="Search a place or coordinates"
        />
      </form>

      <div class="date-range" ref="datePopoverRef">
        <button class="date-pill" type="button" @click="dateOpen = !dateOpen">
          <span class="pill-icon">Period</span>
          <span class="mono">{{ startDate }} -> {{ endDate }}</span>
          <span>⌄</span>
        </button>
        <div v-if="dateOpen" class="date-popover">
          <div class="popover-grid">
            <div class="presets">
              <div class="pop-label">Range</div>
              <button
                v-for="preset in presets"
                :key="preset.id"
                type="button"
                class="preset"
                :class="{ active: activePreset === preset.id }"
                @click="applyPreset(preset.id)"
              >
                <span>{{ preset.label }}</span>
                <span class="mono">{{ preset.short }}</span>
              </button>
            </div>
            <div class="custom-dates">
              <div class="pop-label">Custom</div>
              <label>
                <span>Start</span>
                <input v-model="pendingStart" type="date" min="2015-06-23" :max="pendingEnd" />
              </label>
              <label>
                <span>End</span>
                <input v-model="pendingEnd" type="date" :min="pendingStart" />
              </label>
            </div>
          </div>
          <div class="pop-actions">
            <button type="button" @click="resetPending">Clear</button>
            <button type="button" class="primary" @click="applyCustom">Apply</button>
          </div>
        </div>
      </div>

      <div class="top-actions">
        <button class="icon-btn" title="Share link" @click="copyShareLink">link</button>
      </div>
    </header>

    <nav class="tool-rail" aria-label="Map tools">
      <button class="tool active" title="Inspect point">⌖</button>
      <button class="tool" title="Search" @click="focusSearch">⌕</button>
      <button class="tool" :class="{ active: layersPanelOpen }" title="Layers" @click="layersPanelOpen = !layersPanelOpen">▤</button>
    </nav>

    <!-- Layers panel -->
    <aside v-if="layersPanelOpen" class="layers-panel" aria-label="Layer selector">
      <div class="layers-head">
        <span>Layers</span>
        <button class="icon-btn" @click="layersPanelOpen = false">✕</button>
      </div>

      <div class="layers-section">
        <div class="layers-group-label">Sentinel-2 Indices</div>
        <label class="layer-row layer-row--locked">
          <span class="layer-check layer-check--on">✓</span>
          <span class="layer-name">NDVI</span>
          <span class="layer-src">S2 L2A</span>
        </label>
      </div>

      <div class="layers-section">
        <div class="layers-group-label">Climate &amp; Weather</div>
        <label
          v-for="layer in CLIMATE_LAYERS"
          :key="layer.id"
          class="layer-row"
          @click="toggleClimateLayer(layer.id)"
        >
          <span class="layer-check" :class="{ 'layer-check--on': activeClimateIds.has(layer.id) }">
            {{ activeClimateIds.has(layer.id) ? '✓' : '' }}
          </span>
          <span class="layer-dot" :style="{ background: layer.color }"></span>
          <span class="layer-name">{{ layer.label }}</span>
          <span class="layer-src">{{ layer.source }}</span>
        </label>
      </div>
    </aside>

    <main class="map-stage">
      <div ref="mapEl" class="map"></div>
      <div v-if="!inspectorOpen" class="map-hint">Click anywhere on the map to analyze a Sentinel-2 time series</div>

      <div class="basemap-switcher">
        <button
          v-for="b in basemaps"
          :key="b.id"
          :class="{ active: activeBasemap === b.id }"
          @click="setBasemap(b.id)"
        >
          {{ b.label }}
        </button>
      </div>

      <aside ref="inspectorEl" class="inspector" :class="{ open: inspectorOpen }" aria-label="Location inspector">
        <div class="inspector-head">
          <div>
            <div class="place">{{ placeName }}</div>
            <div class="coord mono">{{ formattedCoordinate }}</div>
            <div class="meta">{{ sceneCountLabel }}</div>
          </div>
          <div class="head-actions">
            <button class="icon-btn" title="Copy link" @click="copyShareLink">link</button>
            <button class="icon-btn" title="Close inspector" @click="closeInspector">x</button>
          </div>
        </div>

        <div class="inspector-body">
          <section class="panel-card">
            <h3>
              Imagery
              <span class="segmented">
                <button :class="{ active: previewLayer === 'TRUE-COLOR' }" @click="previewLayer = 'TRUE-COLOR'">True</button>
                <button :class="{ active: previewLayer === 'FALSE-COLOR' }" @click="previewLayer = 'FALSE-COLOR'">False</button>
                <template v-for="layer in activeClimateLayers" :key="layer.id">
                  <button
                    :class="{ active: previewLayer === layer.imageryMode }"
                    :style="previewLayer === layer.imageryMode ? { background: currentPaletteColor(layer) + '28', color: currentPaletteColor(layer), borderColor: currentPaletteColor(layer) + '66' } : {}"
                    @click="previewLayer = layer.imageryMode"
                  >{{ climateImageryLabel(layer.id) }}</button>
                </template>
              </span>
            </h3>
            <!-- Climate data card -->
            <template v-if="activeClimateImageryLayer">
              <div class="climate-preview">
                <div class="climate-preview-value">
                  <span class="climate-num" :style="{ color: currentPaletteColor(activeClimateImageryLayer) }">
                    {{ climateValueAtDate(activeClimateImageryLayer.id) != null
                        ? Number(climateValueAtDate(activeClimateImageryLayer.id)).toFixed(1)
                        : '—' }}
                  </span>
                  <span class="climate-unit">{{ activeClimateImageryLayer.unit }}</span>
                  <span class="climate-date-label mono">{{ appStore.selectedDate ?? 'select a date' }}</span>
                </div>
                <div class="climate-gradient-wrap">
                  <div
                    class="climate-gradient-track"
                    :style="{ background: climateGradient(activeClimateImageryLayer.id) }"
                  >
                    <div
                      v-if="climateValueAtDate(activeClimateImageryLayer.id) != null"
                      class="climate-needle"
                      :style="{
                        left: climateNeedlePos(activeClimateImageryLayer) + '%',
                        background: currentPaletteColor(activeClimateImageryLayer),
                      }"
                    ></div>
                  </div>
                  <div class="climate-range-labels">
                    <span>{{ activeClimateImageryLayer.yMin }} {{ activeClimateImageryLayer.unit }}</span>
                    <span>{{ activeClimateImageryLayer.yMax }} {{ activeClimateImageryLayer.unit }}</span>
                  </div>
                </div>
                <div v-if="climateStats(activeClimateImageryLayer.id)" class="climate-stats">
                  <span>Min <b>{{ climateStats(activeClimateImageryLayer.id)!.min }}</b></span>
                  <span>Avg <b>{{ climateStats(activeClimateImageryLayer.id)!.avg }}</b></span>
                  <span>Max <b>{{ climateStats(activeClimateImageryLayer.id)!.max }}</b></span>
                  <span class="climate-src">{{ activeClimateImageryLayer.source }}</span>
                </div>
                <p v-else class="empty">Enable the layer and click the map to load data.</p>
              </div>
            </template>

            <!-- Satellite imagery -->
            <template v-else>
              <div v-if="sceneLoading" class="image-skeleton"></div>
              <div v-else-if="selectedScene" class="preview-tile">
                <div
                  ref="previewMapEl"
                  class="preview-map"
                  aria-label="Sentinel-2 preview for the selected location"
                ></div>
                <div class="img-zoom-controls">
                  <button @click.stop="zoomImageIn"    title="Zoom in (fetch closer tile)">＋</button>
                  <button @click.stop="zoomImageReset" title="Reset zoom">⊡</button>
                  <button @click.stop="zoomImageOut"   title="Zoom out (fetch wider tile)">－</button>
                </div>
                <span class="caption mono">{{ selectedSceneDate }} · cloud {{ selectedSceneCloud }}</span>
              </div>
              <p v-else class="empty">No Sentinel-2 scenes found in this date range.</p>
            </template>
          </section>

          <section class="panel-card">
            <h3>Available scenes <span class="tag">{{ sceneDates.length }} cloud-filtered</span></h3>
            <div v-if="ndviLoading && sceneDates.length === 0" class="release-skeleton"></div>
            <div v-else-if="sceneDates.length" class="release-list">
              <button
                v-for="date in sceneDates"
                :key="date"
                type="button"
                class="release"
                :class="{ active: date === appStore.selectedDate }"
                @click="onChartPointClick(date)"
              >
                <span class="mono">{{ date }}</span>
              </button>
            </div>
            <p v-else class="empty">No cloud-free scenes found in this date range.</p>
          </section>

          <section class="panel-card">
            <h3>
              NDVI time series
              <span class="tag-row">
                <span class="tag">S2 L2A</span>
                <span class="cloud-tag" title="Pixels with SCL classes 3, 7–11 (cloud, shadow, snow) are excluded">☁ cloud masked</span>
              </span>
            </h3>
            <div v-if="ndviError" class="error">{{ ndviError }}</div>
            <div v-if="ndviLoading && ndviData.length === 0" class="chart-skeleton"></div>
            <TimeSeriesChart
              v-else
              :data="ndviData"
              :flags="emptyFlags"
              :flag-labels="emptyFlagLabels"
              :selected-date="appStore.selectedDate"
              :y-min="0"
              :y-max="1"
              unit="NDVI"
              class="mini-chart"
              @point-click="onChartPointClick"
            />
          </section>


          <template v-for="layer in activeClimateLayers" :key="layer.id">
            <section class="panel-card">
              <h3>
                {{ layer.label }}
                <span class="segmented">
                  <button
                    v-for="palette in layer.palettes"
                    :key="palette.id"
                    :class="{ active: activePaletteId(layer.id) === palette.id }"
                    :style="activePaletteId(layer.id) === palette.id ? { background: palette.color + '28', color: palette.color, borderColor: palette.color + '66' } : {}"
                    @click="setLayerPalette(layer.id, palette.id)"
                  >{{ palette.label }}</button>
                </span>
              </h3>
              <div v-if="climateErrors[layer.id]" class="error">{{ climateErrors[layer.id] }}</div>
              <div v-else-if="climateLoading[layer.id] && !climateData[layer.id]?.length" class="chart-skeleton"></div>
              <TimeSeriesChart
                v-else
                :data="(climateData[layer.id] ?? [])"
                :flags="emptyFlags"
                :flag-labels="emptyFlagLabels"
                :selected-date="appStore.selectedDate"
                :y-min="layer.yMin"
                :y-max="layer.yMax"
                :unit="layer.unit"
                :color="currentPaletteColor(layer)"
                :chart-type="layer.chartType"
                class="mini-chart"
                @point-click="onChartPointClick"
              />
            </section>
          </template>

        </div>
      </aside>
    </main>

    <footer class="statusbar">
      <span class="mono strong">{{ statusCoordinate }}</span>
      <span>|</span>
      <span>zoom {{ mapZoom }}</span>
      <span>|</span>
      <span>Sentinel-2 L2A · Microsoft Planetary Computer</span>
      <span class="status-right">Imagery (c) Esri</span>
    </footer>

    <div v-if="toast" class="toast">{{ toast }}</div>

  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAppStore } from '../stores/app'
import { getDataSource } from '../config/datasources'
import { useTimeSeries } from '../composables/useTimeSeries'
import TimeSeriesChart from '../plugins/timeSeries/TimeSeriesChart.vue'
import { BASEMAPS, getBasemap, type BasemapId } from '../utils/basemap'
import { serialiseUrl } from '../utils/url'
import {
  getTileUrl,
  searchSentinel2Items,
  stacItemCloudCover,
  stacItemDate,
  type PcStacItem,
} from '../services/planetaryComputerApi'
import {
  CLIMATE_LAYERS,
  fetchClimateTimeSeries,
  type ClimateLayer,
  type ClimatePoint,
} from '../services/climateApi'
import type { Flags, FlagLabels } from '../types/state'


const appStore = useAppStore()
const mapEl = ref<HTMLDivElement | null>(null)
const inspectorEl = ref<HTMLElement | null>(null)
const previewMapEl = ref<HTMLDivElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const datePopoverRef = ref<HTMLElement | null>(null)

const basemaps = BASEMAPS
const activeBasemap = ref<BasemapId>('satellite')
const initialParams = new URLSearchParams(window.location.search)
const inspectorOpen = ref(initialParams.has('lon') || initialParams.has('lng'))
const searchQuery = ref('')
const placeName = ref(inspectorOpen.value ? 'Selected location' : 'Choose a location')
const mapZoom = ref(3)
const statusCoordinate = ref('move over map')
const toast = ref('')

const dateOpen = ref(false)
const startDate = ref(appStore.startDate)
const endDate = ref(appStore.endDate)
const pendingStart = ref(startDate.value)
const pendingEnd = ref(endDate.value)
const activePreset = ref('5y')

const previewLayer = ref<string>('TRUE-COLOR')
const sceneLoading = ref(false)
const scenes = ref<PcStacItem[]>([])
const selectedScene = ref<PcStacItem | null>(null)
const PREVIEW_DEFAULT_ZOOM = 16
const previewTileZoom = ref(PREVIEW_DEFAULT_ZOOM)

// Scene dates derived from NDVI data — these are the exact dates shown in the chart
const sceneDates = computed(() =>
  ndviData.value
    .filter(p => p.value !== null)
    .map(p => p.date)
    .sort((a, b) => b.localeCompare(a)),
)

// Layers panel
const layersPanelOpen = ref(false)
const activeClimateIds = ref(new Set<string>())
const activeClimateLayers = computed(() => CLIMATE_LAYERS.filter(l => activeClimateIds.value.has(l.id)))

const climateData = reactive<Record<string, ClimatePoint[]>>({})
const climateLoading = reactive<Record<string, boolean>>({})
const climateErrors = reactive<Record<string, string | null>>({})

async function fetchClimate(layerId: string) {
  const [lon, lat] = appStore.coordinate
  climateLoading[layerId] = true
  climateErrors[layerId] = null
  try {
    climateData[layerId] = await fetchClimateTimeSeries(lat, lon, appStore.startDate, appStore.endDate, layerId)
  } catch (e) {
    climateErrors[layerId] = e instanceof Error ? e.message : String(e)
    climateData[layerId] = []
  } finally {
    climateLoading[layerId] = false
  }
}

const CLIMATE_IMAGERY_LABELS: Record<string, string> = {
  temperature: 'Temp',
  precipitation: 'Precip',
  et0: 'ET₀',
}

function climateImageryLabel(id: string): string {
  return CLIMATE_IMAGERY_LABELS[id] ?? id
}

function toggleClimateLayer(id: string) {
  const next = new Set(activeClimateIds.value)
  if (next.has(id)) {
    next.delete(id)
    // Reset imagery if this layer's mode was active
    const removed = CLIMATE_LAYERS.find(l => l.id === id)
    if (removed && previewLayer.value === removed.imageryMode) {
      previewLayer.value = 'TRUE-COLOR'
    }
  } else {
    next.add(id)
    if (inspectorOpen.value) fetchClimate(id)
  }
  activeClimateIds.value = next
}

watch(
  [() => appStore.coordinate, () => appStore.startDate, () => appStore.endDate],
  () => {
    for (const id of activeClimateIds.value) {
      if (inspectorOpen.value) fetchClimate(id)
    }
  },
  { deep: true },
)

const emptyFlags: Flags = {}
const emptyFlagLabels: FlagLabels = {}
const maskClouds = ref(true)
const ndviSource = ref(getDataSource('S2_NDVI'))
const { data: ndviData, loading: ndviLoading, error: ndviError } = useTimeSeries(ndviSource, maskClouds)

watch(() => appStore.coordinate, () => {
  previewTileZoom.value = PREVIEW_DEFAULT_ZOOM
  updatePreviewMarker()
  centerPreviewMap(PREVIEW_DEFAULT_ZOOM)
})

function zoomImageIn() {
  previewMap?.zoomIn()
}

function zoomImageOut() {
  previewMap?.zoomOut()
}

function zoomImageReset() {
  previewTileZoom.value = PREVIEW_DEFAULT_ZOOM
  centerPreviewMap(PREVIEW_DEFAULT_ZOOM)
}

// Climate palette selection (per layer id → palette id)
const activePalettes = reactive<Record<string, string>>({})

function activePaletteId(layerId: string): string {
  return activePalettes[layerId] ?? CLIMATE_LAYERS.find(l => l.id === layerId)?.palettes[0]?.id ?? ''
}

function setLayerPalette(layerId: string, paletteId: string) {
  activePalettes[layerId] = paletteId
}

function currentPaletteColor(layer: ClimateLayer): string {
  const id = activePaletteId(layer.id)
  return layer.palettes.find(p => p.id === id)?.color ?? layer.color
}

// Which climate layer's imagery card is currently active (if any)
const activeClimateImageryLayer = computed(() =>
  previewLayer.value.startsWith('climate:')
    ? CLIMATE_LAYERS.find(l => l.imageryMode === previewLayer.value) ?? null
    : null,
)

watch(
  [selectedScene, previewLayer, sceneLoading, activeClimateImageryLayer],
  () => {
    if (sceneLoading.value || !selectedScene.value || activeClimateImageryLayer.value) {
      destroyPreviewMap()
      return
    }
    updatePreviewImagery()
  },
  { flush: 'post' },
)

// Value for the selected date from fetched climate data
function climateValueAtDate(layerId: string): number | null {
  const date = appStore.selectedDate
  if (!date) return null
  return climateData[layerId]?.find(p => p.date === date)?.value ?? null
}

// Stats over the whole fetched series
function climateStats(layerId: string): { min: string; avg: string; max: string } | null {
  const values = climateData[layerId]?.map(p => p.value).filter((v): v is number => v !== null)
  if (!values?.length) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const avg = values.reduce((a, b) => a + b, 0) / values.length
  return { min: min.toFixed(1), avg: avg.toFixed(1), max: max.toFixed(1) }
}

// Needle position (0–100%) on the gradient bar
function climateNeedlePos(layer: ClimateLayer): number {
  const v = climateValueAtDate(layer.id)
  if (v == null) return 0
  const pct = (v - layer.yMin) / (layer.yMax - layer.yMin)
  return Math.max(0, Math.min(100, pct * 100))
}

// CSS gradient string appropriate to each variable
const CLIMATE_GRADIENTS: Record<string, string> = {
  temperature:   'linear-gradient(to right, #4DA6FF, #FFFFFF 50%, #E05252)',
  precipitation: 'linear-gradient(to right, #F5F5DC, #4DA6FF)',
  et0:           'linear-gradient(to right, #FFEB3B, #3BAE70)',
}
function climateGradient(layerId: string): string {
  return CLIMATE_GRADIENTS[layerId] ?? 'linear-gradient(to right, var(--bg-panel-2), var(--accent))'
}

let map: L.Map | null = null
let baseLayer: L.TileLayer | null = null
let labelLayer: L.TileLayer | null = null
let marker: L.Marker | null = null
let previewMap: L.Map | null = null
let previewTileLayer: L.TileLayer | null = null
let previewMarker: L.Marker | null = null
let previewResizeObserver: ResizeObserver | null = null
let sceneRequestId = 0
let previewTileRequestId = 0

const presets = [
  { id: '1y', label: 'Last 12 months', short: '1y' },
  { id: '2y', label: 'Last 2 years', short: '2y' },
  { id: '5y', label: 'Last 5 years', short: '5y' },
  { id: 'all', label: 'Full archive', short: '2015-' },
]

const formattedCoordinate = computed(() => {
  const [lon, lat] = appStore.coordinate
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(5)} ${ns}, ${Math.abs(lon).toFixed(5)} ${ew}`
})

const sceneCountLabel = computed(() => {
  if (!inspectorOpen.value) return 'Click the map to start'
  if (sceneLoading.value) return 'Searching Sentinel-2 scenes...'
  return `${scenes.value.length} Sentinel-2 scenes in range`
})

const selectedSceneDate = computed(() => selectedScene.value ? stacItemDate(selectedScene.value) : '')
const selectedSceneCloud = computed(() => {
  if (!selectedScene.value) return '-'
  const cloud = stacItemCloudCover(selectedScene.value)
  return Number.isFinite(cloud) ? `${cloud.toFixed(1)}%` : 'unknown'
})


function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function yearsAgoIso(years: number): string {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - years)
  return d.toISOString().slice(0, 10)
}

function applyPreset(id: string) {
  activePreset.value = id
  const end = todayIso()
  const start = id === 'all' ? '2015-06-23' : yearsAgoIso(id === '1y' ? 1 : id === '2y' ? 2 : 5)
  pendingStart.value = start
  pendingEnd.value = end
  applyCustom()
}

function resetPending() {
  pendingStart.value = startDate.value
  pendingEnd.value = endDate.value
}

function applyCustom() {
  if (pendingStart.value >= pendingEnd.value) return
  startDate.value = pendingStart.value
  endDate.value = pendingEnd.value
  appStore.setDateRange(startDate.value, endDate.value)
  dateOpen.value = false
  updateUrl()
  if (inspectorOpen.value) {
    loadSceneSummary()
  }
}

function setBasemap(id: BasemapId) {
  activeBasemap.value = id
  const def = getBasemap(id)
  if (baseLayer) baseLayer.setUrl(def.url)
  if (labelLayer && map) {
    map.removeLayer(labelLayer)
    labelLayer = null
  }
  if (def.labelUrl && map) {
    labelLayer = L.tileLayer(def.labelUrl, { maxZoom: def.options.maxZoom, pane: 'overlayPane' }).addTo(map)
  }
}

function markerIcon() {
  return L.divIcon({
    className: 'tp-marker',
    html: '<span></span>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
}

function previewMarkerIcon() {
  return L.divIcon({
    className: 'tp-preview-marker',
    html: '<span></span>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
}

function isDesktopInspector() {
  return window.matchMedia('(min-width: 861px)').matches
}

function visibleBasemapCenterFor(lon: number, lat: number, zoom: number): L.LatLngExpression {
  if (!map || !inspectorOpen.value || !isDesktopInspector()) return [lat, lon]

  const size = map.getSize()
  const inspectorWidth = inspectorEl.value?.getBoundingClientRect().width ?? size.x / 2
  const visibleWidth = Math.max(1, size.x - inspectorWidth)
  const desiredPoint = L.point(visibleWidth / 2, size.y / 2)
  const containerCenter = L.point(size.x / 2, size.y / 2)
  const selectedPoint = map.project([lat, lon], zoom)
  const targetCenterPoint = selectedPoint.add(containerCenter.subtract(desiredPoint))
  return map.unproject(targetCenterPoint, zoom)
}

function centerMainMapOnPoint(lon: number, lat: number, zoom = map?.getZoom() ?? 12, animate = true) {
  if (!map) return
  const center = visibleBasemapCenterFor(lon, lat, zoom)
  if (animate) map.flyTo(center, zoom, { duration: 0.45 })
  else map.setView(center, zoom)
}

function setSelectedPoint(lon: number, lat: number, name = 'Selected location') {
  appStore.setCoordinate(lon, lat)
  placeName.value = name
  inspectorOpen.value = true
  statusCoordinate.value = `${lat.toFixed(5)}, ${lon.toFixed(5)}`
  if (map) {
    if (marker) marker.setLatLng([lat, lon])
    else marker = L.marker([lat, lon], { icon: markerIcon() }).addTo(map)
  }
  centerMainMapOnPoint(lon, lat, Math.max(map?.getZoom() ?? 12, 12))
  updateUrl()
  loadSceneSummary()
  for (const id of activeClimateIds.value) fetchClimate(id)
}

async function ensurePreviewMap() {
  await nextTick()
  if (!previewMapEl.value || previewMap) return

  const [lon, lat] = appStore.coordinate
  previewMap = L.map(previewMapEl.value, {
    attributionControl: false,
    zoomControl: false,
    minZoom: 10,
    maxZoom: 18,
    zoomSnap: 1,
    zoomDelta: 1,
    scrollWheelZoom: true,
    worldCopyJump: true,
  }).setView([lat, lon], previewTileZoom.value)

  L.DomEvent.disableClickPropagation(previewMapEl.value)
  L.DomEvent.disableScrollPropagation(previewMapEl.value)

  previewMarker = L.marker([lat, lon], {
    icon: previewMarkerIcon(),
    interactive: false,
    keyboard: false,
  }).addTo(previewMap)

  previewMap.on('zoomend', () => {
    if (previewMap) previewTileZoom.value = previewMap.getZoom()
  })

  previewResizeObserver = new ResizeObserver(() => previewMap?.invalidateSize())
  previewResizeObserver.observe(previewMapEl.value)
}

function updatePreviewMarker() {
  const [lon, lat] = appStore.coordinate
  previewMarker?.setLatLng([lat, lon])
}

function centerPreviewMap(zoom = previewTileZoom.value) {
  if (!previewMap) return
  const [lon, lat] = appStore.coordinate
  previewMap.setView([lat, lon], zoom)
  previewTileZoom.value = zoom
  updatePreviewMarker()
}

async function updatePreviewImagery() {
  if (!selectedScene.value || activeClimateImageryLayer.value || sceneLoading.value) return

  const requestId = ++previewTileRequestId
  await ensurePreviewMap()
  if (!previewMap || !selectedScene.value) return

  try {
    const tileUrl = await getTileUrl(selectedScene.value, previewLayer.value)
    if (requestId !== previewTileRequestId || !previewMap) return

    if (previewTileLayer) {
      previewTileLayer.setUrl(tileUrl)
    } else {
      previewTileLayer = L.tileLayer(tileUrl, {
        minZoom: 10,
        maxZoom: 18,
        maxNativeZoom: 18,
        keepBuffer: 3,
        updateWhenIdle: false,
      }).addTo(previewMap)
    }

    updatePreviewMarker()
    previewMarker?.bringToFront()
    centerPreviewMap(previewTileZoom.value)
  } catch (e) {
    if (requestId === previewTileRequestId) {
      showToast(e instanceof Error ? e.message : String(e))
    }
  }
}

function destroyPreviewMap() {
  previewTileRequestId++
  previewResizeObserver?.disconnect()
  previewResizeObserver = null
  previewMap?.remove()
  previewMap = null
  previewTileLayer = null
  previewMarker = null
}

function closeInspector() {
  inspectorOpen.value = false
  const url = new URL(window.location.href)
  url.searchParams.delete('lon')
  url.searchParams.delete('lat')
  url.searchParams.delete('selected')
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

function recenterSelectedPointInBasemap(animate = false) {
  if (!inspectorOpen.value) return
  const [lon, lat] = appStore.coordinate
  centerMainMapOnPoint(lon, lat, Math.max(map?.getZoom() ?? 12, 12), animate)
}

function updateUrl() {
  if (!inspectorOpen.value) return
  history.replaceState(null, '', serialiseUrl({
    lon: appStore.coordinate[0],
    lat: appStore.coordinate[1],
    start: startDate.value,
    end: endDate.value,
    selected: appStore.selectedDate,
  }))
}

function chooseScene(items: PcStacItem[]): PcStacItem | null {
  if (!items.length) return null
  const selected = appStore.selectedDate
  const candidates = selected ? items.filter(i => stacItemDate(i) === selected) : items
  const pool = candidates.length ? candidates : items
  const clear = pool.filter(i => stacItemCloudCover(i) <= 20)
  return [...(clear.length ? clear : pool)].sort((a, b) => {
    const dateCompare = stacItemDate(b).localeCompare(stacItemDate(a))
    if (dateCompare !== 0) return dateCompare
    return stacItemCloudCover(a) - stacItemCloudCover(b)
  })[0] ?? null
}

async function loadSceneSummary() {
  if (!inspectorOpen.value) return
  const requestId = ++sceneRequestId
  const [lon, lat] = appStore.coordinate
  sceneLoading.value = true
  scenes.value = []
  selectedScene.value = null
  try {
    const items = await searchSentinel2Items(lon, lat, startDate.value, endDate.value)
    if (requestId !== sceneRequestId) return
    scenes.value = items
    selectedScene.value = chooseScene(items)
  } catch (e) {
    if (requestId !== sceneRequestId) return
    showToast(e instanceof Error ? e.message : String(e))
  } finally {
    if (requestId === sceneRequestId) sceneLoading.value = false
  }
}


function onChartPointClick(date: string) {
  appStore.setSelectedDate(date)
  updateUrl()
  loadSceneSummary()
}

async function runSearch() {
  const q = searchQuery.value.trim()
  if (!q) return
  const coordMatch = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/)
  if (coordMatch) {
    const first = parseFloat(coordMatch[1])
    const second = parseFloat(coordMatch[2])
    const lat = Math.abs(first) <= 90 ? first : second
    const lon = Math.abs(first) <= 90 ? second : first
    setSelectedPoint(lon, lat, 'Searched coordinate')
    return
  }

  try {
    const params = new URLSearchParams({ q, format: 'jsonv2', limit: '1' })
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`)
    const results = await response.json() as Array<{ lat: string; lon: string; display_name: string }>
    const first = results[0]
    if (!first) {
      showToast('No place found.')
      return
    }
    const lat = parseFloat(first.lat)
    const lon = parseFloat(first.lon)
    setSelectedPoint(lon, lat, first.display_name.split(',').slice(0, 2).join(', '))
  } catch {
    showToast('Search failed.')
  }
}

function focusSearch() {
  searchInput.value?.focus()
}

async function copyShareLink() {
  updateUrl()
  try {
    await navigator.clipboard.writeText(window.location.href)
    showToast('Share link copied.')
  } catch {
    showToast('Could not copy link.')
  }
}

function showToast(message: string) {
  toast.value = message
  window.setTimeout(() => {
    if (toast.value === message) toast.value = ''
  }, 2400)
}

function onDocumentClick(e: MouseEvent) {
  if (datePopoverRef.value && !datePopoverRef.value.contains(e.target as Node)) {
    dateOpen.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeInspector()
  if (e.key === '/' && document.activeElement !== searchInput.value) {
    e.preventDefault()
    focusSearch()
  }
}

function onWindowResize() {
  map?.invalidateSize()
  previewMap?.invalidateSize()
  recenterSelectedPointInBasemap(false)
}

onMounted(() => {
  if (appStore.theme !== 'dark') appStore.theme = 'dark'
  if (!mapEl.value) return
  const [lon, lat] = appStore.coordinate
  const def = getBasemap(activeBasemap.value)
  map = L.map(mapEl.value, {
    zoomControl: false,
    attributionControl: true,
    worldCopyJump: true,
  }).setView([lat, lon], inspectorOpen.value ? 13 : 3)
  L.control.zoom({ position: 'topright' }).addTo(map)
  baseLayer = L.tileLayer(def.url, def.options).addTo(map)
  if (def.labelUrl) {
    labelLayer = L.tileLayer(def.labelUrl, { maxZoom: def.options.maxZoom, pane: 'overlayPane' }).addTo(map)
  }

  map.on('click', (e: L.LeafletMouseEvent) => {
    const { lng, lat } = e.latlng.wrap()
    setSelectedPoint(lng, lat)
  })
  map.on('mousemove', (e: L.LeafletMouseEvent) => {
    statusCoordinate.value = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`
  })
  map.on('zoomend', () => { mapZoom.value = map?.getZoom() ?? mapZoom.value })
  mapZoom.value = map.getZoom()

  if (inspectorOpen.value) {
    marker = L.marker([lat, lon], { icon: markerIcon() }).addTo(map)
    centerMainMapOnPoint(lon, lat, 13, false)
    loadSceneSummary()
  }

  document.addEventListener('click', onDocumentClick, true)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onWindowResize)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick, true)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onWindowResize)
  destroyPreviewMap()
  map?.remove()
  map = null
})

</script>

<style scoped>
.tp-shell {
  display: grid;
  grid-template-columns: 52px 1fr;
  grid-template-rows: 52px 1fr 28px;
  grid-template-areas:
    "top top"
    "rail main"
    "rail status";
  height: 100vh;
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: 13px;
}

.mono { font-family: var(--font-mono); }

.topbar {
  grid-area: top;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  z-index: 1200;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  white-space: nowrap;
}

.brand svg {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
}

.brand-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--text-primary);
}

.search {
  flex: 0 1 340px;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  background: var(--bg-panel-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
}

.search:focus-within {
  border-color: rgba(54, 226, 164, 0.5);
  box-shadow: 0 0 0 3px var(--accent-dim);
}

.search input {
  flex: 1;
  min-width: 0;
  background: none;
  border: 0;
  outline: none;
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: 12.5px;
}

.search-icon,
.pill-icon {
  color: var(--accent);
  font-size: 11px;
  text-transform: uppercase;
}

.date-range {
  position: relative;
  margin-left: auto;
}

.date-pill {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-panel-2);
  color: var(--text-primary);
  cursor: pointer;
  padding: 0 14px;
}

.date-pill:hover {
  border-color: var(--border-strong);
}

.date-popover {
  position: absolute;
  top: 42px;
  right: 0;
  width: 430px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  padding: 12px;
  z-index: 1500;
}

.popover-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.pop-label {
  margin: 2px 4px 8px;
  color: var(--text-muted);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.preset {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: var(--font-ui);
  padding: 8px 10px;
}

.preset:hover {
  background: var(--bg-panel-2);
  color: var(--text-primary);
}

.preset.active {
  background: var(--accent-dim);
  color: var(--accent);
}

.custom-dates {
  display: grid;
  gap: 10px;
}

.custom-dates label {
  display: grid;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 11px;
}

.custom-dates input {
  background: var(--bg-panel-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  color-scheme: dark;
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 8px;
}

.pop-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.pop-actions button,
.source-modal button {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-panel-2);
  color: var(--text-primary);
  cursor: pointer;
  padding: 7px 12px;
}

.pop-actions .primary,
.source-modal button {
  background: var(--accent-dim);
  border-color: rgba(54, 226, 164, 0.35);
  color: var(--accent);
}

.top-actions {
  display: flex;
  align-items: center;
  gap: 7px;
}


.icon-btn {
  display: grid;
  place-items: center;
  min-width: 34px;
  height: 34px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: 12px;
  padding: 0 8px;
}

.icon-btn:hover {
  background: var(--bg-panel-2);
  border-color: var(--border);
  color: var(--text-primary);
}

.tool-rail {
  grid-area: rail;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding-top: 12px;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  z-index: 1100;
}

.tool {
  width: 36px;
  height: 36px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.tool:hover {
  background: var(--bg-panel-2);
  color: var(--text-primary);
}

.tool.active {
  background: var(--accent-dim);
  border-color: rgba(54, 226, 164, 0.3);
  color: var(--accent);
}

.tool.settings {
  margin-top: auto;
  margin-bottom: 12px;
}

.map-stage {
  grid-area: main;
  position: relative;
  overflow: hidden;
}

.map {
  position: absolute;
  inset: 0;
}

:deep(.tp-marker span) {
  display: block;
  width: 18px;
  height: 18px;
  border: 2px solid var(--accent);
  border-radius: 50%;
  background: rgba(54, 226, 164, 0.25);
  box-shadow: 0 0 14px rgba(54, 226, 164, 0.9);
}

.map-hint {
  position: absolute;
  left: 50%;
  bottom: 24px;
  z-index: 600;
  transform: translateX(-50%);
  border: 1px solid var(--border);
  border-radius: 999px;
  background: rgba(18, 24, 38, 0.88);
  color: var(--text-secondary);
  padding: 8px 16px;
  backdrop-filter: blur(8px);
}

.basemap-switcher {
  position: absolute;
  left: 14px;
  bottom: 34px;
  z-index: 700;
  display: flex;
  gap: 2px;
  padding: 3px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-2);
}

.basemap-switcher button {
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 11px;
  padding: 6px 12px;
}

.basemap-switcher button.active {
  background: var(--accent-dim);
  color: var(--accent);
}

.inspector {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 900;
  display: flex;
  flex-direction: column;
  width: 50vw;
  height: 100%;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow-pop);
  transform: translateX(100%);
  transition: transform 220ms cubic-bezier(0.4, 0, 0.2, 1);
}

.inspector.open {
  transform: translateX(0);
}

.inspector-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}

.place {
  font-size: 14px;
  font-weight: 600;
}

.coord {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 11.5px;
}

.meta {
  margin-top: 5px;
  color: var(--text-muted);
  font-size: 11px;
}

.head-actions {
  display: flex;
  gap: 4px;
}

.inspector-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px 28px;
}

.panel-card {
  margin-bottom: 14px;
  padding: 12px;
  background: var(--bg-panel-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.panel-card h3 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 10px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.tag {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
}

.tag-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cloud-tag {
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--accent-2);
  background: rgba(77, 166, 255, 0.12);
  border: 1px solid rgba(77, 166, 255, 0.25);
  border-radius: 4px;
  padding: 1px 5px;
  cursor: default;
}

.segmented {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 2px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.segmented button {
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: 11px;
  padding: 4px 9px;
}

.segmented button.active {
  background: var(--accent-dim);
  color: var(--accent);
}

.preview-tile,
.image-skeleton {
  position: relative;
  width: 100%;
  aspect-ratio: 2.4;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
}

.preview-map {
  position: absolute;
  inset: 0;
  background: var(--bg-base);
  cursor: grab;
}

.preview-map:active {
  cursor: grabbing;
}

:deep(.tp-preview-marker span) {
  display: block;
  width: 18px;
  height: 18px;
  border: 2px solid var(--accent);
  border-radius: 50%;
  background: rgba(54, 226, 164, 0.22);
  box-shadow: 0 0 12px rgba(54, 226, 164, 0.85);
}

:deep(.preview-map .leaflet-tile-container) {
  will-change: transform;
}

.img-zoom-controls {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.img-zoom-controls button {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: rgba(10, 14, 22, 0.82);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  backdrop-filter: blur(4px);
}

.img-zoom-controls button:hover {
  background: rgba(54, 226, 164, 0.18);
  border-color: var(--accent);
  color: var(--accent);
}

.scene-crosshair {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
}

.crosshair-h,
.crosshair-v {
  position: absolute;
  background: rgba(54, 226, 164, 0.55);
}

.crosshair-h {
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 28px;
  height: 1px;
}

.crosshair-v {
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 1px;
  height: 28px;
}

.crosshair-dot {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent);
}

.caption {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 3px 7px;
  background: rgba(10, 14, 22, 0.76);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 10px;
}

.release-list {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.release {
  flex: 0 0 auto;
  display: grid;
  gap: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 6px 8px;
  text-align: left;
}

.release.active {
  border-color: var(--accent);
  color: var(--accent);
}

.release small {
  color: var(--text-muted);
  font-size: 10px;
}

.mini-chart {
  height: 150px;
}

.chart-skeleton,
.release-skeleton,
.image-skeleton {
  background: linear-gradient(90deg, var(--bg-panel-2) 25%, #202a3a 37%, var(--bg-panel-2) 63%);
  background-size: 400% 100%;
  animation: shimmer 1.35s ease infinite;
  border-radius: var(--radius-sm);
}

.chart-skeleton {
  height: 150px;
}

.release-skeleton {
  height: 44px;
}

@keyframes shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

.empty,
.error {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.error {
  color: var(--error);
}


.statusbar {
  grid-area: status;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 16px;
  background: var(--bg-panel);
  border-top: 1px solid var(--border);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}

.statusbar .strong {
  color: var(--text-secondary);
}

.status-right {
  margin-left: auto;
}

.toast {
  position: fixed;
  right: 18px;
  bottom: 42px;
  z-index: 3000;
  padding: 10px 13px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  box-shadow: var(--shadow-pop);
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2600;
  display: grid;
  place-items: center;
  background: var(--bg-overlay);
}

.source-modal {
  width: min(480px, 90vw);
  padding: 22px;
  background: var(--bg-panel);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-pop);
}

.source-modal h2 {
  margin: 0 0 10px;
  font-size: 18px;
}

.source-modal p {
  margin: 0 0 18px;
  color: var(--text-secondary);
  line-height: 1.55;
}

/* ---- Climate data card (imagery section) ---- */
.climate-preview {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0;
}

.climate-preview-value {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.climate-num {
  font-size: 42px;
  font-weight: 700;
  font-family: var(--font-mono);
  line-height: 1;
}

.climate-unit {
  font-size: 16px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.climate-date-label {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted);
}

.climate-gradient-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.climate-gradient-track {
  position: relative;
  height: 18px;
  border-radius: var(--radius-sm);
  overflow: visible;
}

.climate-needle {
  position: absolute;
  top: -4px;
  width: 3px;
  height: 26px;
  border-radius: 2px;
  transform: translateX(-50%);
  box-shadow: 0 0 6px rgba(0,0,0,0.5);
}

.climate-range-labels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.climate-stats {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--text-secondary);
}

.climate-stats b {
  color: var(--text-primary);
  font-family: var(--font-mono);
}

.climate-src {
  margin-left: auto;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

/* ---- Layers panel ---- */
.layers-panel {
  position: fixed;
  top: 52px; /* below topbar */
  left: 52px; /* right of tool-rail */
  z-index: 1050;
  width: 260px;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  border-radius: 0 0 var(--radius-md) 0;
  box-shadow: var(--shadow-pop);
  overflow-y: auto;
  max-height: calc(100vh - 80px);
}

.layers-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.layers-section {
  padding: 10px 0 6px;
  border-bottom: 1px solid var(--border);
}

.layers-section:last-child {
  border-bottom: 0;
}

.layers-group-label {
  padding: 2px 12px 8px;
  color: var(--text-muted);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.layer-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 12px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  margin: 0 4px;
  user-select: none;
}

.layer-row:hover {
  background: var(--bg-panel-2);
}

.layer-row--locked {
  cursor: default;
  opacity: 0.7;
}

.layer-check {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 10px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.layer-check--on {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: var(--accent);
}

.layer-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.layer-name {
  flex: 1;
  font-size: 12px;
  color: var(--text-primary);
}

.layer-src {
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  white-space: nowrap;
}

@media (max-width: 860px) {
  .tp-shell {
    grid-template-columns: 44px 1fr;
  }

  .brand {
    min-width: auto;
  }

  .brand-sub,
  .search {
    display: none;
  }

  .date-popover {
    right: -96px;
    width: min(430px, calc(100vw - 24px));
  }

  .inspector {
    top: auto;
    bottom: 0;
    width: 100%;
    height: min(72vh, 620px);
    border-top: 1px solid var(--border);
    border-left: 0;
    transform: translateY(100%);
  }

  .inspector.open {
    transform: translateY(0);
  }
}
</style>
