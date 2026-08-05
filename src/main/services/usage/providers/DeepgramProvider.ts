/**
 * @file DeepgramProvider.ts
 * @description Queries the Deepgram USD balance by resolving the first project and summing its USD balances.
 */

import type { BalanceResult } from '@shared/types'
import { getNumber, getString } from '../ProviderJson'
import { getJsonWithHeaders, ProviderError } from '../ProviderHttp'
import { currency } from '../UsageFormatting'
import { BaseBalanceProvider } from './BaseApiKeyProvider'

const PROJECTS_ENDPOINT = 'https://api.deepgram.com/v1/projects'

const deepgramHeaders = (apiKey: string): Record<string, string> => ({
  Authorization: `Token ${apiKey}`,
  Accept: 'application/json',
})

const enumerateItems = (root: unknown, propertyName: string): unknown[] => {
  if (Array.isArray(root)) return root
  if (root && typeof root === 'object' && !Array.isArray(root)) {
    const items = (root as Record<string, unknown>)[propertyName]
    if (Array.isArray(items)) return items
  }
  return []
}

export default class DeepgramProvider extends BaseBalanceProvider {
  readonly providerName = 'Deepgram'

  async query(apiKey: string): Promise<BalanceResult> {
    const projectsDocument = (await getJsonWithHeaders(
      PROJECTS_ENDPOINT,
      deepgramHeaders(apiKey),
    )) as unknown
    let projectId: string | null = null
    for (const project of enumerateItems(projectsDocument, 'projects')) {
      const candidate = getString(project, 'project_id', 'projectId', 'id')
      if (candidate && candidate.trim() !== '') {
        projectId = candidate
        break
      }
    }
    if (!projectId) {
      throw new ProviderError('Deepgram response did not contain a project_id.')
    }

    const balancesDocument = (await getJsonWithHeaders(
      `https://api.deepgram.com/v1/projects/${encodeURIComponent(projectId)}/balances`,
      deepgramHeaders(apiKey),
    )) as unknown
    let total = 0
    let found = false
    for (const balance of enumerateItems(balancesDocument, 'balances')) {
      const amount =
        getNumber(balance, 'amount') ?? getNumber(balance, 'balance') ?? getNumber(balance, 'total_balance')
      if (amount === null) continue
      const units = getString(balance, 'units', 'currency')
      if (units && units.trim() !== '' && units.toLowerCase() !== 'usd') continue
      total += amount
      found = true
    }
    if (!found) {
      throw new ProviderError('Deepgram response did not contain a balance amount.')
    }
    return { providerName: 'Deepgram', balanceText: currency(total), usdAmount: total }
  }
}
