/**
 * @file ZaiProvider.ts
 * @description Queries Zai (z.ai) usage across token and time limit windows.
 */

import type { MetricResult, UsageWindow } from '@shared/types'
import { getNumber, getString } from '../ProviderJson'
import { getJsonWithBearer, ProviderError } from '../ProviderHttp'
import { resetDuration } from '../UsageFormatting'
import { BaseMetricProvider } from './BaseApiKeyProvider'

const QUOTA_ENDPOINT = 'https://api.z.ai/api/monitor/usage/quota/limit'

const readLimitEntry = (entry: unknown, now: Date): UsageWindow | null => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const record = entry as Record<string, unknown>
  const type = getString(record, 'type') ?? 'Limit'
  const unit = getString(record, 'unit')
  const label = unit && unit.trim() !== '' ? `${type} (${unit})` : type
  const percentage = getNumber(record, 'percentage') ?? getNumber(record, 'remaining_percentage')
  let usedPercent: number | null = null
  if (percentage !== null) {
    usedPercent = 100 - percentage
  } else {
    const usage = getNumber(record, 'usage')
    const number = getNumber(record, 'number')
    if (usage !== null && number !== null && number > 0) {
      usedPercent = (usage / number) * 100
    }
  }
  if (usedPercent === null) return null
  const nextResetTime = getString(record, 'nextResetTime')
  let resetText: string | null = null
  if (nextResetTime) {
    const parsed = new Date(nextResetTime)
    if (!Number.isNaN(parsed.getTime())) {
      resetText = resetDuration(parsed.getTime() - now.getTime())
    }
  }
  return {
    providerName: 'Zai',
    label,
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    resetText,
  }
}

export default class ZaiProvider extends BaseMetricProvider {
  readonly providerName = 'Zai'

  async query(apiKey: string, now: Date): Promise<MetricResult | null> {
    const document = (await getJsonWithBearer(QUOTA_ENDPOINT, apiKey)) as unknown
    const windows: UsageWindow[] = []
    if (Array.isArray(document)) {
      for (const entry of document) {
        const window = readLimitEntry(entry, now)
        if (window) windows.push(window)
      }
    } else if (document && typeof document === 'object') {
      const root = document as Record<string, unknown>
      const data = (root.data as unknown) ?? document
      if (Array.isArray(data)) {
        for (const entry of data) {
          const window = readLimitEntry(entry, now)
          if (window) windows.push(window)
        }
      }
    }
    if (windows.length === 0) {
      throw new ProviderError('Zai response did not contain usable limit entries.')
    }
    return { providerName: 'Zai', plan: null, windows }
  }
}
