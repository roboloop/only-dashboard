import { onScopeDispose, ref, type Ref } from 'vue'

/** A ticking "now", for relative timestamps that stay current on screen. */
export function useNow(intervalMs = 1000): Ref<number> {
  const now = ref(Date.now())

  const timer = setInterval(() => {
    now.value = Date.now()
  }, intervalMs)

  onScopeDispose(() => clearInterval(timer))

  return now
}
