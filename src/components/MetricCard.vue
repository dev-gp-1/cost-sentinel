<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  label: string
  value: string | number
  unit?: string
  accent?: 'teal' | 'orange' | 'green' | 'default'
  change?: string
  icon?: any
}>()

const accentClass = computed(() => {
  if (props.accent === 'teal') return 'teal'
  if (props.accent === 'orange') return 'orange'
  if (props.accent === 'green') return 'green'
  return ''
})
</script>

<template>
  <div class="hud-card p-5 flex flex-col gap-1.5 group">
    <div class="flex items-center justify-between">
      <div class="data-label">{{ label }}</div>
      <div v-if="icon" class="text-[var(--accent-teal)] opacity-60 group-hover:opacity-100 transition">
        <component :is="icon" :size="16" />
      </div>
    </div>
    <div class="flex items-baseline gap-1.5 mt-0.5">
      <span class="metric-value" :class="accentClass">{{ value }}</span>
      <span v-if="unit" class="text-[10px] font-mono text-[var(--text-muted)] tracking-widest">{{ unit }}</span>
    </div>
    <div v-if="change" class="text-[11px] font-mono text-[var(--accent-green)]">{{ change }}</div>
  </div>
</template>
