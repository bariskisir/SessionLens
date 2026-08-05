/**
 * @file OpenAIProvider.ts
 * @description Queries the OpenAI account credit grant balance (total_available USD) via the dashboard billing API.
 */

import type { BalanceResult } from '@shared/types'
import { getNumber } from '../ProviderJson'
import { getJsonWithBearer, ProviderError } from '../ProviderHttp'
import { currency } from '../UsageFormatting'
import { BaseApiKeyProvider } from '@main/providers/BaseApiKeyProvider'
import type { ProviderQueryContext } from '@main/providers/IProvider'

const CREDIT_GRANTS_ENDPOINT = 'https://api.openai.com/v1/dashboard/billing/credit_grants'

export default class OpenAIProvider extends BaseApiKeyProvider {
  async query(context: ProviderQueryContext): Promise<BalanceResult | null> {
    const apiKey = this.resolveApiKey(context)
    if (!apiKey) return null
    const document = (await getJsonWithBearer(CREDIT_GRANTS_ENDPOINT, apiKey)) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('OpenAI response was not a JSON object.')
    }
    const totalAvailable = getNumber(document as Record<string, unknown>, 'total_available')
    if (totalAvailable === null) {
      throw new ProviderError('OpenAI response did not contain total_available.')
    }
    return {
      providerName: 'OpenAI',
      balanceText: currency(totalAvailable),
      usdAmount: totalAvailable,
    }
  }
}
