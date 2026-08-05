/**
 * @file PoeProvider.ts
 * @description Queries the Poe point balance via the current balance API.
 */

import type { BalanceResult } from '@shared/types'
import { getNumber } from '../ProviderJson'
import { getJsonWithBearer, ProviderError } from '../ProviderHttp'
import { BaseBalanceProvider } from './BaseApiKeyProvider'

const BALANCE_ENDPOINT = 'https://api.poe.com/usage/current_balance'

export default class PoeProvider extends BaseBalanceProvider {
  readonly providerName = 'Poe'

  async query(apiKey: string): Promise<BalanceResult> {
    const document = (await getJsonWithBearer(BALANCE_ENDPOINT, apiKey)) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('Poe response was not a JSON object.')
    }
    const balance = getNumber(document as Record<string, unknown>, 'current_point_balance')
    if (balance === null) {
      throw new ProviderError('Poe response did not contain current_point_balance.')
    }
    return {
      providerName: 'Poe',
      balanceText: `${balance.toFixed(2)} pts`,
    }
  }
}
