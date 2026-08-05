/**
 * @file CopilotProvider.ts
 * @description Queries GitHub Copilot usage across premium request interactions and real-time chat quota windows.
 */

import type { MetricResult, UsageWindow } from '@shared/types'
import { getNumber, getObject, getString } from '../ProviderJson'
import { getJsonWithHeaders, ProviderError } from '../ProviderHttp'
import { capitalize, resetDuration } from '../UsageFormatting'
import { BaseMetricProvider } from './BaseApiKeyProvider'

const COPILOT_ENDPOINT = 'https://api.github.com/copilot_internal/user'

const requestLimitWindow = (
  root: Record<string, unknown>,
  now: Date,
): UsageWindow | null => {
  const interactions = getObject(root, 'interaction_tracker_limit')
  if (!interactions) return null
  const usage = getNumber(interactions, 'usage_stats_usage_in_window')
  const limit = getNumber(interactions, 'maximum_limit')
  if (usage === null || limit === null || limit <= 0) return null
  const resetAt = getString(interactions, 'next_limit_reset')
  const usedPercent = (usage / limit) * 100
  let resetText: string | null = null
  if (resetAt) {
    const parsed = new Date(resetAt)
    if (!Number.isNaN(parsed.getTime())) {
      resetText = resetDuration(parsed.getTime() - now.getTime())
    }
  }
  return {
    providerName: 'Copilot',
    label: 'Requests',
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    resetText,
  }
}

const readQuotaWindow = (
  quota: unknown,
  now: Date,
): UsageWindow | null => {
  if (!quota || typeof quota !== 'object' || Array.isArray(quota)) return null
  const entry = quota as Record<string, unknown>
  const remaining = getNumber(entry, 'remaining')
  const total = getNumber(entry, 'total')
  if (remaining === null || total === null || total <= 0) return null
  const usedPercent = ((total - remaining) / total) * 100
  const resetEpoch = getNumber(entry, 'nextResetEpochMs')
  let resetText: string | null = null
  if (resetEpoch !== null) {
    resetText = resetDuration(resetEpoch - now.getTime())
  }
  return {
    providerName: 'Copilot',
    label: 'Chat',
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    resetText,
  }
}

export default class CopilotProvider extends BaseMetricProvider {
  readonly providerName = 'Copilot'

  async query(apiKey: string, now: Date): Promise<MetricResult | null> {
    const document = (await getJsonWithHeaders(
      COPILOT_ENDPOINT,
      { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    )) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('Copilot response was not a JSON object.')
    }
    const root = document as Record<string, unknown>
    const windows: UsageWindow[] = []
    const request = requestLimitWindow(root, now)
    if (request) windows.push(request)
    const quotasArray = getObject(root, 'copilot_chat_real_time_quota') ?? getObject(root, 'copilot_chat_quota')
    if (quotasArray) {
      const quotaWindow = readQuotaWindow(quotasArray, now)
      if (quotaWindow) windows.push(quotaWindow)
    }
    const plan = capitalize(getString(root, 'copilot_plan_type') ?? '')
    if (windows.length === 0) {
      throw new ProviderError('Copilot response did not contain usable rate limit windows.')
    }
    return { providerName: 'Copilot', plan: plan || null, windows }
  }
}
