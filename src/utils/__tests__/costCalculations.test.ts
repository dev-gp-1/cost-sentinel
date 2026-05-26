import { describe, it, expect } from 'vitest'
import { scaleItems } from '../costCalculations'
import type { CostItem } from '../../types/costs'

// Minimal seed for testing
const mockItems: CostItem[] = [
  {
    id: 'fixed-1',
    name: 'Fixed Platform',
    category: 'HARDWARE',
    quantity: 1,
    unitCost: 5000,
    isPerBus: false,
    months: 60,
  },
  {
    id: 'perbus-1',
    name: 'Per Bus Camera',
    category: 'HARDWARE',
    quantity: 6,
    unitCost: 1200,
    isPerBus: true,
    months: 60,
  },
]

describe('costCalculations', () => {
  it('scaleItems keeps fixed costs unchanged', () => {
    const scaled = scaleItems(mockItems, 12, 6)
    const fixed = scaled.find(i => i.id === 'fixed-1')
    expect(fixed?.quantity).toBe(1)
  })

  it('scaleItems scales per-bus items correctly', () => {
    const scaled = scaleItems(mockItems, 12, 6)
    const perBus = scaled.find(i => i.id === 'perbus-1')
    // Should scale from 6 to 12 buses
    expect(perBus?.quantity).toBeGreaterThan(6)
  })
})
