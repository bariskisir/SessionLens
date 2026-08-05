/**
 * @file SyntheticProvider.ts
 * @description Queries Synthetic quota usage across rolling-5h, weekly, and search-hourly windows.
 */

import type { MetricResult, UsageWindow } from '@shared/types'
import { getNumber, getString } from '../ProviderJson'
import { getJsonWithBearer, ProviderError } from '../ProviderHttp'
import { resetDuration } from '../UsageFormatting'
import { BaseMetricProvider } from './BaseApiKeyProvider'

const QUOTAS_ENDPOINT = 'https://api.synthetic.new/v2/quotas'

const readQuotaWindow = (quota: unknown, now: Date): UsageWindow | null => {
  if (!quota || typeof quota !== 'object' || Array.isArray(quota)) return null
  const entry = quota as Record<string, unknown>
  const usedPercent = getNumber(entry, 'usedPercent')
  if (usedPercent === null) return null
  const label = getString(entry, 'label') ?? 'Quota'
  const windowMinutes = getNumber(entry, 'windowMinutes')
  const resetsAt = getString(entry, 'resetsAt')
  let resetText: string | null = null
  if (resetsAt) {
    const parsed = new Date(resetsAt)
    if (!Number.isNaN(parsed.getTime())) {
      resetText = resetDuration(parsed.getTime() - now.getTime())
    }
  } else if (windowMinutes !== null && windowMinutes > 0) {
    resetText = `${Math.round(windowMinutes)}m window`
  }
  return {
    providerName: 'Synthetic',
    label,
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    resetText,
  }
}

export default class SyntheticProvider extends BaseMetricProvider {
  readonly providerName = 'Synthetic'

  async query(apiKey: string, now: Date): Promise<MetricResult | null> {
    const document = (await getJsonWithBearer(QUOTAS_ENDPOINT, apiKey)) as unknown
    const windows: UsageWindow[] = []
    if (Array.isArray(document)) {
      for (const quota of document) {
        const window = readQuotaWindow(quota, now)
        if (window) windows.push(window)
      }
    } else if (document && typeof document === 'object') {
      for (const value of Object.values(document as Record<string, unknown>)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const window = readQuotaWindow(value, now)
          if (window) windows.push(window)
        }
      }
    }
    if (windows.length === 0) {
      throw new ProviderError('Synthetic response did not contain usable quota windows.')
    }
    return { providerName: 'Synthetic', plan: null, windows }
  }
}
