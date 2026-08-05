/**
 * @file OpenRouterProvider.ts
 * @description Queries the OpenRouter remaining credit balance (total_credits minus total_usage) via the credits API.
 */

import type { BalanceResult } from '@shared/types'
import { getObject, getNumber } from '../ProviderJson'
import { getJsonWithBearer, ProviderError } from '../ProviderHttp'
import { currency } from '../UsageFormatting'
import { BaseBalanceProvider } from './BaseApiKeyProvider'

export default class OpenRouterProvider extends BaseBalanceProvider {
  readonly providerName = 'OpenRouter'

  async query(apiKey: string): Promise<BalanceResult> {
    const document = (await getJsonWithBearer(
      'https://openrouter.ai/api/v1/credits',
      apiKey,
    )) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('OpenRouter response was not a JSON object.')
    }
    const data = getObject(document as Record<string, unknown>, 'data')
    if (!data) throw new ProviderError('OpenRouter response did not contain data.')

    const totalCredits = getNumber(data, 'total_credits')
    const totalUsage = getNumber(data, 'total_usage')
    if (totalCredits === null || totalUsage === null) {
      throw new ProviderError('OpenRouter response did not contain total_credits and total_usage.')
    }

    const remaining = totalCredits - totalUsage
    return { providerName: 'OpenRouter', balanceText: currency(remaining), usdAmount: remaining }
  }
}
