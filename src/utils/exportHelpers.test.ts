import { describe, it, expect } from 'vitest'
import { generateExportFilename, rowsToCSV, type TableRow } from './exportHelpers'

describe('exportHelpers', () => {
  it('generateExportFilename produces a filename with prefix, bus count, months and date', () => {
    const filename = generateExportFilename('cost-sentinel', 48, 36)
    // Matches pattern like cost-sentinel-48bus-36mo-2026-05-26
    expect(filename).toMatch(/^cost-sentinel-48bus-36mo-\d{4}-\d{2}-\d{2}$/)
    expect(filename).toContain('48bus')
    expect(filename).toContain('36mo')
  })

  it('rowsToCSV generates valid CSV from table rows', () => {
    const rows: TableRow[] = [
      {
        Category: 'HARDWARE',
        'Line Item': 'Sovereign Edge AI Camera',
        'Unit Cost (USD)': 1240,
        Quantity: 48,
        'Line Total (USD)': 59520,
        Recurring: 'No',
        'Per Bus': 'Yes',
        Notes: 'Test note',
      },
    ]

    const csv = rowsToCSV(rows)
    expect(csv).toContain('Category,Line Item,Unit Cost (USD),Quantity')
    // Note: rowsToCSV only quotes fields containing comma or double-quote
    expect(csv).toContain('HARDWARE,Sovereign Edge AI Camera,1240,48,59520,No,Yes,Test note')
    expect(csv).toContain('59520')
    expect(csv.split('\n').length).toBe(2)
  })

  it('rowsToCSV returns empty string for no rows', () => {
    expect(rowsToCSV([])).toBe('')
  })
})
