<script setup lang="ts">
import type { ProviderId, ProviderState } from '@/shared/types'

defineProps<{ provider: ProviderState; busy?: boolean }>()
defineEmits<{ disconnect: [] }>()

/** Platform colors appear only as the 2px left border (and list-header dots). */
const PLATFORM_COLORS: Record<ProviderId, string> = {
  twitch: 'var(--platform-twitch)',
  kick: 'var(--platform-kick)',
  vkvideo: 'var(--platform-vk)',
}
</script>

<template>
  <article class="card" :style="{ borderLeftColor: PLATFORM_COLORS[provider.id] }">
    <div class="head">
      <div class="name">{{ provider.label }}</div>
      <div v-if="provider.connected && provider.isLive" class="status live">
        <span class="dot"></span>LIVE
      </div>
      <div v-else-if="provider.connected" class="status offline">OFFLINE</div>
      <div v-else class="status none">NOT CONNECTED</div>
    </div>

    <div class="handle" :class="{ empty: !provider.displayName }">
      {{ provider.displayName ? `@${provider.displayName}` : '—' }}
    </div>

    <div class="stream">
      <div class="title" :class="{ empty: !provider.streamTitle }">
        {{ provider.streamTitle ?? 'No title' }}
      </div>
      <div class="category" :class="{ empty: !provider.category }">
        {{ provider.category?.name ?? '—' }}
      </div>
    </div>

    <p v-if="provider.error" class="note error-note">{{ provider.error }}</p>
    <p v-else-if="provider.connected && provider.needsReauth" class="note warning-note">
      New permissions needed — reconnect to save changes
    </p>

    <div class="actions">
      <!-- Connect must be a real navigation, not a fetch: the OAuth consent
           screen has to render as a top-level page. -->
      <a v-if="!provider.connected" class="action connect" :href="`/auth/${provider.id}/start`">
        CONNECT
      </a>
      <template v-else>
        <a
          v-if="provider.dashboardUrl"
          class="action dashboard"
          :href="provider.dashboardUrl"
          target="_blank"
          rel="noopener"
        >
          DASHBOARD ↗
        </a>
        <a
          v-if="provider.needsReauth"
          class="action connect"
          :href="`/auth/${provider.id}/start`"
        >
          RECONNECT
        </a>
        <button
          type="button"
          class="action disconnect"
          :disabled="busy"
          @click="$emit('disconnect')"
        >
          DISCONNECT
        </button>
      </template>
    </div>
  </article>
</template>

<style scoped>
.card {
  border: 1px solid var(--border);
  border-left-width: 2px;
  border-radius: 6px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 11px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.name {
  font: 600 var(--fs-input) / 1 var(--font-sans);
}

.status {
  display: flex;
  align-items: center;
  gap: 6px;
  font: 500 var(--fs-micro) / 1 var(--font-sans);
  letter-spacing: 0.06em;
}

.status.live {
  color: var(--accent);
}

.status.offline {
  color: var(--text-dim);
}

.status.none {
  color: var(--text-faint);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}

.handle {
  font: 400 var(--fs-meta) / 1 var(--font-sans);
  color: var(--text-faint);
}

.handle.empty {
  color: var(--text-empty);
}

.stream {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 2px;
  border-top: 1px solid var(--border-hairline);
}

.title {
  font: 400 var(--fs-body) / 1.45 var(--font-sans);
  color: var(--text-body);
  overflow-wrap: anywhere;
}

.category {
  font: 400 var(--fs-meta) / 1.3 var(--font-sans);
  color: var(--text-muted);
}

.title.empty,
.category.empty {
  color: var(--text-empty);
}

.note {
  font: 400 var(--fs-meta) / 1.4 var(--font-sans);
}

.error-note {
  color: var(--error);
}

.warning-note {
  color: var(--warning);
}

.actions {
  display: flex;
  gap: 16px;
  margin-top: auto;
}

.action {
  font: 500 var(--fs-micro) / 1 var(--font-sans);
  letter-spacing: 0.06em;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-decoration: none;
}

.action.connect {
  color: var(--accent);
}

.action.connect:hover {
  color: var(--accent-hover);
}

.action.dashboard {
  color: var(--text-dim);
}

.action.dashboard:hover {
  color: var(--accent);
}

.action.disconnect {
  color: var(--text-dim);
}

.action.disconnect:hover {
  color: var(--error);
}

.action:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
