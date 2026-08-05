/**
 * @file AntigravityProvider.ts
 * @description Queries Antigravity (Gemini Code Assist) quota usage across session/daily/weekly/monthly windows using CLI OAuth credentials.
 */

import { arch, platform } from 'node:os'
import type { MetricResult, UsageWindow } from '@shared/types'
import { getNumber, getObject, getString } from '../ProviderJson'
import { getJsonWithHeaders, postForm, postJsonWithHeaders, ProviderError } from '../ProviderHttp'
import { capitalize, resetDuration } from '../UsageFormatting'
import { executeAuthFlow } from '../ProviderAuthFlow'
import type AntigravityAuthReader from '../AntigravityAuthReader'
import type { AntigravityAuth } from '../AntigravityAuthReader'

/** Endpoint for resolving the GCP project and tier associated with the user's Code Assist subscription. */
const LOAD_CODE_ASSIST_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'
/** Endpoint for retrieving per-window quota summary. */
const QUOTA_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary'
/** Google OAuth2 token refresh endpoint. */
const TOKEN_REFRESH_ENDPOINT = 'https://oauth2.googleapis.com/token'
/** GitHub releases endpoint used to discover the latest Antigravity CLI version. */
const GITHUB_RELEASES_ENDPOINT = 'https://api.github.com/repos/google-antigravity/antigravity-cli/releases/latest'
/** OAuth2 client ID registered for the Antigravity CLI. */
const OAUTH_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com'
/** OAuth2 client secret registered for the Antigravity CLI. */
const OAUTH_CLIENT_SECRET = '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'
/** Fallback CLI version string used when GitHub release lookup fails. */
const DEFAULT_CLI_VERSION = '1.0.14'
/** User-Agent prefix for all Antigravity API requests. */
const USER_AGENT_PREFIX = 'antigravity/cli'

/**
 * Returns a sort rank for a window label so windows appear in chronological order.
 *
 * @param label - Window label string
 * @returns Integer rank (lower = shorter window)
 */
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

/**
 * Maps raw API window strings to display-friendly labels.
 *
 * @param label - Raw label from API response
 * @returns Mapped display label
 */
const mapWindowLabel = (label: string): string => (label === '5h' ? 'Session' : label)

/**
 * Extracts a human-readable plan label from the raw tier identifier.
 *
 * @param tierId - Raw tier ID string or null
 * @returns Capitalized plan name or null
 */
const planLabel = (tierId: string | null): string | null => {
  if (!tierId || tierId.trim() === '') return null
  const parts = tierId.split('-', 2)
  return capitalize(parts[0] ?? tierId)
}

/**
 * Service provider for querying Antigravity (Gemini Code Assist) usage metrics.
 */
export default class AntigravityProvider {
  /** Provider display name. */
  readonly providerName = 'Antigravity'

  /** Cached GCP project ID resolved on first query. */
  private cachedProjectId: string | null = null
  /** Cached subscription tier ID resolved on first query. */
  private cachedTierId: string | null = null
  /** Cached latest Antigravity CLI version string. */
  private cachedCliVersion: string | null = null

  /**
   * Initializes a new instance of AntigravityProvider.
   *
   * @param authReader - AntigravityAuthReader instance for credential access
   */
  public constructor(private readonly authReader: AntigravityAuthReader) {}

  /**
   * Checks whether valid Antigravity credentials are available.
   *
   * @returns True if an access token is present
   */
  public isConfigured = async (): Promise<boolean> =>
    Boolean((await this.authReader.read())?.accessToken)

  /**
   * Queries Antigravity quota usage windows.
   *
   * @param now - Current timestamp used for expiry and reset calculations
   * @param allowRefresh - Whether to attempt OAuth token refresh on expiry
   * @returns MetricResult with quota windows, or null if credentials are missing
   * @throws ProviderError if the API response is invalid
   */
  public async query(now: Date, allowRefresh: boolean): Promise<MetricResult | null> {
    const auth = await this.authReader.read()
    if (!auth) return null

    const shouldRefresh = (value: AntigravityAuth): boolean =>
      Boolean(value.refreshToken) &&
      (value.expiry === null ||
        value.expiry === undefined ||
        now.getTime() >= new Date(value.expiry).getTime())

    const refreshAsync = async (value: AntigravityAuth): Promise<AntigravityAuth> => {
      if (!value.refreshToken) return value
      const body = new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
        refresh_token: value.refreshToken,
        grant_type: 'refresh_token',
      })
      const document = (await postForm(TOKEN_REFRESH_ENDPOINT, body)) as Record<string, unknown>
      const newAccessToken = getString(document, 'access_token')
      if (!newAccessToken) {
        throw new ProviderError('Antigravity token refresh response did not include an access token.')
      }
      const expiresIn = getNumber(document, 'expires_in')
      const expiry = expiresIn !== null ? new Date(now.getTime() + expiresIn * 1_000) : null
      const refreshed: AntigravityAuth = {
        accessToken: newAccessToken,
        refreshToken: getString(document, 'refresh_token') ?? value.refreshToken,
        expiry: expiry ? expiry.toISOString() : value.expiry,
        idToken: getString(document, 'id_token') ?? value.idToken,
      }
      try {
        this.authReader.save(refreshed)
      } catch {
        // The refreshed credential remains valid for this query even if persistence fails.
      }
      return refreshed
    }

    const buildUserAgent = (): string =>
      `${USER_AGENT_PREFIX}/${this.cachedCliVersion ?? DEFAULT_CLI_VERSION} (aidev_client; os_type=${this.osType()}; arch=${this.architecture()})`

    const ensureInitialized = async (value: AntigravityAuth): Promise<void> => {
      if (this.cachedProjectId !== null) return
      const [project, version] = await Promise.all([
        this.fetchProjectAsync(value, buildUserAgent()),
        this.fetchLatestVersionAsync(),
      ])
      this.cachedProjectId = project.projectId
      this.cachedTierId = project.tierId
      this.cachedCliVersion = version
    }

    const fetchUsageDocument = async (value: AntigravityAuth): Promise<Record<string, unknown>> => {
      await ensureInitialized(value)
      const document = (await postJsonWithHeaders(
        QUOTA_ENDPOINT,
        { project: this.cachedProjectId },
        {
          Authorization: `Bearer ${value.accessToken}`,
          Accept: 'application/json',
          'User-Agent': buildUserAgent(),
        },
      )) as unknown
      if (!document || typeof document !== 'object' || Array.isArray(document)) {
        throw new ProviderError('Antigravity quota response was not a JSON object.')
      }
      return document as Record<string, unknown>
    }

    const { result } = await executeAuthFlow({
      auth,
      allowRefresh,
      readLatestAuth: () => this.authReader.read(),
      shouldRefresh,
      refreshAsync,
      executeAsync: fetchUsageDocument,
    })

    return this.parseQuotaResponse(result as Record<string, unknown>, now)
  }

  /**
   * Parses the raw quota API response into a MetricResult.
   *
   * @param root - Raw JSON response object
   * @param now - Current timestamp for reset duration calculation
   * @returns Parsed MetricResult
   * @throws ProviderError if no usable buckets are found
   */
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
      const groupName = (getString(groupRecord, 'displayName') ?? '')
        .replace(/models/i, '')
        .trim()
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
        const label = windowLabel || groupName
        windows.push({
          groupIndex,
          window: {
            providerName: 'Antigravity',
            label,
            usedPercent: Math.min(100, Math.max(0, usedPercent)),
            resetText,
            subLabel:
              windowLabel && groupName ? groupName : null,
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
      plan: planLabel(this.cachedTierId),
      windows: windows.map((entry) => entry.window),
    }
  }

  /**
   * Fetches the GCP project ID and subscription tier from the Code Assist API.
   *
   * @param auth - Current Antigravity OAuth credentials
   * @param userAgent - User-Agent header string
   * @returns Object containing projectId and optional tierId
   * @throws ProviderError if the response is invalid or project ID is missing
   */
  private async fetchProjectAsync(
    auth: AntigravityAuth,
    userAgent: string,
  ): Promise<{ projectId: string; tierId: string | null }> {
    const document = (await postJsonWithHeaders(
      LOAD_CODE_ASSIST_ENDPOINT,
      { metadata: { ideType: 'ANTIGRAVITY' } },
      {
        Authorization: `Bearer ${auth.accessToken}`,
        Accept: 'application/json',
        'User-Agent': userAgent,
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

  /**
   * Fetches the latest Antigravity CLI release tag from GitHub.
   *
   * @returns Version string (e.g. "1.0.14")
   */
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
      // Version discovery is optional; use the last known compatible fallback.
    }
    return DEFAULT_CLI_VERSION
  }

  /**
   * Returns a normalized OS type string compatible with Antigravity CLI User-Agent format.
   *
   * @returns OS type string: 'windows', 'darwin', or 'linux'
   */
  private osType(): string {
    switch (platform()) {
      case 'win32':
        return 'windows'
      case 'darwin':
        return 'darwin'
      default:
        return 'linux'
    }
  }

  /**
   * Returns a normalized CPU architecture string compatible with Antigravity CLI User-Agent format.
   *
   * @returns Architecture string: 'amd64', 'arm64', '386', 'arm', or Node arch fallback
   */
  private architecture(): string {
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
}
