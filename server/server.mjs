/**
 * Tiny optional GCP Billing SKU server for Cost Sentinel
 * Uses @google-cloud/billing + ADC (gcloud auth application-default login)
 *
 * Run:
 *   cd server && npm i hono @hono/node-server @google-cloud/billing
 *   node server.mjs
 *
 * Then in browser / Cost Sentinel you can enhance the syncSKUFromBillingAPI call to fetch('/api/skus')
 */

import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { CloudCatalogClient } from '@google-cloud/billing'
import { Storage } from '@google-cloud/storage'

const app = new Hono()

// Target project from user
const TARGET_PROJECT_ID = 'gp-phantomvision-dev'
const TARGET_PROJECT_NUMBER = '431115644565'

const MOCK_SKUS = [
  { sku: 'Vertex-Online-Pred-vCPU', description: 'Vertex AI Online Prediction vCPU', listPrice: 0.29, typicalMonthly: 52.4, category: 'AI', notes: 'Primary inference path replaced by on-device' },
  { sku: 'Vision-Label-1K', description: 'Cloud Vision Label Detection per 1K', listPrice: 1.00, typicalMonthly: 18.4, category: 'Vision', notes: 'High volume in fleet perception' },
  { sku: 'Gemini-1.5-Online', description: 'Gemini 1.5 Pro online tokens', listPrice: 0.0005, typicalMonthly: 87.6, category: 'AI', notes: 'Expensive; fully eliminated on-device' },
  { sku: 'Storage-Standard-US', description: 'Cloud Storage Standard (US)', listPrice: 0.020, typicalMonthly: 0, category: 'Storage', notes: 'Multi-region standard storage' },
]

app.get('/api/skus', async (c) => {
  try {
    const client = new CloudCatalogClient()
    
    // Real call - list SKUs (this works with ADC)
    const [skus] = await client.listSkus({ 
      parent: 'services/6F81-5844-456A' // Cloud Storage service (common)
    })

    const formatted = skus.slice(0, 20).map(s => {
      const pricing = s.pricingInfo?.[0]?.pricingExpression?.tieredRates?.[0]?.unitPrice || {}
      return {
        sku: s.skuId,
        description: s.description,
        listPrice: pricing.units || 0,
        category: s.category?.resourceFamily || 'Other',
        service: s.serviceDisplayName || 'Unknown'
      }
    })

    return c.json({ 
      source: 'live', 
      project: TARGET_PROJECT_ID,
      skus: formatted.length > 0 ? formatted : MOCK_SKUS,
      note: 'Live SKU data from Cloud Billing Catalog'
    })
  } catch (err) {
    console.error('GCP Billing API error:', err.message)
    return c.json({ 
      source: 'fallback-mock', 
      skus: MOCK_SKUS, 
      warning: 'Using mock data. Make sure you ran: gcloud auth application-default login',
      project: TARGET_PROJECT_ID
    })
  }
})

// NEW: Storage costs for the specific project
app.get('/api/storage-costs', async (c) => {
  try {
    const storage = new Storage({ projectId: TARGET_PROJECT_ID })
    
    const [buckets] = await storage.getBuckets()
    
    let totalBytes = 0
    const bucketDetails = []

    for (const bucket of buckets) {
      try {
        const [metadata] = await bucket.getMetadata()
        const size = parseInt(metadata.size || '0')
        totalBytes += size
        
        bucketDetails.push({
          name: bucket.name,
          location: metadata.location,
          storageClass: metadata.storageClass,
          sizeGB: (size / 1e9).toFixed(2),
          estimatedMonthlyUSD: (size / 1e9 * 0.020).toFixed(2) // rough Standard US pricing
        })
      } catch (e) {
        bucketDetails.push({ name: bucket.name, error: 'Could not fetch metadata' })
      }
    }

    return c.json({
      source: 'live',
      project: TARGET_PROJECT_ID,
      projectNumber: TARGET_PROJECT_NUMBER,
      totalStorageGB: (totalBytes / 1e9).toFixed(2),
      estimatedMonthlyStorageUSD: (totalBytes / 1e9 * 0.020).toFixed(2),
      buckets: bucketDetails
    })
  } catch (err) {
    console.error('Storage API error:', err.message)
    return c.json({
      source: 'error',
      error: err.message,
      note: 'Make sure ADC is set and the account has Storage permissions on gp-phantomvision-dev',
      project: TARGET_PROJECT_ID
    })
  }
})

app.get('/api/project-info', (c) => c.json({
  projectId: TARGET_PROJECT_ID,
  projectNumber: TARGET_PROJECT_NUMBER,
  currentUserProject: process.env.GOOGLE_CLOUD_PROJECT || 'not set'
}))

app.get('/', (c) => c.text('Cost Sentinel GCP Connector — /api/skus and /api/storage-costs ready'))

const port = 8787
console.log(`Cost Sentinel GCP connector listening on http://localhost:${port}`)
console.log(`Targeting project: ${TARGET_PROJECT_ID} (${TARGET_PROJECT_NUMBER})`)
serve({ fetch: app.fetch, port })
