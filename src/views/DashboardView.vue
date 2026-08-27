<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ProviderCard from '@/components/ProviderCard.vue'
import { useSessionStore } from '@/stores/session'
import type { ProviderId } from '@/shared/types'

const session = useSessionStore()
const route = useRoute()
const router = useRouter()

const busy = ref<ProviderId | null>(null)
const callbackError = ref<string | null>(null)

/** Messages for the ?error=… the OAuth callback redirects back with. */
const ERRORS: Record<string, string> = {
  access_denied: 'Authorization was declined.',
  invalid_state: 'That login link has expired. Please try connecting again.',
  missing_code: 'The platform did not return an authorization code.',
  exchange_failed: 'Could not complete the connection. Please try again.',
}

onMounted(async () => {
  const error = route.query.error
  if (typeof error === 'string') {
    callbackError.value = ERRORS[error] ?? `Authorization failed (${error}).`
    // Drop the parameter so a reload doesn't re-show a stale message.
    await router.replace({ query: {} })
  }

  await session.refresh()
})

async function disconnect(id: ProviderId) {
  busy.value = id
  try {
    await session.disconnect(id)
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <section>
    <div class="heading">
      <h2>Connections</h2>
      <button type="button" class="link" :disabled="session.loading" @click="session.refresh()">
        {{ session.loading ? 'Refreshing…' : 'Refresh' }}
      </button>
    </div>

    <p v-if="callbackError" class="error">{{ callbackError }}</p>
    <p v-if="session.error" class="error">{{ session.error }}</p>

    <p v-if="!session.loaded" class="muted">Loading…</p>

    <div v-else class="grid">
      <ProviderCard
        v-for="provider in session.providers"
        :key="provider.id"
        :provider="provider"
        :busy="busy === provider.id"
        @disconnect="disconnect(provider.id)"
      />
    </div>

    <p v-if="session.loaded && session.connectedCount > 0" class="muted signout">
      <button type="button" class="link" @click="session.logout()">Sign out of everything</button>
    </p>
  </section>
</template>

<style scoped>
.heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

h2 {
  font-size: 1.75rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
  gap: 1rem;
}

.signout {
  margin-top: 1.5rem;
}
</style>
