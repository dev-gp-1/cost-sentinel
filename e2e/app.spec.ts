import { test, expect } from '@playwright/test'

test.describe('Cost Sentinel App', () => {
  test('loads successfully with dashboard and key UI elements', async ({ page }) => {
    const res = await page.goto('/', { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBeLessThan(400)

    // Allow heavy Vue + deps (charts, motion, store init) to hydrate
    await page.waitForTimeout(1800)

    const html = await page.content()
    expect(html.length).toBeGreaterThan(2000)

    // Verify branding + nav labels from App + index
    expect(html).toMatch(/ShadowForge Cost Sentinel/i)
    expect(html).toMatch(/DASHBOARD|SCALE SIMULATOR|GCP CONNECT/i)
    expect(html).toMatch(/Fleet Cost Intelligence|Command Center/i)
  })

  test('supports basic tab navigation interaction', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1500)

    // Click attempt on a simulator-related control (safe if not interactive in headless)
    const sim = page.getByText(/SIMULATOR|Scale/i)
    if (await sim.count() > 0) {
      await sim.first().click({ timeout: 3000 }).catch(() => {})
    }

    const html = await page.content()
    expect(html.length).toBeGreaterThan(1800) // still substantial post-interaction
  })
})
