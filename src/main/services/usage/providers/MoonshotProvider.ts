/**
 * @file MoonshotProvider.ts
 * @description Queries the Moonshot (Kimi) account available USD balance via the user balance API.
 */

import type { BalanceResult } from '@shared/types'
import { getNumber, getObject } from '../ProviderJson'
import { getJsonWithBearer, ProviderError } from '../ProviderHttp'
import { currency } from '../UsageFormatting'
import { BaseBalanceProvider } from './BaseApiKeyProvider'

const BALANCE_ENDPOINT = 'https://api.moonshot.ai/v1/users/me/balance'

export default class MoonshotProvider extends BaseBalanceProvider {
  readonly providerName = 'Moonshot (Kimi)'

  async query(apiKey: string): Promise<BalanceResult> {
    const document = (await getJsonWithBearer(BALANCE_ENDPOINT, apiKey)) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('Moonshot response was not a JSON object.')
    }
    const data = getObject(document as Record<string, unknown>, 'data')
    if (!data) throw new ProviderError('Moonshot response did not contain data.')
    const availableBalance = getNumber(data, 'available_balance')
    if (availableBalance === null) {
      throw new ProviderError('Moonshot response did not contain available_balance.')
    }
    return {
      providerName: 'Moonshot (Kimi)',
      balanceText: currency(availableBalance),
      usdAmount: availableBalance,
    }
  }
}
