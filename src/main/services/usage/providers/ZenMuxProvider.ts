/**
 * @file ZenMuxProvider.ts
 * @description Queries the ZenMux PAYG USD balance via the management API.
 */

import type { BalanceResult } from '@shared/types'
import { getNumber, getObject } from '../ProviderJson'
import { getJsonWithBearer, ProviderError } from '../ProviderHttp'
import { currency } from '../UsageFormatting'
import { BaseBalanceProvider } from './BaseApiKeyProvider'

const BALANCE_ENDPOINT = 'https://zenmux.ai/api/v1/management/payg/balance'

export default class ZenMuxProvider extends BaseBalanceProvider {
  readonly providerName = 'ZenMux'

  async query(apiKey: string): Promise<BalanceResult> {
    const document = (await getJsonWithBearer(BALANCE_ENDPOINT, apiKey)) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('ZenMux response was not a JSON object.')
    }
    const data = getObject(document as Record<string, unknown>, 'data')
    if (!data) throw new ProviderError('ZenMux response did not contain data.')
    const totalCredits = getNumber(data, 'total_credits')
    if (totalCredits === null) {
      throw new ProviderError('ZenMux response did not contain data.total_credits.')
    }
    return { providerName: 'ZenMux', balanceText: currency(totalCredits), usdAmount: totalCredits }
  }
}
