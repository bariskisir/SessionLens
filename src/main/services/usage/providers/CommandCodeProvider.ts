/**
 * @file CommandCodeProvider.ts
 * @description Queries Command Code usage across Session (five-hour) and Weekly rate-limit windows.
 */

import type { MetricResult, UsageWindow } from '@shared/types'
import { getNumber, getObject, getString } from '../ProviderJson'
import { getJsonWithBearer, ProviderError } from '../ProviderHttp'
import { capitalize, resetDuration } from '../UsageFormatting'
import { BaseApiKeyProvider } from '@main/providers/BaseApiKeyProvider'
import type { ProviderQueryContext } from '@main/providers/IProvider'

const SUBSCRIPTION_ENDPOINT = 'https://api.commandcode.ai/alpha/billing/subscriptions'
const CREDITS_ENDPOINT = 'https://api.commandcode.ai/alpha/billing/credits'

const readWindow = (
  windowLimits: Record<string, unknown> | null,
  key: string,
  label: string,
  now: Date,
): UsageWindow | null => {
  const window = windowLimits ? getObject(windowLimits, key) : null
  if (!window) return null
  const used = getNumber(window, 'used') ?? 0
  const cap = getNumber(window, 'cap') ?? 0
  if (cap <= 0) return null
  const resetAtMs = getNumber(window, 'resetAt')
  let resetText: string | null = null
  if (resetAtMs !== null && resetAtMs > 0) {
    const resetTime = new Date(resetAtMs)
    resetText = resetDuration(resetTime.getTime() - now.getTime())
  }
  return {
    providerName: 'Command Code',
    label,
    usedPercent: Math.min(100, Math.max(0, (used / cap) * 100)),
    resetText,
  }
}

const planLabel = (planId: string | null): string | null => {
  if (!planId || planId.trim() === '') return null
  const normalized = planId.trim().toLowerCase()
  const labels: Record<string, string> = {
    'individual-go': 'Go',
    individual: 'Individual',
    pro: 'Pro',
    team: 'Team',
    enterprise: 'Enterprise',
    free: 'Free',
  }
  return labels[normalized] ?? capitalize(normalized)
}

export default class CommandCodeProvider extends BaseApiKeyProvider {
  async query(context: ProviderQueryContext): Promise<MetricResult | null> {
    const apiKey = this.resolveApiKey(context)
    if (!apiKey) return null
    const now = context.now

    const [subscriptionDocument, creditsDocument] = await Promise.all([
      getJsonWithBearer(SUBSCRIPTION_ENDPOINT, apiKey).catch(() => null),
      getJsonWithBearer(CREDITS_ENDPOINT, apiKey),
    ])

    let plan: string | null = null
    if (subscriptionDocument && typeof subscriptionDocument === 'object') {
      const data = getObject(subscriptionDocument as Record<string, unknown>, 'data')
      if (data) plan = planLabel(getString(data, 'planId'))
    }

    if (!creditsDocument || typeof creditsDocument !== 'object' || Array.isArray(creditsDocument)) {
      throw new ProviderError('Command Code credits response was not a JSON object.')
    }
    const root = creditsDocument as Record<string, unknown>
    const windowLimits = getObject(root, 'windowLimits')
    const session = readWindow(windowLimits, 'fiveHour', 'Session', now)
    const weekly = readWindow(windowLimits, 'weekly', 'Weekly', now)
    const windows: UsageWindow[] = []
    if (session) windows.push(session)
    if (weekly) windows.push(weekly)
    if (windows.length === 0) {
      throw new ProviderError('Command Code response did not contain usable rate limit windows.')
    }
    return { providerName: 'Command Code', plan, windows }
  }
}
