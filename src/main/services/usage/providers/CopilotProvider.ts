/**
 * @file CopilotProvider.ts
 * @description Queries GitHub Copilot usage from premium request interaction and chat quota snapshots.
 */

import type { MetricResult, UsageWindow } from '@shared/types'
import { getBoolean, getNumber, getObject, getString } from '../ProviderJson'
import { getJsonWithHeaders, ProviderError } from '../ProviderHttp'
import { capitalize, resetDuration } from '../UsageFormatting'
import { BaseApiKeyProvider } from '@main/providers/BaseApiKeyProvider'
import type { ProviderQueryContext } from '@main/providers/IProvider'

const COPILOT_ENDPOINT = 'https://api.github.com/copilot_internal/user'

interface QuotaSnapshot {
  percentRemaining: number | null
  hasPercentRemaining: boolean
  unlimited: boolean
}

/**
 * Parses a quota snapshot object into its usable fields.
 *
 * @param value - Raw quota snapshot value
 * @returns Structured snapshot or null
 */
const readSnapshot = (value: unknown): QuotaSnapshot | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const percentRemaining = getNumber(record, 'percent_remaining')
  return {
    percentRemaining,
    hasPercentRemaining: getBoolean(record, 'has_percent_remaining') || percentRemaining !== null,
    unlimited: getBoolean(record, 'unlimited'),
  }
}

/**
 * Builds a quota snapshot from monthly/limited quota counters when the
 * direct quota snapshots are missing or unusable.
 *
 * @param monthly - Monthly allowance counter
 * @param limited - Remaining counter
 * @returns Derived snapshot or null
 */
const snapshotFromCounters = (
  monthly: number | null,
  limited: number | null,
): QuotaSnapshot | null => {
  if (monthly === null || limited === null || monthly <= 0) return null
  const percentRemaining = Math.max(0, Math.min(100, (Math.max(0, limited) / monthly) * 100))
  return { percentRemaining, hasPercentRemaining: true, unlimited: false }
}

/**
 * Resolves the usable quota snapshots from the root document: direct
 * `quota_snapshots` first, then `monthly_quotas`/`limited_user_quotas` counters.
 *
 * @param root - Copilot usage root document
 * @returns Premium and chat snapshots
 */
const resolveSnapshots = (
  root: Record<string, unknown>,
): { premium: QuotaSnapshot | null; chat: QuotaSnapshot | null } => {
  const monthlyQuotas = getObject(root, 'monthly_quotas')
  const limitedQuotas = getObject(root, 'limited_user_quotas')
  const monthlyPremium = monthlyQuotas !== null ? getNumber(monthlyQuotas, 'completions') : null
  const limitedPremium = limitedQuotas !== null ? getNumber(limitedQuotas, 'completions') : null
  const monthlyChat = monthlyQuotas !== null ? getNumber(monthlyQuotas, 'chat') : null
  const limitedChat = limitedQuotas !== null ? getNumber(limitedQuotas, 'chat') : null

  let directPremium: QuotaSnapshot | null = null
  let directChat: QuotaSnapshot | null = null
  const snapshots = getObject(root, 'quota_snapshots')
  if (snapshots) {
    directPremium = readSnapshot(snapshots.premium_interactions)
    directChat = readSnapshot(snapshots.chat)
    if (!directPremium || !directChat) {
      // Fall back to scanning unknown keys when the API renames the quota fields.
      let firstUsable: QuotaSnapshot | null = null
      for (const [key, value] of Object.entries(snapshots)) {
        if (key === 'premium_interactions' || key === 'chat') continue
        const snapshot = readSnapshot(value)
        if (!snapshot) continue
        if (firstUsable === null) firstUsable = snapshot
        const name = key.toLowerCase()
        if (!directChat && name.includes('chat')) {
          directChat = snapshot
          continue
        }
        if (
          !directPremium &&
          (name.includes('premium') || name.includes('completion') || name.includes('code'))
        ) {
          directPremium = snapshot
        }
      }
      if (!directPremium && !directChat) directChat = firstUsable
    }
  }

  const usable = (snapshot: QuotaSnapshot | null): QuotaSnapshot | null =>
    snapshot?.hasPercentRemaining && !snapshot.unlimited ? snapshot : null

  const fallbackPremium = snapshotFromCounters(monthlyPremium, limitedPremium)
  const fallbackChat = snapshotFromCounters(monthlyChat, limitedChat)

  const prefer = (
    direct: QuotaSnapshot | null,
    fallback: QuotaSnapshot | null,
  ): QuotaSnapshot | null => {
    if (direct?.unlimited) return usable(fallback)
    return usable(direct) ?? usable(fallback)
  }

  return { premium: prefer(directPremium, fallbackPremium), chat: prefer(directChat, fallbackChat) }
}

/**
 * Builds a usage window from a quota snapshot with the given label and reset time.
 *
 * @param label - Window label
 * @param snapshot - Quota snapshot
 * @param now - Reference timestamp
 * @param resetsAt - Reset timestamp
 * @returns Usage window or null when the snapshot is unusable
 */
const windowFromSnapshot = (
  label: string,
  snapshot: QuotaSnapshot | null,
  now: Date,
  resetsAt: Date | null,
): UsageWindow | null => {
  if (!snapshot?.hasPercentRemaining || snapshot.unlimited) return null
  if (snapshot.percentRemaining === null) return null
  const usedPercent = Math.min(100, Math.max(0, 100 - snapshot.percentRemaining))
  return {
    providerName: 'Copilot',
    label,
    usedPercent,
    resetText: resetsAt !== null ? resetDuration(resetsAt.getTime() - now.getTime()) : null,
  }
}

export default class CopilotProvider extends BaseApiKeyProvider {
  async query(context: ProviderQueryContext): Promise<MetricResult | null> {
    const apiKey = this.resolveApiKey(context)
    if (!apiKey) return null
    const now = context.now

    const document = (await getJsonWithHeaders(COPILOT_ENDPOINT, {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    })) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('Copilot response was not a JSON object.')
    }
    const root = document as Record<string, unknown>

    const resetRaw = getString(root, 'quota_reset_date')
    let resetsAt: Date | null = null
    if (resetRaw && resetRaw.trim() !== '') {
      const parsed = new Date(resetRaw)
      if (!Number.isNaN(parsed.getTime())) resetsAt = parsed
    }

    const { premium, chat } = resolveSnapshots(root)
    const windows: UsageWindow[] = []
    const premiumWindow = windowFromSnapshot('Premium', premium, now, resetsAt)
    const chatWindow = windowFromSnapshot('Chat', chat, now, resetsAt)
    if (premiumWindow) windows.push(premiumWindow)
    if (chatWindow) windows.push(chatWindow)

    const plan = capitalize(
      getString(root, 'copilot_plan') ?? getString(root, 'copilot_plan_type') ?? '',
    )

    if (windows.length === 0) {
      const tokenBasedBilling = getBoolean(root, 'token_based_billing')
      const hasUnlimitedQuota = premium?.unlimited === true || chat?.unlimited === true
      if (tokenBasedBilling || hasUnlimitedQuota) {
        // Token-based billing and unlimited plans are not metered windows;
        // surface the plan without fake usage.
        return { providerName: 'Copilot', plan: plan || null, windows: [] }
      }
      throw new ProviderError('Copilot response did not contain usable quota windows.')
    }
    return { providerName: 'Copilot', plan: plan || null, windows }
  }
}
