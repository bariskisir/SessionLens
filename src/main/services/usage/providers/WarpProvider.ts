/**
 * @file WarpProvider.ts
 * @description Queries Warp request limit usage via GraphQL, including bonus grant credits.
 */

import type { MetricResult, UsageWindow } from '@shared/types'
import { getNumber, getString } from '../ProviderJson'
import { postJsonWithHeaders, ProviderError } from '../ProviderHttp'
import { resetDuration } from '../UsageFormatting'
import { BaseApiKeyProvider } from '@main/providers/BaseApiKeyProvider'
import type { ProviderQueryContext } from '@main/providers/IProvider'

const GRAPHQL_ENDPOINT = 'https://app.warp.dev/graphql/v2?op=GetRequestLimitInfo'

const QUERY = {
  query:
    'query GetRequestLimitInfo($requestContext: RequestContext!) { user(requestContext: $requestContext) { __typename ... on UserOutput { user { requestLimitInfo { isUnlimited nextRefreshTime requestLimit requestsUsedSinceLastRefresh } bonusGrants { requestCreditsGranted requestCreditsRemaining expiration } workspaces { bonusGrantsInfo { grants { requestCreditsGranted requestCreditsRemaining expiration } } } } } } }',
  variables: {
    requestContext: {
      clientContext: {},
      osContext: { category: 'macOS', name: 'macOS', version: '15.0' },
    },
  },
  operationName: 'GetRequestLimitInfo',
}

const readValue = (obj: Record<string, unknown>, key: string): number => {
  const value = obj[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return 0
}

const parseBonusPlan = (user: Record<string, unknown>): string | null => {
  let totalGranted = 0
  let totalRemaining = 0
  const bonusGrants = user.bonusGrants
  if (Array.isArray(bonusGrants)) {
    for (const grant of bonusGrants) {
      if (!grant || typeof grant !== 'object') continue
      const record = grant as Record<string, unknown>
      totalGranted += readValue(record, 'requestCreditsGranted')
      totalRemaining += readValue(record, 'requestCreditsRemaining')
    }
  }
  const workspaces = user.workspaces
  if (Array.isArray(workspaces)) {
    for (const workspace of workspaces) {
      if (!workspace || typeof workspace !== 'object') continue
      const grantsInfo = (workspace as Record<string, unknown>).bonusGrantsInfo
      if (!grantsInfo || typeof grantsInfo !== 'object') continue
      const grants = (grantsInfo as Record<string, unknown>).grants
      if (!Array.isArray(grants)) continue
      for (const grant of grants) {
        if (!grant || typeof grant !== 'object') continue
        const record = grant as Record<string, unknown>
        totalGranted += readValue(record, 'requestCreditsGranted')
        totalRemaining += readValue(record, 'requestCreditsRemaining')
      }
    }
  }
  if (totalGranted > 0) {
    return `+${Math.round(totalRemaining)}/${Math.round(totalGranted)} bonus`
  }
  return null
}

const navigateJsonPath = (root: Record<string, unknown>, path: string[]): unknown => {
  let current: unknown = root
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

export default class WarpProvider extends BaseApiKeyProvider {
  async query(context: ProviderQueryContext): Promise<MetricResult | null> {
    const apiKey = this.resolveApiKey(context)
    if (!apiKey) return null
    const now = context.now

    const document = (await postJsonWithHeaders(GRAPHQL_ENDPOINT, QUERY, {
      Authorization: `Bearer ${apiKey}`,
      'x-warp-client-id': 'warp-app',
      'x-warp-os-category': 'macOS',
      'x-warp-os-name': 'macOS',
      'User-Agent': 'Warp/1.0',
    })) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('Warp response was not a JSON object.')
    }
    const root = document as Record<string, unknown>
    if (Array.isArray(root.errors) && root.errors.length > 0) {
      throw new ProviderError('Warp GraphQL errors returned.')
    }

    const user = navigateJsonPath(root, ['data', 'user', 'user'])
    if (!user || typeof user !== 'object' || Array.isArray(user)) {
      throw new ProviderError('Warp response did not contain requestLimitInfo.')
    }
    const info = user as Record<string, unknown>

    const planUser = navigateJsonPath(root, ['data', 'user', 'user'])

    const isUnlimited =
      typeof info.isUnlimited === 'string'
        ? ['true', '1'].includes((info.isUnlimited as string).toLowerCase())
        : info.isUnlimited === true

    const bonusPlan =
      planUser && typeof planUser === 'object' && !Array.isArray(planUser)
        ? parseBonusPlan(planUser as Record<string, unknown>)
        : null

    if (isUnlimited) {
      const window: UsageWindow = {
        providerName: 'Warp',
        label: 'Requests',
        usedPercent: 0,
        resetText: null,
      }
      return { providerName: 'Warp', plan: bonusPlan ?? 'Unlimited', windows: [window] }
    }

    const requestLimit = getNumber(info, 'requestLimit')
    const requestsUsed = getNumber(info, 'requestsUsedSinceLastRefresh')
    if (requestLimit === null || requestsUsed === null || requestLimit <= 0) {
      throw new ProviderError('Warp response did not contain valid request limit info.')
    }
    const usedPercent = (requestsUsed / requestLimit) * 100
    const nextRefresh = getString(info, 'nextRefreshTime')
    let resetText: string | null = null
    if (nextRefresh) {
      const parsed = new Date(nextRefresh)
      if (!Number.isNaN(parsed.getTime())) {
        resetText = resetDuration(parsed.getTime() - now.getTime())
      }
    }
    const window: UsageWindow = {
      providerName: 'Warp',
      label: 'Requests',
      usedPercent: Math.min(100, Math.max(0, usedPercent)),
      resetText,
    }
    return { providerName: 'Warp', plan: bonusPlan, windows: [window] }
  }
}
