/**
 * @file CodexProvider.ts
 * @description Queries Codex (ChatGPT) rate-limit usage across session (5h) and weekly windows using Codex CLI OAuth credentials.
 */

import type { MetricResult, UsageWindow } from '@shared/types'
import { getArray, getNumber, getObject, getString } from '../ProviderJson'
import { getJson, postForm, ProviderError, readAccessToken } from '../ProviderHttp'
import { capitalize, resetDuration } from '../UsageFormatting'
import { BaseOAuthProvider, type AuthReader } from '../../../../main/providers/BaseOAuthProvider'
import type CodexAuthReader from '../CodexAuthReader'
import type { CodexAuth } from '../CodexAuthReader'

const USAGE_ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage'
const RESET_CREDITS_ENDPOINT = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits'
const REFRESH_ENDPOINT = 'https://auth.openai.com/oauth/token'
const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const REFRESH_INTERVAL_MS = 8 * 24 * 60 * 60 * 1_000

const fromEpoch = (epoch: number): Date => {
  const seconds = epoch > 10_000_000_000 ? epoch / 1000 : epoch
  return new Date(Math.trunc(seconds) * 1_000)
}

const readPlanLabel = (planType: string | null): string | null => {
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
 * Formats a date as `DD.MM` with zero padding, independent of the OS locale.
 *
 * @param date - Date to format
 * @returns Day and month string such as `22.10`
 */
const formatDayMonth = (date: Date): string => {
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}`
}

const readResetNotice = (root: Record<string, unknown>, now: Date): string | null => {
  // The usage payload carries only the reset summary (`available_count`);
  // per-credit rows are merged in from the details endpoint by fetchUsage.
  const resetCredits = getObject(root, 'rate_limit_reset_credits')
  if (!resetCredits) return null
  const availableCount = getNumber(resetCredits, 'available_count')
  if (availableCount === null || availableCount <= 0 || availableCount % 1 !== 0) return null
  const countLabel = availableCount === 1 ? '1 reset' : `${availableCount} resets`
  const credits = getArray(resetCredits, 'credits')
  let nearest: Date | null = null
  if (credits) {
    for (const credit of credits) {
      // Only redeemable credits carry a usable expiry; anything else is ignored.
      if ((getString(credit, 'status') ?? '').toLowerCase() !== 'available') continue
      const expiresAt = getString(credit, 'expires_at')
      if (!expiresAt) continue
      const parsed = new Date(expiresAt)
      if (Number.isNaN(parsed.getTime())) continue
      if (parsed.getTime() > now.getTime() && (nearest === null || parsed < nearest)) {
        nearest = parsed
      }
    }
  }
  if (nearest === null) return countLabel
  return `${countLabel} expires ${formatDayMonth(nearest)}`
}

/**
 * Merges reset-credit detail rows into the usage payload.
 *
 * The usage summary count stays authoritative: detail rows only supply expiry
 * dates, and a sparse detail payload never zeroes a good usage count.
 *
 * @param root - Usage payload to merge into
 * @param document - Raw JSON document from the reset-credits endpoint
 */
const mergeResetCreditDetails = (root: Record<string, unknown>, document: unknown): void => {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return
  const record = document as Record<string, unknown>
  const rows = getArray(record, 'credits')
  const count = getNumber(record, 'available_count')
  if ((rows === null || rows.length === 0) && (count === null || count <= 0)) return
  const existing = getObject(root, 'rate_limit_reset_credits')
  if (existing) {
    if (rows !== null && rows.length > 0) existing.credits = rows
    if (count !== null && count > 0) existing.available_count = count
  } else if (count !== null && count > 0) {
    root.rate_limit_reset_credits = { available_count: count, ...(rows ? { credits: rows } : {}) }
  } else if (rows !== null && rows.length > 0) {
    root.rate_limit_reset_credits = { available_count: rows.length, credits: rows }
  }
}

const readWindow = (
  rateLimit: Record<string, unknown>,
  propertyName: string,
  label: string,
  now: Date,
): UsageWindow | null => {
  const windowValue = getObject(rateLimit, propertyName)
  if (!windowValue) return null
  const usedPercent = getNumber(windowValue, 'used_percent')
  const resetAt = getNumber(windowValue, 'reset_at')
  if (usedPercent === null || resetAt === null) return null
  const resetTime = fromEpoch(resetAt)
  return {
    providerName: 'Codex',
    label,
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    resetText: resetDuration(resetTime.getTime() - now.getTime()),
    resetAt: resetTime.toISOString(),
  }
}

const codexHeaders = (accessToken: string, accountId?: string | null): Record<string, string> => ({
  Authorization: `Bearer ${accessToken}`,
  Accept: 'application/json',
  'User-Agent': 'SessionLens',
  originator: 'codex_cli_rs',
  ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
})

export default class CodexProvider extends BaseOAuthProvider<CodexAuth> {
  public constructor(private readonly codexAuthReader: CodexAuthReader) {
    super({
      id: 'codex',
      name: 'Codex',
      displayOrder: 0,
      authenticationKind: 'oauth',
      credentialName: null,
      settingsOrder: 0,
      iconKey: 'openai',
      startWindowAfterReset: true,
      barProvider: true,
    })
  }

  protected getAuthReader(): AuthReader<CodexAuth> {
    return this.codexAuthReader
  }

  protected shouldRefresh(auth: CodexAuth, now: Date): boolean {
    return (
      Boolean(auth.refreshToken) &&
      (!auth.lastRefresh ||
        now.getTime() - new Date(auth.lastRefresh).getTime() > REFRESH_INTERVAL_MS)
    )
  }

  protected async refreshAuth(auth: CodexAuth, now: Date): Promise<CodexAuth> {
    if (!auth.refreshToken) return auth
    const body = new URLSearchParams({
      client_id: OAUTH_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: auth.refreshToken,
      scope: 'openid profile email',
    })
    const document = (await postForm(REFRESH_ENDPOINT, body)) as Record<string, unknown>
    return {
      accessToken: readAccessToken(document) ?? auth.accessToken,
      accountId: auth.accountId,
      refreshToken: getString(document, 'refresh_token') ?? auth.refreshToken,
      idToken: getString(document, 'id_token') ?? auth.idToken,
      lastRefresh: now.toISOString(),
    }
  }

  protected async fetchUsage(auth: CodexAuth): Promise<unknown> {
    const headers = codexHeaders(auth.accessToken, auth.accountId)
    const [document, resetCredits] = await Promise.all([
      getJson(new Request(USAGE_ENDPOINT, { headers })),
      getJson(new Request(RESET_CREDITS_ENDPOINT, { headers })).catch(() => null),
    ])
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('Codex usage response was not a JSON object.')
    }
    const root = document as Record<string, unknown>
    // The usage payload carries only the reset summary, so merge the dedicated
    // reset-credits payload best-effort for the notice expiry date.
    // A failed supplemental call leaves the summary untouched (count-only notice).
    mergeResetCreditDetails(root, resetCredits)
    return root
  }

  protected buildResult(raw: unknown, _auth: CodexAuth, now: Date): MetricResult | null {
    const root = raw as Record<string, unknown>
    const plan = readPlanLabel(getString(root, 'plan_type'))
    const rateLimit = getRateLimit(root)
    const session = readWindow(rateLimit, 'primary_window', 'Session', now)
    const weekly = readWindow(rateLimit, 'secondary_window', 'Weekly', now)
    if (!session && !weekly) {
      throw new ProviderError('Codex response did not contain usable rate limit windows.')
    }

    const windows: UsageWindow[] = []
    if (session) windows.push(session)
    if (weekly) windows.push(weekly)

    // Reset-credits expiry was merged into the payload by fetchUsage.
    const notice = readResetNotice(root, now)

    return { providerName: 'Codex', plan, windows, notice }
  }

  /** Public helpers for window-start capability. */
  public async getAccessToken(): Promise<string | null> {
    return (await this.codexAuthReader.read())?.accessToken ?? null
  }

  public async getAccountId(): Promise<string | null> {
    return (await this.codexAuthReader.read())?.accountId ?? null
  }
}
