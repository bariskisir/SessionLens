/**
 * @file ElevenLabsProvider.ts
 * @description Queries ElevenLabs character-credit usage as a percentage-based quota window via the subscription API.
 */

import type { MetricResult, UsageWindow } from '@shared/types'
import { getNumber, getString } from '../ProviderJson'
import { getJsonWithKeyHeader, ProviderError } from '../ProviderHttp'
import { capitalize, resetDuration } from '../UsageFormatting'
import { BaseApiKeyProvider } from '@main/providers/BaseApiKeyProvider'
import type { ProviderQueryContext } from '@main/providers/IProvider'

const SUBSCRIPTION_ENDPOINT = 'https://api.elevenlabs.io/v1/user/subscription'

export default class ElevenLabsProvider extends BaseApiKeyProvider {
  async query(context: ProviderQueryContext): Promise<MetricResult | null> {
    const apiKey = this.resolveApiKey(context)
    if (!apiKey) return null
    const now = context.now

    const document = (await getJsonWithKeyHeader(
      SUBSCRIPTION_ENDPOINT,
      apiKey,
      'xi-api-key',
    )) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('ElevenLabs response was not a JSON object.')
    }
    const root = document as Record<string, unknown>
    const characterCount = getNumber(root, 'character_count')
    const characterLimit = getNumber(root, 'character_limit')
    const resetUnix = getNumber(root, 'next_character_count_reset_unix')
    if (characterCount === null || characterLimit === null || resetUnix === null) {
      throw new ProviderError(
        'ElevenLabs response did not contain character_count, character_limit, and next_character_count_reset_unix.',
      )
    }
    if (characterLimit <= 0) {
      throw new ProviderError('ElevenLabs response contained an invalid character_limit.')
    }

    const usedPercent = (characterCount / characterLimit) * 100
    const seconds = resetUnix > 10_000_000_000 ? resetUnix / 1000 : resetUnix
    const resetTime = new Date(Math.trunc(seconds) * 1_000)
    const resetText = resetDuration(resetTime.getTime() - now.getTime())
    const tier = getString(root, 'tier')
    const plan = tier && tier.trim() !== '' ? capitalize(tier.trim()) : null
    const window: UsageWindow = {
      providerName: 'ElevenLabs',
      label: 'Session',
      usedPercent: Math.min(100, Math.max(0, usedPercent)),
      resetText,
      resetAt: resetTime.toISOString(),
    }
    return { providerName: 'ElevenLabs', plan, windows: [window] }
  }
}
