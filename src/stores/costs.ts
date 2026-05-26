/**
 * Ghost Protocol Cost Sentinel
 * Reactive Pinia Store — The single source of truth for the cost review engine.
 *
 * Fully reactive: any edit to items, bus count, months, or inflation instantly
 * propagates to all computed TCO, breakdowns, per-bus metrics, and insights.
 *
 * Ready for:
 *  - Data tables (v-for on items + scaledItems)
 *  - Sliders (activeBusCount, months, inflation)
 *  - What-If scenario cards
 *  - Export / Import JSON
 *  - Reset to pristine COTA pilot baseline
 */

import { defineStore } from 'pinia';
import type {
  CostItem,
  CostCategory,
  CostCategorySummary,
  TCOBreakdown,
  OptimizationInsight,
  WhatIfResult,
  CostExportPayload,
} from '../types/costs';
import {
  calculateTCO,
  generateWhatIfScenarios,
  generateOptimizationInsights,
  scaleItems,
} from '../utils/costCalculations';
import {
  COTA_PILOT_SEED,
  getBaselineItems,
  PILOT_BUS_COUNT,
  DEFAULT_ANALYSIS_MONTHS,
  DEFAULT_INFLATION_RATE,
  WHAT_IF_SCENARIOS,
} from '../data/cotaPilotSeed';

interface CostsState {
  items: CostItem[];
  activeBusCount: number;
  analysisMonths: number;
  inflationRate: number;
  // Immutable snapshot captured at load / reset
  baselineItems: CostItem[];
  baselineBusCount: number;
  baselineMonths: number;
  baselineInflation: number;
}

function generateId(): string {
  // Lightweight, dependency-free, collision-resistant for in-app use
  return 'ci_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export const useCostsStore = defineStore('costs', {
  state: (): CostsState => {
    const baseline = getBaselineItems();
    return {
      items: deepClone(baseline),
      activeBusCount: PILOT_BUS_COUNT,
      analysisMonths: DEFAULT_ANALYSIS_MONTHS,
      inflationRate: DEFAULT_INFLATION_RATE,

      baselineItems: baseline,
      baselineBusCount: PILOT_BUS_COUNT,
      baselineMonths: DEFAULT_ANALYSIS_MONTHS,
      baselineInflation: DEFAULT_INFLATION_RATE,
    };
  },

  getters: {
    /** Live scaled TCO for current UI parameters — the heart of reactivity */
    currentTCO(state): TCOBreakdown {
      return calculateTCO({
        numBuses: state.activeBusCount,
        months: state.analysisMonths,
        inflation: state.inflationRate,
        baseItems: state.items,
      });
    },

    /** Category summaries with percentages — perfect for pie / stacked bar charts */
    categoryBreakdowns(state): CostCategorySummary[] {
      const tco = this.currentTCO;
      const total = tco.totalTCO || 1;

      return (['Materials', 'Parts', 'CloudSaaS', 'Development', 'Support'] as const).map(
        (category) => {
          const itemsInCat = tco.scaledItems.filter((i) => i.category === category);
          const subtotal = itemsInCat.reduce(
            (sum, i) => sum + i.unitCost * i.quantity,
            0
          );
          return {
            category,
            items: itemsInCat,
            subtotal: Math.round(subtotal * 100) / 100,
            itemCount: itemsInCat.length,
            percentOfTotal: Math.round((subtotal / total) * 1000) / 10,
          };
        }
      );
    },

    /** Quick aggregates */
    totalTCO(state) {
      return this.currentTCO.totalTCO
    },
    totalCapex(state) {
      return this.currentTCO.capex
    },
    totalOpex(state) {
      return this.currentTCO.opex
    },
    monthlyBurn(state) {
      return this.currentTCO.monthlyBurn
    },

    perBusMetrics(state) {
      return this.currentTCO.perBus
    },

    /** Live optimization insights for current parameters */
    liveInsights(state): OptimizationInsight[] {
      return generateOptimizationInsights(
        this.currentTCO,
        state.activeBusCount,
        PILOT_BUS_COUNT
      );
    },

    /** Full what-if matrix using the currently edited model as base */
    whatIfResults(state): WhatIfResult[] {
      return generateWhatIfScenarios(
        state.items,
        state.activeBusCount,
        state.analysisMonths,
        state.inflationRate
      );
    },

    /** Number of line items currently loaded */
    itemCount: (state) => state.items.length,

    /** Items grouped for UI tables (original quantities, not scaled) */
    itemsByCategory(state): Record<CostCategory, CostItem[]> {
      const groups = {} as Record<CostCategory, CostItem[]>;
      for (const cat of ['Materials', 'Parts', 'CloudSaaS', 'Development', 'Support'] as const) {
        groups[cat] = state.items.filter((i) => i.category === cat);
      }
      return groups;
    },

    /** Has the model diverged from the pristine COTA pilot seed? */
    isDirty(state): boolean {
      const currentSig = JSON.stringify(state.items);
      const baselineSig = JSON.stringify(state.baselineItems);
      return (
        currentSig !== baselineSig ||
        state.activeBusCount !== state.baselineBusCount ||
        state.analysisMonths !== state.baselineMonths ||
        state.inflationRate !== state.baselineInflation
      );
    },

    /** The canonical three scenarios for quick comparison cards */
    canonicalScenarios: () => WHAT_IF_SCENARIOS,
  },

  actions: {
    /** Update unit cost of a single line item — fully reactive */
    updateUnitCost(id: string, newUnitCost: number) {
      const item = this.items.find((i) => i.id === id);
      if (item && newUnitCost >= 0) {
        item.unitCost = Math.round(newUnitCost * 100) / 100;
      }
    },

    /** Update quantity of a single line item */
    updateQuantity(id: string, newQuantity: number) {
      const item = this.items.find((i) => i.id === id);
      if (item && newQuantity >= 0) {
        item.quantity = Math.max(0, Math.round(newQuantity));
      }
    },

    /** Batch update from table row edits */
    updateItem(id: string, patch: Partial<Pick<CostItem, 'unitCost' | 'quantity' | 'notes'>>) {
      const item = this.items.find((i) => i.id === id);
      if (!item) return;

      if (patch.unitCost !== undefined) item.unitCost = Math.round(patch.unitCost * 100) / 100;
      if (patch.quantity !== undefined) item.quantity = Math.max(0, Math.round(patch.quantity));
      if (patch.notes !== undefined) item.notes = patch.notes;
    },

    /** Add a brand new custom line item (user-defined) */
    addCustomItem(partial: Omit<CostItem, 'id'>) {
      const newItem: CostItem = {
        id: generateId(),
        category: partial.category,
        name: partial.name || 'Custom Line Item',
        unitCost: partial.unitCost ?? 0,
        quantity: partial.quantity ?? 1,
        notes: partial.notes || 'User-added custom cost',
        source: partial.source || 'Custom Entry',
        isRecurring: partial.isRecurring ?? false,
        isPerBus: partial.isPerBus ?? false,
      };
      this.items.push(newItem);
    },

    /** Duplicate an existing item (great for sensitivity analysis) */
    duplicateItem(id: string) {
      const original = this.items.find((i) => i.id === id);
      if (!original) return;

      const copy: CostItem = {
        ...deepClone(original),
        id: generateId(),
        name: `${original.name} (Copy)`,
      };
      this.items.push(copy);
    },

    /** Remove a custom or unwanted line (cannot remove core COTA items but UI can guard) */
    removeItem(id: string) {
      this.items = this.items.filter((i) => i.id !== id);
    },

    /** Change active fleet size — triggers full recalculation cascade */
    setActiveBusCount(count: number) {
      this.activeBusCount = Math.max(1, Math.round(count));
    },

    setAnalysisMonths(months: number) {
      this.analysisMonths = Math.max(1, Math.round(months));
    },

    setInflationRate(rate: number) {
      this.inflationRate = Math.max(0, Math.min(0.12, Math.round(rate * 1000) / 1000));
    },

    /** Complete reset to the original COTA 6-bus pilot proposal */
    resetToBaseline() {
      this.items = deepClone(this.baselineItems);
      this.activeBusCount = this.baselineBusCount;
      this.analysisMonths = this.baselineMonths;
      this.inflationRate = this.baselineInflation;
    },

    /** Restore only quantities and parameters while keeping any custom items (advanced) */
    resetParametersOnly() {
      this.activeBusCount = this.baselineBusCount;
      this.analysisMonths = this.baselineMonths;
      this.inflationRate = this.baselineInflation;
    },

    /** Completely replace the entire item list (used by import) */
    replaceAllItems(newItems: CostItem[]) {
      // Defensive validation
      if (!Array.isArray(newItems) || newItems.length === 0) return;
      this.items = deepClone(newItems);
    },

    /** JSON Export — perfect round-trippable payload for sharing / persistence */
    exportToJSON(): string {
      const payload: CostExportPayload = {
        version: '1.0.0-ghost-sentinel',
        exportedAt: new Date().toISOString(),
        project: 'Ghost Protocol - Cost Sentinel',
        activeBusCount: this.activeBusCount,
        analysisMonths: this.analysisMonths,
        inflationRate: this.inflationRate,
        items: deepClone(this.items),
      };
      return JSON.stringify(payload, null, 2);
    },

    /** Import previously exported JSON. Returns success + any warnings. */
    importFromJSON(jsonString: string): { success: boolean; message: string; warnings?: string[] } {
      try {
        const parsed = JSON.parse(jsonString) as Partial<CostExportPayload>;

        if (!parsed.items || !Array.isArray(parsed.items)) {
          return { success: false, message: 'Invalid payload: missing items array' };
        }

        // Basic shape validation
        const warnings: string[] = [];
        const validItems: CostItem[] = [];

        for (const raw of parsed.items) {
          if (!raw.id || !raw.category || !raw.name || typeof raw.unitCost !== 'number') {
            warnings.push(`Skipped malformed item: ${raw.name || raw.id || 'unknown'}`);
            continue;
          }
          validItems.push({
            id: raw.id,
            category: raw.category,
            name: raw.name,
            unitCost: raw.unitCost,
            quantity: Math.max(0, raw.quantity ?? 1),
            notes: raw.notes,
            source: raw.source,
            isRecurring: !!raw.isRecurring,
            isPerBus: !!raw.isPerBus,
          });
        }

        if (validItems.length === 0) {
          return { success: false, message: 'No valid cost items found in import' };
        }

        this.items = validItems;

        if (typeof parsed.activeBusCount === 'number') {
          this.activeBusCount = Math.max(1, Math.round(parsed.activeBusCount));
        }
        if (typeof parsed.analysisMonths === 'number') {
          this.analysisMonths = Math.max(1, Math.round(parsed.analysisMonths));
        }
        if (typeof parsed.inflationRate === 'number') {
          this.inflationRate = Math.max(0, Math.min(0.12, parsed.inflationRate));
        }

        return {
          success: true,
          message: `Imported ${validItems.length} line items successfully.`,
          warnings: warnings.length ? warnings : undefined,
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Import failed: ${err.message || 'Malformed JSON'}`,
        };
      }
    },

    /** Utility: get a scaled preview without mutating state (for sliders preview etc.) */
    previewTCOAt(numBuses: number, months?: number, inflation?: number): TCOBreakdown {
      return calculateTCO({
        numBuses,
        months: months ?? this.analysisMonths,
        inflation: inflation ?? this.inflationRate,
        baseItems: this.items,
      });
    },

    /** Return currently scaled items (for export tables / CSV) */
    getCurrentScaledItems() {
      return this.currentTCO.scaledItems;
    },
  },
});
