/**
 * @file ChutesProvider.ts
 * @description Queries Chutes AI quota usage (4-hour rolling and monthly windows), falling back to the per-chute quota endpoints.
 */

import type { MetricResult, UsageWindow } from '@shared/types'
import { getJsonWithBearer, ProviderError } from '../ProviderHttp'
import { resetDuration } from '../UsageFormatting'
import { BaseApiKeyProvider } from '@main/providers/BaseApiKeyProvider'
import type { ProviderQueryContext } from '@main/providers/IProvider'

const API_BASE = 'https://api.chutes.ai'
const SUBSCRIPTION_USAGE_ENDPOINT = `${API_BASE}/users/me/subscription_usage`
const QUOTAS_ENDPOINT = `${API_BASE}/users/me/quotas`
const QUOTA_USAGE_ENDPOINT = `${API_BASE}/users/me/quota_usage`

const ROLLING_WINDOW_MINUTES = 4 * 60
const MONTHLY_WINDOW_MINUTES = 30 * 24 * 60

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Normalizes a property key for case/separator-insensitive lookups. */
const normalizedKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Returns the first property value matching any of the given keys. */
const valueFor = (dict: Record<string, unknown>, keys: string[]): unknown => {
  for (const key of keys) {
    const normalized = normalizedKey(key)
    for (const [candidate, value] of Object.entries(dict)) {
      if (normalizedKey(candidate) === normalized) return value
    }
  }
  return null
}

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const text = value.replace(/,/g, '').replace(/\$/g, '').replace(/%/g, '').trim()
    if (text !== '' && Number.isFinite(Number(text))) return Number(text)
  }
  return null
}

const firstNumber = (dict: Record<string, unknown>, keys: string[]): number | null => {
  const value = valueFor(dict, keys)
  return value === null || value === undefined ? null : asNumber(value)
}

const firstString = (dict: Record<string, unknown>, keys: string[]): string | null => {
  const value = valueFor(dict, keys)
  if (typeof value === 'string') {
    const text = value.trim()
    return text !== '' ? text : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

const firstDictionary = (
  dict: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | null => {
  const value = valueFor(dict, keys)
  return isObject(value) ? value : null
}

const firstDate = (dict: Record<string, unknown>, keys: string[]): Date | null => {
  const value = valueFor(dict, keys)
  if (typeof value === 'number' && value > 0) {
    return new Date(value > 10_000_000_000 ? value : value * 1_000)
  }
  if (typeof value === 'string') {
    const text = value.trim()
    if (text === '') return null
    const numeric = Number(text)
    if (Number.isFinite(numeric) && text !== '' && /^[0-9.+-]+$/.test(text)) {
      return new Date(numeric > 10_000_000_000 ? numeric : numeric * 1_000)
    }
    const parsed = new Date(text)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

/** Normalizes a percent value that may be reported as a 0..1 fraction. */
const normalizedPercent = (value: number | null): number | null => {
  if (value === null) return null
  const percent = Math.abs(value) < 1 ? value * 100 : value
  return Math.min(100, Math.max(0, percent))
}

const LABEL_KEYS = [
  'label',
  'name',
  'title',
  'type',
  'quota_type',
  'quotaType',
  'period',
  'window',
  'window_name',
  'windowName',
  'chute_id',
  'chuteId',
]
const LIMIT_KEYS = [
  'limit',
  'cap',
  'max',
  'maximum',
  'quota',
  'quota_limit',
  'quotaLimit',
  'monthly_cap',
  'monthlyCap',
  'monthly_limit',
  'monthlyLimit',
  'request_limit',
  'requestLimit',
  'token_limit',
  'tokenLimit',
  'hard_limit',
  'hardLimit',
  'total',
]
const USED_KEYS = [
  'used',
  'usage',
  'used_amount',
  'usedAmount',
  'consumed',
  'consumed_amount',
  'consumedAmount',
  'current',
  'current_usage',
  'currentUsage',
  'requests',
  'request_count',
  'requestCount',
  'tokens',
  'token_usage',
  'tokenUsage',
  'monthly_usage',
  'monthlyUsage',
]
const REMAINING_KEYS = [
  'remaining',
  'available',
  'balance',
  'left',
  'remaining_amount',
  'remainingAmount',
  'available_amount',
  'availableAmount',
]
const PERCENT_USED_KEYS = [
  'percent_used',
  'percentUsed',
  'usage_percent',
  'usagePercent',
  'used_percent',
  'usedPercent',
  'utilization',
  'utilization_percent',
  'utilizationPercent',
]
const PERCENT_REMAINING_KEYS = [
  'percent_remaining',
  'percentRemaining',
  'remaining_percent',
  'remainingPercent',
]
const RESET_KEYS = [
  'reset_at',
  'resetAt',
  'resets_at',
  'resetsAt',
  'reset_time',
  'resetTime',
  'next_reset_at',
  'nextResetAt',
  'renews_at',
  'renewsAt',
  'renewal_at',
  'renewalAt',
  'period_end',
  'periodEnd',
  'current_period_end',
  'currentPeriodEnd',
  'expires_at',
  'expiresAt',
  'window_end',
  'windowEnd',
  'end_time',
  'endTime',
]
const UNIT_KEYS = ['unit', 'units', 'currency', 'quota_unit', 'quotaUnit']
const PLAN_KEYS = [
  'plan_name',
  'planName',
  'plan',
  'tier',
  'subscription_plan',
  'subscriptionPlan',
  'subscription_tier',
  'subscriptionTier',
]

const ROLLING_PAYLOAD_KEYS = [
  'rolling',
  'rolling_window',
  'rollingWindow',
  'rolling_4h',
  'rolling4h',
  'four_hour',
  'fourHour',
  'four_hour_usage',
  'fourHourUsage',
  'window_4h',
  'window4h',
]
const MONTHLY_PAYLOAD_KEYS = [
  'monthly',
  'monthly_usage',
  'monthlyUsage',
  'subscription',
  'subscription_usage',
  'subscriptionUsage',
  'billing_period',
  'billingPeriod',
]
const QUOTA_CONTAINER_KEYS = [
  'quotas',
  'quota',
  'quota_usage',
  'quotaUsage',
  'limits',
  'usage',
  'entries',
  'subscription_usage',
  'subscriptionUsage',
]
const SUBSCRIPTION_KEYS = [
  'subscription',
  'subscription_usage',
  'subscriptionUsage',
  'current_subscription',
  'currentSubscription',
  'plan',
]
const WINDOW_MINUTE_KEYS = [
  'window_minutes',
  'windowMinutes',
  'period_minutes',
  'periodMinutes',
  'duration_minutes',
  'durationMinutes',
]
const WINDOW_HOUR_KEYS = [
  'window_hours',
  'windowHours',
  'period_hours',
  'periodHours',
  'duration_hours',
  'durationHours',
]
const WINDOW_DAY_KEYS = [
  'window_days',
  'windowDays',
  'period_days',
  'periodDays',
  'duration_days',
  'durationDays',
]
const WINDOW_SECOND_KEYS = [
  'window_seconds',
  'windowSeconds',
  'period_seconds',
  'periodSeconds',
  'duration_seconds',
  'durationSeconds',
]
const WINDOW_TEXT_KEYS = ['window', 'period', 'interval', 'duration']

const isQuotaPayload = (dict: Record<string, unknown>): boolean =>
  firstNumber(dict, LIMIT_KEYS) !== null ||
  firstNumber(dict, USED_KEYS) !== null ||
  firstNumber(dict, REMAINING_KEYS) !== null ||
  firstNumber(dict, PERCENT_USED_KEYS) !== null ||
  firstNumber(dict, PERCENT_REMAINING_KEYS) !== null

/** Extracts nested quota-like objects from a candidate up to the given depth. */
const extractQuotaObjects = (candidate: unknown, depth: number): Record<string, unknown>[] => {
  if (Array.isArray(candidate)) {
    return candidate.flatMap((item) => extractQuotaObjects(item, depth))
  }
  if (!isObject(candidate) || depth <= 0) return []
  const results: Record<string, unknown>[] = isQuotaPayload(candidate) ? [candidate] : []
  for (const value of Object.values(candidate)) {
    results.push(...extractQuotaObjects(value, depth - 1))
  }
  return results
}

/**
 * Resolves the window duration from a quota payload.
 *
 * @param payload - Quota payload
 * @returns Window duration in minutes or null
 */
const windowMinutesOf = (payload: Record<string, unknown>): number | null => {
  const minutes = firstNumber(payload, WINDOW_MINUTE_KEYS)
  if (minutes !== null && minutes > 0) return Math.round(minutes)
  const hours = firstNumber(payload, WINDOW_HOUR_KEYS)
  if (hours !== null && hours > 0) return Math.round(hours * 60)
  const days = firstNumber(payload, WINDOW_DAY_KEYS)
  if (days !== null && days > 0) return Math.round(days * 24 * 60)
  const seconds = firstNumber(payload, WINDOW_SECOND_KEYS)
  if (seconds !== null && seconds > 0) return Math.round(seconds / 60)
  const text = firstString(payload, WINDOW_TEXT_KEYS)
  if (text) {
    const match =
      /^(\d+(?:\.\d+)?)\s*(min|minute|minutes|m|h|hour|hours|d|day|days|mo|month|months)?$/.exec(
        text.trim().toLowerCase(),
      )
    if (match) {
      const value = Number(match[1])
      const unit = match[2] ?? ''
      if (unit.startsWith('mo') || unit === 'month' || unit === 'months')
        return Math.round(value * 30 * 24 * 60)
      if (unit === 'd' || unit === 'day' || unit === 'days') return Math.round(value * 24 * 60)
      if (unit === 'h' || unit === 'hour' || unit === 'hours') return Math.round(value * 60)
      return Math.round(value)
    }
  }
  return null
}

/**
 * Classifies a quota window as rolling or monthly based on its label and duration.
 *
 * @param label - Window label
 * @param windowMinutes - Window duration in minutes
 * @returns 'rolling', 'monthly', or null
 */
const windowKind = (
  label: string | null,
  windowMinutes: number | null,
): 'rolling' | 'monthly' | null => {
  const text = (label ?? '').toLowerCase()
  if (
    text.includes('rolling') ||
    text.includes('4h') ||
    text.includes('4 h') ||
    text.includes('4-hour') ||
    text.includes('four hour') ||
    windowMinutes === ROLLING_WINDOW_MINUTES
  ) {
    return 'rolling'
  }
  if (
    text.includes('month') ||
    text.includes('billing') ||
    text.includes('subscription') ||
    (windowMinutes ?? 0) >= 28 * 24 * 60
  ) {
    return 'monthly'
  }
  return null
}

/**
 * Parses a quota payload into a usage window.
 *
 * @param payload - Quota payload
 * @param defaultLabel - Fallback label
 * @param defaultWindowMinutes - Fallback window duration
 * @param now - Reference timestamp
 * @returns Usage window or null
 */
const parseQuota = (
  payload: Record<string, unknown>,
  defaultLabel: string | null,
  defaultWindowMinutes: number | null,
  now: Date,
): UsageWindow | null => {
  const label = firstString(payload, LABEL_KEYS) ?? defaultLabel
  const limit = firstNumber(payload, LIMIT_KEYS)
  const used = firstNumber(payload, USED_KEYS)
  const remaining = firstNumber(payload, REMAINING_KEYS)

  let usedPercent = normalizedPercent(firstNumber(payload, PERCENT_USED_KEYS))
  if (usedPercent === null) {
    const remainingPercent = normalizedPercent(firstNumber(payload, PERCENT_REMAINING_KEYS))
    if (remainingPercent !== null) usedPercent = 100 - remainingPercent
  }
  if (usedPercent === null) {
    const resolvedLimit = limit ?? (used !== null && remaining !== null ? used + remaining : null)
    const resolvedUsed =
      used ?? (resolvedLimit !== null && remaining !== null ? resolvedLimit - remaining : null)
    if (resolvedUsed !== null && resolvedLimit !== null && resolvedLimit > 0) {
      usedPercent = Math.min(100, Math.max(0, (resolvedUsed / resolvedLimit) * 100))
    }
  }
  if (usedPercent === null) return null

  const windowMinutes = windowMinutesOf(payload) ?? defaultWindowMinutes
  const resetsAt = firstDate(payload, RESET_KEYS)
  const unit = firstString(payload, UNIT_KEYS)
  const displayLabel = label ?? (unit ? `${windowMinutes ?? 0}m quota` : 'Quota')

  return {
    providerName: 'Chutes',
    label: displayLabel,
    usedPercent,
    resetText: resetsAt !== null ? resetDuration(resetsAt.getTime() - now.getTime()) : null,
  }
}

interface ChutesSnapshot {
  rolling: UsageWindow | null
  monthly: UsageWindow | null
  fallback: UsageWindow[]
  plan: string | null
}

/**
 * Parses a Chutes usage document into rolling/monthly windows plus extras.
 *
 * @param document - Parsed JSON document
 * @param now - Reference timestamp
 * @returns Structured snapshot
 */
const parseSnapshot = (document: unknown, now: Date): ChutesSnapshot => {
  const root = isObject(document) ? document : Array.isArray(document) ? { quotas: document } : {}
  const dataRoot = firstDictionary(root, ['data', 'result']) ?? root
  const subscription =
    firstDictionary(root, SUBSCRIPTION_KEYS) ?? firstDictionary(dataRoot, SUBSCRIPTION_KEYS)

  const rollingPayload =
    firstDictionary(root, ROLLING_PAYLOAD_KEYS) ?? firstDictionary(dataRoot, ROLLING_PAYLOAD_KEYS)
  const monthlyPayload =
    firstDictionary(root, MONTHLY_PAYLOAD_KEYS) ?? firstDictionary(dataRoot, MONTHLY_PAYLOAD_KEYS)

  const explicitRolling = rollingPayload
    ? parseQuota(rollingPayload, '4h Rolling', ROLLING_WINDOW_MINUTES, now)
    : null
  const explicitMonthly = monthlyPayload
    ? parseQuota(monthlyPayload, 'Monthly', MONTHLY_WINDOW_MINUTES, now)
    : null

  const quotaObjects: Record<string, unknown>[] = []
  const seen = new Set<string>()
  for (const containerKey of QUOTA_CONTAINER_KEYS) {
    const container = valueFor(root, [containerKey]) ?? valueFor(dataRoot, [containerKey])
    for (const candidate of [container, dataRoot, root]) {
      for (const object of extractQuotaObjects(candidate, 3)) {
        const signature = JSON.stringify(object)
        if (seen.has(signature)) continue
        seen.add(signature)
        quotaObjects.push(object)
      }
    }
  }

  const quotaWindows = quotaObjects
    .map((object) => parseQuota(object, null, null, now))
    .filter((window): window is UsageWindow => window !== null)

  const classifiedRolling =
    explicitRolling ??
    quotaWindows.find((window) => windowKind(window.label, null) === 'rolling') ??
    null
  const classifiedMonthly =
    explicitMonthly ??
    quotaWindows.find((window) => windowKind(window.label, null) === 'monthly') ??
    null

  const fallback = quotaWindows.filter(
    (window) => window !== classifiedRolling && window !== classifiedMonthly,
  )

  const plan =
    firstString(root, PLAN_KEYS) ??
    firstString(dataRoot, PLAN_KEYS) ??
    (subscription ? firstString(subscription, PLAN_KEYS) : null)

  return { rolling: classifiedRolling, monthly: classifiedMonthly, fallback, plan }
}

/**
 * Fetches the per-chute quota definitions and enriches them with usage payloads.
 *
 * @param apiKey - Chutes API key
 * @param now - Reference timestamp
 * @returns Structured quota snapshot or null when no definitions exist
 */
const fetchQuotaSnapshot = async (apiKey: string, now: Date): Promise<ChutesSnapshot | null> => {
  const document = (await getJsonWithBearer(QUOTAS_ENDPOINT, apiKey)) as unknown
  const root = isObject(document) ? document : Array.isArray(document) ? { quotas: document } : {}
  const definitions: Record<string, unknown>[] = []
  const rawDefinitions = valueFor(root, ['quotas', 'data', 'result']) ?? root
  if (Array.isArray(rawDefinitions)) {
    for (const item of rawDefinitions) {
      if (isObject(item)) definitions.push(item)
    }
  }

  const enriched: Record<string, unknown>[] = []
  for (const definition of definitions) {
    const identifier = firstString(definition, ['chute_id', 'chuteId', 'id'])
    if (!identifier) {
      enriched.push(definition)
      continue
    }
    try {
      const usageDocument = (await getJsonWithBearer(
        `${QUOTA_USAGE_ENDPOINT}/${encodeURIComponent(identifier)}`,
        apiKey,
      )) as unknown
      const usage = isObject(usageDocument)
        ? (firstDictionary(usageDocument, ['data', 'result']) ?? usageDocument)
        : null
      if (usage) {
        enriched.push({ ...definition, ...usage })
        continue
      }
    } catch {
      // Unusable chute usage is ignored; the definition alone may still parse.
    }
    enriched.push(definition)
  }

  const windows = enriched
    .map((object) => parseQuota(object, null, null, now))
    .filter((window): window is UsageWindow => window !== null)
  if (windows.length === 0) return null

  const rolling = windows.find((window) => windowKind(window.label, null) === 'rolling') ?? null
  const monthly = windows.find((window) => windowKind(window.label, null) === 'monthly') ?? null
  const fallback = windows.filter((window) => window !== rolling && window !== monthly)
  return { rolling, monthly, fallback, plan: null }
}

export default class ChutesProvider extends BaseApiKeyProvider {
  async query(context: ProviderQueryContext): Promise<MetricResult | null> {
    const apiKey = this.resolveApiKey(context)
    if (!apiKey) return null
    const now = context.now

    const document = (await getJsonWithBearer(SUBSCRIPTION_USAGE_ENDPOINT, apiKey)) as unknown
    if (!document || (typeof document !== 'object' && !Array.isArray(document))) {
      throw new ProviderError('Chutes response was not a JSON document.')
    }
    const snapshot = parseSnapshot(document, now)

    let merged = snapshot
    if (snapshot.rolling === null || snapshot.monthly === null) {
      try {
        const quota = await fetchQuotaSnapshot(apiKey, now)
        if (quota) {
          merged = {
            rolling: snapshot.rolling ?? quota.rolling,
            monthly: snapshot.monthly ?? quota.monthly,
            fallback: [...quota.fallback, ...snapshot.fallback],
            plan: snapshot.plan ?? quota.plan,
          }
        }
      } catch {
        // The quota endpoints are an enrichment path; subscription data still stands.
      }
    }

    const windows: UsageWindow[] = []
    if (merged.rolling) windows.push(merged.rolling)
    if (merged.monthly) windows.push(merged.monthly)
    windows.push(...merged.fallback)

    if (windows.length === 0) {
      throw new ProviderError('Chutes response did not contain usable quota windows.')
    }
    return { providerName: 'Chutes', plan: merged.plan, windows }
  }
}
