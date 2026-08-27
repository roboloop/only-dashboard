<script setup lang="ts">
import type { ProviderState } from '@/shared/types'

defineProps<{ provider: ProviderState; busy?: boolean }>()
defineEmits<{ disconnect: [] }>()
</script>

<template>
  <article class="card" :class="{ 'is-connected': provider.connected }">
    <header>
      <h3>{{ provider.label }}</h3>
      <span v-if="provider.connected && provider.isLive" class="badge live">Live</span>
      <span v-else-if="provider.connected" class="badge">Offline</span>
    </header>

    <!-- Connect must be a real navigation, not a fetch: the OAuth consent
         screen has to render as a top-level page. -->
    <template v-if="!provider.connected">
      <p class="muted">Not connected.</p>
      <a class="button" :href="`/auth/${provider.id}/start`">Connect {{ provider.label }}</a>
    </template>

    <template v-else>
      <dl>
        <dt>Account</dt>
        <dd>{{ provider.displayName ?? '—' }}</dd>

        <dt>Stream title</dt>
        <dd class="title">
          <template v-if="provider.streamTitle">{{ provider.streamTitle }}</template>
          <span v-else class="muted">No title set</span>
        </dd>

        <template v-if="provider.category">
          <dt>Category</dt>
          <dd>{{ provider.category }}</dd>
        </template>
      </dl>

      <p v-if="provider.error" class="error">{{ provider.error }}</p>

      <button type="button" :disabled="busy" @click="$emit('disconnect')">Disconnect</button>
    </template>

    <p v-if="!provider.connected && provider.error" class="error">{{ provider.error }}</p>
  </article>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 0;
}

header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  text-transform: none;
  letter-spacing: normal;
  color: var(--text);
}

.badge {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-muted);
}

.badge.live {
  color: var(--bg);
  background: var(--accent);
  border-color: var(--accent);
}

dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.35rem 1rem;
  margin: 0;
}

dt {
  color: var(--text-muted);
  font-size: 0.8125rem;
}

dd {
  margin: 0;
  overflow-wrap: anywhere;
}

dd.title {
  font-weight: 500;
}

.button {
  align-self: flex-start;
  display: inline-block;
  text-decoration: none;
  color: var(--bg);
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 0.375rem;
  padding: 0.35rem 0.8rem;
}

button {
  align-self: flex-start;
}
</style>
