/**
 * @file VeniceProvider.ts
 * @description Queries the Venice account balance, returning USD when active or DIEM with epoch allocation percentage otherwise.
 */

import type { BalanceResult } from '@shared/types'
import { getNumber, getString } from '../ProviderJson'
import { getJsonWithBearer, ProviderError } from '../ProviderHttp'
import { currency } from '../UsageFormatting'
import { BaseBalanceProvider } from './BaseApiKeyProvider'

const BALANCE_ENDPOINT = 'https://api.venice.ai/api/v1/billing/balance'

export default class VeniceProvider extends BaseBalanceProvider {
  readonly providerName = 'Venice'

  async query(apiKey: string): Promise<BalanceResult> {
    const document = (await getJsonWithBearer(BALANCE_ENDPOINT, apiKey)) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('Venice response was not a JSON object.')
    }
    const root = document as Record<string, unknown>
    const canConsume = root.canConsume === true
    const currencyName = getString(root, 'consumptionCurrency')?.toUpperCase() ?? null
    const balances = root.balances as Record<string, unknown> | undefined
    const usd = balances ? getNumber(balances, 'usd') : getNumber(root, 'usd')
    const diem = balances ? getNumber(balances, 'diem') : getNumber(root, 'diem')
    const allocation = getNumber(root, 'diemEpochAllocation')

    if (!canConsume) {
      return { providerName: 'Venice', balanceText: 'Unavailable' }
    }
    if (currencyName === 'USD' && usd !== null && usd > 0) {
      return { providerName: 'Venice', balanceText: currency(usd), usdAmount: usd }
    }
    if (currencyName !== 'USD' && diem !== null && allocation !== null && allocation > 0) {
      const usedAmount = allocation - diem
      const usedPercent = Math.min(100, Math.max(0, (usedAmount / allocation) * 100))
      return { providerName: 'Venice', balanceText: `DIEM ${diem.toFixed(2)} / ${allocation.toFixed(2)} (${usedPercent.toFixed(1)}%)` }
    }
    if (currencyName === 'DIEM' && diem !== null && diem > 0) {
      return { providerName: 'Venice', balanceText: `DIEM ${diem.toFixed(2)}` }
    }
    if (diem !== null && diem > 0) {
      if (allocation !== null && allocation > 0) {
        const usedAmount = allocation - diem
        const usedPercent = Math.min(100, Math.max(0, (usedAmount / allocation) * 100))
        return { providerName: 'Venice', balanceText: `DIEM ${diem.toFixed(2)} / ${allocation.toFixed(2)} (${usedPercent.toFixed(1)}%)` }
      }
      return { providerName: 'Venice', balanceText: `DIEM ${diem.toFixed(2)}` }
    }
    if (usd !== null && usd > 0) {
      return { providerName: 'Venice', balanceText: currency(usd), usdAmount: usd }
    }
    throw new ProviderError('Venice response did not contain a usable balance.')
  }
}
