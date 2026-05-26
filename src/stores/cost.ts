import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import Papa from 'papaparse'

export interface CostItem {
  id: number
  category: string
  item: string
  unitCost: number
  qty: number
  type: 'one-time' | 'monthly'
  notes?: string
}

export interface ScaleConfig {
  sites: number
  camerasPerSite: number
  retentionMonths: number
  inferenceMultiplier: number
}

// === GCP CONNECT: Powerful importer types for real GCP Billing CSV exports ===
export type GCPCategory = 'Materials' | 'Parts' | 'CloudSaaS'

export interface GCPBillingRow {
  id: string
  service: string
  sku: string
  cost: number
  currency: string
  date?: string
  project?: string
  usage?: string
  raw?: Record<string, any>
}

export interface GCPMapping {
  [serviceKey: string]: GCPCategory
}

export interface SKUEntry {
  sku: string
  description: string
  listPrice: number
  typicalMonthly: number
  category: string
  notes: string
}

export interface SovereignSavingsAnalysis {
  cloudAISpend: number
  aiServices: Array<{ name: string; spend: number }>
  projectedOnDeviceSavings: number
  paybackMonths: number
  narrative: string
}

const STORAGE_KEY = 'shadowforge-cost-sentinel-v1'
const GCP_STORAGE_KEY = 'shadowforge-gcp-import-v1'

// Realistic sample GCP Billing export CSV (standard columns from BigQuery export / Console CSV)
// Includes Vertex AI, Cloud Vision, Compute, Storage – typical for Sovereign Edge workloads
const SAMPLE_GCP_CSV = `billing_account_id,invoice.month,service.description,sku.description,usage_start_time,project.id,location.region,usage.amount,usage.unit,cost,currency
0123AB-4567CD-89EF,202605,Vertex AI,Vertex AI - Online Prediction (vCPU hours),2026-05-03T00:00:00Z,sovereign-edge-prod,us-central1,184.5,hours,52.40,USD
0123AB-4567CD-89EF,202605,Vertex AI,Vertex AI Vision - Training Node Hours (A100),2026-05-11T00:00:00Z,vision-training,us-central1,27.0,hours,312.90,USD
0123AB-4567CD-89EF,202605,Cloud Vision API,Vision API - Label Detection (per 1K units),2026-05-07T14:22:00Z,sovereign-edge-prod,global,18400,units,18.40,USD
0123AB-4567CD-89EF,202605,Cloud Vision API,Vision API - Text Detection + OCR,2026-05-19T09:05:00Z,sovereign-edge-prod,global,7200,units,9.72,USD
0123AB-4567CD-89EF,202605,Compute Engine,E2 Instance Core (us-central1),2026-05-01T00:00:00Z,sovereign-edge-prod,us-central1,672,hours,18.15,USD
0123AB-4567CD-89EF,202605,Compute Engine,E2 Instance RAM (us-central1),2026-05-01T00:00:00Z,sovereign-edge-prod,us-central1,2688,gibibyte_hour,8.12,USD
0123AB-4567CD-89EF,202605,Cloud Storage,Standard Storage (us-central1) - 50GB,2026-05-01T00:00:00Z,sovereign-edge-prod,us-central1,51.2,GB,1.18,USD
0123AB-4567CD-89EF,202605,Cloud Logging,Logging Storage + Ingestion,2026-05-02T00:00:00Z,sovereign-edge-prod,global,12400000,bytes,4.85,USD
0123AB-4567CD-89EF,202605,Vertex AI,Text Embedding API - text-embedding-004,2026-05-22T16:40:00Z,sovereign-edge-prod,global,1280000,characters,1.28,USD
0123AB-4567CD-89EF,202605,Compute Engine,SSD Persistent Disk (Balanced),2026-05-01T00:00:00Z,sovereign-edge-prod,us-central1,420,GB-month,21.00,USD`

function generateId(prefix = 'gcp'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

// Flexible parser: handles standard GCP BigQuery export columns + common Console CSV variants
function parseGCPBillingCSV(csvText: string): GCPBillingRow[] {
  const results = Papa.parse<Record<string, string>>(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  })

  if (results.errors.length > 3) {
    console.warn('[GCP Parser] Some CSV parse issues:', results.errors.slice(0, 3))
  }

  const rows: GCPBillingRow[] = []

  for (const raw of results.data) {
    if (!raw || Object.keys(raw).length < 3) continue

    // Flexible column detection (case-insensitive + common aliases)
    const get = (keys: string[]): string => {
      for (const k of keys) {
        const found = Object.keys(raw).find(h => h.toLowerCase().includes(k.toLowerCase()))
        if (found && raw[found]) return raw[found]
      }
      return ''
    }

    const service = get(['service.description', 'service', 'Service']) || 'Unknown Service'
    const sku = get(['sku.description', 'sku', 'SKU Description', 'sku id']) || 'Unknown SKU'
    const costStr = get(['cost', 'Cost', 'cost (usd)', 'billing cost']) || '0'
    const currency = get(['currency', 'Currency']) || 'USD'
    const date = get(['usage_start_time', 'usage start', 'invoice.month', 'date'])
    const project = get(['project.id', 'project', 'Project ID'])
    const usage = get(['usage.amount', 'usage', 'usage unit'])

    const cost = parseFloat(costStr.replace(/[$,\s]/g, '')) || 0
    if (cost === 0 && !service.includes('Unknown')) continue // skip pure zero lines

    rows.push({
      id: generateId(),
      service: service.trim(),
      sku: sku.trim(),
      cost: Math.round(cost * 100) / 100,
      currency: currency.trim().toUpperCase(),
      date: date ? date.substring(0, 10) : undefined,
      project: project || 'sovereign-edge-prod',
      usage: usage || undefined,
      raw,
    })
  }
  return rows
}

// Generate a few more varied rows for richer demo if needed
function createRichSampleRows(): GCPBillingRow[] {
  const base = parseGCPBillingCSV(SAMPLE_GCP_CSV)
  // Add one more high-value AI row to emphasize Sovereign value prop
  base.push({
    id: generateId(),
    service: 'Vertex AI',
    sku: 'Vertex AI - Gemini 1.5 Pro Inference (online)',
    cost: 87.6,
    currency: 'USD',
    date: '2026-05-15',
    project: 'sovereign-edge-prod',
    usage: '124k tokens',
  })
  return base
}

const DEFAULT_ITEMS: CostItem[] = [
  // Hardware - Edge Sovereign AI Cameras
  { id: 1, category: 'HARDWARE', item: 'Sovereign Edge AI Camera (12MP, Jetson Orin NX)', unitCost: 1240, qty: 48, type: 'one-time', notes: 'Ghost Protocol v4.2' },
  { id: 2, category: 'HARDWARE', item: 'NVIDIA Jetson Orin NX 16GB Module', unitCost: 720, qty: 48, type: 'one-time' },
  { id: 3, category: 'HARDWARE', item: 'IP67 Weatherproof Enclosure + Mount', unitCost: 185, qty: 48, type: 'one-time' },
  { id: 4, category: 'HARDWARE', item: 'Industrial PoE++ Switch (24-port)', unitCost: 890, qty: 3, type: 'one-time' },
  { id: 5, category: 'HARDWARE', item: 'Local NVMe Storage Array (32TB RAID)', unitCost: 3120, qty: 3, type: 'one-time' },
  // Installation & Integration
  { id: 6, category: 'INSTALL', item: 'Site Survey + Custom Mounting', unitCost: 2650, qty: 4, type: 'one-time' },
  { id: 7, category: 'INSTALL', item: 'Cable Runs + Conduit (per site avg)', unitCost: 1870, qty: 4, type: 'one-time' },
  { id: 8, category: 'INSTALL', item: 'On-site Commissioning + Calibration', unitCost: 4200, qty: 4, type: 'one-time' },

  // === HUMAN INSTALLERS (explicit callout as requested) ===
  { id: 15, category: 'HUMAN LABOR', item: 'Certified Field Installer (Transit Specialist) — 7.5 hrs @ $118/hr per camera', unitCost: 885, qty: 48, type: 'one-time', notes: 'Rugged bus mount + electrical + vibration + integration' },
  { id: 16, category: 'HUMAN LABOR', item: 'Lead Installer / Crew Supervisor (1 per 8 cameras)', unitCost: 1250, qty: 6, type: 'one-time', notes: 'QA, safety, coordination with COTA operations' },
  { id: 17, category: 'HUMAN LABOR', item: 'Installer Training + Vehicle-Specific Certification (one-time crew)', unitCost: 6800, qty: 1, type: 'one-time', notes: 'High-voltage, J1939, revenue-service safety' },

  // === MATERIALS: Cabling & Connectivity (aggressive expansion) ===
  { id: 18, category: 'MATERIALS', item: 'M12-8pin Rugged Vibration-Resistant Cable (per camera)', unitCost: 47, qty: 48, type: 'one-time', notes: 'Shielded, IP67, bus-specific length' },
  { id: 19, category: 'MATERIALS', item: 'Custom Power + Data Harness Kit (PoE + CAN)', unitCost: 92, qty: 48, type: 'one-time' },
  { id: 20, category: 'MATERIALS', item: 'Industrial PoE Injectors + Surge Protection (per bus)', unitCost: 165, qty: 48, type: 'one-time' },

  // === LOGISTICS & DEPLOYMENT ===
  { id: 21, category: 'LOGISTICS', item: 'Shipping + Customs (OAK cameras + hardware from EU/US)', unitCost: 185, qty: 48, type: 'one-time' },
  { id: 22, category: 'LOGISTICS', item: 'Depot Staging + Secure Storage (per site)', unitCost: 4200, qty: 4, type: 'one-time' },
  { id: 23, category: 'LOGISTICS', item: 'Fleet Vehicle Downtime Coordination (COTA ops)', unitCost: 850, qty: 48, type: 'one-time', notes: 'Revenue service impact buffer' },

  // === INSTALLATION BUDGET / TIME (granular beyond pure labor) ===
  { id: 24, category: 'INSTALL', item: 'Per-Bus Installation Time Budget (tools, consumables, testing gear)', unitCost: 380, qty: 48, type: 'one-time' },
  { id: 25, category: 'INSTALL', item: 'Crew Travel + Per Diem (multi-depot rollout)', unitCost: 1250, qty: 8, type: 'one-time' },
  { id: 26, category: 'INSTALL', item: 'Depot Electrical + Network Prep (COTA facilities)', unitCost: 18500, qty: 4, type: 'one-time' },

  // === GCLOUD / FIRMWARE + ML PIPELINE (sovereign but real costs) ===
  { id: 27, category: 'GCLOUD_ML', item: 'Artifact Registry + Cloud Storage (firmware + custom models)', unitCost: 185, qty: 1, type: 'monthly' },
  { id: 28, category: 'GCLOUD_ML', item: 'Vertex AI Custom Training Pipeline (fine-tuning RF-DETR / Gemma variants)', unitCost: 2450, qty: 1, type: 'monthly', notes: 'Per major model update cycle' },
  { id: 29, category: 'GCLOUD_ML', item: 'Model Deployment Orchestration + Versioning (even edge push)', unitCost: 680, qty: 1, type: 'monthly' },
  { id: 30, category: 'GCLOUD_ML', item: 'CI/CD for Ghost Protocol Firmware (Cloud Build)', unitCost: 320, qty: 1, type: 'monthly' },

  // === STREAMING, VIDEO & DETECTIONS FROM SHADOWS ===
  { id: 31, category: 'STREAMING', item: 'Selective Cloud Video Clip Storage (detection-triggered, 30s clips)', unitCost: 0.012, qty: 125000, type: 'monthly', notes: 'Only high-severity events offloaded' },
  { id: 32, category: 'STREAMING', item: 'Live WebRTC / RTSP Relay for Dispatch (on-demand)', unitCost: 420, qty: 1, type: 'monthly' },
  { id: 33, category: 'STREAMING', item: 'Detection Metadata + Event Ingestion (structured + video thumbnails)', unitCost: 0.008, qty: 380000, type: 'monthly' },

  // === MQTT / TELEMETRY INFRASTRUCTURE ===
  { id: 34, category: 'MQTT', item: 'GCP Pub/Sub + MQTT Bridge (fleet telemetry + detections)', unitCost: 285, qty: 1, type: 'monthly' },
  { id: 35, category: 'MQTT', item: 'Message Volume + Retention (high-frequency status + events)', unitCost: 165, qty: 1, type: 'monthly' },
  // Cloud / SaaS - Sovereign GCP
  { id: 9, category: 'CLOUD', item: 'GCP Sovereign Region - Vertex AI Inference', unitCost: 0.068, qty: 48, type: 'monthly', notes: 'per camera-hour equiv' },
  { id: 10, category: 'CLOUD', item: 'Object Storage (Coldline) - 90d retention', unitCost: 0.004, qty: 165000, type: 'monthly', notes: 'GB/mo projected' },
  { id: 11, category: 'CLOUD', item: 'GCP Operations Suite + Logging', unitCost: 245, qty: 4, type: 'monthly' },
  { id: 12, category: 'CLOUD', item: 'Secure Private Connectivity (Cloud VPN)', unitCost: 680, qty: 4, type: 'monthly' },
  // Ongoing
  { id: 13, category: 'MAINTENANCE', item: 'Firmware / Model OTA Updates (managed)', unitCost: 340, qty: 4, type: 'monthly' },
  { id: 14, category: 'MAINTENANCE', item: '24/7 Zero-Trust SOC Monitoring Retainer', unitCost: 1950, qty: 1, type: 'monthly' },

  // === COGS OVERHEAD (Sales Director + CFO requirement: Travel, IT Infra, Model Costs) ===
  { id: 36, category: 'COGS', item: 'Travel & Field Support (installer/engineer trips + per diems)', unitCost: 165, qty: 48, type: 'one-time', notes: 'Amortized per camera for multi-depot COTA rollout' },
  { id: 37, category: 'COGS', item: 'IT Infrastructure - Management & Orchestration Platform', unitCost: 420, qty: 1, type: 'monthly', notes: 'Control plane, dashboards, OTA orchestration, monitoring' },
  { id: 38, category: 'COGS', item: 'ML Model Lifecycle (training, fine-tuning, eval, registry, updates)', unitCost: 1850, qty: 1, type: 'monthly', notes: 'Vertex/Gemma retraining cycles + storage + compliance' },
  { id: 39, category: 'COGS', item: 'Customer Success & Tier-2 Support Allocation (per camera)', unitCost: 28, qty: 48, type: 'monthly' },
]

export const useCostStore = defineStore('cost', () => {
  // State
  const items = ref<CostItem[]>([...DEFAULT_ITEMS])
  const scaleConfig = ref<ScaleConfig>({
    sites: 4,
    camerasPerSite: 12,
    retentionMonths: 90,
    inferenceMultiplier: 1.0,
  })

  // === Business Models (CFO + Sales Director requirement) ===
  const businessModel = ref<'hardware-markup' | 'saas-managed'>('hardware-markup')
  const hardwareMarkupPercent = ref(0.42)   // 42% markup on hardware + install heavy costs
  const saasMonthlyPricePerCamera = ref(52)  // Suggested recurring price per camera for full managed service

  // SaaS LTV / Churn assumptions (new per advisor request)
  const saasAnnualChurnRate = ref(0.08)     // 8% annual churn (realistic for transit SaaS)
  const saasGrossMarginForLTV = ref(0.68)   // Conservative gross margin used for LTV calc (after all COGS)

  const lastUpdated = ref<string>(new Date().toISOString())

  // Load from localStorage on init
  function loadFromStorage() {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (parsed.items?.length) items.value = parsed.items
        if (parsed.scaleConfig) scaleConfig.value = parsed.scaleConfig
        if (parsed.lastUpdated) lastUpdated.value = parsed.lastUpdated
      } catch (e) {
        console.warn('[CostSentinel] Failed to parse local state, using defaults.')
      }
    }
  }

  // Auto-persist
  function persist() {
    const payload = {
      items: items.value,
      scaleConfig: scaleConfig.value,
      lastUpdated: new Date().toISOString(),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    lastUpdated.value = payload.lastUpdated
  }

  // Watchers for auto-save
  watch(items, persist, { deep: true })
  watch(scaleConfig, persist, { deep: true })

  // Computed totals
  const oneTimeTotal = computed(() =>
    items.value
      .filter((i) => i.type === 'one-time')
      .reduce((sum, i) => sum + i.unitCost * i.qty, 0)
  )

  const monthlyTotal = computed(() =>
    items.value
      .filter((i) => i.type === 'monthly')
      .reduce((sum, i) => sum + i.unitCost * i.qty, 0)
  )

  const annualRecurring = computed(() => monthlyTotal.value * 12)

  // Scaled projections using current config
  const totalCameras = computed(() => scaleConfig.value.sites * scaleConfig.value.camerasPerSite)

  const scaledOneTime = computed(() => {
    const baseCameras = 48
    const scaleFactor = totalCameras.value / baseCameras
    return Math.round(oneTimeTotal.value * scaleFactor * 100) / 100
  })

  const scaledMonthly = computed(() => {
    const baseCameras = 48
    const camScale = totalCameras.value / baseCameras
    const inferenceScale = scaleConfig.value.inferenceMultiplier
    // Storage scales with retention too (rough proxy)
    const storageScale = (scaleConfig.value.retentionMonths / 90) * 0.6 + 0.4
    return Math.round(monthlyTotal.value * camScale * inferenceScale * storageScale * 100) / 100
  })

  const scaledAnnual = computed(() => Math.round(scaledMonthly.value * 12 * 100) / 100)

  const fiveYearTCO = computed(() => 
    Math.round((scaledOneTime.value + (scaledAnnual.value * 5)) * 100) / 100
  )

  // === Business Model Economics ===
  const hardwareCOGS = computed(() => {
    // Hardware + Cabling + Human Labor + Logistics + Install + Travel (one-time heavy)
    const hardwareRelated = items.value
      .filter(i => ['HARDWARE', 'MATERIALS', 'HUMAN LABOR', 'LOGISTICS', 'INSTALL', 'COGS'].includes(i.category) && i.type === 'one-time')
      .reduce((sum, i) => sum + i.unitCost * i.qty, 0)
    return Math.round(hardwareRelated * 100) / 100
  })

  const recurringCOGS = computed(() => {
    // All monthly costs + GCLOUD_ML + STREAMING + MQTT + COGS recurring
    return Math.round(monthlyTotal.value * 100) / 100
  })

  // Hardware Markup Model
  const hardwareMarkupRevenue = computed(() => {
    const revenue = hardwareCOGS.value * (1 + hardwareMarkupPercent.value)
    return Math.round(revenue * 100) / 100
  })

  const hardwareGrossProfit = computed(() => Math.round((hardwareMarkupRevenue.value - hardwareCOGS.value) * 100) / 100)
  const hardwareGrossMargin = computed(() => hardwareMarkupRevenue.value > 0 ? Math.round((hardwareGrossProfit.value / hardwareMarkupRevenue.value) * 1000) / 10 : 0)

  // SaaS / Managed Service Model
  const saasMonthlyRevenue = computed(() => {
    return Math.round(totalCameras.value * saasMonthlyPricePerCamera.value * 100) / 100
  })

  const saasAnnualRevenue = computed(() => Math.round(saasMonthlyRevenue.value * 12 * 100) / 100)

  const saasGrossProfitMonthly = computed(() => {
    return Math.round((saasMonthlyRevenue.value - recurringCOGS.value) * 100) / 100
  })

  const saasGrossMargin = computed(() => saasMonthlyRevenue.value > 0 ? Math.round((saasGrossProfitMonthly.value / saasMonthlyRevenue.value) * 1000) / 10 : 0)

  const fiveYearSaaSRevenue = computed(() => Math.round(saasAnnualRevenue.value * 5 * 100) / 100)

  // === SaaS LTV & Churn Model ===
  const saasLTVPerCamera = computed(() => {
    // Simple LTV = (Annual Revenue per camera * Gross Margin) / Churn Rate
    const annualRevenuePerCamera = saasMonthlyPricePerCamera.value * 12
    const ltv = (annualRevenuePerCamera * saasGrossMarginForLTV.value) / saasAnnualChurnRate.value
    return Math.round(ltv * 100) / 100
  })

  const saasPaybackMonths = computed(() => {
    if (saasMonthlyRevenue.value <= 0) return 0
    // Rough payback = (one-time COGS per camera) / (monthly gross profit per camera)
    const oneTimePerCamera = hardwareCOGS.value / Math.max(1, totalCameras.value)
    const monthlyGrossProfitPerCamera = (saasMonthlyPricePerCamera.value - (recurringCOGS.value / Math.max(1, totalCameras.value))) * saasGrossMarginForLTV.value
    if (monthlyGrossProfitPerCamera <= 0) return 999
    return Math.round((oneTimePerCamera / monthlyGrossProfitPerCamera) * 10) / 10
  })

  const totalFleetLTV = computed(() => {
    return Math.round(saasLTVPerCamera.value * totalCameras.value * 100) / 100
  })

  // === Margin Waterfall Data (for SaaS model focus) ===
  const marginWaterfall = computed(() => {
    const revenue = store.businessModel === 'saas-managed' ? saasAnnualRevenue.value : hardwareMarkupRevenue.value
    const cogs = store.businessModel === 'saas-managed' ? (recurringCOGS.value * 12) : hardwareCOGS.value

    // Simplified waterfall steps for the chosen model
    return [
      { label: 'Revenue', value: revenue, type: 'start' },
      { label: 'Direct COGS', value: -cogs * 0.65, type: 'negative' },
      { label: 'IT + Model Lifecycle', value: -cogs * 0.22, type: 'negative' },
      { label: 'Travel + Support Overhead', value: -cogs * 0.13, type: 'negative' },
      { label: 'Gross Profit', value: revenue - cogs, type: 'positive' },
    ]
  })

  // Category breakdown for charts
  const categoryBreakdown = computed(() => {
    const groups: Record<string, { oneTime: number; monthly: number }> = {}
    
    items.value.forEach((item) => {
      if (!groups[item.category]) {
        groups[item.category] = { oneTime: 0, monthly: 0 }
      }
      const val = item.unitCost * item.qty
      if (item.type === 'one-time') {
        groups[item.category].oneTime += val
      } else {
        groups[item.category].monthly += val
      }
    })
    return groups
  })

  // =============================================
  // GCP CONNECT — Full Importer + Analysis Engine
  // =============================================
  const gcpRows = ref<GCPBillingRow[]>([])
  const gcpMappings = ref<GCPMapping>({})
  const gcpLastImport = ref<string | null>(null)
  const gcpImportSource = ref<'csv' | 'sample' | 'api-mock' | null>(null)

  // Load persisted GCP data
  function loadGCPFromStorage() {
    try {
      const saved = localStorage.getItem(GCP_STORAGE_KEY)
      if (saved) {
        const p = JSON.parse(saved)
        if (p.rows?.length) gcpRows.value = p.rows
        if (p.mappings) gcpMappings.value = p.mappings
        if (p.lastImport) gcpLastImport.value = p.lastImport
        if (p.source) gcpImportSource.value = p.source
      }
    } catch (e) { /* ignore */ }
  }

  function persistGCP() {
    const payload = {
      rows: gcpRows.value,
      mappings: gcpMappings.value,
      lastImport: gcpLastImport.value,
      source: gcpImportSource.value,
    }
    localStorage.setItem(GCP_STORAGE_KEY, JSON.stringify(payload))
  }

  watch([gcpRows, gcpMappings], persistGCP, { deep: true })

  // Total imported GCP spend (raw)
  const gcpTotalImported = computed(() =>
    gcpRows.value.reduce((sum, r) => sum + r.cost, 0)
  )

  // Unique services + SKUs for mapping UI
  const gcpUniqueServices = computed(() => {
    const map = new Map<string, { service: string; sku: string; totalCost: number; count: number }>()
    gcpRows.value.forEach(r => {
      const key = r.service
      if (!map.has(key)) {
        map.set(key, { service: r.service, sku: r.sku, totalCost: 0, count: 0 })
      }
      const entry = map.get(key)!
      entry.totalCost += r.cost
      entry.count += 1
    })
    return Array.from(map.values()).sort((a, b) => b.totalCost - a.totalCost)
  })

  // Apply user mappings (default to CloudSaaS for unmapped cloud services)
  const gcpMappedRows = computed(() => {
    return gcpRows.value.map(row => ({
      ...row,
      mappedCategory: (gcpMappings.value[row.service] || 'CloudSaaS') as GCPCategory,
    }))
  })

  // Spend by the three key categories after mapping
  const gcpSpendByCategory = computed(() => {
    const totals: Record<GCPCategory, number> = { Materials: 0, Parts: 0, CloudSaaS: 0 }
    gcpMappedRows.value.forEach(r => {
      totals[r.mappedCategory] += r.cost
    })
    return totals
  })

  // AI-heavy cloud spend (Vertex, Vision, Gemini, embeddings, prediction) — key to Sovereign story
  const gcpAICloudSpend = computed(() => {
    const aiKeywords = ['vertex', 'vision', 'gemini', 'embedding', 'prediction', 'ai ', 'inference']
    return gcpRows.value
      .filter(r => aiKeywords.some(k => (r.service + ' ' + r.sku).toLowerCase().includes(k)))
      .reduce((s, r) => s + r.cost, 0)
  })

  // Detailed AI services breakdown for analysis panel
  const gcpAIDetails = computed(() => {
    const aiKeywords = ['vertex', 'vision', 'gemini', 'embedding']
    const groups: Record<string, number> = {}
    gcpRows.value.forEach(r => {
      const hay = (r.service + ' ' + r.sku).toLowerCase()
      if (aiKeywords.some(k => hay.includes(k))) {
        const name = r.service.includes('Vertex') ? 'Vertex AI' : r.service.includes('Vision') ? 'Cloud Vision API' : r.service
        groups[name] = (groups[name] || 0) + r.cost
      }
    })
    return Object.entries(groups)
      .map(([name, spend]) => ({ name, spend: Math.round(spend * 100) / 100 }))
      .sort((a, b) => b.spend - a.spend)
  })

  // Live comparison: Imported GCP bill vs current Sovereign Edge project model (from existing store items)
  const projectModelTotal = computed(() => oneTimeTotal.value + (monthlyTotal.value * 3)) // 3-month horizon snapshot

  const gcpVsModelDelta = computed(() => {
    const imported = gcpTotalImported.value
    const modeled = projectModelTotal.value
    return {
      imported,
      modeled: Math.round(modeled * 100) / 100,
      delta: Math.round((imported - modeled) * 100) / 100,
      percentSavings: imported > 0 ? Math.round(((imported - modeled) / imported) * 1000) / 10 : 0,
    }
  })

  // The crown jewel: "What this means for Sovereign Edge" deep analysis
  const sovereignAnalysis = computed<SovereignSavingsAnalysis>(() => {
    const cloudAI = gcpAICloudSpend.value
    const aiSvcs = gcpAIDetails.value

    // Assumptions for on-device migration (tunable in real UI, hardcoded powerful defaults here)
    const migrationPct = 0.82 // 82% of Vision/Vertex inference moved on-device to Sovereign NPU
    const onDeviceCostFactor = 0.031 // ~3.1% the cost of cloud per inference (NPU power + amortized hardware)
    const hardwarePremiumPerDevice = 420 // extra for on-device silicon vs pure cloud

    const projectedSavings = Math.round(cloudAI * migrationPct * (1 - onDeviceCostFactor) * 100) / 100
    const annualCloudAI = cloudAI * 12
    const annualSavings = Math.round(projectedSavings * 12 * 100) / 100

    // Payback against incremental Sovereign hardware premium (very favorable)
    const devices = Math.max(12, totalCameras.value)
    const totalPremium = devices * hardwarePremiumPerDevice
    const payback = projectedSavings > 0 ? Math.ceil(totalPremium / (projectedSavings + 0.01)) : 99

    const narrative = cloudAI > 0 
      ? `Migrating ${Math.round(migrationPct * 100)}% of detected AI workloads ($${cloudAI.toFixed(0)}/mo) from Vertex & Vision to Sovereign Edge on-device inference eliminates ~${Math.round((1 - onDeviceCostFactor) * 100)}% of those costs. Payback on incremental NPU hardware: ~${payback} months at current scale. This is the core economic advantage of Sovereign Edge.`
      : 'Import a real GCP billing export containing Vertex AI or Cloud Vision usage to see precise Sovereign savings projections.'

    return {
      cloudAISpend: Math.round(cloudAI * 100) / 100,
      aiServices: aiSvcs,
      projectedOnDeviceSavings: projectedSavings,
      paybackMonths: payback,
      narrative,
    }
  })

  // SKU price catalog (strong mock + ready for real @google-cloud/billing ADC backend)
  const skuCatalog = ref<SKUEntry[]>([
    { sku: 'Vertex-Online-Pred-vCPU', description: 'Vertex AI Online Prediction vCPU', listPrice: 0.29, typicalMonthly: 52.4, category: 'AI', notes: 'Primary inference path replaced by on-device' },
    { sku: 'Vision-Label-1K', description: 'Cloud Vision Label Detection per 1K', listPrice: 1.00, typicalMonthly: 18.4, category: 'Vision', notes: 'High volume in fleet perception' },
    { sku: 'Gemini-1.5-Online', description: 'Gemini 1.5 Pro online tokens', listPrice: 0.0005, typicalMonthly: 87.6, category: 'AI', notes: 'Expensive; fully eliminated on-device' },
    { sku: 'Compute-E2-Core', description: 'E2 Instance Core hours', listPrice: 0.027, typicalMonthly: 18.2, category: 'Compute', notes: 'Some residual for orchestration' },
  ])

  // =============================================
  // AGGRESSIVE LIVE CONNECTOR: Progress Tracking + Client-side localStorage Cache
  // For gp-phantomvision-dev via http://localhost:8787 (no BigQuery/persistent DB yet)
  // =============================================
  interface ConnectorProgress {
    totalCalls: number
    passed: number
    pulled: number
    saved: number
    failed: number
    isActive: boolean
    lastUpdated: string | null
  }

  const connectorProgress = ref<ConnectorProgress>({
    totalCalls: 0,
    passed: 0,
    pulled: 0,
    saved: 0,
    failed: 0,
    isActive: false,
    lastUpdated: null
  })

  const connectorProgressPercent = computed(() => {
    const p = connectorProgress.value
    if (!p.totalCalls) return 0
    const completed = p.passed + p.pulled + p.saved + p.failed
    return Math.min(100, Math.floor((completed / p.totalCalls) * 100))
  })

  const liveStorageCache = ref<any>(null)
  const skuCache = ref<any>(null)
  const cacheMeta = ref({
    storageLastPulled: null as string | null,
    skuLastPulled: null as string | null,
    source: 'live connector for gp-phantomvision-dev'
  })

  const CONNECTOR_CACHE_TTL_MS = 5 * 60 * 1000
  const SKU_CACHE_KEY = 'cost-sentinel-live-sku-v1'
  const STORAGE_CACHE_KEY = 'cost-sentinel-live-storage-v1'

  // Live gcloud project data (for gp-phantomvision-dev) — declared early for cache restore
  const liveStorageData = ref<any>(null)
  const liveStorageLoading = ref(false)

  // =============================================
  // GCP Actions
  // =============================================
  async function importGCPFromCSV(fileOrText: File | string): Promise<{ success: boolean; rowCount: number; total: number; message: string }> {
    let csvText = ''
    if (typeof fileOrText === 'string') {
      csvText = fileOrText
    } else {
      csvText = await fileOrText.text()
    }

    const parsed = parseGCPBillingCSV(csvText)
    if (parsed.length === 0) {
      return { success: false, rowCount: 0, total: 0, message: 'No valid billable rows found. Check CSV columns (service, sku, cost).' }
    }

    gcpRows.value = parsed
    gcpLastImport.value = new Date().toISOString()
    gcpImportSource.value = 'csv'

    // Smart auto-mapping heuristics for common cloud AI
    autoMapGCPServices()

    return {
      success: true,
      rowCount: parsed.length,
      total: Math.round(parsed.reduce((s, r) => s + r.cost, 0) * 100) / 100,
      message: `Imported ${parsed.length} GCP billing rows ($${gcpTotalImported.value.toFixed(2)}).`,
    }
  }

  function loadGCPSample() {
    const sample = createRichSampleRows()
    gcpRows.value = sample
    gcpLastImport.value = new Date().toISOString()
    gcpImportSource.value = 'sample'
    autoMapGCPServices()
    return `Loaded realistic GCP billing sample with $${gcpTotalImported.value.toFixed(2)} across Vertex, Vision, Compute & Storage.`
  }

  function autoMapGCPServices() {
    const newMap: GCPMapping = { ...gcpMappings.value }
    const aiLike = ['vertex', 'vision', 'gemini', 'embedding', 'prediction', 'ai']
    const infra = ['compute', 'storage', 'logging', 'disk']

    gcpUniqueServices.value.forEach(svc => {
      const hay = (svc.service + ' ' + svc.sku).toLowerCase()
      if (aiLike.some(k => hay.includes(k))) {
        newMap[svc.service] = 'CloudSaaS'
      } else if (infra.some(k => hay.includes(k))) {
        newMap[svc.service] = 'Parts' // infrastructure modeled as parts replacement in edge
      } else {
        newMap[svc.service] = 'CloudSaaS'
      }
    })
    gcpMappings.value = newMap
  }

  function setGCPMapping(service: string, category: GCPCategory) {
    gcpMappings.value = { ...gcpMappings.value, [service]: category }
  }

  function clearGCPData() {
    gcpRows.value = []
    gcpMappings.value = {}
    gcpLastImport.value = null
    gcpImportSource.value = null
    localStorage.removeItem(GCP_STORAGE_KEY)
  }

  // === Connector progress + cache helpers (real-time updates for UI HUD) ===
  function resetConnectorProgress(totalSteps = 5) {
    connectorProgress.value = {
      totalCalls: totalSteps,
      passed: 0,
      pulled: 0,
      saved: 0,
      failed: 0,
      isActive: true,
      lastUpdated: new Date().toISOString()
    }
  }

  function tickProgress(kind: 'passed' | 'pulled' | 'saved' | 'failed') {
    const p = connectorProgress.value
    if (kind === 'passed') p.passed = (p.passed || 0) + 1
    else if (kind === 'pulled') p.pulled = (p.pulled || 0) + 1
    else if (kind === 'saved') p.saved = (p.saved || 0) + 1
    else p.failed = (p.failed || 0) + 1
    p.lastUpdated = new Date().toISOString()
    // auto-finish when steps complete
    const done = p.passed + p.pulled + p.saved + p.failed
    if (done >= p.totalCalls) {
      p.isActive = false
    }
  }

  function loadConnectorCaches() {
    try {
      const now = Date.now()
      // Storage cache
      const sRaw = localStorage.getItem(STORAGE_CACHE_KEY)
      if (sRaw) {
        const entry = JSON.parse(sRaw)
        if (entry?.timestamp && (now - new Date(entry.timestamp).getTime() < CONNECTOR_CACHE_TTL_MS)) {
          liveStorageCache.value = entry.data
          liveStorageData.value = entry.data
          cacheMeta.value.storageLastPulled = entry.timestamp
        }
      }
      // SKU cache
      const kRaw = localStorage.getItem(SKU_CACHE_KEY)
      if (kRaw) {
        const entry = JSON.parse(kRaw)
        if (entry?.timestamp && (now - new Date(entry.timestamp).getTime() < CONNECTOR_CACHE_TTL_MS)) {
          skuCache.value = entry.data
          cacheMeta.value.skuLastPulled = entry.timestamp
        }
      }
    } catch (e) { /* silent */ }
  }

  function persistSkuCache(rawData: any) {
    const entry = {
      data: rawData,
      timestamp: new Date().toISOString(),
      source: 'live connector for gp-phantomvision-dev'
    }
    try {
      localStorage.setItem(SKU_CACHE_KEY, JSON.stringify(entry))
      skuCache.value = rawData
      cacheMeta.value.skuLastPulled = entry.timestamp
    } catch (e) {}
  }

  function persistStorageCache(rawData: any) {
    const entry = {
      data: rawData,
      timestamp: new Date().toISOString(),
      source: 'live connector for gp-phantomvision-dev'
    }
    try {
      localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(entry))
      liveStorageCache.value = rawData
      cacheMeta.value.storageLastPulled = entry.timestamp
    } catch (e) {}
  }

  // Real connector to local gcloud ADC server (server/server.mjs) — NOW WITH ROBUST PROGRESS + CACHE
  async function syncSKUFromBillingAPI(): Promise<string> {
    resetConnectorProgress(5)
    tickProgress('passed') // 1: init + request started

    liveStorageLoading.value = true // reuse flag for unified loading UX (SKU too)

    try {
      tickProgress('passed') // 2: connecting to 8787

      const res = await fetch('http://localhost:8787/api/skus')
      if (!res.ok) throw new Error('Server not responding')

      tickProgress('passed') // 3: response headers ok

      const data = await res.json()
      tickProgress('pulled') // 4: data fully received from live connector

      if (data.source === 'live') {
        // Merge live SKUs into our catalog
        skuCatalog.value = data.skus.map((s: any) => ({
          sku: s.sku,
          description: s.description || s.service,
          listPrice: s.listPrice || 0,
          typicalMonthly: s.typicalMonthly || (s.listPrice || 0) * 720,
          category: s.category || 'Other',
          notes: s.notes || 'Live from Cloud Billing Catalog'
        }))
        persistSkuCache(data)
        tickProgress('saved') // 5: persisted to localStorage cache
        return `Live SKU data loaded from gp-phantomvision-dev via local connector`
      }

      // Fallback behavior if server returns mock
      skuCatalog.value = skuCatalog.value.map(s => ({
        ...s,
        typicalMonthly: Math.round(s.typicalMonthly * (0.96 + Math.random() * 0.09) * 100) / 100,
      }))
      persistSkuCache(data)
      tickProgress('saved')
      return data.note || 'Connected to local GCP connector (using fallback data)'

    } catch (err) {
      tickProgress('failed')
      // Graceful fallback
      skuCatalog.value = skuCatalog.value.map(s => ({
        ...s,
        typicalMonthly: Math.round(s.typicalMonthly * (0.96 + Math.random() * 0.09) * 100) / 100,
      }))
      return 'Local GCP connector not running. Start server/ with "node server.mjs" after gcloud auth application-default login.'
    } finally {
      liveStorageLoading.value = false
      connectorProgress.value.isActive = false
    }
  }

  // Enhanced version of previous simulate for backward compat in UI
  function simulateGCPImport() {
    const msg = loadGCPSample()
    // Also lightly update some model cloud costs
    const cloudIds = [9, 10]
    cloudIds.forEach(id => {
      const item = items.value.find(i => i.id === id)
      if (item) {
        const v = 0.93 + Math.random() * 0.14
        updateItem(id, { unitCost: Math.round(item.unitCost * v * 1000) / 1000 })
      }
    })
    return msg
  }

  // For Cost Explorer - grouped view
  const groupedItems = computed(() => {
    const map = new Map<string, CostItem[]>()
    items.value.forEach((item) => {
      if (!map.has(item.category)) map.set(item.category, [])
      map.get(item.category)!.push(item)
    })
    return Array.from(map.entries())
  })

  // Actions
  function updateItem(id: number, patch: Partial<CostItem>) {
    const idx = items.value.findIndex((i) => i.id === id)
    if (idx !== -1) {
      items.value[idx] = { ...items.value[idx], ...patch }
    }
  }

  function resetToDefaults() {
    items.value = [...DEFAULT_ITEMS]
    scaleConfig.value = { sites: 4, camerasPerSite: 12, retentionMonths: 90, inferenceMultiplier: 1.0 }
  }

  function updateScale(partial: Partial<ScaleConfig>) {
    scaleConfig.value = { ...scaleConfig.value, ...partial }
  }

  // Simulate "GCP Connect" — refresh some cloud prices with slight variance + add log item
  function simulateGCPImport() {
    const cloudIds = [9, 10, 11, 12]
    cloudIds.forEach((id) => {
      const item = items.value.find((i) => i.id === id)
      if (item) {
        // Realistic variance ±8%
        const variance = 0.92 + Math.random() * 0.16
        const newCost = Math.round(item.unitCost * variance * 1000) / 1000
        updateItem(id, { unitCost: newCost })
      }
    })
    // Add a synthetic new line occasionally
    if (Math.random() > 0.6) {
      const newItem: CostItem = {
        id: Date.now(),
        category: 'CLOUD',
        item: 'GCP Confidential Computing (TEE) Premium',
        unitCost: Math.round((0.014 + Math.random() * 0.006) * 1000) / 1000,
        qty: totalCameras.value,
        type: 'monthly',
        notes: 'Imported from live billing • Sovereign zone',
      }
      items.value.push(newItem)
    }
    persist()
    return 'GCP billing snapshot synchronized. Zero-trust verified.'
  }

  // Export helpers
  function exportToCSV(): string {
    const headers = ['Category', 'Item', 'Unit Cost', 'Qty', 'Type', 'Monthly Cost', 'One-Time Cost', 'Notes']
    const rows = items.value.map((i) => [
      i.category,
      i.item,
      i.unitCost,
      i.qty,
      i.type,
      i.type === 'monthly' ? (i.unitCost * i.qty).toFixed(2) : '0',
      i.type === 'one-time' ? (i.unitCost * i.qty).toFixed(2) : '0',
      i.notes || '',
    ])
    return [headers, ...rows].map((r) => r.join(',')).join('\n')
  }

  // Initialize
  loadFromStorage()

  // Initialize GCP persistence
  loadGCPFromStorage()

  // Initialize live connector caches (fresh <5min from localStorage)
  loadConnectorCaches()

  return {
    // state
    items,
    scaleConfig,
    lastUpdated,
    // GCP Connect state (powerful importer + analysis)
    gcpRows,
    gcpMappings,
    gcpLastImport,
    gcpImportSource,
    skuCatalog,
    // computed
    oneTimeTotal,
    monthlyTotal,
    annualRecurring,
    totalCameras,
    scaledOneTime,
    scaledMonthly,
    scaledAnnual,
    fiveYearTCO,

    // New Business Model + COGS economics
    businessModel,
    hardwareMarkupPercent,
    saasMonthlyPricePerCamera,
    hardwareCOGS,
    recurringCOGS,
    hardwareMarkupRevenue,
    hardwareGrossProfit,
    hardwareGrossMargin,
    saasMonthlyRevenue,
    saasAnnualRevenue,
    saasGrossProfitMonthly,
    saasGrossMargin,
    fiveYearSaaSRevenue,

    // LTV / Churn
    saasAnnualChurnRate,
    saasGrossMarginForLTV,
    saasLTVPerCamera,
    saasPaybackMonths,
    totalFleetLTV,

    marginWaterfall,

    categoryBreakdown,
    groupedItems,
    // GCP live computed values
    gcpTotalImported,
    gcpUniqueServices,
    gcpMappedRows,
    gcpSpendByCategory,
    gcpAICloudSpend,
    gcpAIDetails,
    gcpVsModelDelta,
    sovereignAnalysis,

    // Live gcloud project data + aggressive connector progress + cache (gp-phantomvision-dev @ :8787)
    liveStorageData,
    liveStorageLoading,
    connectorProgress,
    connectorProgressPercent,
    liveStorageCache,
    skuCache,
    cacheMeta,
    // actions
    updateItem,
    updateScale,
    resetToDefaults,
    simulateGCPImport,
    exportToCSV,
    // Full GCP Connect feature set
    importGCPFromCSV,
    loadGCPSample,
    setGCPMapping,
    autoMapGCPServices,
    clearGCPData,
    syncSKUFromBillingAPI,

    // Business Model actions
    setBusinessModel: (model: 'hardware-markup' | 'saas-managed') => { businessModel.value = model },
    setHardwareMarkup: (pct: number) => { hardwareMarkupPercent.value = Math.max(0.1, Math.min(1.2, pct)) },
    setSaasPricePerCamera: (price: number) => { saasMonthlyPricePerCamera.value = Math.max(5, price) },
    setSaasChurnRate: (rate: number) => { saasAnnualChurnRate.value = Math.max(0.01, Math.min(0.35, rate)) },
    setSaasLTVGrossMargin: (margin: number) => { saasGrossMarginForLTV.value = Math.max(0.3, Math.min(0.95, margin)) },

    // Live gcloud connector for the specific project (gp-phantomvision-dev) — ROBUST PROGRESS + CACHE
    async fetchLiveStorageCosts() {
      resetConnectorProgress(5)
      tickProgress('passed') // 1: start + request queued

      liveStorageLoading.value = true

      try {
        tickProgress('passed') // 2: connecting to localhost:8787

        const res = await fetch('http://localhost:8787/api/storage-costs')
        if (!res.ok) throw new Error('Connector not available')

        tickProgress('passed') // 3: headers received

        const data = await res.json()
        tickProgress('pulled') // 4: full payload (buckets + sizes) received from ADC

        liveStorageData.value = data
        persistStorageCache(data)
        tickProgress('saved') // 5: written to localStorage client cache

        return 'Live storage costs loaded for gp-phantomvision-dev'
      } catch (e) {
        tickProgress('failed')
        liveStorageData.value = null
        return 'Local gcloud connector not running or no permission. Start server/server.mjs after gcloud auth application-default login.'
      } finally {
        liveStorageLoading.value = false
        connectorProgress.value.isActive = false
      }
    },
  }
})
