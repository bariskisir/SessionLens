/**
 * @file UsageRefreshService.ts
 * @description Manages the background refresh schedule for provider usage metrics, handling automatic cycles and manual refreshes.
 */

import type { AppSettings, NotificationLevel, UsageSnapshotEvent } from '@shared/types'
import type StorageService from '../StorageService'
import type LoggerService from '../LoggerService'
import type TrayService from '../TrayService'
import type UsageAggregator from './UsageAggregator'
import type NotificationDispatcher from './NotificationDispatcher'
import type UsageWindowStartService from './UsageWindowStartService'
import { buildTooltipCards } from './TooltipCardBuilder'
import { computeIconBars } from './IconLayout'
import { REFRESH_MAX_MINUTES, DEFAULT_SETTINGS } from '@shared/types'

/** Default refresh interval in minutes. */
const DEFAULT_REFRESH_MINUTES = 5
/** Minimum delay in milliseconds. */
const MIN_DELAY_MS = 0
/** Maximum delay in milliseconds (24 hours). */
const MAX_DELAY_MS = 24 * 60 * 60 * 1_000

/** Emits a native system notification from the main process. */
export type NativeNotificationEmitter = (level: NotificationLevel, message: string) => void

/**
 * Runs the usage refresh loop: an initial cycle, then scheduled cycles honoring the
 * configured interval, plus manual refresh requests that coalesce into the schedule.
 */
export default class UsageRefreshService {
  /** Flag indicating whether the refresh loop is currently running. */
  private running = false
  /** Flag indicating whether the loop cancellation has been requested. */
  private cancelled = false
  /** Queue of pending manual refresh request timestamps. */
  private manualRequests: number[] = []
  /** Trigger callback for waking up the wait loop on manual refresh request. */
  private manualRefreshTrigger: ((requestedAt: number) => void) | null = null
  /** Latest cached usage snapshot event. */
  private lastSnapshot: UsageSnapshotEvent | null = null
  /** Timer instance for scheduled refresh delays. */
  private readonly refreshTimer: NodeJS.Timeout | null = null

  /**
   * Initializes a new instance of UsageRefreshService.
   *
   * @param storage - Application settings storage service
   * @param aggregator - Usage aggregator service for querying providers
   * @param tray - System tray management service
   * @param notifications - Notification dispatcher service
   * @param logger - System logger service
   * @param emitNative - Callback for emitting native desktop notifications
   * @param emitSnapshot - Callback for emitting usage snapshots to renderer
   * @param windowStart - Optional session window warm-up starter service
   */
  public constructor(
    private readonly storage: StorageService,
    private readonly aggregator: UsageAggregator,
    private readonly tray: TrayService,
    private readonly notifications: NotificationDispatcher,
    private readonly logger: LoggerService,
    private readonly emitNative: NativeNotificationEmitter,
    private readonly emitSnapshot: (event: UsageSnapshotEvent) => void,
    private readonly windowStart?: UsageWindowStartService,
  ) {}

  /**
   * Returns the most recent completed snapshot, or null before the first cycle completes.
   *
   * @returns Latest usage snapshot event or null
   */
  public getSnapshot(): UsageSnapshotEvent | null {
    return this.lastSnapshot
  }

  /**
   * Queues a manual refresh that the running loop picks up on its next wait cycle.
   */
  public requestManualRefresh(): void {
    const requestedAt = Date.now()
    this.manualRequests.push(requestedAt)
    this.manualRefreshTrigger?.(requestedAt)
  }

  /**
   * Runs the usage refresh loop until cancelled. Throws if already running.
   *
   * @throws Error if the loop is already running
   */
  public async start(): Promise<void> {
    if (this.running) throw new Error('The usage refresh loop is already running.')
    this.running = true
    this.cancelled = false
    this.logger.info('UsageRefreshService', 'Usage refresh loop starting.')

    try {
      let outcome = await this.runCycle('initial')
      let scheduleAnchor = Date.now()
      while (!this.cancelled) {
        const trigger = await this.waitForTrigger(scheduleAnchor, outcome)
        if (this.cancelled) break
        outcome = await this.runCycle(trigger.manual ? 'manual' : 'scheduled')
        scheduleAnchor = trigger.manual ? trigger.anchor : Date.now()
        if (this.manualRequests.length > 0) {
          scheduleAnchor = this.manualRequests.pop() ?? scheduleAnchor
          this.manualRequests.length = 0
        }
      }
    } finally {
      this.running = false
      this.logger.info('UsageRefreshService', 'Usage refresh loop stopped.')
    }
  }

  /**
   * Stops the refresh loop; pending delays resolve immediately.
   */
  public stop(): void {
    this.cancelled = true
  }

  /**
   * Sends a test notification through the native channel and every enabled remote channel.
   */
  public async sendTestNotificationAsync(): Promise<void> {
    const settings = await this.storage.loadSettings()
    await this.notifications.sendTestNotificationAsync(settings, this.emitNative)
  }

  /**
   * Runs one full refresh cycle, applying bars, tooltip cards and notifications.
   *
   * @param trigger - Label identifying cycle trigger source ('initial', 'scheduled', 'manual')
   * @returns Configured refresh period in minutes for the next cycle
   */
  private async runCycle(trigger: string): Promise<number> {
    const started = Date.now()
    let settings: AppSettings
    try {
      settings = await this.storage.loadSettings()
      const snapshot = await this.aggregator.refreshAsync(settings)
      const layout = settings.visual.iconLayout
      this.tray.setUsage(computeIconBars(snapshot.results, layout))
      const cards = buildTooltipCards(snapshot)
      this.tray.setTooltip(cards, settings.visual.scale)
      this.lastSnapshot = {
        cards,
        scale: settings.visual.scale,
        updatedAt: new Date().toISOString(),
      }
      this.emitSnapshot(this.lastSnapshot)
      await this.notifications.emitAsync(snapshot.windows, settings, this.emitNative)
      await this.windowStart?.observeAsync(snapshot.windows, settings)
      this.logger.info('UsageRefreshService', 'Usage refresh completed.', {
        trigger,
        results: snapshot.results.length,
        windows: snapshot.windows.length,
        durationMs: Date.now() - started,
      })
    } catch (error) {
      this.logger.error('UsageRefreshService', 'Usage refresh failed.', error)
      settings = await this.storage.loadSettings().catch(() => DEFAULT_SETTINGS)
    }
    return Math.min(
      REFRESH_MAX_MINUTES,
      Math.max(1, settings.refresh?.minute ?? DEFAULT_REFRESH_MINUTES),
    )
  }

  /**
   * Waits for either the scheduled delay, a manual request, or cancellation.
   *
   * @param anchor - Timestamp anchor for current schedule interval calculation
   * @param refreshMinutes - Refresh interval in minutes
   * @returns Trigger result object indicating if refresh was manual and next anchor timestamp
   */
  private async waitForTrigger(
    anchor: number,
    refreshMinutes: number,
  ): Promise<{ manual: boolean; anchor: number }> {
    const elapsed = Date.now() - anchor
    const periodMs = refreshMinutes * 60 * 1_000
    const delay = Math.min(
      MAX_DELAY_MS,
      Math.max(MIN_DELAY_MS, elapsed >= periodMs ? 0 : periodMs - elapsed),
    )
    return new Promise<{ manual: boolean; anchor: number }>((resolve) => {
      let timer: NodeJS.Timeout
      let finished = false
      const finish = (result: { manual: boolean; anchor: number }): void => {
        if (finished) return
        finished = true
        this.manualRefreshTrigger = null
        clearTimeout(timer)
        resolve(result)
      }
      timer = setTimeout(() => finish({ manual: false, anchor: Date.now() }), delay)
      if (this.cancelled) finish({ manual: false, anchor: Date.now() })
      else if (this.manualRequests.length > 0) {
        const latest = this.manualRequests.pop() ?? Date.now()
        this.manualRequests.length = 0
        finish({ manual: true, anchor: latest })
      } else {
        this.manualRefreshTrigger = (requestedAt) => {
          this.manualRequests.length = 0
          finish({ manual: true, anchor: requestedAt })
        }
      }
    })
  }
}
