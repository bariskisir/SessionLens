/**
 * @file AlibabaProvider.ts
 * @description Queries Alibaba Coding Plan quota usage across per-5h, per-week, and per-month windows.
 */

import type { MetricResult, UsageWindow } from '@shared/types'
import { getArray, getNumber, getString } from '../ProviderJson'
import { postJsonWithHeaders, ProviderError } from '../ProviderHttp'
import { resetDuration } from '../UsageFormatting'
import { BaseMetricProvider } from './BaseApiKeyProvider'

const ENDPOINT =
  'https://modelstudio.console.alibabacloud.com/data/api.json?action=zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2&product=broadscope-bailian&api=queryCodingPlanInstanceInfoV2&currentRegionId=ap-southeast-1'

const alibabaHeaders = (apiKey: string): Record<string, string> => ({
  Authorization: `Bearer ${apiKey}`,
  'x-api-key': apiKey,
  'X-DashScope-API-Key': apiKey,
  Accept: 'application/json',
})

const readQuotaWindow = (quota: unknown, now: Date): UsageWindow | null => {
  if (!quota || typeof quota !== 'object' || Array.isArray(quota)) return null
  const entry = quota as Record<string, unknown>
  const usedAmount = getNumber(entry, 'usedAmount')
  const usagePercent = getNumber(entry, 'usagePercent')
  const usedPercent = usedAmount ?? usagePercent
  if (usedPercent === null) return null
  const label = getString(entry, 'windowType') ?? 'Quota'
  let resetText: string | null = null
  const resetAt = getString(entry, 'nextResetAt')
  if (resetAt) {
    const parsed = new Date(resetAt)
    if (!Number.isNaN(parsed.getTime())) {
      resetText = resetDuration(parsed.getTime() - now.getTime())
    }
  }
  return {
    providerName: 'Alibaba',
    label,
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    resetText,
  }
}

export default class AlibabaProvider extends BaseMetricProvider {
  readonly providerName = 'Alibaba'

  async query(apiKey: string, now: Date): Promise<MetricResult | null> {
    const document = (await postJsonWithHeaders(
      ENDPOINT,
      {},
      alibabaHeaders(apiKey),
    )) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('Alibaba response was not a JSON object.')
    }
    const root = document as Record<string, unknown>
    const windows: UsageWindow[] = []
    const quotas = getArray(root, 'codingPlanQuotaWindows') ?? getArray(root, 'quotaWindows') ?? getArray(root, 'data')
    if (quotas) {
      for (const quota of quotas) {
        const window = readQuotaWindow(quota, now)
        if (window) windows.push(window)
      }
    }
    if (windows.length === 0) {
      throw new ProviderError('Alibaba response did not contain usable quota windows.')
    }
    return { providerName: 'Alibaba', plan: null, windows }
  }
}
