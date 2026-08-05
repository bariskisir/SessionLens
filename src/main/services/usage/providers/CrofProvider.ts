/**
 * @file CrofProvider.ts
 * @description Queries the Crof credit balance (USD) via the usage API.
 */

import type { BalanceResult } from '@shared/types'
import { getNumber } from '../ProviderJson'
import { getJsonWithBearer, ProviderError } from '../ProviderHttp'
import { currency } from '../UsageFormatting'
import { BaseBalanceProvider } from './BaseApiKeyProvider'

const USAGE_ENDPOINT = 'https://crof.ai/usage_api/'

export default class CrofProvider extends BaseBalanceProvider {
  readonly providerName = 'Crof'

  async query(apiKey: string): Promise<BalanceResult> {
    const document = (await getJsonWithBearer(USAGE_ENDPOINT, apiKey)) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('Crof response was not a JSON object.')
    }
    const credits = getNumber(document as Record<string, unknown>, 'credits')
    if (credits === null) {
      throw new ProviderError('Crof response did not contain credits.')
    }
    return { providerName: 'Crof', balanceText: currency(credits), usdAmount: credits }
  }
}
