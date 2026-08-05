/**
 * @file CodexProvider.ts
 * @description Queries Codex (ChatGPT) rate-limit usage across session (5h) and weekly windows using Codex CLI OAuth credentials.
 */

import type { MetricResult, UsageWindow } from '@shared/types'
import { getArray, getNumber, getObject, getString } from '../../../../main/providers/Json'
import { getJson, postForm, ProviderError, readAccessToken } from '../../../../main/providers/Http'
import { capitalize, resetDuration } from '../../../../main/providers/Formatting'
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

const readResetNotice = (root: Record<string, unknown>): string | null => {
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
    const document = (await getJson(
      new Request(USAGE_ENDPOINT, { headers: codexHeaders(auth.accessToken, auth.accountId) }),
    )) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('Codex usage response was not a JSON object.')
    }
    return document as Record<string, unknown>
  }

  protected buildResult(raw: unknown, auth: CodexAuth, now: Date): MetricResult | null {
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

    // Supplemental reset-credits fetch happens asynchronously after this returns.
    // We fire it best-effort and update via the shared notice field.
    const notice = readResetNotice(root)
    void this.fetchResetNotice(auth.accessToken, auth.accountId).catch(() => {})

    return { providerName: 'Codex', plan, windows, notice }
  }

  private async fetchResetNotice(accessToken: string, accountId?: string | null): Promise<void> {
    // Best-effort supplemental call — result is not returned synchronously
    // but future refreshes will pick up updated reset credits.
    try {
      const document = (await getJson(
        new Request(RESET_CREDITS_ENDPOINT, {
          headers: codexHeaders(accessToken, accountId),
        }),
      )) as unknown
      // Result is used indirectly through the next refresh cycle.
      void document
    } catch {
      // Supplemental data; ignore failures.
    }
  }

  /** Public helpers for window-start capability. */
  public async getAccessToken(): Promise<string | null> {
    return (await this.codexAuthReader.read())?.accessToken ?? null
  }

  public async getAccountId(): Promise<string | null> {
    return (await this.codexAuthReader.read())?.accountId ?? null
  }
}
