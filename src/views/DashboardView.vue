<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CategoryBlock from '@/components/CategoryBlock.vue'
import ProviderCard from '@/components/ProviderCard.vue'
import TitleBlock from '@/components/TitleBlock.vue'
import { useNow } from '@/composables/useNow'
import { relativeTime } from '@/lib/relative-time'
import { useSessionStore } from '@/stores/session'
import { useStreamStore } from '@/stores/stream'
import type { ProviderId } from '@/shared/types'

const session = useSessionStore()
const stream = useStreamStore()
const route = useRoute()
const router = useRouter()
const now = useNow(1000)

const busy = ref<ProviderId | null>(null)
const callbackError = ref<string | null>(null)

/**
 * Keep block 1 live: re-read /api/me every 30s so online/offline flips and a
 * title or category changed elsewhere shows up on the cards. Skipped while a
 * save or disconnect is in flight (its optimistic update must not be raced)
 * and while the tab is hidden.
 */
const STATUS_POLL_MS = 30_000

const poll = setInterval(() => {
  if (document.hidden) return
  if (busy.value || session.loading) return
  if (stream.titleSaving || stream.categorySaving) return
  void session.refresh()
}, STATUS_POLL_MS)

onScopeDispose(() => clearInterval(poll))

/** Messages for the ?error=… the OAuth callback redirects back with. */
const ERRORS: Record<string, string> = {
  access_denied: 'Authorization was declined.',
  invalid_state: 'That login link has expired. Please try connecting again.',
  missing_code: 'The platform did not return an authorization code.',
  exchange_failed: 'Could not complete the connection. Please try again.',
}

const syncNote = computed(() => {
  if (session.loading || !session.fetchedAt) return 'syncing…'
  return `synced ${relativeTime(session.fetchedAt, now.value)} ago`
})

onMounted(async () => {
  const error = route.query.error
  if (typeof error === 'string') {
    callbackError.value = ERRORS[error] ?? `Authorization failed (${error}).`
    // Drop the parameter so a reload doesn't re-show a stale message.
    await router.replace({ query: {} })
  }

  await session.refresh()

  // The title input starts from the current shared title.
  if (!stream.draftTitle) {
    const current = session.providers.find((p) => p.connected && p.streamTitle)?.streamTitle
    if (current) stream.draftTitle = current
  }

  await stream.loadHistory()
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
  <div class="console">
    <header class="bar">
      <div class="brand">ONLY-DASHBOARD</div>
      <div class="sync">
        <template v-if="session.handle">@{{ session.handle }} · </template>{{ syncNote }}
      </div>
    </header>

    <p v-if="callbackError" class="page-error">{{ callbackError }}</p>
    <p v-if="session.error" class="page-error">{{ session.error }}</p>

    <template v-if="session.loaded">
      <div class="cards">
        <ProviderCard
          v-for="provider in session.providers"
          :key="provider.id"
          :provider="provider"
          :busy="busy === provider.id"
          @disconnect="disconnect(provider.id)"
        />
      </div>

      <TitleBlock class="ruled" />
      <CategoryBlock class="ruled" />

      <footer v-if="session.connectedCount > 0" class="foot">
        <button type="button" class="signout" @click="session.logout()">
          SIGN OUT OF EVERYTHING
        </button>
      </footer>
    </template>
    <p v-else class="loading">Loading…</p>
  </div>
</template>

<style scoped>
.console {
  max-width: 1120px;
  margin: 0 auto;
  padding-bottom: 34px;
}

.bar {
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 26px;
  border-bottom: 1px solid var(--border-rule);
}

.brand {
  font: 600 var(--fs-meta) / 1 var(--font-sans);
  letter-spacing: 0.12em;
  color: var(--text-dim);
}

.sync {
  font: 400 var(--fs-meta) / 1 var(--font-sans);
  color: var(--text-ghost);
}

.page-error {
  margin: 16px 26px 0;
  font: 400 var(--fs-meta) / 1.4 var(--font-sans);
  color: var(--error);
}

.loading {
  margin: 24px 26px 0;
  font: 400 var(--fs-meta) / 1.4 var(--font-sans);
  color: var(--text-faint);
}

.cards {
  padding: 24px 26px 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  align-items: stretch;
}

.ruled {
  margin: 26px 26px 0;
  padding-top: 22px;
  border-top: 1px solid var(--border-rule);
}

.foot {
  margin: 26px 26px 0;
  padding-top: 22px;
  border-top: 1px solid var(--border-rule);
}

.signout {
  font: 500 var(--fs-micro) / 1 var(--font-sans);
  letter-spacing: 0.06em;
  color: var(--text-faint);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}

.signout:hover {
  color: var(--error);
}

@media (max-width: 720px) {
  .cards {
    grid-template-columns: 1fr;
  }
}
</style>
