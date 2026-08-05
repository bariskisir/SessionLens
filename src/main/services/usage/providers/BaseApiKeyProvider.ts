/**
 * @file BaseApiKeyProvider.ts
 * @description Abstract base class for API-key authenticated providers, providing shared configuration detection.
 */

import type { BalanceResult, MetricResult, ProviderResult } from '@shared/types'

export abstract class BaseApiKeyProvider {
  /** Display name used in settings, tooltips, and tray icon layout. */
  abstract readonly providerName: string

  /**
   * Returns true when the provider has a non-empty API key configured.
   *
   * @param apiKey - API key string or null from settings or environment
   */
  isConfigured(apiKey: string | null): boolean {
    return Boolean(apiKey && apiKey.trim() !== '')
  }

  /**
   * Queries the provider for usage data.
   *
   * Implemented by each concrete provider with its own signature since metrics,
   * balance, and hybrid providers accept different parameters.
   */
  abstract query(...args: unknown[]): Promise<ProviderResult | null>
}

/**
 * Narrowing helper for API key metric providers that produce usage windows.
 */
export abstract class BaseMetricProvider extends BaseApiKeyProvider {
  abstract override query(apiKey: string, now: Date): Promise<MetricResult | null>
}

/**
 * Narrowing helper for API key balance providers that produce formatted balance text.
 */
export abstract class BaseBalanceProvider extends BaseApiKeyProvider {
  abstract override query(apiKey: string): Promise<BalanceResult>
}

/**
 * Narrowing helper for API key providers that can produce either metrics or balance.
 */
export abstract class BaseHybridProvider extends BaseApiKeyProvider {
  abstract override query(apiKey: string, now: Date): Promise<MetricResult | BalanceResult | null>
}
