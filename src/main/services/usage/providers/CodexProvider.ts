/**
 * @file CodexProvider.ts
 * @description Queries Codex (ChatGPT) rate-limit usage across session (5h) and weekly windows using Codex CLI OAuth credentials.
 */

import type { MetricResult, UsageWindow } from '@shared/types'
import { getArray, getNumber, getObject, getString } from '../ProviderJson'
import { getJson, postForm, ProviderError, readAccessToken } from '../ProviderHttp'
import { capitalize, resetDuration } from '../UsageFormatting'
import { executeAuthFlow } from '../ProviderAuthFlow'
import type CodexAuthReader from '../CodexAuthReader'

/** Endpoint for querying Codex (ChatGPT) WHAM usage windows. */
const USAGE_ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage'
/** Endpoint for querying rate-limit reset credits. */
const RESET_CREDITS_ENDPOINT = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits'
/** OpenAI OAuth token refresh endpoint. */
const REFRESH_ENDPOINT = 'https://auth.openai.com/oauth/token'
/** OAuth2 client ID registered for the Codex CLI. */
const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
/** Milliseconds between proactive token refreshes (8 days). */
const REFRESH_INTERVAL_MS = 8 * 24 * 60 * 60 * 1_000

/**
 * Converts an epoch timestamp (seconds or milliseconds) to a Date.
 *
 * @param epoch - Unix timestamp in either seconds or milliseconds
 * @returns Corresponding Date object
 */
const fromEpoch = (epoch: number): Date => {
  const seconds = epoch > 10_000_000_000 ? epoch / 1000 : epoch
  return new Date(Math.trunc(seconds) * 1_000)
}

/**
 * Maps a raw plan type string to a display-friendly label.
 *
 * @param planType - Raw plan type string or null
 * @returns Human-readable plan label or null
 */
const planLabel = (planType: string | null): string | null => {
  if (!planType) return null
  const normalized = planType.toLowerCase()
  const labels: Record<string, string> = {
    free: 'Free',
    plus: 'Plus',
    pro: 'Pro',
    pro_lite: 'Pro Lite',
    prolite: 'Pro Lite',
    'pro-lite': 'Pro Lite',
    go: 'Go',
    team: 'Team',
    business: 'Business',
    enterprise: 'Enterprise',
    education: 'Education',
    edu: 'Education',
    guest: 'Guest',
  }
  return labels[normalized] ?? capitalize(normalized)
}

/**
 * Extracts the rate limit object from the usage response, supporting both direct and nested formats.
 *
 * @param root - Root API response record
 * @returns Rate limit record
 * @throws ProviderError if no rate_limit is found
 */
const getRateLimit = (root: Record<string, unknown>): Record<string, unknown> => {
  const rateLimit = getObject(root, 'rate_limit')
  if (rateLimit) return rateLimit
  const additional = getArray(root, 'additional_rate_limits')
  if (additional) {
    for (const item of additional) {
      const nested = getObject(item, 'rate_limit')
      if (nested) return nested
    }
  }
  throw new ProviderError('Codex response did not contain rate_limit.')
}

/**
 * Reads available reset credit count and nearest expiry date into a notice string.
 *
 * @param root - Root API response record
 * @returns Notice string such as "2 resets exp 08/08" or null if no credits
 */
const readAvailableResetLabel = (root: Record<string, unknown>): string | null => {
  const resetCredits = getObject(root, 'rate_limit_reset_credits') ?? root
  const availableCount = getNumber(resetCredits, 'available_count')
  if (availableCount === null || availableCount <= 0 || availableCount % 1 !== 0) return null
  const countLabel = availableCount === 1 ? '1 reset' : `${availableCount} resets`

  const credits = getArray(resetCredits, 'credits')
  let nearest: Date | null = null
  if (credits) {
    for (const credit of credits) {
      if ((getString(credit, 'status') ?? '').toLowerCase() !== 'available') continue
      const expiresAt = getString(credit, 'expires_at')
      const parsed = expiresAt ? new Date(expiresAt) : null
      if (parsed && !Number.isNaN(parsed.getTime()) && (nearest === null || parsed < nearest)) {
        nearest = parsed
      }
    }
  }

  if (nearest === null) return countLabel
  const ddmm = nearest.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })
  return `${countLabel} exp ${ddmm}`
}

/**
 * Reads a single usage window from the rate limit record.
 *
 * @param rateLimit - Rate limit record from API response
 * @param propertyName - Property key for the window object
 * @param label - Display label for this window
 * @param providerName - Provider name string
 * @param now - Current timestamp for reset duration calculation
 * @returns UsageWindow or null if data is missing
 */
const readWindow = (
  rateLimit: Record<string, unknown>,
  propertyName: string,
  label: string,
  providerName: string,
  now: Date,
): UsageWindow | null => {
  const windowValue = getObject(rateLimit, propertyName)
  if (!windowValue) return null
  const usedPercent = getNumber(windowValue, 'used_percent')
  const resetAt = getNumber(windowValue, 'reset_at')
  if (usedPercent === null || resetAt === null) return null
  const resetTime = fromEpoch(resetAt)
  const resetText = resetDuration(resetTime.getTime() - now.getTime())
  return {
    providerName,
    label,
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    resetText,
    resetAt: resetTime.toISOString(),
  }
}

/**
 * Service provider for querying Codex (ChatGPT) usage metrics.
 */
export default class CodexProvider {
  /** Provider display name. */
  readonly providerName = 'Codex'

  /**
   * Initializes a new instance of CodexProvider.
   *
   * @param authReader - CodexAuthReader instance for credential access
   * @param fetchImpl - Optional fetch implementation for testing
   */
  public constructor(private readonly authReader: CodexAuthReader) {}

  /**
   * Checks whether Codex credentials are available.
   *
   * @returns True if an access token is present
   */
  public isConfigured = async (): Promise<boolean> =>
    (await this.authReader.read())?.accessToken != null

  /**
   * Queries Codex session and weekly usage windows.
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
      (!value.lastRefresh ||
        now.getTime() - new Date(value.lastRefresh).getTime() > REFRESH_INTERVAL_MS)

    const refreshAsync = async (value: typeof auth): Promise<typeof auth> => {
      if (!value.refreshToken) return value
      const body = new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: value.refreshToken,
        scope: 'openid profile email',
      })
      const document = (await postForm(REFRESH_ENDPOINT, body)) as Record<string, unknown>
      const refreshed: typeof auth = {
        accessToken: readAccessToken(document) ?? value.accessToken,
        accountId: value.accountId,
        refreshToken: getString(document, 'refresh_token') ?? value.refreshToken,
        idToken: getString(document, 'id_token') ?? value.idToken,
        lastRefresh: now.toISOString(),
      }
      try {
        await this.authReader.save(refreshed)
      } catch {
        // Persisting failed; the in-memory auth is still valid for this refresh cycle.
      }
      return refreshed
    }

    const requestHeaders = (accessToken: string, accountId?: string | null): Record<string, string> => ({
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'SessionLens',
      originator: 'codex_cli_rs',
      ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
    })

    const getUsageDocument = async (value: typeof auth): Promise<Record<string, unknown>> => {
      const document = (await getJson(
        new Request(USAGE_ENDPOINT, { headers: requestHeaders(value.accessToken, value.accountId) }),
      )) as unknown
      if (!document || typeof document !== 'object' || Array.isArray(document)) {
        throw new ProviderError('Codex usage response was not a JSON object.')
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
    const plan = planLabel(getString(root, 'plan_type'))
    const rateLimit = getRateLimit(root)
    const session = readWindow(rateLimit, 'primary_window', 'Session', 'Codex', now)
    const weekly = readWindow(rateLimit, 'secondary_window', 'Weekly', 'Codex', now)
    if (!session && !weekly) {
      throw new ProviderError('Codex response did not contain usable rate limit windows.')
    }

    let notice = readAvailableResetLabel(root)
    try {
      const resetDocument = (await getJson(
        new Request(RESET_CREDITS_ENDPOINT, {
          headers: requestHeaders(finalAuth.accessToken, finalAuth.accountId),
        }),
      )) as unknown
      if (resetDocument && typeof resetDocument === 'object' && !Array.isArray(resetDocument)) {
        notice = readAvailableResetLabel(resetDocument as Record<string, unknown>)
      }
    } catch {
      // Reset credits are supplemental; keep the count from the usage response.
    }

    const windows: UsageWindow[] = []
    if (session) windows.push(session)
    if (weekly) windows.push(weekly)
    return { providerName: 'Codex', plan, windows, notice }
  }
}

