import { test, expect } from '@playwright/test'

test('dev server responds successfully', async ({ page }) => {
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' })
  expect(response?.status()).toBeLessThan(500)
  // Reliable: wait for Vue mount point
  await page.waitForSelector('#app', { timeout: 10000 })
  await expect(page.locator('#app')).toBeVisible()
})
