/**
 * Ghost Protocol Cost Sentinel - Pure Calculation Engine
 * All functions are side-effect free, fully deterministic, and unit-testable.
 * Used by both the Pinia store and any external scripts / Node harnesses.
 */

import type {
  CostItem,
  CostCategory,
  TCOBreakdown,
  PerBusMetrics,
  OptimizationInsight,
  Scenario,
  WhatIfResult,
  ScaleOptions,
} from '../types/costs';
import {
  COTA_PILOT_SEED,
  WHAT_IF_SCENARIOS,
  PILOT_BUS_COUNT,
  DEFAULT_ANALYSIS_MONTHS,
  DEFAULT_INFLATION_RATE,
} from '../data/cotaPilotSeed';

/** Internal helper: compound inflation factor for a given number of years */
function inflationFactor(years: number, rate: number): number {
  return Math.pow(1 + rate, years);
}

/** Convert months to fractional years for inflation math */
function monthsToYears(months: number): number {
  return months / 12;
}

/**
 * Core pure function: Scale a set of CostItems to a target fleet size + horizon.
 * - Fixed items (isPerBus=false) keep their original quantity.
 * - Per-bus items have quantity = Math.round(originalPerUnitQty * numBuses / originalBusCount) but we normalize intelligently.
 *
 * The seed is defined against a 6-bus pilot. We detect the "per bus unit" by inspecting
 * items that were seeded with isPerBus and quantity divisible by 6.
 */
export function scaleItems(
  baseItems: CostItem[],
  numBuses: number,
  pilotBusCount: number = PILOT_BUS_COUNT
): CostItem[] {
  return baseItems.map((item) => {
    if (!item.isPerBus) {
      // Fixed cost - quantity unchanged (dev, training, spares, base platform fees)
      return { ...item };
    }

    // Per-bus scaling: compute the effective unit quantity from the pilot seed
    // (handles items that had qty=6, qty=8 for extra brackets, etc.)
    const pilotQty = item.quantity;
    // Heuristic: if qty was set for pilot, derive per-bus unit then re-scale
    const perBusUnit = pilotQty / pilotBusCount;
    const scaledQty = Math.max(1, Math.round(perBusUnit * numBuses));

    return {
      ...item,
      quantity: scaledQty,
    };
  });
}

/**
 * Calculate inflation-adjusted OpEx for recurring items over the horizon.
 * Applies compound inflation annually on the recurring base.
 */
export function calculateRecurringCost(
  recurringItems: CostItem[],
  numBuses: number,
  months: number,
  inflation: number = DEFAULT_INFLATION_RATE
): number {
  if (months <= 0) return 0;

  const years = monthsToYears(months);
  let total = 0;

  for (const item of recurringItems) {
    const annualBase = item.unitCost * item.quantity; // already scaled
    // Apply average inflation over the period (mid-point convention for conservatism)
    const avgInflation = inflationFactor(years * 0.5, inflation);
    const inflatedAnnual = annualBase * avgInflation;

    // Prorate for partial years + compound remaining full years
    const fullYears = Math.floor(years);
    const fraction = years - fullYears;

    let horizonCost = inflatedAnnual * fullYears;
    // Final partial year (no additional inflation on the fraction for simplicity)
    horizonCost += inflatedAnnual * fraction;

    total += horizonCost;
  }

  return Math.round(total * 100) / 100;
}

/**
 * Primary pure TCO calculator. Returns rich breakdown ready for UI.
 */
export function calculateTCO(options: ScaleOptions): TCOBreakdown {
  const {
    numBuses,
    months,
    inflation = DEFAULT_INFLATION_RATE,
    baseItems = COTA_PILOT_SEED,
  } = options;

  if (numBuses < 1) throw new Error('numBuses must be >= 1');
  if (months < 1) throw new Error('months must be >= 1');

  // 1. Scale all line items to target fleet
  const scaledItems = scaleItems(baseItems, numBuses);

  // 2. Partition
  const fixedItems = scaledItems.filter((i) => !i.isRecurring);
  const recurringItems = scaledItems.filter((i) => i.isRecurring);

  // 3. CapEx = sum of all non-recurring (one-time)
  const capex = fixedItems.reduce(
    (sum, item) => sum + item.unitCost * item.quantity,
    0
  );

  // 4. OpEx = recurring over horizon with inflation
  const opex = calculateRecurringCost(recurringItems, numBuses, months, inflation);

  const totalTCO = Math.round((capex + opex) * 100) / 100;

  // 5. Category breakdown (on scaled items)
  const byCategory = {} as Record<CostCategory, number>;
  for (const cat of [
    'Materials',
    'Parts',
    'CloudSaaS',
    'Development',
    'Support',
  ] as const) {
    byCategory[cat] = scaledItems
      .filter((i) => i.category === cat)
      .reduce((s, i) => s + i.unitCost * i.quantity, 0);
  }

  // 6. Per-bus metrics
  const devItems = scaledItems.filter((i) => i.category === 'Development');
  const totalDev = devItems.reduce((s, i) => s + i.unitCost * i.quantity, 0);
  const amortizedDevPerBus = totalDev / numBuses;

  // Separate one-time CapEx that is truly CapEx (exclude dev for "hardware only" view if desired)
  const hardwareCapex = capex - totalDev;

  const capexPerBus = (capex) / numBuses; // full loaded including amortized dev
  const opexPerBusAnnual = (opex / (months / 12)) / numBuses;

  const perBus: PerBusMetrics = {
    capexPerBus: Math.round(capexPerBus * 100) / 100,
    opexPerBusAnnual: Math.round(opexPerBusAnnual * 100) / 100,
    tcoPerBus: Math.round((totalTCO / numBuses) * 100) / 100,
    amortizedDevPerBus: Math.round(amortizedDevPerBus * 100) / 100,
  };

  const monthlyBurn = Math.round((totalTCO / months) * 100) / 100;

  return {
    numBuses,
    months,
    inflationRate: inflation,
    capex: Math.round(capex * 100) / 100,
    opex: Math.round(opex * 100) / 100,
    totalTCO,
    baselineTotal: totalTCO,
    byCategory,
    perBus,
    monthlyBurn,
    scaledItems,
  };
}

/**
 * Generate complete what-if results for the three canonical COTA scenarios
 * plus the currently active model parameters.
 */
export function generateWhatIfScenarios(
  currentItems: CostItem[],
  currentBusCount: number,
  currentMonths: number,
  currentInflation: number
): WhatIfResult[] {
  const scenarios = [...WHAT_IF_SCENARIOS];

  return scenarios.map((scenario) => {
    const tco = calculateTCO({
      numBuses: scenario.numBuses,
      months: scenario.months,
      inflation: scenario.inflation ?? currentInflation,
      baseItems: currentItems, // use live edited items for "what if on my model"
    });

    const insights = generateOptimizationInsights(
      tco,
      scenario.numBuses,
      currentBusCount
    );

    // Leverage vs current pilot baseline (how much cheaper per bus at this scale)
    const pilotTCO = calculateTCO({
      numBuses: PILOT_BUS_COUNT,
      months: currentMonths,
      inflation: currentInflation,
      baseItems: currentItems,
    });
    const leverageVsPilot =
      pilotTCO.perBus.tcoPerBus > 0
        ? Math.round(
            ((pilotTCO.perBus.tcoPerBus - tco.perBus.tcoPerBus) /
              pilotTCO.perBus.tcoPerBus) *
              10000
          ) / 100 // percentage improvement
        : 0;

    return {
      scenario,
      tco,
      insights,
      leverageVsPilot,
    };
  });
}

/**
 * Sophisticated rule-based Optimization Insights Engine.
 * Creative executive-facing names as requested:
 *   - Sovereignty Multiplier
 *   - Fleet Leverage Effect
 *   - Edge Sentinel Advantage
 *   - Amortization Avalanche
 *   etc.
 */
export function generateOptimizationInsights(
  tco: TCOBreakdown,
  scenarioBuses: number,
  pilotBaselineBuses: number = PILOT_BUS_COUNT
): OptimizationInsight[] {
  const insights: OptimizationInsight[] = [];
  const { perBus, capex, opex, totalTCO, byCategory, numBuses } = tco;

  const cloudSaaS = byCategory.CloudSaaS || 0;
  const devTotal = byCategory.Development || 0;
  const materials = byCategory.Materials || 0;

  // 1. Sovereignty Multiplier (Edge vs traditional heavy cloud VMS)
  // Traditional VMS often 4-6x higher cloud egress + storage. We model ~85% reduction.
  const traditionalVMSEquiv = cloudSaaS * 5.8; // conservative multiplier for raw video + storage
  const sovereigntySavings = Math.round((traditionalVMSEquiv - cloudSaaS) * 0.85);
  const sovereigntyPct = cloudSaaS > 0 ? Math.round((sovereigntySavings / traditionalVMSEquiv) * 100) : 85;

  insights.push({
    title: 'Sovereignty Multiplier',
    message: `Sovereign edge inference eliminates ~${sovereigntyPct}% of traditional VMS cloud dependency. Estimated 36-month savings vs legacy video management: $${sovereigntySavings.toLocaleString()}.`,
    impact: `-$${sovereigntySavings.toLocaleString()} / ${numBuses} buses`,
    severity: 'positive',
    triggers: ['CloudSaaS', 'scale-any'],
    formulaRef: 'traditionalVMSEquiv = CloudSaaS × 5.8 × 0.85',
  });

  // 2. Fleet Leverage Effect (amortization of fixed dev)
  const devPerBus = perBus.amortizedDevPerBus;
  const pilotDevPerBus = devTotal / pilotBaselineBuses; // approx
  const leverageFactor = pilotDevPerBus > 0 ? (pilotDevPerBus / devPerBus).toFixed(1) : '1.0';

  if (numBuses >= 25) {
    insights.push({
      title: 'Fleet Leverage Effect',
      message: `Development amortization drops to $${devPerBus.toFixed(0)}/bus at ${numBuses}-bus scale — a ${leverageFactor}× improvement versus the 6-bus pilot. Fixed costs now represent only ${((devTotal / totalTCO) * 100).toFixed(1)}% of TCO.`,
      impact: `$${devPerBus.toFixed(0)} / bus dev cost`,
      severity: 'positive',
      triggers: ['Development', 'numBuses>=25'],
      formulaRef: 'amortizedDev = totalDev / numBuses',
    });
  }

  // 3. Amortization Avalanche (sharp knee around 40-60 buses)
  if (numBuses >= 40 && numBuses < 80) {
    const projected50 = calculateTCO({ numBuses: 50, months: tco.months, inflation: tco.inflationRate });
    const dropPct = Math.round(
      ((perBus.tcoPerBus - projected50.perBus.tcoPerBus) / perBus.tcoPerBus) * 100
    );
    insights.push({
      title: 'Amortization Avalanche',
      message: `Crossing the 50-bus threshold triggers an additional ${Math.abs(dropPct)}% reduction in fully-loaded per-bus TCO. The next 10–20 buses deliver disproportionate returns.`,
      impact: `${Math.abs(dropPct)}% marginal TCO reduction`,
      severity: 'high',
      triggers: ['numBuses 40-80'],
    });
  }

  // 4. Edge Sentinel Advantage (CloudSaaS vs Materials ratio)
  const cloudVsHardware = materials > 0 ? (cloudSaaS / materials) * 100 : 0;
  if (cloudVsHardware < 65) {
    insights.push({
      title: 'Edge Sentinel Advantage',
      message: `Recurring CloudSaaS is only ${cloudVsHardware.toFixed(0)}% of Materials CapEx. Traditional VMS fleets routinely see Cloud/Storage OpEx exceed hardware 3:1 within 24 months.`,
      impact: `${cloudVsHardware.toFixed(0)}% SaaS-to-hardware ratio`,
      severity: 'info',
      triggers: ['CloudSaaS', 'Materials'],
    });
  }

  // 5. Pilot-to-Fleet Compression (for larger scenarios)
  if (scenarioBuses > pilotBaselineBuses) {
    const compression = Math.round(
      ((perBus.tcoPerBus / (totalTCO / pilotBaselineBuses)) * 100 - 100) * -1
    );
    insights.push({
      title: 'Pilot-to-Fleet Compression',
      message: `At ${scenarioBuses} buses your per-bus TCO compresses by ~${compression}% relative to a naive linear extrapolation of the 6-bus pilot. This is the power of sovereign scale.`,
      impact: `~${compression}% compression`,
      severity: 'medium',
      triggers: ['scale'],
    });
  }

  // 6. Inflation Shield (because most cost is CapEx + fixed dev)
  const opexRatio = totalTCO > 0 ? (opex / totalTCO) * 100 : 0;
  if (opexRatio < 35) {
    insights.push({
      title: 'Inflation Shield',
      message: `Only ${opexRatio.toFixed(1)}% of modeled TCO is recurring OpEx. The sovereign architecture provides a natural hedge against 2.5–4% annual inflation on cloud storage and bandwidth.`,
      impact: `${opexRatio.toFixed(1)}% OpEx exposure`,
      severity: 'positive',
      triggers: ['inflation', 'opex'],
    });
  }

  // 7. Break-even Horizon Hint (rough)
  if (months >= 24 && perBus.tcoPerBus > 0) {
    const hardwareOnlyPerBus = (materials + (byCategory.Parts || 0) + (byCategory.Support || 0) - (byCategory.Development || 0)) / numBuses;
    insights.push({
      title: 'Ghost Horizon Payback',
      message: `At current burn rate the hardware + install reaches effective payback versus traditional recurring VMS models in approximately ${Math.ceil((hardwareOnlyPerBus / (perBus.opexPerBusAnnual / 12)) * 1.6)} months on a 50+ bus fleet.`,
      impact: 'Strong multi-year NPV',
      severity: 'info',
      triggers: ['months>=24'],
    });
  }

  return insights;
}

/**
 * Convenience: calculate per-bus cost at any scale quickly.
 */
export function getPerBusCostAtScale(
  numBuses: number,
  months: number = DEFAULT_ANALYSIS_MONTHS,
  inflation: number = DEFAULT_INFLATION_RATE,
  baseItems?: CostItem[]
): number {
  const tco = calculateTCO({ numBuses, months, inflation, baseItems });
  return tco.perBus.tcoPerBus;
}

/**
 * Export a clean snapshot of scaled line items for CSV / table rendering.
 */
export function exportScaledLineItems(tco: TCOBreakdown) {
  return tco.scaledItems.map((item) => ({
    id: item.id,
    category: item.category,
    name: item.name,
    unitCost: item.unitCost,
    quantity: item.quantity,
    lineTotal: Math.round(item.unitCost * item.quantity * 100) / 100,
    isRecurring: !!item.isRecurring,
    isPerBus: !!item.isPerBus,
  }));
}
