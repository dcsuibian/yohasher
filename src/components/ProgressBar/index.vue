<script setup lang="ts">
import { computed, onBeforeMount, onMounted, ref } from 'vue'

const { current, total } = defineProps<{
  current: number
  total: number
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const leftRef = ref<HTMLDivElement | null>(null)
const charWidth = 9
const barMaxLength = ref(0)
let observer: ResizeObserver | null = null

onMounted(() => {
  if (null === containerRef.value || null === leftRef.value) {
    return
  }
  observer = new ResizeObserver(() => {
    if (null === leftRef.value) {
      return
    }
    const width = leftRef.value.clientWidth
    barMaxLength.value = Math.floor(width / charWidth)
  })
  observer.observe(containerRef.value!)
})

onBeforeMount(() => {
  observer?.disconnect()
})

const text = computed(() => {
  if (0 === total || barMaxLength.value <= 0) {
    return ''
  }
  const totalCount = barMaxLength.value
  const currentCount = Math.floor((current / total) * totalCount)
  const remainCount = totalCount - currentCount
  return '#'.repeat(currentCount) + '-'.repeat(remainCount)
})

defineOptions({
  name: 'ProgressBar',
})
</script>

<template>
  <div class="progress-bar" ref="containerRef">
    <div class="left" ref="leftRef">
      {{ text }}
    </div>
    <div class="right">
      <span v-if="0 === total"> N/A </span>
      <span v-else> {{ current }}/{{ total }} ({{ ((current / total) * 100).toFixed(2) }}%) </span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.progress-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;

  .left {
    flex: 1;
    font-family: monospace;
    font-size: 16px;
  }
}
</style>
