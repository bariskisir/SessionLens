/**
 * @file DeepSeekProvider.ts
 * @description Queries the DeepSeek account balance (USD and CNY) via the user balance API.
 */

import type { BalanceResult } from '@shared/types'
import { getArray, getNumber, getString } from '../ProviderJson'
import { getJsonWithBearer, ProviderError } from '../ProviderHttp'
import { currency } from '../UsageFormatting'
import { BaseBalanceProvider } from './BaseApiKeyProvider'

export default class DeepSeekProvider extends BaseBalanceProvider {
  readonly providerName = 'DeepSeek'

  async query(apiKey: string): Promise<BalanceResult> {
    const document = (await getJsonWithBearer(
      'https://api.deepseek.com/user/balance',
      apiKey,
    )) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('DeepSeek response was not a JSON object.')
    }
    const root = document as Record<string, unknown>
    const balanceInfos = getArray(root, 'balance_infos')
    if (!balanceInfos) throw new ProviderError('DeepSeek response did not contain balance_infos.')

    let usd: number | null = null
    let cny: number | null = null
    for (const balanceInfo of balanceInfos) {
      const amount = getNumber(balanceInfo, 'total_balance')
      if (amount === null) continue
      const balanceCurrency = getString(balanceInfo, 'currency')
      if (balanceCurrency?.toLowerCase() === 'usd') usd = amount
      else if (balanceCurrency?.toLowerCase() === 'cny') cny = amount
    }

    const parts: string[] = []
    if (usd !== null) parts.push(currency(usd))
    if (cny !== null && cny !== 0) parts.push(currency(cny, '\u00A5'))
    if (parts.length === 0) throw new ProviderError('DeepSeek response did not contain a USD or CNY balance.')

    return { providerName: 'DeepSeek', balanceText: parts.join(' / '), usdAmount: usd, cnyAmount: cny }
  }
}
