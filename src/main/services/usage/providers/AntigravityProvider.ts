/**
 * @file AntigravityProvider.ts
 * @description Queries Antigravity (Gemini Code Assist) quota usage across session/daily/weekly/monthly windows using CLI OAuth credentials.
 */

import { arch, platform } from 'node:os'
import type { MetricResult, UsageWindow } from '@shared/types'
import { getNumber, getObject, getString } from '../ProviderJson'
import { getJsonWithHeaders, postForm, postJsonWithHeaders, ProviderError } from '../ProviderHttp'
import { capitalize, resetDuration } from '../UsageFormatting'
import { BaseOAuthProvider } from '../../../../main/providers/BaseOAuthProvider'
import type AntigravityAuthReader from '../AntigravityAuthReader'
import type { AntigravityAuth } from '../AntigravityAuthReader'

const LOAD_CODE_ASSIST_ENDPOINT =
  'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'
const QUOTA_ENDPOINT =
  'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary'
const TOKEN_REFRESH_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GITHUB_RELEASES_ENDPOINT =
  'https://api.github.com/repos/google-antigravity/antigravity-cli/releases/latest'
const OAUTH_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com'
const OAUTH_CLIENT_SECRET = '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'
const DEFAULT_CLI_VERSION = '1.0.14'
const USER_AGENT_PREFIX = 'antigravity/cli'

const windowRank = (label: string): number => {
  switch (label) {
    case 'Session':
      return 0
    case 'Daily':
      return 1
    case 'Weekly':
      return 2
    case 'Monthly':
      return 3
    default:
      return 4
  }
}

const mapWindowLabel = (label: string): string => (label === '5h' ? 'Session' : label)

const readPlanLabel = (tierId: string | null): string | null => {
  if (!tierId || tierId.trim() === '') return null
  const parts = tierId.split('-', 2)
  return capitalize(parts[0] ?? tierId)
}

const osType = (): string => {
  switch (platform()) {
    case 'win32':
      return 'windows'
    case 'darwin':
      return 'darwin'
    default:
      return 'linux'
  }
}

const cpuArch = (): string => {
  switch (arch()) {
    case 'x64':
      return 'amd64'
    case 'arm64':
      return 'arm64'
    case 'ia32':
      return '386'
    case 'arm':
      return 'arm'
    default:
      return arch()
  }
}

export default class AntigravityProvider extends BaseOAuthProvider<AntigravityAuth> {
  private cachedProjectId: string | null = null
  private cachedTierId: string | null = null
  private cachedCliVersion: string | null = null

  public constructor(private readonly authReader: AntigravityAuthReader) {
    super({
      id: 'antigravity',
      name: 'Antigravity',
      displayOrder: 5,
      authenticationKind: 'oauth',
      credentialName: null,
      settingsOrder: 2,
      iconKey: 'antigravity',
      startWindowAfterReset: true,
      barProvider: true,
    })
  }

  protected getAuthReader() {
    return this.authReader
  }

  protected shouldRefresh(auth: AntigravityAuth, now: Date): boolean {
    return (
      Boolean(auth.refreshToken) &&
      (auth.expiry === null ||
        auth.expiry === undefined ||
        now.getTime() >= new Date(auth.expiry).getTime())
    )
  }

  protected async refreshAuth(auth: AntigravityAuth, now: Date): Promise<AntigravityAuth> {
    if (!auth.refreshToken) return auth
    const body = new URLSearchParams({
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      refresh_token: auth.refreshToken,
      grant_type: 'refresh_token',
    })
    const document = (await postForm(TOKEN_REFRESH_ENDPOINT, body)) as Record<string, unknown>
    const newAccessToken = getString(document, 'access_token')
    if (!newAccessToken) {
      throw new ProviderError('Antigravity token refresh response did not include an access token.')
    }
    const expiresIn = getNumber(document, 'expires_in')
    const expiry = expiresIn !== null ? new Date(now.getTime() + expiresIn * 1_000) : null
    return {
      accessToken: newAccessToken,
      refreshToken: getString(document, 'refresh_token') ?? auth.refreshToken,
      expiry: expiry ? expiry.toISOString() : auth.expiry,
      idToken: getString(document, 'id_token') ?? auth.idToken,
    }
  }

  protected async fetchUsage(auth: AntigravityAuth): Promise<unknown> {
    await this.ensureInitialized(auth)
    const document = (await postJsonWithHeaders(
      QUOTA_ENDPOINT,
      { project: this.cachedProjectId },
      {
        Authorization: `Bearer ${auth.accessToken}`,
        Accept: 'application/json',
        'User-Agent': this.buildUserAgent(),
      },
    )) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('Antigravity quota response was not a JSON object.')
    }
    return document as Record<string, unknown>
  }

  protected buildResult(raw: unknown, _auth: AntigravityAuth, now: Date): MetricResult | null {
    return this.parseQuotaResponse(raw as Record<string, unknown>, now)
  }

  // -----------------------------------------------------------------------
  // Initialisation (cached project/tier/CLI version lookup)
  // -----------------------------------------------------------------------

  private async ensureInitialized(auth: AntigravityAuth): Promise<void> {
    if (this.cachedProjectId !== null) return
    const [project, version] = await Promise.all([
      this.fetchProjectAsync(auth),
      this.fetchLatestVersionAsync(),
    ])
    this.cachedProjectId = project.projectId
    this.cachedTierId = project.tierId
    this.cachedCliVersion = version
  }

  private async fetchProjectAsync(
    auth: AntigravityAuth,
  ): Promise<{ projectId: string; tierId: string | null }> {
    const document = (await postJsonWithHeaders(
      LOAD_CODE_ASSIST_ENDPOINT,
      { metadata: { ideType: 'ANTIGRAVITY' } },
      {
        Authorization: `Bearer ${auth.accessToken}`,
        Accept: 'application/json',
        'User-Agent': this.buildUserAgent(),
      },
    )) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ProviderError('Antigravity loadCodeAssist response was not a JSON object.')
    }
    const root = document as Record<string, unknown>
    const projectId = getString(root, 'cloudaicompanionProject')
    if (!projectId || projectId.trim() === '') {
      throw new ProviderError(
        'Antigravity loadCodeAssist response did not contain cloudaicompanionProject.',
      )
    }
    const currentTier = getObject(root, 'currentTier')
    const tierId = currentTier ? getString(currentTier, 'id') : null
    return { projectId, tierId }
  }

  private async fetchLatestVersionAsync(): Promise<string> {
    try {
      const document = (await getJsonWithHeaders(GITHUB_RELEASES_ENDPOINT, {
        Accept: 'application/json',
        'User-Agent': 'SessionLens',
      })) as unknown
      if (document && typeof document === 'object' && !Array.isArray(document)) {
        const tagName = getString(document as Record<string, unknown>, 'tag_name')
        if (tagName && tagName.trim() !== '') {
          return tagName.startsWith('v') ? tagName.slice(1) : tagName
        }
      }
    } catch {
      /* fall through to default */
    }
    return DEFAULT_CLI_VERSION
  }

  // -----------------------------------------------------------------------
  // Quota parsing
  // -----------------------------------------------------------------------

  private parseQuotaResponse(root: Record<string, unknown>, now: Date): MetricResult {
    const groups = root.groups
    if (!Array.isArray(groups)) {
      throw new ProviderError('Antigravity quota response did not contain groups.')
    }
    const windows: { groupIndex: number; window: UsageWindow }[] = []
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex]
      if (!group || typeof group !== 'object') continue
      const groupRecord = group as Record<string, unknown>
      const groupName = (getString(groupRecord, 'displayName') ?? '').replace(/models/i, '').trim()
      const buckets = groupRecord.buckets
      if (!Array.isArray(buckets)) continue
      for (const bucket of buckets) {
        if (!bucket || typeof bucket !== 'object') continue
        const bucketRecord = bucket as Record<string, unknown>
        const remainingFraction = getNumber(bucketRecord, 'remainingFraction')
        if (remainingFraction === null) continue
        const rawWindow = getString(bucketRecord, 'window') ?? ''
        const windowLabel = mapWindowLabel(capitalize(rawWindow))
        const usedPercent = (1 - remainingFraction) * 100
        const resetTimeRaw = getString(bucketRecord, 'resetTime')
        let resetText: string | null = null
        if (resetTimeRaw) {
          const parsed = new Date(resetTimeRaw)
          if (!Number.isNaN(parsed.getTime())) {
            resetText = resetDuration(parsed.getTime() - now.getTime())
          }
        }
        windows.push({
          groupIndex,
          window: {
            providerName: 'Antigravity',
            label: windowLabel || groupName,
            usedPercent: Math.min(100, Math.max(0, usedPercent)),
            resetText,
            subLabel: windowLabel && groupName ? groupName : null,
          },
        })
      }
    }
    if (windows.length === 0) {
      throw new ProviderError('Antigravity quota response did not contain usable buckets.')
    }
    windows.sort((left, right) => {
      if (left.groupIndex !== right.groupIndex) return left.groupIndex - right.groupIndex
      return windowRank(left.window.label) - windowRank(right.window.label)
    })
    return {
      providerName: 'Antigravity',
      plan: readPlanLabel(this.cachedTierId),
      windows: windows.map((entry) => entry.window),
    }
  }

  private buildUserAgent(): string {
    const version = this.cachedCliVersion ?? DEFAULT_CLI_VERSION
    return `${USER_AGENT_PREFIX}/${version} (aidev_client; os_type=${osType()}; arch=${cpuArch()})`
  }
}
