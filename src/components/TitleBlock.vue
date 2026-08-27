<script setup lang="ts">
import { useNow } from '@/composables/useNow'
import { relativeTime } from '@/lib/relative-time'
import { useStreamStore } from '@/stores/stream'

const stream = useStreamStore()
const now = useNow(30_000)
</script>

<template>
  <section class="block">
    <div class="block-label">Title</div>

    <div class="row">
      <input
        v-model="stream.draftTitle"
        class="field"
        type="text"
        placeholder="Stream title"
        @keyup.enter="stream.saveTitle()"
      />
      <button
        type="button"
        class="save"
        :disabled="stream.titleSaving || !stream.draftTitle.trim()"
        @click="stream.saveTitle()"
      >
        Save
      </button>
    </div>

    <p v-if="stream.titleError" class="error-note">{{ stream.titleError }}</p>

    <div v-if="stream.titleHistory.length" class="history">
      <div
        v-for="entry in stream.titleHistory"
        :key="entry.id"
        class="hrow"
        @click="stream.applyTitle(entry.text)"
      >
        <button
          type="button"
          class="star"
          :class="{ on: entry.pinned }"
          :aria-label="entry.pinned ? 'Unpin title' : 'Pin title'"
          @click.stop="stream.pinTitle(entry.id, !entry.pinned)"
        >
          {{ entry.pinned ? '★' : '☆' }}
        </button>
        <div class="text" :class="{ pinned: entry.pinned }">{{ entry.text }}</div>
        <div v-if="entry.pinned" class="apply">APPLY</div>
        <div v-else class="when">{{ relativeTime(entry.at, now) }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.block {
  display: flex;
  flex-direction: column;
  gap: 12px;
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

.history {
  display: flex;
  flex-direction: column;
}

.hrow {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 4px;
  border-bottom: 1px solid var(--border-hairline);
  cursor: pointer;
}

.hrow:last-child {
  border-bottom: none;
}

.hrow:hover {
  background: var(--surface);
}

.star {
  width: 18px;
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

.text {
  flex: 1;
  min-width: 0;
  font: 400 var(--fs-body) / 1.4 var(--font-sans);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.text.pinned {
  color: var(--text-soft);
}

.apply {
  font: 500 var(--fs-micro) / 1 var(--font-sans);
  letter-spacing: 0.06em;
  color: var(--text-faint);
}

.hrow:hover .apply {
  color: var(--accent);
}

.when {
  font: 400 var(--fs-micro) / 1 var(--font-sans);
  color: var(--text-dim);
}
</style>
