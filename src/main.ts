import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'dockview-vue/dist/styles/dockview.css'
import './styles/themes.css'
import App from './App.vue'
import { useCampaignStore } from './stores/campaign'
import { parseUrl } from './utils/url'
import TimeSeriesPanel from './plugins/timeSeries/TimeSeriesPanel.vue'
import FlagEditorPanel from './plugins/flagEditor/FlagEditorPanel.vue'
import MapPanel from './plugins/map/MapPanel.vue'
import WaybackPanel from './plugins/wayback/WaybackPanel.vue'
import CampaignMapPanel from './plugins/campaign/CampaignMapPanel.vue'
import CampaignAdminPanel from './plugins/campaign/CampaignAdminPanel.vue'
import CampaignUploadPanel from './plugins/campaign/CampaignUploadPanel.vue'
import LabellingFormPanel from './plugins/campaign/LabellingFormPanel.vue'
import PanelSettingsButton from './components/PanelSettingsButton.vue'

async function init() {
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)

  // dockview-vue resolves panel components by name via Vue's component registry
  app.component('timeSeriesPanel', TimeSeriesPanel)
  app.component('flagEditorPanel', FlagEditorPanel)
  app.component('mapPanel', MapPanel)
  app.component('waybackPanel', WaybackPanel)
  app.component('campaignMapPanel', CampaignMapPanel)
  app.component('campaignAdminPanel', CampaignAdminPanel)
  app.component('campaignUploadPanel', CampaignUploadPanel)
  app.component('labellingFormPanel', LabellingFormPanel)
  app.component('panelSettingsButton', PanelSettingsButton)

  // If a campaign is referenced in the URL, load all its data from IDB
  // *before* mounting so components see correct state immediately (no races).
  const parsed = parseUrl(window.location.search)
  if (parsed.schema?.campaign) {
    const campaignStore = useCampaignStore()
    const urlSchema = {
      name:       parsed.schema.campaign,
      flagLabels: parsed.schema.flagLabels,
      fields:     parsed.schema.fields,
    }
    const found = await campaignStore.loadFromIdb(parsed.schema.campaign, urlSchema).catch(() => false)
    if (!found) {
      // Campaign not in IDB — load ephemerally from URL schema
      campaignStore.loadEphemeral(urlSchema)
    }
  }

  app.mount('#app')
}

init()
