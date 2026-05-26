/**
 * Ghost Protocol Cost Sentinel - Robust Cost Review Engine
 * Type definitions for reactive TCO modeling, COTA-seeded pilot scenarios,
 * and sovereign edge optimization insights.
 */

export type CostCategory =
  | 'Materials'
  | 'Parts'
  | 'CloudSaaS'
  | 'Development'
  | 'Support';

export const COST_CATEGORIES: readonly CostCategory[] = [
  'Materials',
  'Parts',
  'CloudSaaS',
  'Development',
  'Support',
] as const;

export interface CostItem {
  /** Stable unique identifier (UUID or slug) */
  id: string;
  /** High-level bucket for reporting and scaling rules */
  category: CostCategory;
  /** Human-readable line item (e.g. "OAK-4 + Rugged Mount + PoE/M12 Kit") */
  name: string;
  /** Base unit price in USD before quantity */
  unitCost: number;
  /** Current quantity (for pilot this is pre-populated for 6 buses + fixed dev) */
  quantity: number;
  /** Freeform context, assumptions, or COTA reference */
  notes?: string;
  /** Provenance (COTA Proposal, Internal Estimate, Vendor Quote, etc.) */
  source?: string;
  /** True if this line renews annually (affects TCO monthly proration + inflation) */
  isRecurring?: boolean;
  /** True if quantity should scale linearly with bus fleet size (vs fixed/one-time) */
  isPerBus?: boolean;
}

export interface CostCategorySummary {
  category: CostCategory;
  items: CostItem[];
  subtotal: number;
  itemCount: number;
  percentOfTotal: number;
}

export interface PerBusMetrics {
  /** Total one-time CapEx allocated across current bus count */
  capexPerBus: number;
  /** Annualized OpEx / recurring per bus */
  opexPerBusAnnual: number;
  /** Fully-loaded TCO per bus for the modeled horizon */
  tcoPerBus: number;
  /** Development amortization per bus at current scale */
  amortizedDevPerBus: number;
}

export interface Scenario {
  /** Scenario identifier for what-if modeling */
  id: string;
  /** Friendly label ("COTA 6-Bus Pilot", "Mid-Market 50-Bus Fleet", "Full COTA 330-Bus Rollout") */
  label: string;
  numBuses: number;
  months: number;
  /** Optional override inflation (defaults to 2.5%) */
  inflation?: number;
  description?: string;
}

export interface TCOBreakdown {
  /** Modeled fleet size */
  numBuses: number;
  /** Analysis horizon in months */
  months: number;
  inflationRate: number;

  /** One-time capital expenditure (non-recurring items) */
  capex: number;
  /** Recurring operational expenditure over the horizon (inflation-adjusted) */
  opex: number;
  /** Total Cost of Ownership = capex + opex */
  totalTCO: number;

  /** Grand total before any scaling / amortization adjustments */
  baselineTotal: number;

  /** Breakdown by the five canonical categories */
  byCategory: Record<CostCategory, number>;

  /** Detailed per-bus unit economics */
  perBus: PerBusMetrics;

  /** Effective monthly burn rate (useful for cash-flow views) */
  monthlyBurn: number;

  /** Raw line-item contributions after scaling (for tables) */
  scaledItems: CostItem[];
}

export interface OptimizationInsight {
  /** Creative, memorable name for executive dashboards */
  title: string;
  /** Concise actionable recommendation */
  message: string;
  /** Quantitative delta or projected savings (USD or %) */
  impact: string;
  /** Severity / priority for UI badge rendering */
  severity: 'high' | 'medium' | 'positive' | 'info';
  /** Which scale thresholds or conditions trigger this insight */
  triggers: string[];
  /** Optional deep-link or formula reference */
  formulaRef?: string;
}

export interface WhatIfResult {
  scenario: Scenario;
  tco: TCOBreakdown;
  insights: OptimizationInsight[];
  /** Per-bus cost at this scale vs pilot baseline */
  leverageVsPilot: number;
}

export interface CostEngineState {
  /** Master editable list of all cost line items (Pinia reactive source of truth) */
  items: CostItem[];
  /** Current active bus count for the live model (editable via sliders) */
  activeBusCount: number;
  /** Current analysis horizon in months */
  analysisMonths: number;
  /** Annual inflation assumption (editable) */
  inflationRate: number;
  /** Baseline snapshot for "Reset to COTA Pilot" functionality */
  baselineItems: CostItem[];
  baselineBusCount: number;
}

/** JSON-serializable export format (versioned for future migrations) */
export interface CostExportPayload {
  version: string;
  exportedAt: string;
  project: 'Ghost Protocol - Cost Sentinel';
  activeBusCount: number;
  analysisMonths: number;
  inflationRate: number;
  items: CostItem[];
}

/** Pure function result for scaling calculations */
export interface ScaleOptions {
  numBuses: number;
  months: number;
  inflation?: number;
  baseItems?: CostItem[]; // when calling standalone
}
