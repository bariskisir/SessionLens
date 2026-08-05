/**
 * @file UsageWindowStartService.ts
 * @description Monitors window observations between refreshes and triggers warm-up start requests when reset deadlines advance.
 */

import type { AppSettings, UsageWindow } from '@shared/types'
import type LoggerService from '../LoggerService'
import type WindowStartRequestSender from './WindowStartRequestSender'

/** Tolerance threshold in milliseconds for reset timestamp drift. */
const RESET_DEADLINE_DRIFT_TOLERANCE_MS = 60_000
/** Supported provider IDs for window warming functionality. */
const SUPPORTED_PROVIDERS = new Set(['codex', 'claude', 'antigravity'])

/** Internal state observation for a single usage window. */
interface WindowObservation {
  usedPercent: number
  resetAt: string | null
  lowUsageWarmTriggered: boolean
  lowUsageWarmResetAt: string | null
  pendingStart: boolean
  isMovingReset: boolean
}

/** Per-provider tracking state for reset windows. */
interface ProviderResetState {
  windows: Map<string, WindowObservation>
}

/**
 * Builds a composite lookup key for a window by label and subLabel.
 *
 * @param window - Usage window definition
 * @returns Composite key string
 */
const windowKey = (window: UsageWindow): string =>
  `${window.label.toUpperCase()}|${(window.subLabel ?? '').toUpperCase()}`

/**
 * Starts a session with a minimal request after a usage reset, or when an unused
 * session's reset timestamp moves later between two consecutive observations.
 */
export default class UsageWindowStartService {
  /** Internal map tracking observation states by provider name. */
  private readonly states = new Map<string, ProviderResetState>()
  /** Guard flag preventing overlapping observation evaluations. */
  private running = false

  /**
   * Initializes a new instance of UsageWindowStartService.
   *
   * @param sender - Window start request sender implementation
   * @param logger - Service for logging system operations
   */
  public constructor(
    private readonly sender: WindowStartRequestSender,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Evaluates current window observations against past state and triggers warming requests when appropriate.
   *
   * @param windows - Array of active usage windows
   * @param settings - Current application settings
   */
  public async observeAsync(windows: UsageWindow[], settings: AppSettings): Promise<void> {
    const enabledProviders = new Map<string, AppSettings['providers'][number]>()
    for (const provider of settings.providers ?? []) {
      if (!provider.enabled) continue
      if (provider.startWindowAfterReset !== true) continue
      if (!SUPPORTED_PROVIDERS.has((provider.id ?? provider.name).toLowerCase())) continue
      enabledProviders.set((provider.id ?? provider.name).toLowerCase(), provider)
    }
    const smallModelSelector =
      settings.models?.smallModelSelector.trim() === ''
        ? 'nano,mini,haiku,lite,flash,oss'
        : (settings.models?.smallModelSelector ?? 'nano,mini,haiku,lite,flash,oss')

    if (this.running) return
    this.running = true
    try {
      for (const providerName of this.states.keys()) {
        if (!enabledProviders.has(providerName)) this.states.delete(providerName)
      }

      for (const providerName of enabledProviders.keys()) {
        const currentWindows = new Map<string, UsageWindow>()
        for (const window of windows) {
          if (window.providerName.toLowerCase() !== providerName) continue
          currentWindows.set(windowKey(window), window)
        }

        let state = this.states.get(providerName)
        if (!state) {
          state = { windows: new Map() }
          for (const [key, window] of currentWindows) {
            state.windows.set(key, {
              usedPercent: window.usedPercent,
              resetAt: window.resetAt ?? null,
              lowUsageWarmTriggered: false,
              lowUsageWarmResetAt: null,
              pendingStart: false,
              isMovingReset: false,
            })
          }
          this.states.set(providerName, state)
          this.logger.debug(
            'UsageWindowStart',
            `${providerName} reset-window starter armed with ${currentWindows.size} session window(s).`,
          )
          continue
        }

        for (const [key, current] of currentWindows) {
          const observation = state.windows.get(key)
          if (!observation) {
            state.windows.set(key, {
              usedPercent: current.usedPercent,
              resetAt: current.resetAt ?? null,
              lowUsageWarmTriggered: false,
              lowUsageWarmResetAt: null,
              pendingStart: false,
              isMovingReset: false,
            })
            continue
          }

          if (
            observation.lowUsageWarmTriggered &&
            observation.lowUsageWarmResetAt != null &&
            current.resetAt != null &&
            new Date(current.resetAt).getTime() >
              new Date(observation.lowUsageWarmResetAt).getTime() + RESET_DEADLINE_DRIFT_TOLERANCE_MS
          ) {
            observation.lowUsageWarmTriggered = false
            observation.lowUsageWarmResetAt = null
          }

          const usageReset = current.usedPercent < observation.usedPercent
          if (usageReset && current.usedPercent < 5) {
            observation.lowUsageWarmTriggered = true
          }

          if (current.usedPercent >= 5) {
            observation.lowUsageWarmTriggered = false
            observation.lowUsageWarmResetAt = null
          } else if (current.resetAt != null && observation.resetAt != null) {
            const resetAtMs = new Date(current.resetAt).getTime()
            const previousResetAtMs = new Date(observation.resetAt).getTime()
            if (resetAtMs > previousResetAtMs && !observation.lowUsageWarmTriggered) {
              observation.lowUsageWarmTriggered = true
              observation.isMovingReset = true
            }
          }

          if (
            !observation.lowUsageWarmTriggered &&
            !usageReset &&
            current.usedPercent < 1 &&
            observation.usedPercent < 1
          ) {
            observation.lowUsageWarmTriggered = true
            observation.isMovingReset = true
          }

          if (usageReset || observation.isMovingReset) {
            observation.pendingStart = true
          }
        }

        for (const [key, current] of currentWindows) {
          const observation = state.windows.get(key)
          if (!observation?.pendingStart) continue
          const isMovingReset = observation.isMovingReset
          try {
            await this.sender.startAsync({
              providerName,
              smallModelSelector,
              windowLabel: current.label,
              windowSubLabel: current.subLabel ?? null,
            })
            observation.pendingStart = false
            observation.isMovingReset = false
            if (observation.lowUsageWarmTriggered) {
              observation.lowUsageWarmResetAt = current.resetAt ?? null
            }
            this.logger.info(
              'UsageWindowStart',
              isMovingReset
                ? `${providerName} session window (${current.subLabel ?? current.label}) was warmed after its low-usage reset timestamp moved later.`
                : `${providerName} session window (${current.subLabel ?? current.label}) was warmed after reset with a minimal request.`,
            )
          } catch (error) {
            this.logger.warn(
              'UsageWindowStart',
              `${providerName} session-window (${current.subLabel ?? current.label}) start request failed; it will be retried on the next refresh.`,
              error,
            )
          }
        }

        for (const [key, current] of currentWindows) {
          const observation = state.windows.get(key)
          if (!observation) continue
          observation.usedPercent = current.usedPercent
          observation.resetAt = current.resetAt ?? null
        }
      }
    } finally {
      this.running = false
    }
  }
}

