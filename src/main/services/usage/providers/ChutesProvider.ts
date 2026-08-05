/**
 * @file ChutesProvider.ts
 * @description Queries Chutes AI service for 4-hour rolling and monthly quota usage.
 */

import type { MetricResult, UsageWindow } from '@shared/types'
import { getNumber } from '../ProviderJson'
import { getJsonWithBearer, ProviderError } from '../ProviderHttp'
import { BaseMetricProvider } from './BaseApiKeyProvider'

const SUBSCRIPTION_USAGE_ENDPOINT = 'https://api.chutes.ai/users/me/subscription_usage'

export default class ChutesProvider extends BaseMetricProvider {
  readonly providerName = 'Chutes'

  async query(apiKey: string, _now: Date): Promise<MetricResult | null> {
    const document = (await getJsonWithBearer(
      SUBSCRIPTION_USAGE_ENDPOINT,
      apiKey,
    )) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('Chutes response was not a JSON object.')
    }
    const root = document as Record<string, unknown>
    const windows: UsageWindow[] = []
    const fourHourPercent =
      getNumber(root, 'usedPercent') ??
      getNumber(root, 'fourHourUsedPercent') ??
      getNumber(root, 'rolling_4h_used')
    const monthlyPercent = getNumber(root, 'monthlyUsedPercent') ?? getNumber(root, 'monthly_used')
    if (fourHourPercent !== null) {
      windows.push({
        providerName: 'Chutes',
        label: '4h Rolling',
        usedPercent: Math.min(100, Math.max(0, fourHourPercent)),
      })
    }
    if (monthlyPercent !== null) {
      windows.push({
        providerName: 'Chutes',
        label: 'Monthly',
        usedPercent: Math.min(100, Math.max(0, monthlyPercent)),
      })
    }
    if (windows.length === 0) {
      throw new ProviderError('Chutes response did not contain usable quota windows.')
    }
    return { providerName: 'Chutes', plan: null, windows }
  }
}
