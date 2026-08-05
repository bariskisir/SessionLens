/**
 * @file ZenMuxProvider.ts
 * @description Queries the ZenMux subscription quota windows (5-hour and 7-day) and PAYG USD balance.
 */

import type { BalanceResult, MetricResult, UsageWindow } from '@shared/types'
import { getNumber, getObject, getString } from '../ProviderJson'
import { getJsonWithBearer, ProviderError } from '../ProviderHttp'
import { capitalize, currency, resetDuration } from '../UsageFormatting'
import { BaseApiKeyProvider } from '@main/providers/BaseApiKeyProvider'
import type { ProviderQueryContext } from '@main/providers/IProvider'

const MANAGEMENT_BASE = 'https://zenmux.ai/api/v1/management'
const SUBSCRIPTION_ENDPOINT = `${MANAGEMENT_BASE}/subscription/detail`
const BALANCE_ENDPOINT = `${MANAGEMENT_BASE}/payg/balance`

/**
 * Normalizes a quota percentage that the API may report either as a 0..1
 * fraction or as a 0..100 percentage.
 *
 * @param value - Raw quota percentage
 * @returns Normalized percentage clamped to 0..100
 */
const normalizedPercent = (value: number | null): number | null => {
  if (value === null) return null
  const percent = Math.abs(value) < 1 ? value * 100 : value
  return Math.min(100, Math.max(0, percent))
}

/**
 * Builds a usage window from a subscription quota payload.
 *
 * @param quota - Raw quota object
 * @param label - Window label
 * @param now - Reference timestamp
 * @returns Usage window or null
 */
const quotaWindow = (
  quota: Record<string, unknown> | null,
  label: string,
  now: Date,
): UsageWindow | null => {
  if (!quota) return null
  const usedPercent = normalizedPercent(getNumber(quota, 'usage_percentage'))
  if (usedPercent === null) return null
  const resetsAtRaw = getString(quota, 'resets_at')
  let resetText: string | null = null
  if (resetsAtRaw) {
    const parsed = new Date(resetsAtRaw)
    if (!Number.isNaN(parsed.getTime())) {
      resetText = resetDuration(parsed.getTime() - now.getTime())
    }
  }
  return { providerName: 'ZenMux', label, usedPercent, resetText }
}

export default class ZenMuxProvider extends BaseApiKeyProvider {
  async query(context: ProviderQueryContext): Promise<MetricResult | BalanceResult | null> {
    const apiKey = this.resolveApiKey(context)
    if (!apiKey) return null
    const now = context.now

    let subscriptionError: unknown = null
    try {
      const document = (await getJsonWithBearer(SUBSCRIPTION_ENDPOINT, apiKey)) as unknown
      if (!document || typeof document !== 'object' || Array.isArray(document)) {
        throw new ProviderError('ZenMux subscription response was not a JSON object.')
      }
      const root = document as Record<string, unknown>
      if (root.success === false) {
        throw new ProviderError('ZenMux subscription response reported failure.')
      }
      const data = getObject(root, 'data')
      if (!data) throw new ProviderError('ZenMux subscription response did not contain data.')
      const plan = getObject(data, 'plan')
      const tier = plan ? getString(plan, 'tier') : null

      const windows: UsageWindow[] = []
      const fiveHour = quotaWindow(getObject(data, 'quota_5_hour'), '5h', now)
      const weekly = quotaWindow(getObject(data, 'quota_7_day'), '7d', now)
      if (fiveHour) windows.push(fiveHour)
      if (weekly) windows.push(weekly)
      if (windows.length === 0) {
        throw new ProviderError(
          'ZenMux subscription response did not contain usable quota windows.',
        )
      }

      let planText: string | null = null
      if (tier && tier.trim() !== '') planText = `${capitalize(tier.trim())} plan`
      try {
        const balanceDocument = (await getJsonWithBearer(BALANCE_ENDPOINT, apiKey)) as unknown
        const balanceData =
          balanceDocument && typeof balanceDocument === 'object' && !Array.isArray(balanceDocument)
            ? getObject(balanceDocument as Record<string, unknown>, 'data')
            : null
        const totalCredits = balanceData ? getNumber(balanceData, 'total_credits') : null
        if (totalCredits !== null) {
          const balanceText = `PAYG ${currency(totalCredits)}`
          planText = planText ? `${planText} · ${balanceText}` : balanceText
        }
      } catch {
        // PAYG balance is optional enrichment; keep the quota windows.
      }

      return { providerName: 'ZenMux', plan: planText, windows }
    } catch (error) {
      subscriptionError = error
    }

    try {
      const document = (await getJsonWithBearer(BALANCE_ENDPOINT, apiKey)) as unknown
      if (!document || typeof document !== 'object' || Array.isArray(document)) {
        throw new ProviderError('ZenMux balance response was not a JSON object.')
      }
      const data = getObject(document as Record<string, unknown>, 'data')
      if (!data) throw new ProviderError('ZenMux balance response did not contain data.')
      const totalCredits = getNumber(data, 'total_credits')
      if (totalCredits === null) {
        throw new ProviderError('ZenMux balance response did not contain data.total_credits.')
      }
      return {
        providerName: 'ZenMux',
        balanceText: currency(totalCredits),
        usdAmount: totalCredits,
      }
    } catch {
      throw subscriptionError instanceof Error
        ? subscriptionError
        : new ProviderError('ZenMux subscription and balance queries failed.')
    }
  }
}
