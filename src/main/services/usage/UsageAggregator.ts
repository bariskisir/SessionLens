/**
 * @file UsageAggregator.ts
 * @description Orchestrates concurrent usage queries across all configured LLM and service providers with fault isolation.
 */

import type { AppSettings, ProviderResult, UsageSnapshot } from '@shared/types'
import { createProviderContext } from './ProviderQueryContext'
import type CodexProvider from './providers/CodexProvider'
import type ClaudeProvider from './providers/ClaudeProvider'
import type DeepSeekProvider from './providers/DeepSeekProvider'
import type OpenRouterProvider from './providers/OpenRouterProvider'
import type AntigravityProvider from './providers/AntigravityProvider'
import type CommandCodeProvider from './providers/CommandCodeProvider'
import type CopilotProvider from './providers/CopilotProvider'
import type WarpProvider from './providers/WarpProvider'
import type SyntheticProvider from './providers/SyntheticProvider'
import type ChutesProvider from './providers/ChutesProvider'
import type ZaiProvider from './providers/ZaiProvider'
import type ElevenLabsProvider from './providers/ElevenLabsProvider'
import type AlibabaProvider from './providers/AlibabaProvider'
import type MiniMaxProvider from './providers/MiniMaxProvider'
import type KiloProvider from './providers/KiloProvider'
import type CodebuffProvider from './providers/CodebuffProvider'
import type OpenAIProvider from './providers/OpenAIProvider'
import type VeniceProvider from './providers/VeniceProvider'
import type ZenMuxProvider from './providers/ZenMuxProvider'
import type CrofProvider from './providers/CrofProvider'
import type MoonshotProvider from './providers/MoonshotProvider'
import type PoeProvider from './providers/PoeProvider'
import type DeepgramProvider from './providers/DeepgramProvider'
import type LoggerService from '../LoggerService'

/** Map of all supported provider service instances. */
export interface ProviderRegistry {
  codex: CodexProvider
  claude: ClaudeProvider
  deepseek: DeepSeekProvider
  openrouter: OpenRouterProvider
  antigravity: AntigravityProvider
  commandcode: CommandCodeProvider
  copilot: CopilotProvider
  warp: WarpProvider
  synthetic: SyntheticProvider
  chutes: ChutesProvider
  zai: ZaiProvider
  elevenlabs: ElevenLabsProvider
  alibaba: AlibabaProvider
  minimax: MiniMaxProvider
  kilo: KiloProvider
  codebuff: CodebuffProvider
  openai: OpenAIProvider
  venice: VeniceProvider
  zenmux: ZenMuxProvider
  crof: CrofProvider
  moonshot: MoonshotProvider
  poe: PoeProvider
  deepgram: DeepgramProvider
}

/** Individual provider query task with order index. */
interface SelectedProvider {
  displayOrder: number
  query: () => Promise<ProviderResult | null>
}

/** Maximum timeout in milliseconds for an individual provider query. */
const PROVIDER_TIMEOUT_MS = 45_000

/**
 * Aggregates usage metrics and balance data from multiple AI service providers.
 */
export default class UsageAggregator {
  /**
   * Initializes a new instance of UsageAggregator.
   *
   * @param providers - Registry containing initialized provider service instances
   * @param logger - Service for logging system events
   */
  public constructor(
    private readonly providers: ProviderRegistry,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Queries all enabled and configured providers concurrently, isolating provider-local failures.
   *
   * @param settings - Current application configuration settings
   * @returns Snapshot containing aggregated results and usage window metrics
   */
  public async refreshAsync(settings: AppSettings): Promise<UsageSnapshot> {
    const now = new Date()
    const context = createProviderContext(settings, now)
    const selected: SelectedProvider[] = []

    for (let i = 0; i < settings.providers.length; i++) {
      const provider = settings.providers[i]
      if (provider === undefined || !provider.enabled) continue
      const entry = this.selectProvider(provider, context.apiKeys, now)
      if (entry) {
        entry.displayOrder = i
        selected.push(entry)
      }
    }

    this.logger.info('UsageAggregator', 'Provider selection completed.', {
      registered: settings.providers.length,
      configured: selected.length,
    })

    selected.sort((left, right) => left.displayOrder - right.displayOrder)

    const outcomes = await Promise.allSettled(
      selected.map(async (entry) => {
        const timeout = new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), PROVIDER_TIMEOUT_MS)
        })
        return Promise.race([entry.query(), timeout])
      }),
    )

    const results: ProviderResult[] = []
    for (let i = 0; i < outcomes.length; i++) {
      const outcome = outcomes[i]
      const providerName = selected[i]?.query.name ?? 'unknown'
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

  /**
   * Resolves a provider query task based on provider ID/type.
   *
   * @param provider - Provider configuration item from settings
   * @param apiKeys - Map of resolved API keys by credential name
   * @param now - Current reference timestamp
   * @returns Configured query wrapper or null if missing credentials
   */
  private selectProvider(
    provider: AppSettings['providers'][number],
    apiKeys: Map<string, string>,
    now: Date,
  ): SelectedProvider | null {
    const key = (provider.id ?? provider.name).toLowerCase()

    // OAuth providers use built-in credential readers, no API key needed.
    const oauthProviders: Record<string, () => Promise<ProviderResult | null>> = {
      codex: () => this.providers.codex.query(now, provider.refreshToken),
      claude: () => this.providers.claude.query(now, provider.refreshToken),
      antigravity: () => this.providers.antigravity.query(now, provider.refreshToken),
    }
    if (key in oauthProviders) {
      const queryFn = oauthProviders[key]
      if (queryFn) return { displayOrder: 0, query: queryFn }
    }

    // API key providers require a resolved credential before querying.
    const apiKey = this.resolveApiKey(provider, apiKeys)
    if (!apiKey) return null

    const apiKeyProviders: Record<string, () => Promise<ProviderResult | null>> = {
      commandcode: () => this.providers.commandcode.query(apiKey, now),
      copilot: () => this.providers.copilot.query(apiKey, now),
      warp: () => this.providers.warp.query(apiKey, now),
      synthetic: () => this.providers.synthetic.query(apiKey, now),
      zai: () => this.providers.zai.query(apiKey, now),
      elevenlabs: () => this.providers.elevenlabs.query(apiKey, now),
      codebuff: () => this.providers.codebuff.query(apiKey, now),
      alibaba: () => this.providers.alibaba.query(apiKey, now),
      deepseek: () => this.providers.deepseek.query(apiKey),
      openrouter: () => this.providers.openrouter.query(apiKey),
      openai: () => this.providers.openai.query(apiKey),
      venice: () => this.providers.venice.query(apiKey),
      zenmux: () => this.providers.zenmux.query(apiKey),
      crof: () => this.providers.crof.query(apiKey),
      moonshot: () => this.providers.moonshot.query(apiKey),
      poe: () => this.providers.poe.query(apiKey),
      deepgram: () => this.providers.deepgram.query(apiKey),
      chutes: () => this.providers.chutes.query(apiKey, now),
      minimax: () => this.providers.minimax.query(apiKey, now),
      kilo: () => this.providers.kilo.query(apiKey, now),
    }
    if (key in apiKeyProviders) {
      const queryFn = apiKeyProviders[key]
      if (queryFn) return { displayOrder: 0, query: queryFn }
    }

    return null
  }

  /**
   * Resolves the API key for a provider from memory or process environment variables.
   *
   * @param provider - Provider configuration item
   * @param apiKeys - Map of pre-resolved API keys
   * @returns Resolved API key string or null if unavailable
   */
  private resolveApiKey(
    provider: AppSettings['providers'][number],
    apiKeys: Map<string, string>,
  ): string | null {
    if (provider.credential) {
      const resolved = apiKeys.get(provider.credential)
      if (resolved) return resolved
    }
    if (!provider.credential) return null
    const envValue = process.env[provider.credential]
    return envValue && envValue.trim() !== '' ? envValue : null
  }
}
