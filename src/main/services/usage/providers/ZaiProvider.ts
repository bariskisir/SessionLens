/**
 * @file ZaiProvider.ts
 * @description Queries Zai (z.ai) usage across token and time limit windows.
 */

import type { MetricResult, UsageWindow } from '@shared/types'
import { getNumber, getString } from '../ProviderJson'
import { getJsonWithBearer, ProviderError } from '../ProviderHttp'
import { resetDuration } from '../UsageFormatting'
import { BaseApiKeyProvider } from '@main/providers/BaseApiKeyProvider'
import type { ProviderQueryContext } from '@main/providers/IProvider'

const QUOTA_ENDPOINT = 'https://api.z.ai/api/monitor/usage/quota/limit'

/** Zai limit unit enum values mapped to their minute durations. */
const UNIT_MINUTES: Record<number, number> = {
  1: 24 * 60,
  3: 60,
  5: 1,
  6: 7 * 24 * 60,
}

/** Zai limit unit enum values mapped to display labels. */
const UNIT_LABELS: Record<number, string> = {
  1: 'day',
  3: 'hour',
  5: 'minute',
  6: 'week',
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

interface ZaiLimitEntry {
  type: string
  unit: number
  number: number
  usage: number | null
  currentValue: number | null
  remaining: number | null
  percentage: number | null
  nextResetTime: number | null
}

/**
 * Parses a raw limit entry, deriving the used percentage from usage/remaining
 * first and treating the raw API percentage as an already-used percentage.
 *
 * @param record - Raw limit entry object
 * @returns Structured limit entry or null when the type is unknown
 */
const readLimitEntry = (record: Record<string, unknown>): ZaiLimitEntry | null => {
  const type = getString(record, 'type')
  if (type !== 'TOKENS_LIMIT' && type !== 'TIME_LIMIT') return null
  const unitRaw = getNumber(record, 'unit')
  const unit = unitRaw !== null && unitRaw in UNIT_MINUTES ? Math.trunc(unitRaw) : 0
  return {
    type,
    unit,
    number: getNumber(record, 'number') ?? 0,
    usage: getNumber(record, 'usage'),
    currentValue: getNumber(record, 'currentValue'),
    remaining: getNumber(record, 'remaining'),
    percentage: getNumber(record, 'percentage'),
    nextResetTime: getNumber(record, 'nextResetTime'),
  }
}

/**
 * Computes the used percentage for a limit entry, preferring a value derived
 * from the usage/remaining counters over the raw API percentage.
 *
 * @param entry - Structured limit entry
 * @returns Used percentage clamped to 0..100, or null when unknown
 */
const usedPercentOf = (entry: ZaiLimitEntry): number | null => {
  const clamp = (value: number): number => Math.min(100, Math.max(0, value))
  if (entry.usage !== null && entry.usage > 0) {
    let used: number | null = null
    if (entry.remaining !== null) {
      const usedFromRemaining = entry.usage - entry.remaining
      used =
        entry.currentValue !== null
          ? Math.max(usedFromRemaining, entry.currentValue)
          : usedFromRemaining
    } else if (entry.currentValue !== null) {
      used = entry.currentValue
    }
    if (used !== null) return clamp((Math.max(0, Math.min(entry.usage, used)) / entry.usage) * 100)
  }
  if (entry.percentage === null) return null
  return clamp(entry.percentage)
}

/**
 * Resolves the minutes for a limit entry's window, or null when unknown.
 *
 * @param entry - Structured limit entry
 * @returns Window duration in minutes or null
 */
const windowMinutesOf = (entry: ZaiLimitEntry): number | null => {
  if (entry.number <= 0) return null
  const unitMinutes = UNIT_MINUTES[entry.unit]
  return unitMinutes !== undefined ? entry.number * unitMinutes : null
}

/**
 * Builds the tooltip label for a limit entry from its window description.
 *
 * @param entry - Structured limit entry
 * @returns Display label string
 */
const labelOf = (entry: ZaiLimitEntry): string => {
  if (entry.type === 'TIME_LIMIT') return 'MCP'
  const unitLabel = UNIT_LABELS[entry.unit]
  if (entry.number === 5 && unitLabel === 'hour') return '5-hour'
  if (unitLabel && entry.number > 0) {
    const suffix = entry.number === 1 ? unitLabel : `${unitLabel}s`
    return `${entry.number} ${suffix} window`
  }
  return 'Tokens'
}

/**
 * Reads the reset countdown text from a limit entry's epoch-millisecond timestamp.
 *
 * @param entry - Structured limit entry
 * @param now - Reference timestamp
 * @returns Countdown text or null
 */
const resetTextOf = (entry: ZaiLimitEntry, now: Date): string | null => {
  if (entry.nextResetTime === null || entry.nextResetTime <= 0) return null
  return resetDuration(entry.nextResetTime - now.getTime())
}

export default class ZaiProvider extends BaseApiKeyProvider {
  async query(context: ProviderQueryContext): Promise<MetricResult | null> {
    const apiKey = this.resolveApiKey(context)
    if (!apiKey) return null
    const now = context.now

    const document = (await getJsonWithBearer(QUOTA_ENDPOINT, apiKey)) as unknown
    if (!isObject(document) && !Array.isArray(document)) {
      throw new ProviderError('Zai response was not a JSON document.')
    }

    let limits: unknown[] = []
    let plan: string | null = null
    if (Array.isArray(document)) {
      limits = document
    } else {
      const root = document as Record<string, unknown>
      if (root.success === false) {
        throw new ProviderError(getString(root, 'msg') ?? 'Zai API reported failure.')
      }
      const data = isObject(root.data) ? (root.data as Record<string, unknown>) : root
      const dataLimits = data.limits
      if (Array.isArray(dataLimits)) limits = dataLimits
      const rawPlan =
        getString(data, 'planName') ??
        getString(data, 'plan') ??
        getString(data, 'plan_type') ??
        getString(data, 'packageName') ??
        getString(data, 'level')
      if (rawPlan && rawPlan.trim() !== '') plan = rawPlan.trim()
    }

    const entries: ZaiLimitEntry[] = []
    for (const limit of limits) {
      if (!isObject(limit)) continue
      const entry = readLimitEntry(limit as Record<string, unknown>)
      if (entry) entries.push(entry)
    }

    const tokenLimits = entries.filter((entry) => entry.type === 'TOKENS_LIMIT')
    const timeLimit = entries.find((entry) => entry.type === 'TIME_LIMIT') ?? null
    tokenLimits.sort(
      (a, b) =>
        (windowMinutesOf(a) ?? Number.MAX_SAFE_INTEGER) -
        (windowMinutesOf(b) ?? Number.MAX_SAFE_INTEGER),
    )

    // Multiple TOKENS_LIMIT entries: shortest window surfaces as the session window.
    const sessionTokenLimit = tokenLimits.length >= 2 ? (tokenLimits[0] ?? null) : null
    const tokenLimit =
      sessionTokenLimit !== null
        ? (tokenLimits[tokenLimits.length - 1] ?? null)
        : (tokenLimits[0] ?? null)

    const windows: UsageWindow[] = []
    const primary = sessionTokenLimit ?? tokenLimit ?? timeLimit
    if (primary) {
      windows.push({
        providerName: this.providerName,
        label: labelOf(primary),
        usedPercent: usedPercentOf(primary) ?? 0,
        resetText: resetTextOf(primary, now),
      })
    }
    if (sessionTokenLimit !== null && tokenLimit) {
      windows.push({
        providerName: this.providerName,
        label: labelOf(tokenLimit),
        usedPercent: usedPercentOf(tokenLimit) ?? 0,
        resetText: resetTextOf(tokenLimit, now),
      })
    }
    if (tokenLimit && timeLimit) {
      windows.push({
        providerName: this.providerName,
        label: labelOf(timeLimit),
        usedPercent: usedPercentOf(timeLimit) ?? 0,
        resetText: resetTextOf(timeLimit, now),
      })
    }

    if (windows.length === 0) {
      throw new ProviderError('Zai response did not contain usable limit entries.')
    }
    return { providerName: this.providerName, plan, windows }
  }
}
