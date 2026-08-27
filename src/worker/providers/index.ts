import { PROVIDER_IDS, type ProviderId } from '../../shared/types'
import { kick } from './kick'
import { twitch } from './twitch'
import type { Provider } from './types'
import { vkvideo } from './vkvideo'

export const PROVIDERS: Record<ProviderId, Provider> = { twitch, kick, vkvideo }

/** Registry order drives the order of the cards in the UI. */
export const PROVIDER_LIST: Provider[] = PROVIDER_IDS.map((id) => PROVIDERS[id])

export function isProviderId(value: string): value is ProviderId {
  return Object.hasOwn(PROVIDERS, value)
}

export * from './oauth'
export * from './types'
