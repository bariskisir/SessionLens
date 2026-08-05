/**
 * @file CrofProvider.ts
 * @description Queries the Crof request quota window and credit balance.
 */

import type { BalanceResult, MetricResult, UsageWindow } from '@shared/types'
import { getNumber } from '../ProviderJson'
import { getJsonWithBearer, ProviderError } from '../ProviderHttp'
import { currency, resetDuration } from '../UsageFormatting'
import { BaseApiKeyProvider } from '@main/providers/BaseApiKeyProvider'
import type { ProviderQueryContext } from '@main/providers/IProvider'

const USAGE_ENDPOINT = 'https://crof.ai/usage_api/'

const RESET_TIME_ZONE = 'America/Chicago'

/**
 * Returns the fixed UTC offset in milliseconds for the Crof reset time zone
 * at the given instant, resolving DST through the Intl short offset label.
 *
 * @param date - Reference instant
 * @returns Offset in milliseconds
 */
const chicagoOffsetMs = (date: Date): number => {
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: RESET_TIME_ZONE,
    timeZoneName: 'shortOffset',
  })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value
  const match = /^GMT([+-])(\d+)$/.exec(label ?? '')
  if (!match) return 0
  const sign = match[1] === '-' ? -1 : 1
  return sign * Number(match[2]) * 3_600_000
}

/**
 * Computes the next local midnight in the Crof reset time zone.
 *
 * @param now - Reference timestamp
 * @returns Reset instant
 */
const nextRequestReset = (now: Date): Date => {
  const wall = new Date(now.getTime() + chicagoOffsetMs(now))
  const nextUtcMidnight = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1)
  return new Date(nextUtcMidnight - chicagoOffsetMs(new Date(nextUtcMidnight)))
}

export default class CrofProvider extends BaseApiKeyProvider {
  async query(context: ProviderQueryContext): Promise<MetricResult | BalanceResult | null> {
    const apiKey = this.resolveApiKey(context)
    if (!apiKey) return null
    const now = context.now

    const document = (await getJsonWithBearer(USAGE_ENDPOINT, apiKey)) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('Crof response was not a JSON object.')
    }
    const root = document as Record<string, unknown>
    const credits = getNumber(root, 'credits')
    if (credits === null) {
      throw new ProviderError('Crof response did not contain credits.')
    }

    const requestsPlan = getNumber(root, 'requestsPlan') ?? getNumber(root, 'requests_plan')
    const usableRequests = getNumber(root, 'usableRequests') ?? getNumber(root, 'usable_requests')

    if (requestsPlan !== null && usableRequests !== null) {
      const clampedUsable = Math.max(0, Math.min(requestsPlan, usableRequests))
      const usedPercent =
        requestsPlan > 0 ? 100 - Math.floor((clampedUsable / requestsPlan) * 100) : 100
      const windows: UsageWindow[] = [
        {
          providerName: this.providerName,
          label: 'Requests',
          usedPercent: Math.min(100, Math.max(0, usedPercent)),
          resetText: resetDuration(nextRequestReset(now).getTime() - now.getTime()),
        },
        {
          providerName: this.providerName,
          label: 'Credits',
          // Crof returns a balance but no credit cap, so the bar only indicates
          // present versus exhausted credits.
          usedPercent: credits > 0 ? 0 : 100,
        },
      ]
      return { providerName: this.providerName, plan: null, windows }
    }

    return { providerName: this.providerName, balanceText: currency(credits), usdAmount: credits }
  }
}
