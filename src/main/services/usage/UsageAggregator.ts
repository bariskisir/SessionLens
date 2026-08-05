/**
 * @file UsageAggregator.ts
 * @description Orchestrates concurrent usage queries across all configured providers with fault isolation.
 */

import type { AppSettings, ProviderResult, UsageSnapshot } from '@shared/types'
import { createProviderContext } from '../../../main/providers/IProvider'
import type { IProvider } from '../../../main/providers/IProvider'
import type LoggerService from '../LoggerService'

/** Maximum timeout in milliseconds for an individual provider query. */
const PROVIDER_TIMEOUT_MS = 45_000

/**
 * Aggregates usage metrics and balance data from multiple AI service providers.
 */
export default class UsageAggregator {
  /**
   * @param providers - Flat list of all registered IProvider instances
   * @param logger - Service for logging system events
   */
  public constructor(
    private readonly providers: IProvider[],
    private readonly logger: LoggerService,
  ) {}

  /**
   * Queries all enabled and configured providers concurrently, isolating
   * provider-local failures with per-provider timeouts.
   *
   * @param settings - Current application configuration settings
   * @returns Snapshot containing aggregated results and usage window metrics
   */
  public async refreshAsync(settings: AppSettings): Promise<UsageSnapshot> {
    const now = new Date()
    const context = createProviderContext(settings, now)

    // Build a lookup of enabled provider IDs from settings
    const enabledIds = new Set(
      settings.providers.filter((p) => p.enabled).map((p) => (p.id ?? p.name).toLowerCase()),
    )

    // Select providers that are enabled AND configured
    const selected = this.providers
      .filter((p) => enabledIds.has(p.id))
      .filter((p) => p.isConfigured(context))

    this.logger.info('UsageAggregator', 'Provider selection completed.', {
      registered: settings.providers.length,
      configured: selected.length,
    })

    const outcomes = await Promise.allSettled(
      selected.map(async (provider) => {
        const timeout = new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), PROVIDER_TIMEOUT_MS)
        })
        return Promise.race([provider.query(context), timeout])
      }),
    )

    const results: ProviderResult[] = []
    for (let i = 0; i < outcomes.length; i++) {
      const outcome = outcomes[i]
      const providerName = selected[i]?.providerName ?? 'unknown'
      if (!outcome) continue
      if (outcome.status === 'fulfilled' && outcome.value !== null) {
        results.push(outcome.value)
      } else if (outcome.status === 'rejected') {
        this.logger.warn('UsageAggregator', 'Provider query failed.', {
          provider: providerName,
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        })
      }
    }

    const windows = results.flatMap((result) => ('windows' in result ? result.windows : []))
    return { results, windows }
  }
}
