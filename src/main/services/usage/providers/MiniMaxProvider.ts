/**
 * @file MiniMaxProvider.ts
 * @description Queries MiniMax model-based usage percentages and points balance, falling back from international to China endpoints.
 */

import type { BalanceResult, MetricResult, UsageWindow } from '@shared/types'
import { getArray, getNumber, getObject, getString } from '../ProviderJson'
import { getJsonWithHeaders, ProviderError } from '../ProviderHttp'
import { resetDuration } from '../UsageFormatting'
import { BaseHybridProvider } from './BaseApiKeyProvider'

const INTERNATIONAL_ENDPOINT = 'https://api.minimax.io/v1/token_plan/remains'
const CHINA_ENDPOINT = 'https://api.minimaxi.com/v1/token_plan/remains'

const minimaxHeaders = (apiKey: string): Record<string, string> => ({
  Authorization: `Bearer ${apiKey}`,
  'MM-API-Source': 'CodexBar',
})

const readModelRemain = (model: unknown, now: Date): UsageWindow | null => {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return null
  const record = model as Record<string, unknown>
  const modelName = getString(record, 'model_name', 'model', 'name') ?? 'Model'
  const remainingPercent = getNumber(record, 'current_interval_remaining_percent')
  let usedPercent: number | null = null
  if (remainingPercent !== null) {
    usedPercent = 100 - remainingPercent
  } else {
    const usageCount = getNumber(record, 'current_interval_usage_count')
    const totalCount = getNumber(record, 'current_interval_total_count')
    if (usageCount !== null && totalCount !== null && totalCount > 0) {
      usedPercent = (usageCount / totalCount) * 100
    }
  }
  if (usedPercent === null) return null
  const endTime = getString(record, 'end_time')
  let resetText: string | null = null
  if (endTime) {
    const parsed = new Date(endTime)
    if (!Number.isNaN(parsed.getTime())) {
      resetText = resetDuration(parsed.getTime() - now.getTime())
    }
  }
  return {
    providerName: 'MiniMax',
    label: modelName,
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    resetText,
  }
}

export default class MiniMaxProvider extends BaseHybridProvider {
  readonly providerName = 'MiniMax'

  async query(apiKey: string, now: Date): Promise<MetricResult | BalanceResult | null> {
    let document: unknown
    try {
      document = await getJsonWithHeaders(INTERNATIONAL_ENDPOINT, minimaxHeaders(apiKey))
    } catch {
      document = await getJsonWithHeaders(CHINA_ENDPOINT, minimaxHeaders(apiKey))
    }
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('MiniMax response was not a JSON object.')
    }
    let data: unknown = document
    const dataProp = getObject(document as Record<string, unknown>, 'data')
    if (dataProp) data = dataProp
    const dataRecord = data as Record<string, unknown>
    const pointsBalance = getNumber(dataRecord, 'points_balance')
    const pointsText = pointsBalance !== null ? `${pointsBalance.toFixed(2)} pts` : null
    const windows: UsageWindow[] = []
    const modelRemains = getArray(dataRecord, 'model_remains')
    if (modelRemains) {
      for (const model of modelRemains) {
        const window = readModelRemain(model, now)
        if (window) windows.push(window)
      }
    }
    if (windows.length === 0 && pointsText !== null) {
      return { providerName: 'MiniMax', balanceText: pointsText }
    }
    if (windows.length === 0) {
      throw new ProviderError('MiniMax response did not contain usable model usage windows.')
    }
    return { providerName: 'MiniMax', plan: pointsText, windows }
  }
}
