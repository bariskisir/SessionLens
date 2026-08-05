/**
 * @file CodebuffProvider.ts
 * @description Queries Codebuff quota usage as a single Quota window via the usage API.
 */

import type { MetricResult, UsageWindow } from '@shared/types'
import { getNumber, getString } from '../ProviderJson'
import { postJsonWithHeaders, ProviderError } from '../ProviderHttp'
import { resetDuration } from '../UsageFormatting'
import { BaseApiKeyProvider } from '@main/providers/BaseApiKeyProvider'
import type { ProviderQueryContext } from '@main/providers/IProvider'

const USAGE_ENDPOINT = 'https://www.codebuff.com/api/v1/usage'

export default class CodebuffProvider extends BaseApiKeyProvider {
  async query(context: ProviderQueryContext): Promise<MetricResult | null> {
    const apiKey = this.resolveApiKey(context)
    if (!apiKey) return null
    const now = context.now

    const document = (await postJsonWithHeaders(
      USAGE_ENDPOINT,
      { fingerprintId: 'sessionlens-usage' },
      { Authorization: `Bearer ${apiKey}` },
    )) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('Codebuff response was not a JSON object.')
    }
    const root = document as Record<string, unknown>
    const usage = getNumber(root, 'usage')
    const quota = getNumber(root, 'quota')
    if (usage === null || quota === null || quota <= 0) {
      throw new ProviderError('Codebuff response did not contain usable usage and quota.')
    }
    const usedPercent = (usage / quota) * 100
    const nextReset = getString(root, 'next_quota_reset')
    let resetText: string | null = null
    if (nextReset) {
      const parsed = new Date(nextReset)
      if (!Number.isNaN(parsed.getTime())) {
        resetText = resetDuration(parsed.getTime() - now.getTime())
      }
    }
    const remainingBalance = getNumber(root, 'remainingBalance')
    const plan = remainingBalance !== null ? `Balance ${remainingBalance.toFixed(2)}` : null
    const window: UsageWindow = {
      providerName: 'Codebuff',
      label: 'Quota',
      usedPercent: Math.min(100, Math.max(0, usedPercent)),
      resetText,
    }
    return { providerName: 'Codebuff', plan, windows: [window] }
  }
}
