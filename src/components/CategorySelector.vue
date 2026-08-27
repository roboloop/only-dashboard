<script setup lang="ts">
import { computed } from 'vue'
import { useStreamStore } from '@/stores/stream'
import type { Category, ProviderId, ProviderState } from '@/shared/types'

const props = defineProps<{ provider: ProviderState }>()

const stream = useStreamStore()

const PLATFORM_COLORS: Record<ProviderId, string> = {
  twitch: 'var(--platform-twitch)',
  kick: 'var(--platform-kick)',
  vkvideo: 'var(--platform-vk)',
}

const pick = computed(() => stream.picks[props.provider.id] ?? null)
const skipped = computed(() => stream.skipped[props.provider.id] === true)
const candidates = computed(() => stream.candidates[props.provider.id])
const searchError = computed(() => stream.searchErrors[props.provider.id])

/** The column is open while a search is active and nothing has been clicked. */
const open = computed(
  () => props.provider.connected && stream.searchActive && !pick.value && !skipped.value,
)

function isExact(candidate: Category): boolean {
  return candidate.name.toLowerCase() === stream.draftCategoryQuery.trim().toLowerCase()
}

let overrideTimer: ReturnType<typeof setTimeout> | undefined

function onOverrideInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (overrideTimer) clearTimeout(overrideTimer)
  overrideTimer = setTimeout(() => void stream.searchProvider(props.provider.id, value), 300)
}
</script>

<template>
  <div class="column" :class="{ dimmed: !provider.connected }">
    <div class="col-head">
      <span class="pdot" :style="{ background: PLATFORM_COLORS[provider.id] }"></span>
      <span class="pname">{{ provider.label }}</span>
      <button v-if="open" type="button" class="head-action" @click="stream.skipProvider(provider.id)">
        SKIP
      </button>
      <button
        v-else-if="skipped"
        type="button"
        class="head-action"
        @click="stream.clearPick(provider.id)"
      >
        UNDO
      </button>
    </div>

    <!-- Disconnected: nothing to pick. -->
    <div v-if="!provider.connected" class="row dashed">
      <div class="thumb-lg stripe-thumb"></div>
      <div class="row-text faint">Not connected</div>
    </div>

    <!-- Explicitly skipped for this save. -->
    <div v-else-if="skipped" class="row plain">
      <div class="thumb-lg stripe-thumb"></div>
      <div class="row-text faint">Skipped — keeping current</div>
    </div>

    <!-- A candidate has been clicked. Clicking again reopens the list. -->
    <div v-else-if="pick" class="row plain picked" @click="stream.clearPick(provider.id)">
      <img v-if="pick.imageUrl" class="thumb-lg" :src="pick.imageUrl" alt="" />
      <div v-else class="thumb-lg stripe-thumb"></div>
      <div class="row-text body">{{ pick.name }}</div>
      <div class="tag">SELECTED</div>
    </div>

    <!-- Open: the candidate list for the current query. -->
    <div v-else-if="open" class="box">
      <div class="row head-row">
        <div class="thumb-lg stripe-thumb"></div>
        <div class="row-text faint">Pick a match…</div>
        <div class="count">{{ candidates?.length ?? '' }}</div>
      </div>
      <div class="list">
        <div v-if="stream.searching && !candidates" class="list-note">Searching…</div>
        <div v-else-if="searchError" class="list-note error-note">{{ searchError }}</div>
        <div v-else-if="candidates && candidates.length === 0" class="list-note">No matches</div>
        <div
          v-for="candidate in candidates ?? []"
          :key="candidate.id"
          class="candidate"
          :class="{ exact: isExact(candidate) }"
          @click="stream.pickCategory(provider.id, candidate)"
        >
          <img v-if="candidate.imageUrl" class="thumb-sm" :src="candidate.imageUrl" alt="" />
          <div v-else class="thumb-sm stripe-thumb"></div>
          <div class="cname" :class="{ bright: isExact(candidate) }">{{ candidate.name }}</div>
          <div v-if="isExact(candidate)" class="tag">EXACT</div>
        </div>
        <div class="override">
          <input
            type="text"
            class="override-input"
            :placeholder="`Search ${provider.label} categories…`"
            @input="onOverrideInput"
          />
        </div>
      </div>
    </div>

    <!-- Idle: show what the platform is currently set to. -->
    <div v-else class="row plain">
      <img
        v-if="provider.category?.imageUrl"
        class="thumb-lg"
        :src="provider.category.imageUrl"
        alt=""
      />
      <div v-else class="thumb-lg stripe-thumb"></div>
      <div class="row-text" :class="provider.category ? 'body' : 'faint'">
        {{ provider.category?.name ?? 'No category' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.column {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}

.column.dimmed {
  opacity: 0.55;
}

.col-head {
  display: flex;
  align-items: center;
  gap: 7px;
}

.pdot {
  width: 5px;
  height: 5px;
  border-radius: 1px;
  flex: none;
}

.pname {
  font: 500 var(--fs-micro) / 1 var(--font-sans);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.head-action {
  margin-left: auto;
  font: 500 var(--fs-micro) / 1 var(--font-sans);
  letter-spacing: 0.06em;
  color: var(--text-faint);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}

.head-action:hover {
  color: var(--accent);
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 6px;
}

.row.plain {
  border: 1px solid var(--border);
}

.row.picked {
  cursor: pointer;
}

.row.picked:hover {
  border-color: var(--border-input);
}

.row.dashed {
  border: 1px dashed var(--border);
}

.thumb-lg {
  width: 34px;
  height: 45px;
  flex: none;
  border-radius: 3px;
  border: 1px solid var(--border);
  object-fit: cover;
}

.thumb-sm {
  width: 28px;
  height: 37px;
  flex: none;
  border-radius: 3px;
  border: 1px solid var(--border);
  object-fit: cover;
}

.row-text {
  flex: 1;
  min-width: 0;
  font: 400 var(--fs-body) / 1.35 var(--font-sans);
  overflow-wrap: anywhere;
}

.row-text.body {
  color: var(--text-body);
}

.row-text.faint {
  color: var(--text-faint);
}

.tag {
  font: 500 var(--fs-micro) / 1 var(--font-sans);
  letter-spacing: 0.06em;
  color: var(--accent);
  flex: none;
}

.count {
  font: 400 var(--fs-micro) / 1 var(--font-sans);
  color: var(--text-dim);
  flex: none;
}

.box {
  border: 1px solid var(--accent);
  border-radius: 6px;
  overflow: hidden;
}

.head-row {
  background: var(--surface);
  border-radius: 0;
}

.list {
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}

.list-note {
  padding: 8px 12px;
  font: 400 var(--fs-meta) / 1.3 var(--font-sans);
  color: var(--text-empty);
}

.list-note.error-note {
  color: var(--error);
}

.candidate {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
}

.candidate:hover,
.candidate.exact {
  background: var(--surface-hover);
}

.cname {
  flex: 1;
  min-width: 0;
  font: 400 var(--fs-meta) / 1.3 var(--font-sans);
  color: var(--text-mid);
  overflow-wrap: anywhere;
}

.cname.bright {
  color: var(--text);
}

.override {
  border-top: 1px solid var(--border);
  background: var(--surface-deep);
}

.override-input {
  width: 100%;
  background: none;
  border: none;
  outline: none;
  padding: 8px 12px;
  font: 400 var(--fs-meta) / 1.2 var(--font-sans);
  color: var(--text-body);
}

.override-input::placeholder {
  color: var(--text-faint);
}
</style>
