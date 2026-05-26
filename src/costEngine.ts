/**
 * Ghost Protocol Cost Sentinel
 * Public Engine API Barrel
 *
 * One-stop import for the complete reactive cost modeling system:
 *
 *   import {
 *     useCostsStore,
 *     calculateTCO,
 *     generateOptimizationInsights,
 *     COTA_PILOT_SEED,
 *     type CostItem,
 *     type TCOBreakdown,
 *   } from '@/costEngine';
 *
 * Everything is tree-shakeable and fully typed.
 */

// Core reactive store
export { useCostsStore } from './stores/costs';

// Pure calculation engine (stateless, perfect for testing or Node scripts)
export {
  calculateTCO,
  scaleItems,
  calculateRecurringCost,
  generateWhatIfScenarios,
  generateOptimizationInsights,
  getPerBusCostAtScale,
  exportScaledLineItems,
} from './utils/costCalculations';

export {
  tcoToTableRows,
  generateExportFilename,
  rowsToCSV,
  buildTcoSummaryBlock,
} from './utils/exportHelpers';

// Authoritative seed data & constants
export {
  COTA_PILOT_SEED,
  WHAT_IF_SCENARIOS,
  PILOT_BUS_COUNT,
  DEFAULT_ANALYSIS_MONTHS,
  DEFAULT_INFLATION_RATE,
  getBaselineItems,
  getSeedItemById,
} from './data/cotaPilotSeed';

// All TypeScript contracts
export type {
  CostItem,
  CostCategory,
  CostCategorySummary,
  Scenario,
  TCOBreakdown,
  PerBusMetrics,
  OptimizationInsight,
  WhatIfResult,
  CostExportPayload,
  ScaleOptions,
} from './types/costs';
