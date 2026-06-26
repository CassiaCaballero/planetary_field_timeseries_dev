<template>
  <div class="map-panel">
    <div v-if="status === 'loading'" class="map-status">
      Loading Planetary Computer imagery...
    </div>
    <div v-else-if="status === 'error'" class="map-status map-status-error" :title="errorDetail">
      Imagery failed - {{ errorDetail }}
    </div>
    <div ref="mapEl" class="map-container"></div>

    <PanelSettingsModal
      v-if="showSettings"
      title="Map Settings"
      @cancel="showSettings = false"
      @apply="applySettings"
    >
      <label class="field-row">
        <span class="field-label">Layer</span>
        <select v-model="pendingLayer" class="field-select">
          <option v-for="l in layers" :key="l.id" :value="l.id">{{ l.title }}</option>
        </select>
      </label>
    </PanelSettingsModal>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAppStore } from '../../stores/app'
import { useLayoutStore } from '../../stores/layout'
import { usePanelSettingsStore } from '../../stores/panelSettings'
import { basemapUrl } from '../../utils/basemap'
import { buildPixelPolygon } from '../../utils/geometry'
import {
  findBestMapItem,
  getTileUrl,
  PC_LAYERS,
  type PcLayer,
} from '../../services/planetaryComputerApi'
import PanelSettingsModal from '../../components/PanelSettingsModal.vue'
import { loadMississippiFields, type FieldFeature } from '../../services/fieldBoundaries'
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'

// dockview-vue passes a single `params` prop containing both the user-defined
// params (under params.params) and the panel API (under params.api).
type UserParams = { activeLayer?: string }
type PanelApi = {
  id: string
  updateParameters(p: Record<string, unknown>): void
  setTitle(title: string): void
}

const props = defineProps<{
  params?: { params?: UserParams; api?: PanelApi }
}>()

const panelApi = () => props.params?.api

const appStore = useAppStore()
const layoutStore = useLayoutStore()
const settingsStore = usePanelSettingsStore()

const mapEl = ref<HTMLDivElement | null>(null)
const activeLayer = ref<string>(props.params?.params?.activeLayer ?? 'TRUE-COLOR')
const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const errorDetail = ref('')
const layers = ref<PcLayer[]>(PC_LAYERS)

let map: L.Map | null = null
let basemap: L.TileLayer | null = null
let imageryLayer: L.TileLayer | null = null
let marker: L.Polygon | null = null
let fieldsLayer: L.GeoJSON | null = null
let allFields: FeatureCollection<Polygon | MultiPolygon> | null = null
let fieldsLoading = false
let resizeObserver: ResizeObserver | null = null
let imageryRequestId = 0
let fieldsRequestId = 0

const coordinate = computed(() => appStore.coordinate)
const selectedDate = computed(() => appStore.selectedDate)
const FIELD_LOAD_ZOOM = 16

function pixelLatLngs(lon: number, lat: number): L.LatLngExpression[] {
  return buildPixelPolygon(lon, lat).coordinates[0].map(([lng, la]) => [la, lng] as L.LatLngExpression)
}

function layerTitle(layerId: string): string {
  return layers.value.find(l => l.id === layerId)?.title ?? layerId
}

function initMap() {
  if (!mapEl.value || map) return

  const [lon, lat] = coordinate.value
  map = L.map(mapEl.value, { zoomControl: true, attributionControl: false }).setView(
    [lat, lon],
    16
  )

  basemap = L.tileLayer(basemapUrl(), { maxZoom: 19 }).addTo(map)

  marker = L.polygon(pixelLatLngs(lon, lat), {
    color: '#ffff00',
    fillOpacity: 0,
    weight: 2,
  }).addTo(map)

  resizeObserver = new ResizeObserver(() => map?.invalidateSize())
  resizeObserver.observe(mapEl.value)
  map.on('zoomend moveend', updateFieldsForZoom)
}

function fieldCoordinates(feature: FieldFeature): number[][] {
  return feature.geometry.type === 'Polygon'
    ? feature.geometry.coordinates.flat()
    : feature.geometry.coordinates.flat(2)
}

function fieldIntersectsMapBounds(feature: FieldFeature, bounds: L.LatLngBounds) {
  return fieldCoordinates(feature).some(([lng, lat]) => bounds.contains([lat, lng]))
}

function renderVisibleFields() {
  if (!map || !allFields) return
  const bounds = map.getBounds().pad(0.15)
  const visible = {
    type: 'FeatureCollection' as const,
    features: allFields.features.filter(feature => fieldIntersectsMapBounds(feature as FieldFeature, bounds)),
  }
  fieldsLayer?.remove()
  if (!visible.features.length) {
    fieldsLayer = null
    return
  }
  fieldsLayer = L.geoJSON(visible, {
    style: feature => ({
      color: (feature as FieldFeature | undefined)?.properties?.fieldId === appStore.selectedField?.properties.fieldId ? '#FFC145' : '#FFC145',
      weight: (feature as FieldFeature | undefined)?.properties?.fieldId === appStore.selectedField?.properties.fieldId ? 3 : 1,
      fillOpacity: 0.08,
    }),
    onEachFeature: (feature, layer) => {
      layer.on('click', () => {
        const field = feature as FieldFeature
        appStore.setSelectedField(field)
        const center = (layer as L.Polygon).getBounds().getCenter()
        appStore.setCoordinate(center.lng, center.lat)
      })
    },
  }).addTo(map)
}

async function updateFieldsForZoom() {
  if (!map) return
  if (map.getZoom() < FIELD_LOAD_ZOOM) {
    fieldsLayer?.remove()
    fieldsLayer = null
    return
  }
  if (allFields) {
    renderVisibleFields()
    return
  }
  await loadFields()
}


async function loadFields() {
  if (!map) return
  if (map.getZoom() < FIELD_LOAD_ZOOM || fieldsLoading) return
  fieldsLoading = true
  const requestId = ++fieldsRequestId
  try {
    allFields = await loadMississippiFields()
    if (requestId !== fieldsRequestId || !map) return
    renderVisibleFields()
  } catch (e) {
    status.value = 'error'
    errorDetail.value = `Field boundaries failed - ${e instanceof Error ? e.message : String(e)}`
  } finally {
    fieldsLoading = false
  }
}


async function loadFields() {
  if (!map) return
  const requestId = ++fieldsRequestId
  try {
    const fields = await loadMississippiFields()
    if (requestId !== fieldsRequestId || !map) return
    fieldsLayer?.remove()
    fieldsLayer = L.geoJSON(fields, {
      style: feature => ({
        color: (feature as FieldFeature | undefined)?.properties?.fieldId === appStore.selectedField?.properties.fieldId ? '#FFC145' : '#FFC145',
        weight: (feature as FieldFeature | undefined)?.properties?.fieldId === appStore.selectedField?.properties.fieldId ? 3 : 1,
        fillOpacity: 0.08,
      }),
      onEachFeature: (feature, layer) => {
        layer.on('click', () => {
          const field = feature as FieldFeature
          appStore.setSelectedField(field)
          const center = (layer as L.Polygon).getBounds().getCenter()
          appStore.setCoordinate(center.lng, center.lat)
        })
      },
    }).addTo(map)
    const bounds = fieldsLayer.getBounds()
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] })
  } catch (e) {
    status.value = 'error'
    errorDetail.value = `Field boundaries failed - ${e instanceof Error ? e.message : String(e)}`
  }
}

async function updateImagery() {
  if (!map) return

  const requestId = ++imageryRequestId
  const [lon, lat] = coordinate.value
  const start = selectedDate.value ?? appStore.startDate
  const end = selectedDate.value ?? appStore.endDate

  status.value = 'loading'
  errorDetail.value = ''

  try {
    const item = await findBestMapItem(lon, lat, start, end)
    if (requestId !== imageryRequestId) return
    if (!item) throw new Error('No Sentinel-2 item found for this location and date.')

    const tileUrl = await getTileUrl(item, activeLayer.value)
    if (requestId !== imageryRequestId) return

    if (imageryLayer) {
      imageryLayer.setUrl(tileUrl)
    } else {
      imageryLayer = L.tileLayer(tileUrl, {
        maxZoom: 24,
        attribution: 'Sentinel-2 L2A via Microsoft Planetary Computer',
      }).addTo(map)
    }
    status.value = 'ready'
  } catch (e) {
    if (requestId !== imageryRequestId) return
    status.value = 'error'
    errorDetail.value = e instanceof Error ? e.message : String(e)
  }
}

// Settings modal state
const showSettings = ref(false)
const pendingLayer = ref<string>(activeLayer.value)

function openSettings() {
  pendingLayer.value = activeLayer.value
  showSettings.value = true
}

function applySettings() {
  activeLayer.value = pendingLayer.value
  panelApi()?.setTitle(layerTitle(activeLayer.value))
  showSettings.value = false
}

// Panel settings bridge
const panelId = computed(() => panelApi()?.id ?? '')

watch(panelId, (id, oldId) => {
  if (oldId) settingsStore.unregister(oldId)
  if (id) settingsStore.register(id, openSettings)
}, { immediate: true })

onUnmounted(() => {
  if (panelId.value) settingsStore.unregister(panelId.value)
})

watch(activeLayer, (layer) => {
  panelApi()?.updateParameters({ activeLayer: layer })
  panelApi()?.setTitle(layerTitle(layer))
  layoutStore.saveLayout()
  updateImagery()
})

watch(() => props.params?.params, (p) => {
  if (p?.activeLayer && p.activeLayer !== activeLayer.value) {
    activeLayer.value = p.activeLayer
    panelApi()?.setTitle(layerTitle(p.activeLayer))
  }
})

watch([coordinate, selectedDate, () => appStore.startDate, () => appStore.endDate], () => {
  const [lon, lat] = coordinate.value
  marker?.setLatLngs(pixelLatLngs(lon, lat))
  map?.panTo([lat, lon])
  updateImagery()
}, { deep: true })

watch(() => appStore.effectiveTheme, () => { basemap?.setUrl(basemapUrl()) })
watch(() => appStore.selectedField, () => { renderVisibleFields() }, { deep: true })

onMounted(() => {
  panelApi()?.setTitle(layerTitle(activeLayer.value))
  initMap()
  loadFields()
  updateImagery()
})

onUnmounted(() => {
  imageryRequestId++
  resizeObserver?.disconnect()
  map?.remove()
  map = null
  imageryLayer = null
  marker = null
  fieldsLayer = null
})
</script>

<style scoped>
.map-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.map-status {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 16px;
  font-size: 0.85rem;
  color: var(--text-muted);
  font-style: italic;
  flex-shrink: 0;
}

.map-status-error {
  color: var(--red);
  font-style: normal;
  cursor: help;
  background: var(--bg-error);
  border-bottom: 1px solid var(--red);
}

.map-container {
  flex: 1;
  min-height: 0;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.field-label {
  width: 90px;
  flex-shrink: 0;
  font-size: 0.85rem;
  color: var(--text-sub);
}

.field-select {
  flex: 1;
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.85rem;
  padding: 6px 8px;
  outline: none;
}

.field-select:focus {
  border-color: var(--accent);
}
</style>
