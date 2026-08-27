<script setup lang="ts">
import { useApi } from '@/composables/useApi'
import { useCounterStore } from '@/stores/counter'
import type { HelloResponse } from '@/shared/types'

const { data, error, loading, refresh } = useApi<HelloResponse>('/api/hello')
const counter = useCounterStore()

// Renders "development" under `vite dev` and "production" in a real build —
// a quick eyeball check that you're looking at what you think you are.
const mode = import.meta.env.MODE
</script>

<template>
  <section>
    <h2>Hello, world</h2>

    <div class="card">
      <h3>From the Worker</h3>
      <p v-if="loading" class="muted">Loading…</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <p v-else-if="data">{{ data.message }}</p>
      <button type="button" @click="refresh">Fetch again</button>
    </div>

    <div class="card">
      <h3>From Pinia</h3>
      <p>
        count: <strong>{{ counter.count }}</strong> · doubled:
        <strong>{{ counter.doubleCount }}</strong>
      </p>
      <button type="button" @click="counter.increment">Increment</button>
    </div>

    <p class="muted">Build mode: {{ mode }}</p>
  </section>
</template>

<style scoped>
h2 {
  font-size: 1.75rem;
  margin-bottom: 1.5rem;
}
</style>
