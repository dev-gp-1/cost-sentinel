<script setup lang="ts">
import type { CostItem } from '../stores/cost'

const props = defineProps<{
  items: CostItem[]
}>()

const emit = defineEmits<{
  (e: 'update-item', id: number, patch: Partial<CostItem>): void
}>()

function update(id: number, field: keyof CostItem, val: any) {
  const patch: any = {}
  if (field === 'unitCost' || field === 'qty') {
    patch[field] = Number(val)
  } else {
    patch[field] = val
  }
  emit('update-item', id, patch)
}
</script>

<template>
  <div class="hud-card overflow-hidden">
    <table class="data-table">
      <thead>
        <tr>
          <th style="width: 15%">CATEGORY</th>
          <th>LINE ITEM</th>
          <th style="width: 12%; text-align: right">UNIT COST</th>
          <th style="width: 9%; text-align: right">QTY</th>
          <th style="width: 12%; text-align: right">EXTENDED</th>
          <th style="width: 9%">TYPE</th>
          <th style="width: 22%">NOTES</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="item.id">
          <td class="font-mono text-[10px] text-[var(--accent-teal)] tracking-[1.2px] font-semibold">{{ item.category }}</td>
          <td class="text-[var(--text-primary)] font-medium pr-3">{{ item.item }}</td>
          <td class="text-right">
            <input
              type="number"
              step="0.001"
              :value="item.unitCost"
              @input="e => update(item.id, 'unitCost', (e.target as HTMLInputElement).value)"
              class="text-right"
            />
          </td>
          <td class="text-right">
            <input
              type="number"
              :value="item.qty"
              @input="e => update(item.id, 'qty', (e.target as HTMLInputElement).value)"
              class="text-right"
            />
          </td>
          <td class="text-right cost mono text-lg">
            {{ (item.unitCost * item.qty).toLocaleString() }}
          </td>
          <td>
            <span class="inline-block px-2 py-0.5 rounded text-[10px] font-mono tracking-widest"
                  :class="item.type === 'monthly' ? 'bg-orange-950 text-[var(--accent-orange)]' : 'bg-teal-950 text-[var(--accent-teal)]'">
              {{ item.type.toUpperCase() }}
            </span>
          </td>
          <td class="text-[var(--text-muted)] text-xs font-light pr-2">{{ item.notes || '—' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
