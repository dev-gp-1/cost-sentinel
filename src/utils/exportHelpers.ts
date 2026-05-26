/**
 * Ghost Protocol Cost Sentinel — Export Helpers
 * Utilities for turning the reactive engine output into portable artifacts.
 * Leverages existing project deps (papaparse, jspdf) for rich exports in consuming components.
 */

import type { TCOBreakdown, CostItem } from '../types/costs';

export interface TableRow {
  Category: string;
  'Line Item': string;
  'Unit Cost (USD)': number;
  Quantity: number;
  'Line Total (USD)': number;
  Recurring: 'Yes' | 'No';
  'Per Bus': 'Yes' | 'No';
  Notes: string;
}

/** Convert current TCO scaled items into clean tabular rows for CSV / DataTable */
export function tcoToTableRows(tco: TCOBreakdown): TableRow[] {
  return tco.scaledItems.map((item: CostItem) => ({
    Category: item.category,
    'Line Item': item.name,
    'Unit Cost (USD)': item.unitCost,
    Quantity: item.quantity,
    'Line Total (USD)': Math.round(item.unitCost * item.quantity * 100) / 100,
    Recurring: item.isRecurring ? 'Yes' : 'No',
    'Per Bus': item.isPerBus ? 'Yes' : 'No',
    Notes: item.notes || item.source || '',
  }));
}

/** Generate filename-safe slug for downloads */
export function generateExportFilename(prefix: string, numBuses: number, months: number): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${prefix}-${numBuses}bus-${months}mo-${date}`;
}

/** Build a minimal CSV string (no extra deps; papaparse also available in project for parsing) */
export function rowsToCSV(rows: TableRow[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (val: any) =>
    typeof val === 'string' && (val.includes(',') || val.includes('"'))
      ? `"${val.replace(/"/g, '""')}"`
      : val;
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape((r as any)[h])).join(',')),
  ];
  return lines.join('\n');
}

/** Summary block for PDF / report headers (used by consuming UI with jsPDF) */
export function buildTcoSummaryBlock(tco: TCOBreakdown) {
  return {
    'Fleet Size': `${tco.numBuses} buses`,
    'Analysis Horizon': `${tco.months} months`,
    'Inflation Assumption': `${(tco.inflationRate * 100).toFixed(1)}%`,
    'Total CapEx': `$${tco.capex.toLocaleString()}`,
    'Total OpEx (inflated)': `$${tco.opex.toLocaleString()}`,
    'TOTAL TCO': `$${tco.totalTCO.toLocaleString()}`,
    'Fully Loaded Per Bus': `$${tco.perBus.tcoPerBus.toLocaleString()}`,
    'Monthly Cash Burn': `$${tco.monthlyBurn.toLocaleString()}`,
  };
}
