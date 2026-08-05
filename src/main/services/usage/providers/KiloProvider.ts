/**
 * @file KiloProvider.ts
 * @description Queries Kilo credits and Kilo Pass usage when the account has an active pass, using batched tRPC endpoints.
 */

import type { BalanceResult, MetricResult, UsageWindow } from '@shared/types'
import { getNumber, getString } from '../ProviderJson'
import { getJsonWithBearer, ProviderError } from '../ProviderHttp'
import { currency, resetDuration } from '../UsageFormatting'
import { BaseHybridProvider } from './BaseApiKeyProvider'

const TRPC_ENDPOINT = 'https://app.kilo.ai/api/trpc'
const PROCEDURES = ['user.getCreditBlocks', 'kiloPass.getState', 'user.getAutoTopUpPaymentMethod']

const buildUsageUri = (): string => {
  const endpoint = `${TRPC_ENDPOINT}/${PROCEDURES.join(',')}`
  const input = `{${PROCEDURES.map((_, index) => `"${index}":{"json":null}`).join(',')}}`
  return `${endpoint}?batch=1&input=${encodeURIComponent(input)}`
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Recursively finds the first property with the given name (max depth 2). */
const findProperty = (
  element: unknown,
  propertyName: string,
  maxDepth = 2,
): unknown => {
  if (!isObject(element) || maxDepth < 0) return null
  if (propertyName in element) return element[propertyName]
  for (const value of Object.values(element)) {
    if (isObject(value)) {
      const found = findProperty(value, propertyName, maxDepth - 1)
      if (found !== null && found !== undefined) return found
    }
  }
  return null
}

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

const findDecimal = (element: unknown, propertyNames: string[]): number | null => {
  for (const propertyName of propertyNames) {
    const property = findProperty(element, propertyName)
    if (property === null || property === undefined) continue
    if (typeof property === 'object' && !Array.isArray(property)) {
      continue
    }
    const value = asNumber(property)
    if (value !== null) return value
  }
  return null
}

const payloadAt = (root: unknown, index: number): unknown => {
  let entry: unknown
  if (Array.isArray(root)) {
    entry = root[index] ?? null
  } else if (isObject(root)) {
    entry = root[String(index)] ?? null
  } else {
    return null
  }
  if (entry === null || entry === undefined) return null
  if (isObject(entry) && entry.error !== undefined) {
    const error = entry.error
    const message = isObject(error) ? getString(error, 'message') : null
    throw new ProviderError(`Kilo tRPC procedure failed: ${message ?? 'unknown error'}`)
  }
  if (!isObject(entry) || entry.result === undefined) return null
  const result = entry.result
  if (!isObject(result)) return null
  if (result.data !== undefined) {
    const data = result.data
    if (isObject(data) && data.json !== undefined && data.json !== null) {
      return data.json
    }
    return data === null ? null : data
  }
  if (result.json !== undefined && result.json !== null) return result.json
  return null
}

interface KiloCredits {
  used: number
  total: number
  remaining: number
}

interface KiloPass {
  used: number
  total: number
  resetsAt: Date | null
}

const parseCredits = (payload: unknown): KiloCredits | null => {
  if (payload === null || payload === undefined) return null
  const creditBlocks = findProperty(payload, 'creditBlocks')
  if (Array.isArray(creditBlocks) && creditBlocks.length > 0) {
    let total = 0
    let remaining = 0
    let sawTotal = false
    let sawRemaining = false
    for (const block of creditBlocks) {
      if (!isObject(block)) continue
      const amount = getNumber(block, 'amount_mUsd')
      if (amount !== null) {
        total += amount / 1_000_000
        sawTotal = true
      }
      const balance = getNumber(block, 'balance_mUsd')
      if (balance !== null) {
        remaining += balance / 1_000_000
        sawRemaining = true
      }
    }
    if (sawTotal || sawRemaining) {
      return {
        used: sawTotal && sawRemaining ? Math.max(0, total - remaining) : 0,
        total: Math.max(0, total),
        remaining: Math.max(0, remaining),
      }
    }
  }

  const totalBalance = findProperty(payload, 'totalBalance_mUsd')
  if (totalBalance !== null && totalBalance !== undefined) {
    const balance = getNumber(totalBalance, '') ?? Number(totalBalance)
    if (Number.isFinite(balance)) {
      const value = Math.max(0, balance / 1_000_000)
      return { used: 0, total: value, remaining: value }
    }
  }

  const used = findDecimal(payload, ['used', 'usedCredits', 'creditsUsed', 'consumed', 'spent'])
  const totalGeneric = findDecimal(payload, ['total', 'totalCredits', 'creditsTotal', 'limit'])
  const remainingGeneric = findDecimal(payload, [
    'remaining',
    'remainingCredits',
    'creditsRemaining',
  ])
  if (used === null && totalGeneric === null && remainingGeneric === null) return null
  const resolvedTotal = totalGeneric ?? Math.max(0, (used ?? 0) + (remainingGeneric ?? 0))
  const resolvedRemaining = remainingGeneric ?? Math.max(0, resolvedTotal - (used ?? 0))
  return {
    used: Math.max(0, used ?? resolvedTotal - resolvedRemaining),
    total: Math.max(0, resolvedTotal),
    remaining: Math.max(0, resolvedRemaining),
  }
}

const parseDate = (raw: string | null): Date | null => {
  if (!raw || raw.trim() === '') return null
  const value = raw.trim()
  const epoch = Number(value)
  if (Number.isFinite(epoch)) {
    const seconds = Math.abs(epoch) > 10_000_000_000 ? epoch / 1000 : epoch
    return new Date(Math.trunc(seconds) * 1_000)
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const parsePass = (payload: unknown): KiloPass | null => {
  if (payload === null || payload === undefined) return null
  const subscription = findProperty(payload, 'subscription')
  const source = isObject(subscription) ? subscription : isObject(payload) ? payload : null
  if (!source) return null
  const used = getNumber(source, 'currentPeriodUsageUsd')
  const baseCredits = getNumber(source, 'currentPeriodBaseCreditsUsd')
  if (used === null || baseCredits === null) return null
  const bonusCredits = getNumber(source, 'currentPeriodBonusCreditsUsd') ?? 0
  const total = Math.max(0, baseCredits) + Math.max(0, bonusCredits)
  const resetsAtRaw =
    getString(source, 'nextBillingAt') ??
    getString(source, 'nextRenewalAt') ??
    getString(source, 'renewsAt') ??
    getString(source, 'renewAt')
  return {
    used: Math.max(0, used),
    total,
    resetsAt: parseDate(resetsAtRaw),
  }
}

const parsePlanName = (payload: unknown): string | null => {
  if (payload === null || payload === undefined) return null
  const subscriptionProperty = findProperty(payload, 'subscription')
  const hasSubscription = subscriptionProperty !== null && subscriptionProperty !== undefined
  if (subscriptionProperty === null) return null
  const source = isObject(subscriptionProperty)
    ? subscriptionProperty
    : isObject(payload)
      ? payload
      : null
  if (!source) return null
  const tier = getString(source, 'tier', 'planName', 'tierName', 'passName', 'subscriptionName')
  if (tier && tier.trim() !== '') {
    const labels: Record<string, string> = {
      tier_19: 'Starter',
      tier_49: 'Pro',
      tier_199: 'Expert',
    }
    return labels[tier.trim()] ?? tier.trim()
  }
  const hasPassShape =
    getNumber(source, 'currentPeriodUsageUsd') !== null ||
    getNumber(source, 'currentPeriodBaseCreditsUsd') !== null ||
    getNumber(source, 'currentPeriodBonusCreditsUsd') !== null
  return hasSubscription || hasPassShape ? 'Kilo Pass' : null
}

export default class KiloProvider extends BaseHybridProvider {
  readonly providerName = 'Kilo'

  async query(apiKey: string, now: Date): Promise<MetricResult | BalanceResult | null> {
    const document = (await getJsonWithBearer(buildUsageUri(), apiKey)) as unknown
    const creditPayload = payloadAt(document, 0)
    const passPayload = payloadAt(document, 1)
    const pass = parsePass(passPayload)
    const credits = parseCredits(creditPayload)
    const planName = parsePlanName(passPayload)

    if (pass) {
      const usedPercent = pass.total > 0 ? (pass.used / pass.total) * 100 : 100
      const resetText =
        pass.resetsAt !== null ? resetDuration(pass.resetsAt.getTime() - now.getTime()) : null
      const planParts: string[] = []
      if (planName) planParts.push(planName)
      if (credits) planParts.push(`Balance ${currency(credits.remaining)}`)
      const window: UsageWindow = {
        providerName: 'Kilo',
        label: 'Pass',
        usedPercent: Math.min(100, Math.max(0, usedPercent)),
        resetText,
      }
      return {
        providerName: 'Kilo',
        plan: planParts.length > 0 ? planParts.join(' - ') : null,
        windows: [window],
      }
    }

    if (!credits) {
      throw new ProviderError('Kilo response did not contain credit or pass usage.')
    }
    return {
      providerName: 'Kilo',
      balanceText: currency(credits.remaining),
      usdAmount: credits.remaining,
    }
  }
}
