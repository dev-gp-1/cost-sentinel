/**
 * COTA (Central Ohio Transit Authority) Ghost Protocol Pilot Seed Data
 * Accurately derived from approved proposals:
 *   - Core dev $68,500 (completed)
 *   - NPU enablement $9,800
 *   - On-bus validation $12,500
 *   - OAK-4 + rugged mount + PoE/M12 hardware $2,800 / bus base
 *   - Install $600 / bus
 *   - Annual SaaS + remote support $1,100 / bus base
 *
 * 6-bus pilot quantities baked in. All values are USD.
 * This module is the single source of truth for baseline reset.
 */

import type { CostItem, CostCategory, Scenario } from '../types/costs';

export const PILOT_BUS_COUNT = 6;
export const DEFAULT_ANALYSIS_MONTHS = 36; // 3-year TCO horizon typical for transit
export const DEFAULT_INFLATION_RATE = 0.025; // 2.5% annual

/**
 * Master baseline items for the 6-bus COTA pilot.
 * Development items are fixed (qty=1). Hardware/Install/SaaS are scaled to 6 buses.
 * isPerBus + isRecurring drive the pure scaling engine.
 */
export const COTA_PILOT_SEED: readonly CostItem[] = [
  // === DEVELOPMENT (Fixed, amortized across fleet) ===
  {
    id: 'dev-core-001',
    category: 'Development',
    name: 'Core Ghost Protocol Development & Edge AI Stack',
    unitCost: 68500,
    quantity: 1,
    notes: 'Completed baseline per COTA proposal. Sovereign on-bus inference, no video egress to cloud.',
    source: 'COTA Proposal - Core Dev',
    isRecurring: false,
    isPerBus: false,
  },
  {
    id: 'dev-npu-002',
    category: 'Development',
    name: 'NPU / Hailo-8L Enablement & Model Optimization',
    unitCost: 9800,
    quantity: 1,
    notes: 'Quantization, pruning, and real-time multi-camera orchestration for OAK-4.',
    source: 'COTA Proposal - NPU Enablement',
    isRecurring: false,
    isPerBus: false,
  },
  {
    id: 'dev-validation-003',
    category: 'Development',
    name: 'On-Bus Validation, Integration & COTA Acceptance Testing',
    unitCost: 12500,
    quantity: 1,
    notes: 'Vibration, thermal, power, and route-cycle validation across 6 pilot buses.',
    source: 'COTA Proposal - On-bus Validation',
    isRecurring: false,
    isPerBus: false,
  },

  // === MATERIALS (Per-bus hardware) ===
  {
    id: 'mat-oak4-004',
    category: 'Materials',
    name: 'OAK-4 Camera + Rugged IP67 Mount + PoE/M12 Cabling Kit',
    unitCost: 2800,
    quantity: 6,
    notes: 'Primary sensor package per bus base. Includes 4x 4K global shutter + integrated NPU.',
    source: 'COTA Proposal - Hardware $2,800/bus',
    isRecurring: false,
    isPerBus: true,
  },
  {
    id: 'mat-spares-005',
    category: 'Materials',
    name: 'Spares & Rapid Replacement Inventory (OAK-4 + Mounts)',
    unitCost: 3200,
    quantity: 2,
    notes: '2 full spare kits for the 6-bus pilot fleet (buffer against vandalism/impact).',
    source: 'Internal Transit Ops Estimate',
    isRecurring: false,
    isPerBus: false,
  },

  // === PARTS (Ancillary hardware & consumables) ===
  {
    id: 'prt-harness-006',
    category: 'Parts',
    name: 'Extended M12 Harnesses, Vibration Isolators & Power Conditioning',
    unitCost: 475,
    quantity: 6,
    notes: 'Per-bus cable management and EMI hardening for bus electrical environment.',
    source: 'Vendor Quote - COTA Pilot',
    isRecurring: false,
    isPerBus: true,
  },
  {
    id: 'prt-mount-007',
    category: 'Parts',
    name: 'Additional Roof & Interior Mounting Brackets (Reinforced)',
    unitCost: 185,
    quantity: 8,
    notes: 'Extra structural hardware for articulated buses and multi-camera placements.',
    source: 'COTA Facilities',
    isRecurring: false,
    isPerBus: false,
  },

  // === CloudSaaS (Recurring per bus) ===
  {
    id: 'cloud-saas-008',
    category: 'CloudSaaS',
    name: 'Ghost Sentinel Cloud SaaS - Fleet Command, OTA Updates, Analytics Dashboard',
    unitCost: 1100,
    quantity: 6,
    notes: 'Annual subscription per bus base. Includes secure telemetry, model updates, and executive dashboards. Sovereign edge keeps raw video on-prem.',
    source: 'COTA Proposal - Annual SaaS/Support $1,100/bus',
    isRecurring: true,
    isPerBus: true,
  },
  {
    id: 'cloud-base-009',
    category: 'CloudSaaS',
    name: 'Ghost Sentinel Platform Base Fee (Multi-tenant Fleet Management)',
    unitCost: 2400,
    quantity: 1,
    notes: 'Fixed annual platform access independent of bus count. Billed pro-rata in TCO.',
    source: 'Ghost Protocol Pricing - Enterprise',
    isRecurring: true,
    isPerBus: false,
  },

  // === SUPPORT (Install + services) ===
  {
    id: 'sup-install-010',
    category: 'Support',
    name: 'Professional On-Bus Installation, Commissioning & COTA Sign-off',
    unitCost: 600,
    quantity: 6,
    notes: 'Certified tech labor, alignment, firmware provisioning, and 30-day burn-in per bus.',
    source: 'COTA Proposal - Install $600/bus',
    isRecurring: false,
    isPerBus: true,
  },
  {
    id: 'sup-training-011',
    category: 'Support',
    name: 'COTA Fleet Technician & Operations Training Program',
    unitCost: 4200,
    quantity: 1,
    notes: 'Two-day hands-on + virtual modules for maintenance and dashboard usage.',
    source: 'Ghost Protocol Professional Services',
    isRecurring: false,
    isPerBus: false,
  },
  {
    id: 'sup-maint-012',
    category: 'Support',
    name: 'Annual Preventive Maintenance & Remote Health Monitoring Retainer',
    unitCost: 780,
    quantity: 6,
    notes: 'Per-bus annual retainer for remote diagnostics, calibration verification, and priority field response.',
    source: 'COTA Proposal - Ongoing Support',
    isRecurring: true,
    isPerBus: true,
  },
] as const;

/** Pre-defined what-if scenarios for instant comparison */
export const WHAT_IF_SCENARIOS: readonly Scenario[] = [
  {
    id: 'pilot-6',
    label: 'COTA 6-Bus Pilot',
    numBuses: 6,
    months: 36,
    inflation: DEFAULT_INFLATION_RATE,
    description: 'Current approved pilot deployment. Baseline for all leverage calculations.',
  },
  {
    id: 'mid-50',
    label: 'Mid-Market 50-Bus Fleet',
    numBuses: 50,
    months: 36,
    inflation: DEFAULT_INFLATION_RATE,
    description: 'Typical mid-size transit agency expansion. Strong amortization inflection.',
  },
  {
    id: 'full-330',
    label: 'Full COTA 330-Bus Rollout',
    numBuses: 330,
    months: 48,
    inflation: 0.03,
    description: 'Complete COTA fleet electrification + Ghost Protocol standardization. Maximum sovereignty leverage.',
  },
] as const;

/**
 * Helper to deep-clone the seed (for store baseline + reset)
 */
export function getBaselineItems(): CostItem[] {
  return JSON.parse(JSON.stringify(COTA_PILOT_SEED));
}

/**
 * Quick lookup map by id (useful in store actions)
 */
export function getSeedItemById(id: string): CostItem | undefined {
  return COTA_PILOT_SEED.find((item) => item.id === id);
}
