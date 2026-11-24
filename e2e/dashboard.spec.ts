import { expect, test } from '@playwright/test'

test('loads live telemetry and keeps unsupported sensors explicit', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'System overview' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'LLM monitor' })).toBeVisible()
  await expect(page.getByText('LIVE', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Unavailable').first()).toBeVisible()
})

test('filters the process list and opens the benchmark view', async ({ page }) => {
  await page.route('**/api/models', (route) => route.fulfill({ json: [] }))
  await page.goto('/')
  const filter = page.getByRole('textbox', { name: 'Filter processes' })
  await expect(filter).toBeVisible()
  await filter.fill('no-process-can-match-this')
  await expect(page.getByText('No matching processes')).toBeVisible()
  await page.getByRole('button', { name: 'Benchmark' }).click()
  await expect(page.getByRole('heading', { name: 'Benchmark', exact: true })).toBeVisible()
  await expect(page.getByText('No installed models found')).toBeVisible({ timeout: 10_000 })
})

test('keeps navigation and the dashboard within a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Benchmark' })).toBeVisible()
  const dimensions = await page.locator('body').evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width)
})