/**
 * Ghost Protocol Cost Sentinel - Store Barrel
 * Re-export the cost engine store for ergonomic imports across components.
 */
export { useCostsStore } from './costs';
export type { CostsState } from './costs'; // if needed externally (state shape is internal)
