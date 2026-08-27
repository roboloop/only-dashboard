<script setup lang="ts">
import { useApi } from '@/composables/useApi'
import type { StatsResponse } from '@/shared/types'

const { data, error, loading, refresh } = useApi<StatsResponse>('/api/stats')

const percent = (delta: number) => `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`
const number = (value: number) => value.toLocaleString('en-US')
</script>

<template>
  <section>
    <h2>Stats</h2>

    <p v-if="loading" class="muted">Loading…</p>
    <p v-else-if="error" class="error">{{ error }}</p>

    <template v-else-if="data">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col" class="num">Value</th>
              <th scope="col" class="num">Change</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="stat in data.stats" :key="stat.id">
              <td>{{ stat.label }}</td>
              <td class="num">{{ number(stat.value) }}{{ stat.unit ? ` ${stat.unit}` : '' }}</td>
              <td class="num" :class="stat.delta >= 0 ? 'up' : 'down'">
                {{ percent(stat.delta) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="muted">
        Generated {{ new Date(data.generatedAt).toLocaleTimeString() }} ·
        <button type="button" class="link" @click="refresh">refresh</button>
      </p>
    </template>
  </section>
</template>

<style scoped>
h2 {
  font-size: 1.75rem;
  margin-bottom: 1.5rem;
}

.table-wrap {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 0.6rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

th {
  color: var(--text-muted);
  font-weight: 500;
  font-size: 0.8125rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.up {
  color: var(--up);
}

.down {
  color: var(--down);
}
</style>
