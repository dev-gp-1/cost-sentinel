import { test, expect } from '@playwright/test'

test('dev server responds successfully', async ({ page }) => {
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' })
  expect(response?.status()).toBeLessThan(500)
})
