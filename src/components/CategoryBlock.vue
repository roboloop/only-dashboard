<script setup lang="ts">
import CategorySelector from '@/components/CategorySelector.vue'
import { useSessionStore } from '@/stores/session'
import { useStreamStore } from '@/stores/stream'
import type { ProviderId } from '@/shared/types'

const session = useSessionStore()
const stream = useStreamStore()

const PLATFORM_COLORS: Record<ProviderId, string> = {
  twitch: 'var(--platform-twitch)',
  kick: 'var(--platform-kick)',
  vkvideo: 'var(--platform-vk)',
}

function onQueryInput(event: Event) {
  stream.setCategoryQuery((event.target as HTMLInputElement).value)
}
</script>

<template>
  <section class="block">
    <div class="block-label">Category</div>

    <div class="row">
      <input
        :value="stream.draftCategoryQuery"
        class="field"
        type="text"
        placeholder="Search a category across platforms"
        @input="onQueryInput"
      />
      <button
        type="button"
        class="save"
        :disabled="!stream.canSaveCategory || stream.categorySaving"
        @click="stream.saveCategory()"
      >
        Save
      </button>
    </div>

    <p v-if="stream.categoryError" class="error-note">{{ stream.categoryError }}</p>

    <div class="selectors">
      <CategorySelector
        v-for="provider in session.providers"
        :key="provider.id"
        :provider="provider"
      />
    </div>

    <div class="recents">
      <div
        v-for="provider in session.providers"
        :key="provider.id"
        class="recent-col"
        :class="{ dimmed: !provider.connected }"
      >
        <div class="col-head">
          <span class="pdot" :style="{ background: PLATFORM_COLORS[provider.id] }"></span>
          <span class="pname">{{ provider.label }} · Recent</span>
        </div>

        <div v-if="stream.categoryHistory[provider.id].length === 0" class="empty">
          Nothing yet
        </div>
        <div
          v-for="entry in stream.categoryHistory[provider.id]"
          :key="entry.category.id"
          class="rrow"
          @click="stream.applyCategory(provider.id, entry.category)"
        >
          <button
            type="button"
            class="star"
            :class="{ on: entry.pinned }"
            :aria-label="entry.pinned ? 'Unpin category' : 'Pin category'"
            @click.stop="stream.pinCategory(provider.id, entry.category.id, !entry.pinned)"
          >
            {{ entry.pinned ? '★' : '☆' }}
          </button>
          <div class="rname" :class="{ pinned: entry.pinned }">{{ entry.category.name }}</div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.block {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.row {
  display: flex;
  gap: 8px;
}

.field {
  flex: 1;
  min-width: 0;
  background: var(--surface);
  border: 1px solid var(--border-input);
  border-radius: 6px;
  padding: 12px 14px;
  font: 400 var(--fs-input) / 1.3 var(--font-sans);
  color: var(--text);
  outline: none;
}

.field:focus {
  border-color: var(--accent);
}

.field::placeholder {
  color: var(--text-faint);
}

.save {
  flex: none;
  padding: 12px 22px;
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: var(--on-accent);
  font: 600 var(--fs-body) / 1.3 var(--font-sans);
  cursor: pointer;
}

.save:hover:not(:disabled) {
  background: var(--accent-hover);
}

.save:disabled {
  opacity: 0.5;
  cursor: default;
}

.error-note {
  font: 400 var(--fs-meta) / 1.4 var(--font-sans);
  color: var(--error);
}

.selectors,
.recents {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  align-items: start;
}

.recents {
  padding-top: 16px;
  border-top: 1px solid var(--border-hairline);
}

.recent-col {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}

.recent-col.dimmed {
  opacity: 0.5;
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
  color: var(--text-faint);
}

.empty {
  font: 400 var(--fs-meta) / 1.3 var(--font-sans);
  color: var(--text-empty);
  padding: 6px 4px;
}

.rrow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  cursor: pointer;
}

.rrow:hover {
  background: var(--surface);
}

.star {
  flex: none;
  font: 400 var(--fs-meta) / 1 var(--font-sans);
  color: var(--star-off);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}

.star.on {
  color: var(--accent);
}

.rname {
  flex: 1;
  min-width: 0;
  font: 400 var(--fs-meta) / 1.3 var(--font-sans);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.rname.pinned {
  color: var(--text-soft);
}

@media (max-width: 720px) {
  .selectors,
  .recents {
    grid-template-columns: 1fr;
  }
}
</style>
