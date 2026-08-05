/**
 * @file ClaudeProvider.ts
 * @description Queries Claude usage across session (5h) and weekly windows using Claude CLI OAuth credentials.
 */

import type { MetricResult, UsageWindow } from '@shared/types'
import { getNumber, getObject, getString } from '../../../../main/providers/Json'
import { getJson, postForm, ProviderError, readAccessToken } from '../../../../main/providers/Http'
import { capitalize, resetDuration } from '../../../../main/providers/Formatting'
import { BaseOAuthProvider, type AuthReader } from '../../../../main/providers/BaseOAuthProvider'
import type ClaudeAuthReader from '../ClaudeAuthReader'
import type { ClaudeAuth } from '../ClaudeAuthReader'

const USAGE_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage'
const REFRESH_ENDPOINT = 'https://platform.claude.com/v1/oauth/token'
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const BETA_HEADER = 'oauth-2025-04-20'
const CLAUDE_CODE_USER_AGENT = 'claude-code/2.1.0'

const readPlanLabel = (tier: string | null | undefined): string | null => {
  if (!tier) return null
  const normalized = tier.trim().toLowerCase()
  if (normalized.includes('max')) return 'Max'
  if (normalized.includes('pro')) return 'Pro'
  if (normalized.includes('team')) return 'Team'
  if (normalized.includes('enterprise')) return 'Enterprise'
  if (normalized.includes('free')) return 'Free'
  if (normalized === 'default_claude_ai') return 'Claude AI'
  return capitalize(normalized)
}

const parseResetTime = (iso8601: string | null): Date | null => {
  if (!iso8601) return null
  const parsed = new Date(iso8601)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const readWindow = (
  root: Record<string, unknown>,
  propertyName: string,
  label: string,
  now: Date,
): UsageWindow | null => {
  const windowValue = getObject(root, propertyName)
  if (!windowValue) return null
  const utilization = getNumber(windowValue, 'utilization')
  if (utilization === null) return null
  const resetTime = parseResetTime(getString(windowValue, 'resets_at'))
  const resetAfter = resetTime ? resetTime.getTime() - now.getTime() : null
  return {
    providerName: 'Claude',
    label,
    usedPercent: Math.min(100, Math.max(0, utilization)),
    resetText: resetAfter !== null ? resetDuration(resetAfter) : null,
    resetAt: resetTime?.toISOString() ?? null,
  }
}

export default class ClaudeProvider extends BaseOAuthProvider<ClaudeAuth> {
  public constructor(private readonly claudeAuthReader: ClaudeAuthReader) {
    super({
      id: 'claude',
      name: 'Claude',
      displayOrder: 10,
      authenticationKind: 'oauth',
      credentialName: null,
      settingsOrder: 1,
      iconKey: 'claude',
      startWindowAfterReset: true,
      barProvider: true,
    })
  }

  protected getAuthReader(): AuthReader<ClaudeAuth> {
    return this.claudeAuthReader
  }

  protected shouldRefresh(auth: ClaudeAuth, now: Date): boolean {
    return (
      Boolean(auth.refreshToken) &&
      (!auth.expiresAt || now.getTime() >= new Date(auth.expiresAt).getTime())
    )
  }

  protected async refreshAuth(auth: ClaudeAuth, now: Date): Promise<ClaudeAuth> {
    if (!auth.refreshToken) return auth
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: auth.refreshToken,
      client_id: OAUTH_CLIENT_ID,
    })
    const document = (await postForm(REFRESH_ENDPOINT, body)) as Record<string, unknown>
    const accessToken = readAccessToken(document)
    if (!accessToken) {
      throw new ProviderError('Claude token refresh response did not include an access token.')
    }
    const expiresIn = getNumber(document, 'expires_in')
    return {
      accessToken,
      subscriptionType: auth.subscriptionType,
      rateLimitTier: auth.rateLimitTier,
      refreshToken: getString(document, 'refresh_token') ?? auth.refreshToken,
      expiresAt:
        expiresIn !== null
          ? new Date(now.getTime() + expiresIn * 1_000).toISOString()
          : auth.expiresAt,
      scopes: auth.scopes,
    }
  }

  protected async fetchUsage(auth: ClaudeAuth): Promise<unknown> {
    const document = (await getJson(
      new Request(USAGE_ENDPOINT, {
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          Accept: 'application/json',
          'anthropic-beta': BETA_HEADER,
          'User-Agent': CLAUDE_CODE_USER_AGENT,
        },
      }),
    )) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('Claude usage response was not a JSON object.')
    }
    return document as Record<string, unknown>
  }

  protected buildResult(raw: unknown, auth: ClaudeAuth, now: Date): MetricResult | null {
    const root = raw as Record<string, unknown>
    const plan = readPlanLabel(auth.subscriptionType ?? auth.rateLimitTier)
    const session = readWindow(root, 'five_hour', 'Session', now)
    const weekly = readWindow(root, 'seven_day', 'Weekly', now)
    if (!session && !weekly) {
      throw new ProviderError('Claude response did not contain usable rate limit windows.')
    }
    const windows: UsageWindow[] = []
    if (session) windows.push(session)
    if (weekly) windows.push(weekly)
    return { providerName: 'Claude', plan, windows }
  }
}
