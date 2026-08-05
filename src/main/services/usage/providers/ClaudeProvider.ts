/**
 * @file ClaudeProvider.ts
 * @description Queries Claude usage across session (5h) and weekly windows using Claude CLI OAuth credentials.
 */

import type { MetricResult, UsageWindow } from '@shared/types'
import { getNumber, getObject, getString } from '../ProviderJson'
import { getJson, postForm, ProviderError, readAccessToken } from '../ProviderHttp'
import { capitalize, resetDuration } from '../UsageFormatting'
import { executeAuthFlow } from '../ProviderAuthFlow'
import type ClaudeAuthReader from '../ClaudeAuthReader'

/** Endpoint for querying Claude OAuth usage windows. */
const USAGE_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage'
/** Endpoint for refreshing Claude OAuth tokens. */
const REFRESH_ENDPOINT = 'https://platform.claude.com/v1/oauth/token'
/** OAuth2 client ID registered for Claude Code. */
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
/** Anthropic beta API header value required for usage endpoints. */
const BETA_HEADER = 'oauth-2025-04-20'
/** User-Agent string matching Claude Code CLI requests. */
const CLAUDE_CODE_USER_AGENT = 'claude-code/2.1.0'

/**
 * Maps a raw subscription tier or rate limit tier string to a display label.
 *
 * @param tier - Raw tier string from API response
 * @returns Human-readable plan label or null
 */
const planLabel = (tier: string | null | undefined): string | null => {
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

/**
 * Parses an ISO 8601 reset timestamp to a Date, returning null on failure.
 *
 * @param iso8601 - ISO 8601 string or null
 * @returns Parsed Date or null
 */
const parseResetTime = (iso8601: string | null): Date | null => {
  if (!iso8601) return null
  const parsed = new Date(iso8601)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Reads a single usage window from the API response object.
 *
 * @param root - Root API response record
 * @param propertyName - Property key for the window object
 * @param label - Display label for this window
 * @param providerName - Provider name string
 * @param now - Current timestamp for reset duration calculation
 * @returns UsageWindow or null if utilization is missing
 */
const readWindow = (
  root: Record<string, unknown>,
  propertyName: string,
  label: string,
  providerName: string,
  now: Date,
): UsageWindow | null => {
  const windowValue = getObject(root, propertyName)
  if (!windowValue) return null
  const utilization = getNumber(windowValue, 'utilization')
  if (utilization === null) return null
  const resetTime = parseResetTime(getString(windowValue, 'resets_at'))
  const resetAfter = resetTime ? resetTime.getTime() - now.getTime() : null
  const resetText = resetAfter !== null ? resetDuration(resetAfter) : null
  return {
    providerName,
    label,
    usedPercent: Math.min(100, Math.max(0, utilization)),
    resetText,
    resetAt: resetTime?.toISOString() ?? null,
  }
}

/**
 * Service provider for querying Claude usage metrics.
 */
export default class ClaudeProvider {
  /** Provider display name. */
  readonly providerName = 'Claude'

  /**
   * Initializes a new instance of ClaudeProvider.
   *
   * @param authReader - ClaudeAuthReader instance for credential access
   * @param fetchImpl - Optional fetch implementation for testing
   */
  public constructor(private readonly authReader: ClaudeAuthReader) {}

  /**
   * Checks whether Claude credentials are available.
   *
   * @returns True if an access token is present
   */
  public isConfigured = async (): Promise<boolean> =>
    (await this.authReader.read())?.accessToken != null

  /**
   * Queries Claude session and weekly usage windows.
   *
   * @param now - Current timestamp for expiry and reset calculations
   * @param allowRefresh - Whether to attempt OAuth token refresh on expiry
   * @returns MetricResult with usage windows, or null if credentials are missing
   * @throws ProviderError if the API response is invalid
   */
  public async query(now: Date, allowRefresh: boolean): Promise<MetricResult | null> {
    const auth = await this.authReader.read()
    if (!auth) return null

    const shouldRefresh = (value: typeof auth): boolean =>
      Boolean(value.refreshToken) &&
      (!value.expiresAt || now.getTime() >= new Date(value.expiresAt).getTime())

    const refreshAsync = async (value: typeof auth): Promise<typeof auth> => {
      if (!value.refreshToken) return value
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: value.refreshToken,
        client_id: OAUTH_CLIENT_ID,
      })
      const document = (await postForm(REFRESH_ENDPOINT, body)) as Record<string, unknown>
      const accessToken = readAccessToken(document)
      if (!accessToken) throw new ProviderError('Claude token refresh response did not include an access token.')
      const expiresIn = getNumber(document, 'expires_in')
      const refreshed: typeof auth = {
        accessToken,
        subscriptionType: value.subscriptionType,
        rateLimitTier: value.rateLimitTier,
        refreshToken: getString(document, 'refresh_token') ?? value.refreshToken,
        expiresAt:
          expiresIn !== null ? new Date(now.getTime() + expiresIn * 1_000).toISOString() : value.expiresAt,
        scopes: value.scopes,
      }
      try {
        await this.authReader.save(refreshed)
      } catch {
        // Persisting failed; the in-memory auth is still valid for this refresh cycle.
      }
      return refreshed
    }

    const getUsageDocument = async (value: typeof auth): Promise<Record<string, unknown>> => {
      const document = (await getJson(
        new Request(USAGE_ENDPOINT, {
          headers: {
            Authorization: `Bearer ${value.accessToken}`,
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

    const { auth: finalAuth, result } = await executeAuthFlow({
      auth,
      allowRefresh,
      readLatestAuth: () => this.authReader.read(),
      shouldRefresh,
      refreshAsync,
      executeAsync: getUsageDocument,
    })

    const root = result as Record<string, unknown>
    const plan = planLabel(finalAuth.subscriptionType ?? finalAuth.rateLimitTier)
    const session = readWindow(root, 'five_hour', 'Session', 'Claude', now)
    const weekly = readWindow(root, 'seven_day', 'Weekly', 'Claude', now)
    if (!session && !weekly) {
      throw new ProviderError('Claude response did not contain usable rate limit windows.')
    }

    const windows: UsageWindow[] = []
    if (session) windows.push(session)
    if (weekly) windows.push(weekly)
    return { providerName: 'Claude', plan, windows }
  }
}

