/**
 * @file IProvider.ts
 * @description Unified provider interface and per-refresh query context shared by all provider implementations.
 */

import type { AppSettings, ProviderResult } from '@shared/types'

/**
 * Per-refresh execution context containing the resolved timestamp, API key
 * lookups, and token-refresh permission map derived from current settings.
 */
export interface ProviderQueryContext {
  now: Date
  apiKeys: Map<string, string>
  refreshTokenMap: Map<string, boolean>
}

/**
 * Builds a query context from application settings plus environment variable fallbacks.
 * Each provider receives this context once per refresh cycle.
 *
 * @param settings - Current application settings
 * @param now - Current reference timestamp
 * @returns Constructed ProviderQueryContext
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
 * Resolves an API key from settings, falling back to the same-named environment variable.
 */
const resolveApiKey = (
  settingsValue: string | null | undefined,
  environmentVariableName: string,
): string | null => {
  if (settingsValue && settingsValue.trim() !== '') return settingsValue.trim()
  const envValue = process.env[environmentVariableName]
  return envValue && envValue.trim() !== '' ? envValue : null
}

/**
 * Unified interface that every provider (OAuth and API key) implements.
 */
export interface IProvider {
  /** Unique provider identifier matching ProviderDescriptor.id. */
  readonly id: string
  /** Display name shown in settings, tooltips, and tray layout. */
  readonly providerName: string

  /**
   * Returns true when the provider has usable credentials for the given context.
   * OAuth providers check their auth reader; API key providers check context.apiKeys.
   */
  isConfigured(context: ProviderQueryContext): Promise<boolean> | boolean

  /**
   * Queries the provider for usage or balance data.
   * Returns null when credentials are missing or unavailable.
   */
  query(context: ProviderQueryContext): Promise<ProviderResult | null>
}
