/**
 * Alternative tiny Express GCP Billing stub
 * npm i express @google-cloud/billing cors
 */

const express = require('express')
const cors = require('cors')
const { CloudCatalogClient } = require('@google-cloud/billing')

const app = express()
app.use(cors())
app.use(express.json())

const MOCK = [ /* same as in server.mjs */ 
  { sku: 'Vertex-Online-Pred-vCPU', description: 'Vertex AI Online Prediction vCPU', listPrice: 0.29, typicalMonthly: 52.4, category: 'AI', notes: 'Primary inference path replaced by on-device' },
  { sku: 'Vision-Label-1K', description: 'Cloud Vision Label Detection per 1K', listPrice: 1.00, typicalMonthly: 18.4, category: 'Vision', notes: 'High volume in fleet perception' },
  { sku: 'Gemini-1.5-Online', description: 'Gemini 1.5 Pro online tokens', listPrice: 0.0005, typicalMonthly: 87.6, category: 'AI', notes: 'Expensive; fully eliminated on-device' },
]

app.get('/api/skus', async (_req, res) => {
  // Real version (uncomment + gcloud auth application-default login):
  /*
  const client = new CloudCatalogClient()
  const [skus] = await client.listSkus({ parent: 'services/...' })
  return res.json({ source:'live', skus })
  */
  res.json({ source: 'mock-express', skus: MOCK })
})

app.listen(8787, () => console.log('Express GCP stub on :8787'))
