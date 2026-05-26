<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { Chart, registerables } from 'chart.js'

Chart.register(...registerables)

const props = defineProps<{
  title: string
  labels: string[]
  dataOneTime: number[]
  dataMonthly: number[]
  dataFiveYear?: number[]
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
let chart: Chart | null = null

function renderChart() {
  if (!canvasRef.value) return
  if (chart) chart.destroy()

  const ctx = canvasRef.value.getContext('2d', { alpha: true })!
  
  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: props.labels,
      datasets: [
        {
          label: 'One-Time CapEx',
          data: props.dataOneTime,
          backgroundColor: 'rgba(2, 128, 144, 0.75)',
          borderColor: '#028090',
          borderWidth: 1,
          borderRadius: 2,
        },
        {
          label: 'Monthly OpEx × 12',
          data: props.dataMonthly,
          backgroundColor: 'rgba(255, 90, 0, 0.7)',
          borderColor: '#FF5A00',
          borderWidth: 1,
          borderRadius: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { 
          labels: { color: '#A5B4C8', font: { family: 'JetBrains Mono, monospace', size: 11 } },
          position: 'top',
        },
        tooltip: {
          backgroundColor: '#0A1625',
          borderColor: '#028090',
          borderWidth: 1,
          titleFont: { family: 'JetBrains Mono' },
          bodyFont: { family: 'JetBrains Mono' },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(42,74,104,0.4)', lineWidth: 0.5 },
          ticks: { color: '#6B7C92', font: { family: 'JetBrains Mono', size: 10 } }
        },
        y: {
          grid: { color: 'rgba(42,74,104,0.4)', lineWidth: 0.5 },
          ticks: { 
            color: '#6B7C92', 
            font: { family: 'JetBrains Mono', size: 10 },
            callback: (v) => '$' + Number(v).toLocaleString()
          }
        }
      }
    }
  })
}

watch(() => [props.labels, props.dataOneTime, props.dataMonthly], renderChart, { deep: true })

onMounted(renderChart)
onUnmounted(() => chart?.destroy())
</script>

<template>
  <div class="chart-container h-[298px]">
    <div class="section-header !mb-3 !pb-2">
      <span class="label">{{ title }}</span>
    </div>
    <canvas ref="canvasRef" class="w-full h-[242px]"></canvas>
  </div>
</template>
