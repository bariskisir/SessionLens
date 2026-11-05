/**
 * @file RefuselessProvider.ts
 * @description Queries the Refuseless credit balance in the account's reported currency unit.
 */

import type { BalanceResult } from '@shared/types'
import { getNumber, getString } from '../ProviderJson'
import { getJsonWithBearer, ProviderError } from '../ProviderHttp'
import { currencyForUnit } from '../UsageFormatting'
import { BaseApiKeyProvider } from '@main/providers/BaseApiKeyProvider'
import type { ProviderQueryContext } from '@main/providers/IProvider'

const BALANCE_ENDPOINT = 'https://api.refuseless.com/v1/credits'

export default class RefuselessProvider extends BaseApiKeyProvider {
  async query(context: ProviderQueryContext): Promise<BalanceResult | null> {
    const apiKey = this.resolveApiKey(context)
    if (!apiKey) return null
    const document = (await getJsonWithBearer(BALANCE_ENDPOINT, apiKey)) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('Refuseless response was not a JSON object.')
    }
    const root = document as Record<string, unknown>
    const balance = getNumber(root, 'balance')
    if (balance === null) {
      throw new ProviderError('Refuseless response did not contain balance.')
    }

    const unit = getString(root, 'unit')
    const normalizedUnit = unit?.trim().toLowerCase() ?? null
    return {
      providerName: this.providerName,
      balanceText: currencyForUnit(balance, unit),
      usdAmount: normalizedUnit === null || normalizedUnit === 'usd' ? balance : null,
      cnyAmount: normalizedUnit === 'cny' ? balance : null,
    }
  }
}
