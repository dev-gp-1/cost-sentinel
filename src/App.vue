<script setup lang="ts">
import { ref, computed, onMounted, nextTick, onUnmounted } from 'vue'
import { 
  Camera, BarChart3, SlidersHorizontal, Cloud, FileText, Zap, 
  RefreshCw, Download, Upload, RotateCcw, TrendingUp, Play, X, Check, AlertTriangle
} from 'lucide-vue-next'
import { Chart, registerables } from 'chart.js'
import Papa from 'papaparse'
import { useCostStore, type GCPCategory } from './stores/cost'
import MetricCard from './components/MetricCard.vue'
import CostDataTable from './components/CostDataTable.vue'
import ProjectionChart from './components/ProjectionChart.vue'

// Pinia store (full GCP Connect power + model)
const store = useCostStore()

Chart.register(...registerables)

// Navigation
const activeTab = ref<'dashboard' | 'explorer' | 'simulator' | 'gcp' | 'reports'>('dashboard')

const navItems = [
  { id: 'dashboard' as const, label: 'DASHBOARD', icon: BarChart3 },
  { id: 'explorer' as const, label: 'COST EXPLORER', icon: Camera },
  { id: 'simulator' as const, label: 'SCALE SIMULATOR', icon: SlidersHorizontal },
  { id: 'gcp' as const, label: 'GCP CONNECT', icon: Cloud },
  { id: 'reports' as const, label: 'REPORTS', icon: FileText },
]

// Hero assets
const heroVideo = '/assets/videos/1.mp4'

// HUD Dynamic state
const liveConfidence = ref(97.4)
const hudDetections = ref(14)
const gcpStatus = ref('DISCONNECTED')

// Toast notifications (local HUD style)
const toast = ref<{ msg: string; type: 'success' | 'info' } | null>(null)
function showToast(msg: string, type: 'success' | 'info' = 'success') {
  toast.value = { msg, type }
  setTimeout(() => (toast.value = null), 2800)
}

// Scale simulator local reactive (synced to store)
const localScale = computed({
  get: () => store.scaleConfig,
  set: (v) => store.updateScale(v),
})

function updateScaleField(field: keyof typeof store.scaleConfig, val: number) {
  store.updateScale({ [field]: val })
}

// Live derived values
const currentOneTime = computed(() => store.oneTimeTotal)
const currentMonthly = computed(() => store.monthlyTotal)
const currentAnnual = computed(() => store.annualRecurring)
const scaledOneTime = computed(() => store.scaledOneTime)
const scaledMonthly = computed(() => store.scaledMonthly)
const scaledAnnual = computed(() => store.scaledAnnual)
const fiveYearTCO = computed(() => store.fiveYearTCO)
const totalCameras = computed(() => store.totalCameras)

// Category breakdown formatted for charts
const chartLabels = computed(() => Object.keys(store.categoryBreakdown))
const chartOneTime = computed(() => chartLabels.value.map(k => Math.round(store.categoryBreakdown[k].oneTime)))
const chartMonthlyAnnual = computed(() => chartLabels.value.map(k => Math.round(store.categoryBreakdown[k].monthly * 12)))

// Human Installer specific callout (new)
const humanLaborTotal = computed(() => {
  return store.items
    .filter(i => i.category === 'HUMAN LABOR')
    .reduce((sum, i) => sum + i.unitCost * i.qty, 0)
})
const humanLaborPercent = computed(() => {
  const total = store.oneTimeTotal + (store.monthlyTotal * 12)
  return total > 0 ? Math.round((humanLaborTotal.value / total) * 100) : 0
})

// For Reports
const reportGenerated = ref(false)

function formatCurrency(n: number) {
  return '$' + n.toLocaleString('en-US')
}

// Actions
function handleUpdateItem(id: number, patch: Partial<CostItem>) {
  store.updateItem(id, patch)
}

function resetAllData() {
  if (confirm('Reset all costs and scale parameters to validated Ghost Protocol defaults?')) {
    store.resetToDefaults()
    showToast('DATA RESET TO PRODUCTION BASELINE', 'info')
  }
}

async function connectGCP() {
  gcpStatus.value = 'SYNCING'
  await nextTick()
  
  const msg = store.simulateGCPImport()
  gcpStatus.value = 'SECURE LINK ESTABLISHED'
  
  showToast(msg, 'success')
  
  liveConfidence.value = Math.round(94 + Math.random() * 4.8 * 10) / 10
  hudDetections.value = 11 + Math.floor(Math.random() * 9)
  
  setTimeout(() => {
    gcpStatus.value = 'LIVE • SOVEREIGN GCP'
    activeTab.value = 'gcp'
    onGCPTabActivated()
  }, 900)
}

// ==================== FULL GCP CONNECT IMPLEMENTATION (PapaParse + Live Analysis) ====================
const isDragging = ref(false)
const isImporting = ref(false)

let gcpCategoryChart: Chart | null = null
let gcpComparisonChart: Chart | null = null
let gcpAISavingsChart: Chart | null = null

function destroyGCPCharts() {
  gcpCategoryChart?.destroy(); gcpComparisonChart?.destroy(); gcpAISavingsChart?.destroy()
  gcpCategoryChart = gcpComparisonChart = gcpAISavingsChart = null
}

function renderGCPCharts() {
  destroyGCPCharts()
  // Category doughnut (mapped)
  const catEl = document.getElementById('gcp-cat-chart') as HTMLCanvasElement
  if (catEl) {
    const c = store.gcpSpendByCategory
    gcpCategoryChart = new Chart(catEl.getContext('2d')!, {
      type: 'doughnut',
      data: { labels: ['Materials','Parts','CloudSaaS'], datasets: [{ data: [c.Materials, c.Parts, c.CloudSaaS], backgroundColor: ['#02C39A','#E85D04','#028090'], borderWidth: 3, borderColor: '#0A1625' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#A5B4C8', font: { size: 11, family: 'monospace' } } } } }
    })
  }
  // Imported vs Model comparison
  const compEl = document.getElementById('gcp-comp-chart') as HTMLCanvasElement
  if (compEl) {
    const d = store.gcpVsModelDelta
    gcpComparisonChart = new Chart(compEl.getContext('2d')!, {
      type: 'bar',
      data: { labels: ['Imported GCP', 'Sovereign Model'], datasets: [{ data: [d.imported, d.modeled], backgroundColor: ['#E85D04', '#02C39A'] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { color: '#64748B', callback: (v:any) => '$'+Number(v).toLocaleString() } } } }
    })
  }
  // AI Savings (highlight)
  const aiEl = document.getElementById('gcp-ai-chart') as HTMLCanvasElement
  if (aiEl) {
    const sa = store.sovereignAnalysis
    gcpAISavingsChart = new Chart(aiEl.getContext('2d')!, {
      type: 'bar',
      data: { labels: ['Cloud AI', 'On-Device (proj)'], datasets: [{ data: [sa.cloudAISpend, Math.max(0, sa.cloudAISpend - sa.projectedOnDeviceSavings)], backgroundColor: ['#E85D04', '#028090'] }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    })
  }
}

function onGCPTabActivated() {
  setTimeout(() => { if (store.gcpRows.length) renderGCPCharts() }, 90)
}

async function handleGCPFile(file: File) {
  if (!file.name.toLowerCase().endsWith('.csv')) { showToast('Select a GCP Billing .csv export', 'warn'); return }
  isImporting.value = true
  try {
    const res = await store.importGCPFromCSV(file)
    showToast(res.message, res.success ? 'success' : 'warn')
    if (res.success) { gcpStatus.value = 'LIVE • CSV'; await nextTick(); renderGCPCharts() }
  } catch (e: any) { showToast('Parse error: ' + e.message, 'warn') }
  isImporting.value = false
}

function onDrop(e: DragEvent) { e.preventDefault(); isDragging.value = false; const f = e.dataTransfer?.files?.[0]; if (f) handleGCPFile(f) }
function onDragOver(e: DragEvent) { e.preventDefault(); isDragging.value = true }
function onDragLeave() { isDragging.value = false }

function triggerFileInput() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv'
  inp.onchange = () => { const f = inp.files?.[0]; if (f) handleGCPFile(f) }; inp.click()
}

function loadGCPDemoSample() {
  const m = store.loadGCPSample()
  showToast(m, 'success'); gcpStatus.value = 'SAMPLE • SOVEREIGN'
  nextTick(renderGCPCharts)
}

function clearGCP() { store.clearGCPData(); destroyGCPCharts(); showToast('GCP data cleared', 'info'); gcpStatus.value = 'DISCONNECTED' }
function setMapping(svc: string, cat: GCPCategory) { store.setGCPMapping(svc, cat); nextTick(renderGCPCharts) }
function autoMapAll() { store.autoMapGCPServices(); showToast('Services auto-mapped', 'success'); nextTick(renderGCPCharts) }
async function refreshSKUs() { const m = await store.syncSKUFromBillingAPI(); showToast(m, 'info') }

async function fetchLiveStorage() {
  const msg = await store.fetchLiveStorageCosts()
  showToast(msg, store.liveStorageData?.source === 'live' ? 'success' : 'info')
}

function exportGCPAnalysis() {
  const sa = store.sovereignAnalysis; const d = store.gcpVsModelDelta
  const lines = ['SOVEREIGN EDGE GCP ANALYSIS', `Date,${new Date().toISOString()}`, `Imported,${d.imported}`, `Model,${d.modeled}`, `AI Spend,${sa.cloudAISpend}`, `Monthly Savings,${sa.projectedOnDeviceSavings}`, `Payback Months,${sa.paybackMonths}`]
  sa.aiServices.forEach(s => lines.push(`${s.name},${s.spend}`))
  const blob = new Blob([lines.join('\n')], {type:'text/csv'})
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=`sovereign-gcp-${Date.now()}.csv`; a.click(); URL.revokeObjectURL(url)
  showToast('Analysis CSV exported', 'success')
}

// Keyboard + init
onMounted(() => {
  // existing interval already in file or add
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==='r') { e.preventDefault(); resetAllData() }
    if (e.key.toLowerCase()==='g' && activeTab.value !== 'gcp') { activeTab.value='gcp'; onGCPTabActivated() }
  })
  if (activeTab.value === 'gcp' && store.gcpRows.length) setTimeout(renderGCPCharts, 140)
})
onUnmounted(destroyGCPCharts)

function generateCSV() {
  const csv = store.exportToCSV()
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `shadowforge-cost-sentinel-${new Date().toISOString().slice(0,10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  showToast('CSV EXPORTED — ZERO-TRUST AUDIT TRAIL')
}

function generatePDF() {
  import('jspdf').then(({ jsPDF }) => {
    const doc = new jsPDF()
    const w = doc.internal.pageSize.getWidth()
    doc.setFillColor(10, 22, 37)
    doc.rect(0, 0, w, 30, 'F')
    doc.setTextColor(2, 128, 144)
    doc.setFontSize(16)
    doc.text('SHADOWFORGE COST SENTINEL', 18, 17)
    doc.setFontSize(9)
    doc.text('SOVEREIGN EDGE + GCP CONNECT ANALYSIS', 18, 24)
    doc.setTextColor(232, 240, 254)
    doc.text(`GCP Imported: $${(store.gcpTotalImported || 0).toFixed(2)}   AI Savings/mo: $${(store.sovereignAnalysis?.projectedOnDeviceSavings || 0).toFixed(0)}`, 18, 38)
    doc.text(`Fleet: ${totalCameras.value} cameras  |  5-YR TCO: ${formatCurrency(fiveYearTCO.value)}`, 18, 45)
    doc.save(`ShadowForge-Sovereign-GCP-${Date.now()}.pdf`)
    showToast('PDF REPORT GENERATED')
    reportGenerated.value = true
  })
}

function loadSampleFleet() {
  store.updateScale({ sites: 22, camerasPerSite: 15, retentionMonths: 120, inferenceMultiplier: 1.35 })
  showToast('LARGE FLEET PRESET LOADED', 'info')
}


function generatePDF() {
  import('jspdf').then(({ jsPDF }) => {
    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()

    doc.setFillColor(10, 22, 37)
    doc.rect(0, 0, pageWidth, 38, 'F')
    doc.setTextColor(2, 128, 144)
    doc.setFontSize(22)
    doc.text('SHADOWFORGE COST SENTINEL', 20, 20)
    doc.setFontSize(10)
    doc.text('GHOST PROTOCOL • SOVEREIGN EDGE AI • CLASSIFIED — LOCAL ONLY', 20, 29)

    doc.setTextColor(232, 240, 254)
    doc.setFontSize(12)
    doc.text(`FLEET-SCALE TCO REPORT — ${new Date().toLocaleDateString()}`, 20, 48)

    doc.setDrawColor(2, 128, 144)
    doc.rect(20, 55, pageWidth - 40, 52, 'S')
    doc.text(`CAMERAS DEPLOYED: ${totalCameras.value}    |    5-YEAR TCO: ${formatCurrency(fiveYearTCO.value)}`, 24, 68)
    doc.text(`CAPEX (SCALED): ${formatCurrency(scaledOneTime.value)}    |    ANNUAL OPEX: ${formatCurrency(scaledAnnual.value)}`, 24, 79)
    doc.text(`RETENTION: ${store.scaleConfig.retentionMonths} DAYS    |    INFERENCE MULT: ${store.scaleConfig.inferenceMultiplier.toFixed(1)}×`, 24, 90)

    let y = 118
    doc.setFontSize(9)
    doc.setTextColor(165, 180, 200)
    doc.text('CATEGORY', 20, y)
    doc.text('ITEM', 52, y)
    doc.text('UNIT', 128, y)
    doc.text('QTY', 150, y)
    doc.text('EXTENDED', 170, y)

    y += 4
    doc.line(20, y, pageWidth - 20, y)
    y += 8

    doc.setTextColor(232, 240, 254)
    store.items.forEach((item, idx) => {
      if (y > 260) {
        doc.addPage()
        y = 30
      }
      const ext = (item.unitCost * item.qty).toFixed(0)
      doc.text(item.category, 20, y)
      doc.text(item.item.substring(0, 42), 52, y)
      doc.text(item.unitCost.toFixed(item.type === 'monthly' ? 3 : 0), 128, y)
      doc.text(String(item.qty), 150, y)
      doc.text(ext, 170, y)
      y += 7
      if (idx % 4 === 0) y += 1
    })

    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139)
    doc.text('ZERO-TRUST • LOCAL-FIRST • NO PII • GENERATED BY SHADOWFORGE COST SENTINEL', 20, 285)
    doc.text('COTA COLUMBUS — GHOST PROTOCOL v4.2 — DATA SOVEREIGNTY BY DESIGN', 20, 292)

    doc.save(`ShadowForge-Cost-Sentinel-Report-${Date.now()}.pdf`)
    showToast('PDF REPORT GENERATED — SECURE DOWNLOAD')
    reportGenerated.value = true
  })
}

function loadSampleFleet() {
  store.updateScale({ sites: 22, camerasPerSite: 15, retentionMonths: 120, inferenceMultiplier: 1.35 })
  showToast('LARGE FLEET PRESET LOADED (330 CAMERAS)', 'info')
}

// Live HUD animation loop
onMounted(() => {
  setInterval(() => {
    if (activeTab.value === 'dashboard' || activeTab.value === 'gcp') {
      liveConfidence.value = Math.max(93, Math.min(99.1, liveConfidence.value + (Math.random() - 0.5) * 0.7))
      if (Math.random() > 0.82) hudDetections.value = Math.max(9, Math.min(28, hudDetections.value + Math.floor((Math.random() - 0.5) * 4)))
    }
  }, 2400)

  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'r' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      resetAllData()
    }
    if (e.key === '?') {
      activeTab.value = activeTab.value === 'simulator' ? 'dashboard' : 'simulator'
    }
  })
})
</script>

<template>
  <!-- ===== GLOBAL SCANLINES + HUD FRAME ===== -->
  <div class="scanlines"></div>
  
  <div class="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans overflow-x-hidden">
    
    <!-- ===== TOP COMMAND BAR ===== -->
    <header class="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--bg-primary)]/95 backdrop-blur-2xl">
      <div class="max-w-[1480px] mx-auto px-6 h-16 flex items-center justify-between">
        <!-- Logo + Identity -->
        <div class="flex items-center gap-3.5">
          <div class="flex h-9 w-9 items-center justify-center rounded bg-gradient-to-br from-[var(--accent-teal)] via-[#04A6A8] to-[#02C39A] shadow-inner">
            <Zap class="h-5 w-5 text-[#0A1625]" />
          </div>
          <div>
            <div class="font-semibold tracking-[-1.5px] text-[21px] leading-none text-white">SHADOWFORGE</div>
            <div class="text-[9px] font-mono tracking-[3.2px] text-[var(--accent-teal)] -mt-px">COST SENTINEL • GHOST PROTOCOL</div>
          </div>
          <div class="ml-3 rounded-full border border-[var(--accent-teal)]/40 bg-[var(--bg-secondary)] px-3 py-px text-[10px] font-mono tracking-[1px] text-[var(--accent-teal)]">
            v4.2 • LOCAL
          </div>
        </div>

        <!-- Status HUD -->
        <div class="hidden md:flex items-center gap-5 text-xs font-mono text-[var(--text-muted)]">
          <div class="flex items-center gap-1.5">
            <div class="status-dot"></div>
            <span>SECURE LOCAL SESSION</span>
          </div>
          <div class="h-3 w-px bg-[var(--border)]" />
          <div>DEPLOYED: <span class="text-[var(--accent-teal)]">COTA COLUMBUS</span></div>
          <div>LATENCY <span class="text-[var(--accent-green)] font-semibold">4.1ms</span></div>
        </div>

        <!-- Quick Actions -->
        <div class="flex items-center gap-2">
          <button @click="resetAllData" class="btn flex items-center gap-2 text-xs py-1.5 px-3.5">
            <RotateCcw :size="14" /> RESET BASELINE
          </button>
          <button @click="activeTab = 'reports'" class="btn-primary flex items-center gap-2 text-xs py-1.5 px-4">
            <Download :size="14" /> EXPORT
          </button>
        </div>
      </div>

      <!-- Sidebar-style NAV TABS -->
      <div class="border-t border-[var(--border)] bg-[var(--bg-secondary)]">
        <div class="max-w-[1480px] mx-auto px-4 flex items-center gap-1 text-sm overflow-x-auto">
          <div 
            v-for="item in navItems" 
            :key="item.id"
            @click="activeTab = item.id"
            class="nav-item flex-shrink-0 select-none"
            :class="{ active: activeTab === item.id }"
          >
            <component :is="item.icon" class="icon" />
            <span class="font-medium tracking-[0.5px]">{{ item.label }}</span>
          </div>
          
          <div class="flex-1"></div>
          
          <!-- Live HUD indicators in nav -->
          <div class="hidden xl:flex items-center gap-4 pr-2 text-[10px] font-mono text-[var(--text-muted)]">
            <div class="flex items-center gap-2">
              <span>DETECTIONS</span>
              <span class="font-semibold text-[var(--accent-orange)] tabular-nums">{{ hudDetections }}</span>
            </div>
            <div>CONF <span class="font-semibold text-[var(--accent-teal)] tabular-nums">{{ liveConfidence.toFixed(1) }}%</span></div>
            <div class="text-[var(--accent-green)]">● SOVEREIGN NPU ACTIVE</div>
          </div>
        </div>
      </div>
    </header>

    <!-- STUNNING FULL-BLEED HERO -->
    <div v-if="activeTab === 'dashboard'" class="hero-container">
      <video 
        :src="heroVideo" 
        autoplay 
        muted 
        loop 
        playsinline
        class="hero-video"
      />
      <div class="hero-overlay"></div>
      
      <div class="absolute inset-0 opacity-30 pointer-events-none" 
           style="background-image: linear-gradient(rgba(2,128,144,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(2,128,144,0.1) 1px, transparent 1px); background-size: 38px 38px;"></div>

      <!-- Animated HUD Targeting Elements -->
      <div class="hud-target top-left"></div>
      <div class="hud-target top-right"></div>
      <div class="hud-target bottom-left"></div>
      
      <div class="reticle" style="top: 29%; left: 31%;"></div>
      <div class="reticle" style="top: 61%; right: 27%; animation-delay: 820ms;"></div>
      
      <div class="hud-tag top-left font-mono">AI-CAM-08 • 98.7% CONF</div>
      <div class="hud-tag top-right">SOVEREIGN-4 • NVENC ON</div>
      <div class="hud-tag mid">RAIL-12 • 17 TARGETS</div>

      <div class="absolute inset-0 z-10 flex items-center justify-center">
        <div class="text-center px-6 max-w-[1080px]">
          <div class="inline-block px-5 py-1 rounded border border-white/25 bg-black/40 text-[10px] tracking-[4px] mb-6 font-mono text-[var(--accent-teal)]">
            VALIDATED MAY 2026 • TWO OAK-4 SHADOWS • COTA TRANSIT
          </div>
          
          <h1 class="text-[68px] md:text-[86px] leading-[.9] font-semibold tracking-[-5.2px] mb-3 text-white">
            SHADOWFORGE<br>
            <span class="text-[var(--accent-teal)] glow-teal">COST SENTINEL</span>
          </h1>
          
          <p class="max-w-2xl mx-auto text-2xl tracking-tight text-white/75 mb-2">
            Ghost Protocol Sovereign Edge AI
          </p>
          <p class="text-[var(--text-muted)] text-lg tracking-[-0.2px] max-w-xl mx-auto">
            Review. Scale. Optimize.<br>
            Zero-trust spend intelligence for mass transit AI deployments.
          </p>

          <div class="mt-9 flex flex-wrap justify-center gap-3">
            <button @click="activeTab = 'explorer'" class="btn-primary text-base px-9 py-3 tracking-widest">
              <Camera class="inline -mt-px mr-2" :size="17" /> EXPLORE COSTS
            </button>
            <button @click="activeTab = 'simulator'" class="btn text-base px-9 py-3 tracking-widest border-white/40">
              <SlidersHorizontal class="inline -mt-px mr-2" :size="17" /> RUN SCALE SIM
            </button>
            <button @click="activeTab = 'gcp'" class="btn text-base px-9 py-3 tracking-widest">
              <Cloud class="inline -mt-px mr-2" :size="17" /> SYNC GCP BILLING
            </button>
          </div>
        </div>
      </div>

      <div class="absolute bottom-9 right-9 text-right font-mono text-xs text-white/40 tracking-widest z-20">
        ASSETS: GROK IMAGINE • 1.MP4 + 1-4.JPG<br>
        <span class="text-[var(--accent-orange)]">MISSION CRITICAL • LOCAL ONLY</span>
      </div>
    </div>

    <!-- MAIN CONTENT — TABBED SECTIONS -->
    <div class="max-w-[1480px] mx-auto px-6 pb-20 pt-8 relative z-10">
      
      <!-- DASHBOARD -->
      <div v-if="activeTab === 'dashboard'" class="tab-content space-y-9">
        <div class="flex justify-between items-end">
          <div>
            <div class="label mb-1">COMMAND CENTER • LIVE FROM LOCAL STORE</div>
            <h2 class="text-5xl tracking-[-2.2px] font-semibold text-white">Fleet Cost Intelligence</h2>
          </div>
          <div class="text-right">
            <div class="font-mono text-xs text-[var(--text-muted)]">LAST SYNC</div>
            <div class="font-mono text-[var(--accent-teal)]">{{ new Date(store.lastUpdated).toLocaleTimeString() }}</div>
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <MetricCard label="CURRENT ONE-TIME CAPEX" :value="formatCurrency(currentOneTime)" accent="teal" />
          <MetricCard label="CURRENT MONTHLY OPEX" :value="formatCurrency(currentMonthly)" accent="orange" />
          <MetricCard label="ANNUAL RECURRING" :value="formatCurrency(currentAnnual)" />
          <MetricCard label="SCALED CAMERAS" :value="totalCameras" unit="UNITS" accent="teal" />
          <MetricCard label="PROJECTED 5-YR TCO" :value="formatCurrency(fiveYearTCO)" accent="orange" />
          <MetricCard label="PER CAMERA (SCALED)" :value="formatCurrency(Math.round(fiveYearTCO / Math.max(totalCameras, 1)))" />
        </div>

        <!-- Business Model Comparison surfaced on main Dashboard -->
        <div class="hud-card p-8">
          <div class="flex items-center justify-between mb-6">
            <div>
              <div class="label">BUSINESS MODEL SNAPSHOT</div>
              <div class="text-2xl font-semibold tracking-tight">Current Scale Economics</div>
            </div>
            <div @click="activeTab = 'simulator'" class="text-xs px-4 py-2 border border-white/30 rounded-xl hover:bg-white/5 cursor-pointer flex items-center gap-2">
              OPEN FULL COMPARISON <SlidersHorizontal :size="14" />
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="bg-[#0A1625] rounded-2xl p-6 border border-[#E85D04]/30">
              <div class="text-[#E85D04] font-semibold mb-1 text-sm tracking-wider">HARDWARE + MARKUP</div>
              <div class="text-4xl font-mono tracking-tighter">{{ formatCurrency(store.hardwareMarkupRevenue) }} <span class="text-sm align-super text-[#64748B]">revenue</span></div>
              <div class="mt-4 flex gap-8 text-sm">
                <div><span class="text-[#64748B]">Profit</span><br><span class="font-semibold text-[#02C39A]">{{ formatCurrency(store.hardwareGrossProfit) }}</span></div>
                <div><span class="text-[#64748B]">Margin</span><br><span class="font-semibold">{{ store.hardwareGrossMargin }}%</span></div>
              </div>
            </div>

            <div class="bg-[#0A1625] rounded-2xl p-6 border border-[#028090]/30">
              <div class="text-[#028090] font-semibold mb-1 text-sm tracking-wider">SAAS / MANAGED SERVICE</div>
              <div class="text-4xl font-mono tracking-tighter">{{ formatCurrency(store.saasAnnualRevenue) }} <span class="text-sm align-super text-[#64748B]">ARR</span></div>
              <div class="mt-4 flex gap-8 text-sm">
                <div><span class="text-[#64748B]">Profit / Yr</span><br><span class="font-semibold text-[#02C39A]">{{ formatCurrency(store.saasGrossProfitMonthly * 12) }}</span></div>
                <div><span class="text-[#64748B]">Margin</span><br><span class="font-semibold">{{ store.saasGrossMargin }}%</span></div>
              </div>
              <div class="mt-3 text-xs text-[#64748B]">LTV per camera: <span class="font-mono text-white">{{ formatCurrency(store.saasLTVPerCamera) }}</span> @ {{ (store.saasAnnualChurnRate * 100).toFixed(0) }}% churn</div>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div class="lg:col-span-3 hud-card p-6">
            <div class="section-header"><span class="label">COST DISTRIBUTION BY CATEGORY</span></div>
            <ProjectionChart 
              title="CATEGORY CAPEX + ANNUAL OPEX" 
              :labels="chartLabels" 
              :dataOneTime="chartOneTime" 
              :dataMonthly="chartMonthlyAnnual" 
            />
          </div>
          <div class="lg:col-span-2 space-y-4">
            <div class="hud-card p-6">
              <div class="section-header"><span class="label">IMMEDIATE ACTIONS</span></div>
              <div class="space-y-3 text-sm">
                <div @click="activeTab='explorer'" class="flex justify-between items-center px-4 py-3 bg-[var(--bg-secondary)] hover:bg-[var(--bg-elevated)] border border-[var(--border)] hover:border-[var(--accent-teal)] rounded cursor-pointer transition">
                  <div>Edit line items &amp; pricing</div><Camera :size="16" />
                </div>
                <div @click="activeTab='simulator'" class="flex justify-between items-center px-4 py-3 bg-[var(--bg-secondary)] hover:bg-[var(--bg-elevated)] border border-[var(--border)] hover:border-[var(--accent-teal)] rounded cursor-pointer transition">
                  <div>Run fleet scale what-if</div><SlidersHorizontal :size="16" />
                </div>
                <div @click="activeTab='gcp'" class="flex justify-between items-center px-4 py-3 bg-[var(--bg-secondary)] hover:bg-[var(--bg-elevated)] border border-[var(--border)] hover:border-[var(--accent-teal)] rounded cursor-pointer transition">
                  <div>Import live GCP Sovereign billing</div><Cloud :size="16" />
                </div>
              </div>
            </div>
            <div class="hud-card p-6 text-xs leading-relaxed text-[var(--text-muted)]">
              All calculations run 100% client-side. Data auto-saved to browser localStorage. 
              Designed for zero-trust environments.
            </div>
          </div>
        </div>
      </div>

      <!-- COST EXPLORER -->
      <div v-else-if="activeTab === 'explorer'" class="tab-content">
        <div class="flex items-center justify-between mb-5">
          <div>
            <div class="label">HARDWARE • CABLING • HUMAN LABOR • LOGISTICS • GCLOUD ML • STREAMING • MQTT • FIRMWARE</div>
            <h2 class="text-4xl tracking-tight font-semibold">Cost Explorer — Editable</h2>
          </div>
          <button @click="resetAllData" class="btn"><RotateCcw :size="15" class="mr-1.5" /> RESET TO BASELINE</button>
        </div>
        <CostDataTable :items="store.items" @update-item="handleUpdateItem" />
        <div class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="hud-card p-5 text-center">
            <div class="text-xs tracking-widest text-[var(--text-muted)]">TOTAL ONE-TIME</div>
            <div class="text-5xl font-semibold tabular-nums mt-1 text-[var(--accent-teal)]">{{ formatCurrency(currentOneTime) }}</div>
          </div>
          <div class="hud-card p-5 text-center">
            <div class="text-xs tracking-widest text-[var(--text-muted)]">TOTAL MONTHLY OPEX</div>
            <div class="text-5xl font-semibold tabular-nums mt-1 text-[var(--accent-orange)]">{{ formatCurrency(currentMonthly) }}</div>
          </div>
          <div class="hud-card p-5 text-center">
            <div class="text-xs tracking-widest text-[var(--text-muted)]">ANNUAL RECURRING COST</div>
            <div class="text-5xl font-semibold tabular-nums mt-1">{{ formatCurrency(currentAnnual) }}</div>
          </div>
        </div>
        <p class="text-center text-xs text-[var(--text-muted)] mt-4 font-mono">EDIT ANY FIELD — CHANGES PERSIST LOCALLY. REAL-TIME IMPACT ON SIMULATOR.</p>
      </div>

      <!-- SCALE SIMULATOR -->
      <div v-else-if="activeTab === 'simulator'" class="tab-content">
        <div class="flex items-end justify-between mb-6">
          <div>
            <div class="label">WHAT-IF MODELING ENGINE</div>
            <h2 class="text-5xl font-semibold tracking-tight">Scale Simulator</h2>
          </div>
          <button @click="loadSampleFleet" class="btn-orange flex items-center gap-2">LOAD 330-CAMERA FLEET PRESET</button>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div class="lg:col-span-5 hud-card p-7">
            <div class="uppercase text-xs tracking-[2px] text-[var(--accent-teal)] mb-5">PARAMETERS — DRAG TO MODEL</div>
            
            <div class="space-y-7">
              <div>
                <div class="flex justify-between text-sm mb-2"><div>SITES / DEPOTS</div><div class="font-mono text-[var(--accent-teal)]">{{ localScale.sites }}</div></div>
                <input type="range" min="1" max="48" step="1" :value="localScale.sites" @input="e => updateScaleField('sites', +(e.target as HTMLInputElement).value)" class="w-full" />
              </div>
              <div>
                <div class="flex justify-between text-sm mb-2"><div>CAMERAS PER SITE</div><div class="font-mono text-[var(--accent-teal)]">{{ localScale.camerasPerSite }}</div></div>
                <input type="range" min="4" max="32" step="1" :value="localScale.camerasPerSite" @input="e => updateScaleField('camerasPerSite', +(e.target as HTMLInputElement).value)" class="w-full" />
              </div>
              <div>
                <div class="flex justify-between text-sm mb-2"><div>VIDEO RETENTION (DAYS)</div><div class="font-mono text-[var(--accent-teal)]">{{ localScale.retentionMonths }}</div></div>
                <input type="range" min="30" max="365" step="5" :value="localScale.retentionMonths" @input="e => updateScaleField('retentionMonths', +(e.target as HTMLInputElement).value)" class="w-full" />
              </div>
              <div>
                <div class="flex justify-between text-sm mb-2"><div>INFERENCE LOAD MULTIPLIER</div><div class="font-mono text-[var(--accent-teal)]">{{ localScale.inferenceMultiplier.toFixed(2) }}×</div></div>
                <input type="range" min="0.6" max="2.4" step="0.05" :value="localScale.inferenceMultiplier" @input="e => updateScaleField('inferenceMultiplier', +(e.target as HTMLInputElement).value)" class="w-full" />
              </div>
            </div>

            <div class="pt-6 mt-7 border-t border-[var(--border)] flex justify-between items-center text-sm">
              <div class="font-mono text-[var(--text-muted)]">TOTAL CAMERAS</div>
              <div class="text-4xl tabular-nums font-semibold tracking-tighter text-white">{{ totalCameras }}</div>
            </div>

            <!-- Business Model Switcher (CFO + Sales Director requirement) -->
            <div class="mt-6 pt-5 border-t border-[var(--border)]">
              <div class="uppercase text-xs tracking-[2px] text-[var(--accent-teal)] mb-3">BUSINESS MODEL</div>
              
              <div class="flex gap-2 mb-4">
                <button 
                  @click="store.setBusinessModel('hardware-markup')"
                  :class="store.businessModel === 'hardware-markup' ? 'bg-[#02C39A] text-black' : 'border border-white/30 hover:bg-white/5'"
                  class="flex-1 py-2 rounded-xl font-semibold text-sm transition">
                  HARDWARE + MARKUP
                </button>
                <button 
                  @click="store.setBusinessModel('saas-managed')"
                  :class="store.businessModel === 'saas-managed' ? 'bg-[#02C39A] text-black' : 'border border-white/30 hover:bg-white/5'"
                  class="flex-1 py-2 rounded-xl font-semibold text-sm transition">
                  SAAS / MANAGED SERVICE
                </button>
              </div>

              <div v-if="store.businessModel === 'hardware-markup'" class="space-y-3">
                <div>
                  <div class="flex justify-between text-xs mb-1">
                    <div>Markup on Hardware + Install Heavy Costs</div>
                    <div class="font-mono">{{ (store.hardwareMarkupPercent * 100).toFixed(0) }}%</div>
                  </div>
                  <input type="range" min="0.15" max="0.85" step="0.01" :value="store.hardwareMarkupPercent" 
                         @input="e => store.setHardwareMarkup(+(e.target as HTMLInputElement).value)" class="w-full accent-[#02C39A]">
                </div>
                <div class="text-[10px] text-[#64748B]">Revenue = Hardware/Install/COGS × (1 + markup). Classic equipment sale model.</div>
              </div>

              <div v-else class="space-y-3">
                <div>
                  <div class="flex justify-between text-xs mb-1">
                    <div>Monthly Price per Camera (Managed Service)</div>
                    <div class="font-mono">${{ store.saasMonthlyPricePerCamera }}</div>
                  </div>
                  <input type="range" min="18" max="95" step="1" :value="store.saasMonthlyPricePerCamera" 
                         @input="e => store.setSaasPricePerCamera(+(e.target as HTMLInputElement).value)" class="w-full accent-[#02C39A]">
                </div>
                <div class="text-[10px] text-[#64748B]">Full managed service (A2A access, model updates, monitoring, support). Recurring revenue model.</div>

                <!-- LTV / Churn Controls -->
                <div class="mt-4 pt-4 border-t border-white/10 grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <div class="flex justify-between mb-1"><span>Annual Churn Rate</span><span class="font-mono">{{ (store.saasAnnualChurnRate * 100).toFixed(0) }}%</span></div>
                    <input type="range" min="0.02" max="0.25" step="0.01" :value="store.saasAnnualChurnRate" @input="e => store.setSaasChurnRate(+(e.target as HTMLInputElement).value)" class="w-full accent-[#02C39A]">
                  </div>
                  <div>
                    <div class="flex justify-between mb-1"><span>Gross Margin for LTV</span><span class="font-mono">{{ (store.saasGrossMarginForLTV * 100).toFixed(0) }}%</span></div>
                    <input type="range" min="0.4" max="0.9" step="0.01" :value="store.saasGrossMarginForLTV" @input="e => store.setSaasLTVGrossMargin(+(e.target as HTMLInputElement).value)" class="w-full accent-[#02C39A]">
                  </div>
                </div>
                <div class="text-[10px] mt-2 text-[#64748B]">LTV per camera: <span class="font-mono text-white">{{ formatCurrency(store.saasLTVPerCamera) }}</span> • Payback: ~{{ store.saasPaybackMonths }} months</div>
              </div>
            </div>

            <!-- Human Installers highlight (new) -->
            <div class="mt-6 pt-5 border-t border-[var(--border)] bg-[#0F2538] -mx-2 px-4 py-4 rounded-xl">
              <div class="flex items-center justify-between text-sm">
                <div>
                  <span class="text-[var(--accent-orange)] font-semibold">HUMAN INSTALLERS</span>
                  <span class="text-xs text-[var(--text-muted)] ml-2">• Major variable cost</span>
                </div>
                <div class="font-mono text-xl text-[var(--accent-orange)] tabular-nums">
                  {{ formatCurrency(humanLaborTotal) }}
                </div>
              </div>
              <div class="text-[10px] text-[var(--text-muted)] mt-1">
                {{ humanLaborPercent }}% of total project cost at current scale. 
                Scales with cameras but has strong crew-efficiency gains at 100+ units.
              </div>
            </div>

            <div class="text-[10px] text-[var(--text-muted)] mt-2 px-1">
              <span class="text-[var(--accent-orange)]">Transit note:</span> Human installers are often the #1 or #2 line item in agency RFPs. 
              Consider line-item for "COTA internal tech training program" in larger fleet scenarios to reduce long-term OpEx.
            </div>

            <!-- Aggressive new cost reality callouts -->
            <div class="mt-4 space-y-2 text-[10px]">
              <div class="bg-[#1A2A3F] px-3 py-2 rounded-lg border-l-2 border-[#E85D04]">
                <span class="font-semibold text-[#E85D04]">Cabling + Logistics:</span> These "boring" materials often add 18-25% to hardware CAPEX at fleet scale. One-time but painful if not modeled.
              </div>
              <div class="bg-[#1A2A3F] px-3 py-2 rounded-lg border-l-2 border-[#028090]">
                <span class="font-semibold text-[#028090]">GCloud ML + Streaming + MQTT:</span> Even fully sovereign designs still carry real recurring costs for firmware OTA, custom model retraining, selective event video offload, and high-volume detection telemetry. These grow with fleet size and model update frequency.
              </div>
            </div>
          </div>

          <div class="lg:col-span-7 space-y-4">
            <!-- Business Model Economics (new CFO view) -->
            <div class="hud-card p-6 mb-4" v-if="store.businessModel === 'hardware-markup'">
              <div class="uppercase text-xs tracking-[2px] text-[#E85D04] mb-2">HARDWARE MARKUP MODEL — GROSS ECONOMICS</div>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
                <div>
                  <div class="text-xs text-[#64748B]">REVENUE (at {{ (store.hardwareMarkupPercent*100).toFixed(0) }}% markup)</div>
                  <div class="text-3xl font-semibold tabular-nums tracking-tight mt-1 text-white">{{ formatCurrency(store.hardwareMarkupRevenue) }}</div>
                </div>
                <div>
                  <div class="text-xs text-[#64748B]">GROSS PROFIT</div>
                  <div class="text-3xl font-semibold tabular-nums tracking-tight mt-1 text-[#02C39A]">{{ formatCurrency(store.hardwareGrossProfit) }}</div>
                </div>
                <div>
                  <div class="text-xs text-[#64748B]">GROSS MARGIN</div>
                  <div class="text-3xl font-semibold tabular-nums tracking-tight mt-1 text-[#02C39A]">{{ store.hardwareGrossMargin }}%</div>
                </div>
              </div>
            </div>

            <div class="hud-card p-6 mb-4" v-else>
              <div class="uppercase text-xs tracking-[2px] text-[#E85D04] mb-2">SAAS / MANAGED SERVICE MODEL — GROSS ECONOMICS</div>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
                <div>
                  <div class="text-xs text-[#64748B]">ANNUAL RECURRING REVENUE</div>
                  <div class="text-3xl font-semibold tabular-nums tracking-tight mt-1 text-white">{{ formatCurrency(store.saasAnnualRevenue) }}</div>
                </div>
                <div>
                  <div class="text-xs text-[#64748B]">GROSS PROFIT / YEAR</div>
                  <div class="text-3xl font-semibold tabular-nums tracking-tight mt-1 text-[#02C39A]">{{ formatCurrency(store.saasGrossProfitMonthly * 12) }}</div>
                </div>
                <div>
                  <div class="text-xs text-[#64748B]">GROSS MARGIN</div>
                  <div class="text-3xl font-semibold tabular-nums tracking-tight mt-1 text-[#02C39A]">{{ store.saasGrossMargin }}%</div>
                </div>
              </div>
              <div class="text-[10px] text-center text-[#64748B] mt-2">5-Year Revenue at current price: {{ formatCurrency(store.fiveYearSaaSRevenue) }}</div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div class="hud-card p-5">
                <div class="text-xs tracking-widest text-[var(--text-muted)]">SCALED ONE-TIME CAPEX</div>
                <div class="text-[42px] font-semibold tabular-nums tracking-tighter mt-1 text-[var(--accent-teal)]">{{ formatCurrency(scaledOneTime) }}</div>
              </div>
              <div class="hud-card p-5">
                <div class="text-xs tracking-widest text-[var(--text-muted)]">PROJECTED ANNUAL OPEX</div>
                <div class="text-[42px] font-semibold tabular-nums tracking-tighter mt-1 text-[var(--accent-orange)]">{{ formatCurrency(scaledAnnual) }}</div>
              </div>
              <div class="hud-card p-5 border-[var(--accent-orange)]/50">
                <div class="text-xs tracking-widest text-[var(--text-muted)]">5-YEAR TOTAL COST OF OWNERSHIP</div>
                <div class="text-[42px] font-semibold tabular-nums tracking-tighter mt-1 text-[var(--accent-orange)]">{{ formatCurrency(fiveYearTCO) }}</div>
                <div class="text-xs text-[var(--accent-teal)] mt-1">Includes inflation buffer built into model</div>
              </div>
            </div>

            <ProjectionChart 
              title="PROJECTED COSTS AT CURRENT SCALE"
              :labels="['Hardware + Cabling', 'Human Labor + Logistics', 'Install & Deployment', 'GCloud ML + Streaming + MQTT']"
              :dataOneTime="[scaledOneTime * 0.38, scaledOneTime * 0.31, scaledOneTime * 0.18, scaledOneTime * 0.13]"
              :dataMonthly="[0, 0, 0, scaledAnnual * 1.0]"
            />
          </div>
        </div>
      </div>

      <!-- GCP CONNECT - FULL BEAUTIFUL COMMAND CENTER (PapaParse + Mapping + Sovereign Analysis + Charts) -->
      <div v-else-if="activeTab === 'gcp'" class="tab-content space-y-6">
        <div>
          <div class="label tracking-[2.5px]">REAL GCP BILLING • PAPAPARSE PARSER • NO LOGIN</div>
          <h2 class="text-5xl font-semibold tracking-[-2px] mt-1">GCP Connect <span class="text-base align-middle font-normal text-[#02C39A]">— Command Center</span></h2>
          <p class="max-w-3xl text-[#64748B] mt-2">Beautiful importer for standard GCP Billing CSV exports (BigQuery or Console). Map every service to Materials / Parts / CloudSaaS. Watch live spend vs your Sovereign Edge project model. Deep "What this means for Sovereign Edge" analysis highlights massive savings by replacing Vertex AI / Cloud Vision with on-device inference.</p>
        </div>

        <!-- Status + Actions -->
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-mono bg-[#111F2E] border border-[#028090]/30 px-5 h-12 rounded-2xl">
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full" :class="store.gcpRows.length ? 'bg-[#02C39A] animate-pulse' : 'bg-[#E85D04]'" />
            <span class="text-[#02C39A]">{{ gcpStatus }}</span>
          </div>
          <div v-if="store.gcpLastImport" class="text-[#64748B]">IMPORTED {{ new Date(store.gcpLastImport).toLocaleDateString() }}</div>
          <div class="flex-1"></div>
          <button @click="loadGCPDemoSample" class="hover:text-white text-[#02C39A] flex items-center gap-1.5"><Play class="w-3.5 h-3.5"/> LOAD SAMPLE (Vertex + Vision + Compute)</button>
          <button @click="triggerFileInput" class="hover:text-white flex items-center gap-1.5"><Upload class="w-3.5 h-3.5"/> DROP OR SELECT CSV</button>
          <button @click="clearGCP" class="hover:text-white flex items-center gap-1.5"><X class="w-3.5 h-3.5"/> CLEAR</button>
          <button @click="refreshSKUs" :disabled="store.liveStorageLoading || store.connectorProgress.isActive" class="hover:text-white flex items-center gap-1.5 disabled:opacity-50"><RefreshCw class="w-3.5 h-3.5" :class="{ 'animate-spin': store.liveStorageLoading || store.connectorProgress.isActive }"/> SYNC SKU PRICES</button>
        </div>

        <!-- Stunning Drag & Drop Importer -->
        <div 
          @click="triggerFileInput"
          @drop="onDrop" @dragover="onDragOver" @dragleave="onDragLeave"
          class="hud-card p-12 text-center border-2 border-dashed cursor-pointer transition-all active:scale-[0.985]"
          :class="isDragging ? '!border-[#02C39A] bg-[#02C39A]/5' : 'border-[#028090]/30 hover:border-[#028090]/60'">
          <Upload class="mx-auto mb-4 opacity-75" :size="42" />
          <div class="text-2xl tracking-tight">DROP GCP BILLING EXPORT CSV</div>
          <div class="text-sm text-[#64748B] mt-1">PapaParse parses any standard export (service.description • sku.description • cost • project.id). Auto-detects BigQuery flattened columns.</div>
          <div v-if="isImporting" class="mt-3 text-[#E85D04] text-xs tracking-[3px]">PARSING WITH PAPAPARSE • BUILDING LIVE MODEL...</div>
        </div>

        <!-- When data loaded: Full interactive power center -->
        <div v-if="store.gcpRows.length" class="space-y-6">
          <!-- Mapping Console -->
          <div class="hud-card p-7">
            <div class="flex items-baseline justify-between mb-4">
              <div>
                <div class="font-mono text-xs text-[#02C39A]">CATEGORY MAPPING — MATERIALS / PARTS / CLOUDSAAS</div>
                <div class="text-xl">Map {{ store.gcpUniqueServices.length }} services → instantly recalculates everything</div>
              </div>
              <div>
                <button @click="autoMapAll" class="text-xs px-5 py-2 rounded-xl border border-[#02C39A]/50 hover:bg-[#02C39A]/10">AUTO MAP AI &amp; INFRA</button>
              </div>
            </div>

            <div class="space-y-2 max-h-[240px] overflow-auto pr-1 text-sm">
              <div v-for="svc in store.gcpUniqueServices" :key="svc.service" class="grid grid-cols-12 items-center gap-3 bg-[#0A1625] px-5 py-2.5 rounded-2xl">
                <div class="col-span-5 font-medium truncate">{{ svc.service }}</div>
                <div class="col-span-3 font-mono text-xs text-[#64748B] truncate">{{ svc.sku }}</div>
                <div class="col-span-2 text-right font-semibold tabular-nums text-[#02C39A]">${{ svc.totalCost.toFixed(2) }}</div>
                <div class="col-span-2 flex gap-px">
                  <button v-for="cat in (['Materials','Parts','CloudSaaS'] as const)" :key="cat"
                    @click="setMapping(svc.service, cat)"
                    class="flex-1 py-1 text-[10px] rounded-xl border transition"
                    :class="store.gcpMappings[svc.service] === cat ? 'bg-[#02C39A] text-black border-[#02C39A]' : 'border-white/15 hover:bg-white/5'">
                    {{ cat.substring(0, 4) }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 3 Live Chart.js Visualizations -->
          <div class="grid md:grid-cols-3 gap-4">
            <div class="hud-card p-6">
              <div class="label mb-2">MAPPED SPEND DISTRIBUTION</div>
              <div class="h-64"><canvas id="gcp-cat-chart" /></div>
            </div>
            <div class="hud-card p-6">
              <div class="label mb-2">GCP IMPORT vs SOVEREIGN MODEL</div>
              <div class="h-64"><canvas id="gcp-comp-chart" /></div>
              <div class="text-center text-xs mt-1 text-[#02C39A] font-mono">{{ store.gcpVsModelDelta.percentSavings }}% MODEL SAVINGS</div>
            </div>
            <div class="hud-card p-6">
              <div class="label mb-2">AI CLOUD → ON-DEVICE SAVINGS</div>
              <div class="h-64"><canvas id="gcp-ai-chart" /></div>
            </div>
          </div>

          <!-- Sovereign Edge Analysis (the hero section) -->
          <div class="hud-card border-[#02C39A]/40 p-8 bg-[#0A1625]">
            <div class="uppercase tracking-[3px] text-sm text-[#02C39A] flex items-center gap-2 mb-3">
              <TrendingUp class="w-4 h-4"/> WHAT THIS MEANS FOR SOVEREIGN EDGE
            </div>
            <div class="text-[21px] leading-tight tracking-tight pr-4">{{ store.sovereignAnalysis.narrative }}</div>

            <div class="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div class="bg-[#111F2E] p-5 rounded-2xl">
                <div class="uppercase text-xs text-[#64748B]">CLOUD AI SPEND</div>
                <div class="text-4xl font-mono mt-2 text-[#E85D04]">${{ store.sovereignAnalysis.cloudAISpend.toFixed(0) }}</div>
                <div class="text-xs mt-1">/mo (Vertex + Vision + Gemini)</div>
              </div>
              <div class="bg-[#111F2E] p-5 rounded-2xl">
                <div class="uppercase text-xs text-[#64748B]">PROJECTED ON-DEVICE SAVINGS</div>
                <div class="text-4xl font-mono mt-2 text-[#02C39A]">${{ store.sovereignAnalysis.projectedOnDeviceSavings.toFixed(0) }}</div>
                <div class="text-xs mt-1">per month at 82% migration</div>
              </div>
              <div class="bg-[#111F2E] p-5 rounded-2xl">
                <div class="uppercase text-xs text-[#64748B]">HARDWARE PAYBACK</div>
                <div class="text-4xl font-mono mt-2">{{ store.sovereignAnalysis.paybackMonths }} <span class="text-xl align-super">months</span></div>
              </div>
              <div class="bg-[#111F2E] p-5 rounded-2xl text-xs">
                <div class="uppercase text-[#64748B] mb-2">TOP CLOUD AI SERVICES</div>
                <div v-for="s in store.sovereignAnalysis.aiServices" :key="s.name" class="flex justify-between py-0.5 border-b border-white/5 last:border-none">
                  <span>{{ s.name }}</span> <span class="font-mono text-[#E85D04]">${{ s.spend.toFixed(0) }}</span>
                </div>
              </div>
            </div>
            <div class="text-[10px] mt-5 text-[#64748B] flex gap-2 items-center"><AlertTriangle class="w-3.5 h-3.5 text-[#E85D04]"/> All values are 100% live. Edit any mapping above — charts, totals, and savings projections update in real time.</div>

            <!-- Creative tie-in for Human Installers (new) -->
            <div class="mt-4 text-xs bg-[#0F2538] border border-[#02C39A]/30 rounded-xl p-4 text-[#CBD5E1]">
              <span class="font-semibold text-[#02C39A]">Human Installers as the Enabler:</span> 
              The one-time human labor cost (currently visible in your model under HUMAN LABOR) is the critical upfront investment that unlocks the elimination of recurring high cloud AI inference spend. 
              In a real COTA deployment, the certified transit techs who mount and commission the OAK-4 cameras are what makes the 80-90%+ monthly savings possible by moving inference on-device.
            </div>
          </div>

          <!-- AGGRESSIVE LIVE CONNECTOR PROGRESS HUD (SKU + Storage fetches via :8787) -->
          <div v-if="store.connectorProgress.isActive || store.cacheMeta.storageLastPulled || store.cacheMeta.skuLastPulled" 
               class="hud-card p-5 border border-[#02C39A]/30 bg-[#0A1625]">
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-3">
                <div v-if="store.connectorProgress.isActive" class="w-5 h-5 border-2 border-[#02C39A] border-t-transparent rounded-full animate-spin" />
                <div v-else class="w-2 h-2 rounded-full bg-[#02C39A]" />
                <div class="font-mono text-xs tracking-[2px] text-[#02C39A]">LIVE GCLOUD CONNECTOR • gp-phantomvision-dev</div>
              </div>
              <div class="font-mono text-[10px] text-[#64748B]">
                {{ store.connectorProgress.isActive ? 'SYNCING...' : 'IDLE • CACHED' }}
              </div>
            </div>

            <!-- Prominent progress indicator -->
            <div v-if="store.connectorProgress.isActive" class="mb-3">
              <div class="flex items-baseline gap-4">
                <div class="text-5xl font-mono font-semibold text-[#02C39A] tabular-nums">{{ store.connectorProgressPercent }}<span class="text-2xl align-super">%</span></div>
                <div>
                  <div class="text-sm tracking-widest">COMPLETE</div>
                  <div class="text-[10px] text-[#64748B] font-mono">STEP {{ store.connectorProgress.passed + store.connectorProgress.pulled + store.connectorProgress.saved + store.connectorProgress.failed }} / {{ store.connectorProgress.totalCalls }}</div>
                </div>
              </div>
              <div class="mt-2 h-1.5 bg-white/10 rounded overflow-hidden">
                <div class="h-1.5 bg-[#02C39A] transition-all" :style="{ width: store.connectorProgressPercent + '%' }"></div>
              </div>
            </div>

            <!-- Live breakdown -->
            <div class="font-mono text-xs text-[#CBD5E1] bg-black/30 px-4 py-2 rounded-xl flex flex-wrap gap-x-4 gap-y-1">
              <span class="text-[#02C39A]">{{ store.connectorProgressPercent }}% COMPLETE</span>
              <span>|</span>
              <span>Passed: <span class="text-white">{{ store.connectorProgress.passed }}</span></span>
              <span>Pulled: <span class="text-white">{{ store.connectorProgress.pulled }}</span></span>
              <span>Saved: <span class="text-white">{{ store.connectorProgress.saved }}</span></span>
              <span class="text-[#E85D04]">Failed: {{ store.connectorProgress.failed }}</span>
            </div>

            <div v-if="!store.connectorProgress.isActive && (store.cacheMeta.storageLastPulled || store.cacheMeta.skuLastPulled)" class="mt-2 text-[10px] text-[#64748B] font-mono">
              Last successful connector activity • Caches auto-expire after 5 min
            </div>
          </div>

          <!-- SKU Catalog + Backend hint -->
          <div class="hud-card p-6">
            <div class="flex justify-between items-baseline mb-3">
              <div>
                <div class="font-mono text-xs text-[#02C39A]">SKU PRICE CATALOG (AI / COMPUTE)</div>
                <div v-if="store.cacheMeta.skuLastPulled" class="text-[10px] text-[#02C39A]/70 font-mono mt-0.5">
                  Last pulled: {{ new Date(store.cacheMeta.skuLastPulled).toLocaleTimeString() }} • {{ store.cacheMeta.source }}
                </div>
              </div>
              <button @click="refreshSKUs" 
                      :disabled="store.liveStorageLoading || store.connectorProgress.isActive"
                      class="text-xs px-4 py-1 border border-white/30 rounded hover:bg-white/5 flex items-center gap-1.5 disabled:opacity-60">
                <RefreshCw class="w-3 h-3" :class="{ 'animate-spin': store.liveStorageLoading || store.connectorProgress.isActive }"/>
                REFRESH — TRY LOCAL GCLOUD ADC
              </button>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div v-for="s in store.skuCatalog" :key="s.sku" class="bg-[#0A1625] border border-white/5 rounded-2xl p-4">
                <div class="font-mono text-[#02C39A]">{{ s.sku }}</div>
                <div class="mt-0.5">{{ s.description }}</div>
                <div class="flex justify-between mt-2 text-[10px] text-[#64748B]">
                  <div>LIST ${{ s.listPrice }}</div>
                  <div class="font-semibold text-[#E85D04]">TYPICAL ${{ s.typicalMonthly }}</div>
                </div>
                <div class="text-[10px] mt-2 text-[#64748B]">{{ s.notes }}</div>
              </div>
            </div>
            <div class="mt-4 text-xs text-[#64748B] font-mono">For live data: from the cost-sentinel folder run <span class="text-[#02C39A]">./start-gcloud-connector.sh</span> (or <span class="text-[#02C39A]">npm run connector</span>). Last response cached 5 min in localStorage.</div>
          </div>

          <!-- Live Storage Costs wired to gp-phantomvision-dev -->
          <div class="hud-card p-6 mt-6">
            <div class="flex justify-between items-baseline mb-4">
              <div>
                <div class="font-mono text-xs text-[#02C39A]">LIVE FROM GCLOUD CONNECTOR</div>
                <div class="text-xl font-semibold">Storage Costs — gp-phantomvision-dev (Phantom Vision Dev)</div>
                <div v-if="store.cacheMeta.storageLastPulled" class="mt-1 text-[10px] font-mono text-[#02C39A]">
                  Last pulled: {{ new Date(store.cacheMeta.storageLastPulled).toLocaleTimeString() }} • {{ store.cacheMeta.source }}
                </div>
              </div>
              <button @click="fetchLiveStorage" 
                      :disabled="store.liveStorageLoading || store.connectorProgress.isActive"
                      class="text-xs px-4 py-2 border border-[#02C39A]/40 rounded-xl hover:bg-[#02C39A]/10 flex items-center gap-2 disabled:opacity-60">
                <RefreshCw class="w-3.5 h-3.5" :class="{ 'animate-spin': store.liveStorageLoading || store.connectorProgress.isActive }"/>
                {{ store.liveStorageLoading || store.connectorProgress.isActive ? 'LOADING...' : 'FETCH LIVE STORAGE' }}
              </button>
            </div>

            <!-- Prominent progress also echoed here when active for this action -->
            <div v-if="store.connectorProgress.isActive" class="mb-4 px-4 py-3 bg-black/40 rounded-xl text-xs font-mono border border-[#02C39A]/20">
              <div class="flex items-center gap-2 text-[#02C39A]">
                <span class="animate-pulse">●</span> 
                CONNECTOR ACTIVE — {{ store.connectorProgressPercent }}% 
                (Passed {{ store.connectorProgress.passed }} • Pulled {{ store.connectorProgress.pulled }} • Saved {{ store.connectorProgress.saved }} • Failed {{ store.connectorProgress.failed }})
              </div>
            </div>

            <div v-if="store.liveStorageData?.source === 'live'" class="space-y-4">
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="bg-[#0A1625] p-4 rounded-xl">
                  <div class="text-xs text-[#64748B]">TOTAL STORAGE IN PROJECT</div>
                  <div class="text-3xl font-mono mt-1">{{ store.liveStorageData.totalStorageGB }} GB</div>
                </div>
                <div class="bg-[#0A1625] p-4 rounded-xl">
                  <div class="text-xs text-[#64748B]">EST. MONTHLY (approx Standard)</div>
                  <div class="text-3xl font-mono mt-1 text-[#E85D04]">${{ store.liveStorageData.estimatedMonthlyStorageUSD }}</div>
                </div>
                <div class="bg-[#0A1625] p-4 rounded-xl">
                  <div class="text-xs text-[#64748B]">BUCKETS FOUND</div>
                  <div class="text-3xl font-mono mt-1">{{ store.liveStorageData.buckets?.length || 0 }}</div>
                </div>
              </div>

              <div class="text-xs text-[#64748B]">Bucket-level breakdown (most of this video/detection storage can move on-device with Ghost Protocol, dramatically reducing these costs):</div>
              <div class="max-h-40 overflow-auto text-xs font-mono bg-[#0A1625] p-3 rounded-xl">
                <div v-for="b in store.liveStorageData.buckets" :key="b.name" class="flex justify-between py-1 border-b border-white/5 last:border-none">
                  <span class="truncate">{{ b.name }}</span>
                  <span>{{ b.sizeGB }} GB → ~${{ b.estimatedMonthlyUSD }}/mo</span>
                </div>
              </div>

              <!-- Cache + source provenance -->
              <div class="text-[10px] font-mono px-1 text-[#02C39A]/80">
                Last pulled: {{ store.cacheMeta.storageLastPulled ? new Date(store.cacheMeta.storageLastPulled).toLocaleString() : 'just now' }} • Source: {{ store.cacheMeta.source }}
              </div>
            </div>

            <div v-else-if="store.liveStorageData" class="text-xs text-[#E85D04]">
              {{ store.liveStorageData.error || 'Connector responded but no data.' }}
            </div>

            <div v-else class="text-xs text-[#64748B] leading-relaxed">
              Run this from the <span class="font-mono">cost-sentinel</span> folder:<br>
              <span class="font-mono text-[#02C39A]">./start-gcloud-connector.sh</span><br>
              (or <span class="font-mono">npm run connector</span>).<br>
              Then click the button above. Requires <code>gcloud auth application-default login</code> + project set to <span class="font-mono">gp-phantomvision-dev</span>.
            </div>

            <!-- Critical inline explanation per requirements (lightweight local tool, no persistent DB) -->
            <div class="mt-5 pt-4 border-t border-white/10 text-[10px] leading-snug text-[#64748B]">
              <span class="font-semibold text-[#E85D04]">NOTE:</span> 
              No persistent database/BigQuery cache is used yet. This is a lightweight local tool. Data is fetched live via ADC on each request. We cache the last response in browser localStorage for speed. 
              For production historical billing, enable Cloud Billing export to BigQuery on the project.
            </div>
          </div>
        </div>

        <!-- Empty powerful call to action -->
        <div v-else class="hud-card p-12 text-center">
          <div class="text-[#02C39A] mb-2"><Cloud :size="48" class="mx-auto opacity-70"/></div>
          <div class="text-2xl">Ready for authentic GCP billing data</div>
          <p class="text-[#64748B] max-w-sm mx-auto mt-2">Load the rich demo sample (includes Vertex AI Vision training, Gemini inference, Compute, etc.) or drop any real export from the Google Cloud Console Billing export or BigQuery table export.</p>
        </div>
      </div>

      <!-- REPORTS -->
      <div v-else class="tab-content">
        <div class="mb-7">
          <div class="label">AUDIT-GRADE DELIVERABLES</div>
          <h2 class="text-5xl font-semibold tracking-tight">Reports &amp; Exports</h2>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div class="hud-card p-8">
            <div class="uppercase font-mono tracking-widest text-sm text-[var(--accent-teal)] mb-4">EXECUTIVE SUMMARY</div>
            <div class="space-y-6 text-sm">
              <div class="flex justify-between border-b border-[var(--border)] pb-3"><div>Scaled Fleet Size</div><div class="font-mono">{{ totalCameras }} CAMERAS</div></div>
              <div class="flex justify-between border-b border-[var(--border)] pb-3"><div>5-Year TCO (Current Scale)</div><div class="font-mono text-xl text-[var(--accent-orange)]">{{ formatCurrency(fiveYearTCO) }}</div></div>
              <div class="flex justify-between border-b border-[var(--border)] pb-3"><div>CapEx (One-Time)</div><div class="font-mono">{{ formatCurrency(scaledOneTime) }}</div></div>
              <div class="flex justify-between"><div>Annual OpEx</div><div class="font-mono">{{ formatCurrency(scaledAnnual) }}</div></div>
            </div>
          </div>
          <div class="hud-card p-8 flex flex-col">
            <div class="uppercase font-mono tracking-widest text-sm text-[var(--accent-teal)] mb-4">GENERATE DELIVERABLES</div>
            <div class="flex-1 flex flex-col justify-center gap-y-4">
              <button @click="generateCSV" class="btn w-full justify-center py-4 text-base tracking-wider">
                <Download :size="17" class="mr-2" /> EXPORT FULL DATASET (CSV)
              </button>
              <button @click="generatePDF" class="btn-primary w-full justify-center py-4 text-base tracking-wider">
                <FileText :size="17" class="mr-2" /> GENERATE CLASSIFIED PDF REPORT
              </button>
              <button @click="connectGCP" class="btn w-full justify-center py-3.5 text-sm">
                <RefreshCw :size="15" class="mr-2" /> REFRESH FROM GCP BEFORE EXPORT
              </button>
            </div>
            <div v-if="reportGenerated" class="text-[10px] text-center text-[var(--accent-green)] font-mono pt-4">PDF REPORT LAST GENERATED SUCCESSFULLY.</div>
          </div>
        </div>
        <div class="mt-6 text-xs font-mono text-center text-[var(--text-muted)]">
          All exports contain complete line-item detail, scale parameters, and timestamp. Perfect for procurement, finance, and zero-trust audit reviews.
        </div>
      </div>
    </div>

    <footer class="border-t border-[var(--border)] py-5 text-center">
      <div class="max-w-[1480px] mx-auto px-6 text-[10px] font-mono tracking-widest text-[var(--text-muted)] flex flex-wrap justify-center gap-x-6 gap-y-1">
        <span>SHADOWFORGE COST SENTINEL v4.2</span>
        <span>GHOST PROTOCOL SOVEREIGN EDGE AI</span>
        <span>100% CLIENT-SIDE • NO LOGIN • LOCAL PERSISTENCE</span>
        <span class="text-[var(--accent-orange)]">COTA MASS TRANSIT • MAY 2026</span>
      </div>
    </footer>

    <Transition name="fade">
      <div v-if="toast" class="fixed bottom-8 left-1/2 -translate-x-1/2 z-[90] px-6 py-2.5 rounded-full bg-[#0F1E32] border border-[var(--accent-teal)] text-sm font-mono shadow-xl flex items-center gap-3">
        <div class="text-[var(--accent-teal)]">●</div>
        {{ toast.msg }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: all 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translate(-50%, 12px); }
</style>
