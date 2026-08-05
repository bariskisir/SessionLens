/**
 * @file ProviderQueryContext.ts
 * @description Builds per-refresh execution context containing reference timestamps, API key lookups, and refresh permissions.
 */

import type { AppSettings } from '@shared/types'

/** Context object passed to provider query methods during refresh. */
export interface ProviderQueryContext {
  now: Date
  apiKeys: Map<string, string>
  refreshTokenMap: Map<string, boolean>
}

/**
 * Resolves an API key from settings, falling back to the same-named environment variable.
 *
 * @param settingsValue - Configured API key string from settings
 * @param environmentVariableName - Name of the environment variable fallback
 * @returns Resolved non-empty API key string or null
 */
export const resolveApiKey = (
  settingsValue: string | null | undefined,
  environmentVariableName: string,
): string | null => {
  if (settingsValue && settingsValue.trim() !== '') return settingsValue.trim()
  const envValue = process.env[environmentVariableName]
  return envValue && envValue.trim() !== '' ? envValue : null
}

/**
 * Builds a provider context from application settings plus environment variable fallbacks.
 *
 * @param settings - Current application settings
 * @param now - Current reference timestamp
 * @returns Constructed ProviderQueryContext object
 */
export const createProviderContext = (settings: AppSettings, now: Date): ProviderQueryContext => {
  const apiKeys = new Map<string, string>()
  const refreshTokenMap = new Map<string, boolean>()

  for (const provider of settings.providers) {
    refreshTokenMap.set(provider.name.toLowerCase(), provider.refreshToken)
    if (provider.id) refreshTokenMap.set(provider.id.toLowerCase(), provider.refreshToken)
    if (provider.type !== 'apiKey' || !provider.credential) continue
    const resolved = resolveApiKey(provider.apiKey, provider.credential)
    if (resolved) apiKeys.set(provider.credential, resolved)
  }

  return { now, apiKeys, refreshTokenMap }
}

/**
 * Returns whether the named provider is allowed to refresh its OAuth token.
 *
 * @param context - Active query context
 * @param providerName - Target provider name or ID
 * @returns True if token refresh is permitted
 */
export const canRefreshToken = (context: ProviderQueryContext, providerName: string): boolean =>
  context.refreshTokenMap.get(providerName.toLowerCase()) ?? true
