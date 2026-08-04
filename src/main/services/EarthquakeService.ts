/**
 * Receives Firebase push messages, maintains the two desired topics, and persists earthquakes.
 */

import { createHash, randomUUID } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  Notification,
  powerMonitor,
  safeStorage,
  screen,
  type BrowserWindow,
  type Rectangle,
} from 'electron'
import PushReceiver from '@eneris/push-receiver'
import type { Types } from '@eneris/push-receiver/dist/client'
import {
  calculateDestinationCoordinates,
  calculateDistanceKm,
  createEarthquakeTopics,
  estimateEarthquakeNetworkIntensity,
} from '@shared/earthquake'
import {
  createEarthquakeNotificationUrl,
  createWindowsEarthquakeToastXml,
} from '@shared/earthquakeNotification'
import type {
  AppSettings,
  EarthquakeEvent,
  EarthquakeEventKind,
  EarthquakeNotificationOpenEvent,
  EarthquakeReceivedEvent,
  EarthquakeServiceStatus,
  SessionDocument,
} from '@shared/types'
import { z } from 'zod'
import {
  createFirebaseTopicMembershipUrl,
  EARTHQUAKE_NETWORK_FIREBASE_CONFIG,
  EARTHQUAKE_NETWORK_PACKAGE_ID,
  EARTHQUAKE_NETWORK_REGISTER_URL,
  EARTHQUAKE_NETWORK_UPDATE_LOCATION_URL,
  EARTHQUAKE_NETWORK_UPDATE_TILE_URL,
} from '../earthquakeNetworkConfig'
import { isIgnoredMessage, parseEarthquakeEnvelope } from './EarthquakePayloadParser'
import type LoggerService from './LoggerService'
import type StorageService from './StorageService'

const firebaseConfigSchema = z.object({
  projectId: z.string().min(1),
  appId: z.string().min(1),
  apiKey: z.string().min(1),
  messagingSenderId: z.string().min(1),
  authDomain: z.string().optional(),
  databaseURL: z.string().optional(),
  storageBucket: z.string().optional(),
  measurementId: z.string().optional(),
})
const firebaseAuthTokenResponseSchema = z.object({
  token: z.string().min(1),
  expiresIn: z.string().regex(/^\d+s$/),
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const credentialsSchema = z.custom<Types.Credentials>(
  (value) =>
    isRecord(value) &&
    isRecord(value.gcm) &&
    isRecord(value.fcm) &&
    isRecord(value.keys) &&
    isRecord(value.config),
)

const receiverStateSchema = z.object({
  credentials: credentialsSchema.optional(),
  persistentIds: z.array(z.string()).max(500).default([]),
  subscribedTopics: z
    .array(z.string().regex(/^[a-zA-Z0-9-_.~%]{1,900}$/))
    .max(10)
    .default([]),
  topicRegistrationFid: z.string().min(1).max(100).optional(),
  backendUserId: z.string().regex(/^\d+$/).optional(),
  lastRegisteredLatitude: z.number().min(-90).max(90).optional(),
  lastRegisteredLongitude: z.number().min(-180).max(180).optional(),
})
const legacyEncryptedReceiverStateSchema = z.object({ encrypted: z.string().min(1) })

interface ReceiverState {
  credentials?: Types.Credentials | undefined
  persistentIds: string[]
  subscribedTopics: string[]
  topicRegistrationFid?: string | undefined
  backendUserId?: string | undefined
  lastRegisteredLatitude?: number | undefined
  lastRegisteredLongitude?: number | undefined
}

interface FullscreenWindowState {
  bounds: Rectangle
  maximized: boolean
  visible: boolean
}

type StatusListener = (status: EarthquakeServiceStatus) => void
type EarthquakeListener = (event: EarthquakeReceivedEvent) => void
type NotificationOpenListener = (event: EarthquakeNotificationOpenEvent) => void

/** Coordinates the long-lived desktop FCM receiver and earthquake notification policy. */
export default class EarthquakeService {
  private settings: AppSettings
  private receiver: PushReceiver | null = null
  private checkTimer: NodeJS.Timeout | null = null
  private refreshPromise: Promise<EarthquakeServiceStatus> | null = null
  private refreshAfterCurrent = false
  private stateWriteTail: Promise<void> = Promise.resolve()
  private fullscreenWindowState: FullscreenWindowState | null = null
  private fullscreenRetryTimers: NodeJS.Timeout[] = []
  private powerMonitoringActive = false
  private status: EarthquakeServiceStatus
  private readonly statusListeners = new Set<StatusListener>()
  private readonly earthquakeListeners = new Set<EarthquakeListener>()
  private readonly notificationOpenListeners = new Set<NotificationOpenListener>()
  private readonly handleSystemResume = (): void => {
    this.logger.info('EarthquakeService', 'System resumed; refreshing the FCM transport.')
    void this.refresh()
  }

  /** Creates an inactive receiver; start is called after the renderer window exists. */
  public constructor(
    private readonly storage: StorageService,
    private readonly logger: LoggerService,
    private readonly dataRoot: string,
    private readonly window: BrowserWindow,
    settings: AppSettings,
    private readonly notificationProtocol: string | null,
  ) {
    this.settings = settings
    this.status = {
      state: 'disconnected',
      topics: createEarthquakeTopics(settings.earthquakeLatitude, settings.earthquakeLongitude),
      subscribedTopics: [],
    }
  }

  /** Starts FCM registration immediately and plans the next minute-based check. */
  public async start(): Promise<EarthquakeServiceStatus> {
    if (!this.powerMonitoringActive) {
      powerMonitor.on('resume', this.handleSystemResume)
      this.powerMonitoringActive = true
    }
    return this.refresh()
  }

  /** Returns an immutable snapshot safe for IPC serialization. */
  public getStatus(): EarthquakeServiceStatus {
    return structuredClone(this.status)
  }

  /** Applies notification preferences and reconnects when location or cadence changes. */
  public applySettings(settings: AppSettings): void {
    const connectionChanged =
      settings.earthquakeLatitude !== this.settings.earthquakeLatitude ||
      settings.earthquakeLongitude !== this.settings.earthquakeLongitude ||
      settings.fcmCheckIntervalMinutes !== this.settings.fcmCheckIntervalMinutes
    this.settings = settings
    this.status = {
      ...this.status,
      topics: createEarthquakeTopics(settings.earthquakeLatitude, settings.earthquakeLongitude),
      ...(connectionChanged ? { subscribedTopics: [], topicMembershipConfirmed: false } : {}),
    }
    this.scheduleNextCheck()
    if (connectionChanged) {
      if (this.refreshPromise) this.refreshAfterCurrent = true
      else void this.refresh()
    }
  }

  /** Registers one main-process status sink. */
  public onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  /** Registers one newly persisted earthquake sink. */
  public onEarthquake(listener: EarthquakeListener): () => void {
    this.earthquakeListeners.add(listener)
    return () => this.earthquakeListeners.delete(listener)
  }

  /** Registers one native-notification activation sink. */
  public onNotificationOpen(listener: NotificationOpenListener): () => void {
    this.notificationOpenListeners.add(listener)
    return () => this.notificationOpenListeners.delete(listener)
  }

  /** Focuses the application and requests the stored notification target in the renderer. */
  public openNotification(sessionId: string): void {
    if (this.window.isMinimized()) this.window.restore()
    this.window.show()
    this.window.focus()
    const event = { sessionId }
    this.notificationOpenListeners.forEach((listener) => {
      listener(event)
    })
  }

  /** Recreates the receiver, obtains its token, and replaces the two gateway topics. */
  public refresh(): Promise<EarthquakeServiceStatus> {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.connectReceiver().finally(() => {
      this.refreshPromise = null
      this.scheduleNextCheck()
      if (this.refreshAfterCurrent) {
        this.refreshAfterCurrent = false
        void this.refresh()
      }
    })
    return this.refreshPromise
  }

  /** Removes the exact local FCM state file and creates a fresh Firebase/backend identity. */
  public async resetRegistration(): Promise<EarthquakeServiceStatus> {
    if (this.refreshPromise) await this.refreshPromise
    if (this.checkTimer) clearTimeout(this.checkTimer)
    this.checkTimer = null
    this.receiver?.destroy()
    this.receiver = null
    await this.stateWriteTail.catch(() => undefined)
    const statePath = join(this.dataRoot, 'fcm-state.json')
    await rm(statePath, { force: true })
    this.refreshAfterCurrent = false
    this.updateStatus({
      state: 'disconnected',
      topics: createEarthquakeTopics(
        this.settings.earthquakeLatitude,
        this.settings.earthquakeLongitude,
      ),
      subscribedTopics: [],
      message: 'The previous FCM registration was removed.',
    })
    this.logger.info('EarthquakeService', 'Local FCM registration state removed and reset started.')
    return this.refresh()
  }

  /** Simulates a random event through the same persistence and notification pipeline. */
  public async test(kind: EarthquakeEventKind): Promise<SessionDocument> {
    const requestedDistanceKm = 10 + Math.random() * 490
    const [latitude, longitude] = calculateDestinationCoordinates(
      this.settings.earthquakeLatitude,
      this.settings.earthquakeLongitude,
      requestedDistanceKm,
      Math.random() * 360,
    )
    const distanceKm = calculateDistanceKm(
      this.settings.earthquakeLatitude,
      this.settings.earthquakeLongitude,
      latitude,
      longitude,
    )
    const magnitude = Number((5 + Math.random() * 3).toFixed(1))
    const receivedAt = new Date().toISOString()
    const earthquake: EarthquakeEvent = {
      id: createHash('sha256').update(`test:${randomUUID()}`).digest('hex'),
      kind,
      source: 'Earthquake Signal Test',
      latitude: Number(latitude.toFixed(4)),
      longitude: Number(longitude.toFixed(4)),
      receivedAt,
      occurredAt: receivedAt,
      magnitude,
      depthKm: Number((5 + Math.random() * 15).toFixed(1)),
      place: `${Math.round(distanceKm)} km test event`,
      distanceKm: Number(distanceKm.toFixed(1)),
      ...(kind === 'realtime'
        ? {
            revision: 1,
            estimatedIntensity: estimateEarthquakeNetworkIntensity(magnitude, distanceKm),
            alertDelaySeconds: Math.round(Math.random() * 10),
            warning: 'Realtime alert test',
          }
        : { warning: 'Seismic network notification test' }),
    }
    return (await this.processEarthquake(earthquake)).session
  }

  /** Stops timers and the underlying persistent FCM socket. */
  public dispose(): void {
    if (this.checkTimer) clearTimeout(this.checkTimer)
    this.checkTimer = null
    this.receiver?.destroy()
    this.receiver = null
    this.clearFullscreenRetries()
    this.statusListeners.clear()
    this.earthquakeListeners.clear()
    this.notificationOpenListeners.clear()
    if (this.powerMonitoringActive) {
      powerMonitor.removeListener('resume', this.handleSystemResume)
      this.powerMonitoringActive = false
    }
  }

  /** Establishes one fresh receiver so application starts and upgrades always reschedule work. */
  private async connectReceiver(): Promise<EarthquakeServiceStatus> {
    const firebase = this.loadFirebaseConfig()
    const topics = createEarthquakeTopics(
      this.settings.earthquakeLatitude,
      this.settings.earthquakeLongitude,
    )
    if (!firebase) {
      this.logger.warn(
        'EarthquakeService',
        'FCM receiver is not configured; EARTHQUAKE_FIREBASE_CONFIG is missing or invalid.',
      )
      this.updateStatus({
        state: 'not-configured',
        topics,
        subscribedTopics: [],
        lastCheckedAt: new Date().toISOString(),
        message: 'Firebase client configuration is not configured.',
      })
      return this.getStatus()
    }

    this.updateStatus({ state: 'connecting', topics, subscribedTopics: [] })
    this.receiver?.destroy()
    const persisted = await this.loadReceiverState()
    const vapidKey = process.env.EARTHQUAKE_FIREBASE_VAPID_KEY ?? ''
    const reusableCredentials = persisted.credentials
      ? await this.refreshFirebaseInstallationIfNeeded(persisted.credentials, firebase, vapidKey)
      : undefined
    const receiver = new PushReceiver({
      firebase,
      debug: false,
      persistentIds: persisted.persistentIds,
      ...(reusableCredentials ? { credentials: reusableCredentials } : {}),
      ...(vapidKey ? { vapidKey } : {}),
      bundleId: EARTHQUAKE_NETWORK_PACKAGE_ID,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    this.receiver = receiver
    let activeBackendUserId = persisted.backendUserId
    let activeRegisteredLatitude = persisted.lastRegisteredLatitude
    let activeRegisteredLongitude = persisted.lastRegisteredLongitude
    let activeSubscribedTopics = persisted.subscribedTopics
    let activeTopicRegistrationFid = persisted.topicRegistrationFid
    receiver.onCredentialsChanged(({ newCredentials }) => {
      void this.saveReceiverState({
        credentials: newCredentials,
        persistentIds: receiver.persistentIds.slice(-500),
        subscribedTopics: activeSubscribedTopics,
        ...(activeTopicRegistrationFid ? { topicRegistrationFid: activeTopicRegistrationFid } : {}),
        ...(activeBackendUserId ? { backendUserId: activeBackendUserId } : {}),
        ...(activeRegisteredLatitude === undefined
          ? {}
          : { lastRegisteredLatitude: activeRegisteredLatitude }),
        ...(activeRegisteredLongitude === undefined
          ? {}
          : { lastRegisteredLongitude: activeRegisteredLongitude }),
      })
    })
    receiver.onNotification((envelope) => {
      void this.receiveEnvelope(envelope, receiver)
    })
    receiver.on('ON_CONNECT', () => {
      if (this.receiver !== receiver) return
      this.updateStatus({
        ...this.status,
        state: 'connecting',
        message: 'FCM transport socket connected; waiting for authentication.',
      })
    })
    receiver.onReady(() => {
      if (this.receiver !== receiver) return
      this.updateStatus({
        ...this.status,
        state: 'connected',
        lastCheckedAt: new Date().toISOString(),
        message: 'FCM transport connected.',
      })
    })
    receiver.on('ON_DISCONNECT', () => {
      if (this.receiver !== receiver) return
      this.updateStatus({
        ...this.status,
        state: 'disconnected',
        message: 'FCM transport disconnected; automatic reconnection is in progress.',
      })
    })

    try {
      await receiver.connect()
      const token = receiver.fcmToken
      const credentials = await receiver.registerIfNeeded()
      let backendRegistered = false
      let tileRegistered = false
      let locationSynchronized = false
      let topicMembershipConfirmed = false
      try {
        activeBackendUserId = await this.registerEarthquakeNetworkBackend(
          token,
          activeBackendUserId,
        )
        backendRegistered = true
      } catch (error) {
        this.logger.error(
          'EarthquakeService',
          'Earthquake Network backend registration failed.',
          error,
        )
      }
      if (activeBackendUserId && backendRegistered) {
        try {
          await this.updateEarthquakeNetworkTile(activeBackendUserId, topics[1] ?? '')
          tileRegistered = true
        } catch (error) {
          this.logger.error('EarthquakeService', 'Earthquake Network tile update failed.', error)
        }
        try {
          await this.updateEarthquakeNetworkLocation(
            activeBackendUserId,
            activeRegisteredLatitude,
            activeRegisteredLongitude,
          )
          activeRegisteredLatitude = this.settings.earthquakeLatitude
          activeRegisteredLongitude = this.settings.earthquakeLongitude
          locationSynchronized = true
        } catch (error) {
          this.logger.error(
            'EarthquakeService',
            'Earthquake Network location synchronization failed.',
            error,
          )
        }
      }
      const installationFid = credentials.fcm.installation.fid
      const previouslySubscribedTopics =
        persisted.topicRegistrationFid === installationFid
          ? persisted.subscribedTopics
          : persisted.credentials?.fcm.installation.fid === installationFid &&
              persisted.lastRegisteredLatitude !== undefined &&
              persisted.lastRegisteredLongitude !== undefined
            ? createEarthquakeTopics(
                persisted.lastRegisteredLatitude,
                persisted.lastRegisteredLongitude,
              )
            : []
      activeSubscribedTopics = previouslySubscribedTopics
      activeTopicRegistrationFid = installationFid
      try {
        await this.synchronizeFirebaseTopics(
          firebase,
          credentials.fcm.installation,
          topics,
          previouslySubscribedTopics,
        )
        activeSubscribedTopics = [...topics]
        topicMembershipConfirmed = true
      } catch (error) {
        this.logger.error(
          'EarthquakeService',
          'Official Firebase topic membership synchronization failed; the receiver will remain connected.',
          error,
        )
      }
      await this.saveReceiverState({
        credentials,
        persistentIds: receiver.persistentIds.slice(-500),
        subscribedTopics: activeSubscribedTopics,
        topicRegistrationFid: activeTopicRegistrationFid,
        ...(activeBackendUserId ? { backendUserId: activeBackendUserId } : {}),
        ...(activeRegisteredLatitude === undefined
          ? {}
          : { lastRegisteredLatitude: activeRegisteredLatitude }),
        ...(activeRegisteredLongitude === undefined
          ? {}
          : { lastRegisteredLongitude: activeRegisteredLongitude }),
      })
      const message = !topicMembershipConfirmed
        ? 'FCM transport connected, but Firebase topic membership could not be confirmed.'
        : !backendRegistered
          ? 'FCM topics are subscribed, but Earthquake Network backend registration failed.'
          : !tileRegistered || !locationSynchronized
            ? 'FCM topics are subscribed; Earthquake Network location metadata is incomplete.'
            : 'FCM token, topics, tile, and fixed location are registered.'
      this.updateStatus({
        state: 'connected',
        topics,
        subscribedTopics: topicMembershipConfirmed ? topics : [],
        token,
        ...(activeBackendUserId ? { backendUserId: activeBackendUserId } : {}),
        backendRegistered,
        tileRegistered,
        locationSynchronized,
        topicMembershipConfirmed,
        firebaseInstallationId: credentials.fcm.installation.fid,
        gcmAndroidId: credentials.gcm.androidId,
        gcmAppId: credentials.gcm.appId,
        firebaseProjectId: credentials.config.projectId,
        packageId: credentials.config.bundleId,
        installationCreatedAt: new Date(credentials.fcm.installation.createdAt).toISOString(),
        authTokenExpiresAt: new Date(
          credentials.fcm.installation.createdAt + credentials.fcm.installation.expiresIn,
        ).toISOString(),
        persistentMessageCount: receiver.persistentIds.length,
        lastCheckedAt: new Date().toISOString(),
        message,
      })
      this.logger.info('EarthquakeService', 'FCM receiver connected.', {
        topics,
        subscribedTopics: topicMembershipConfirmed ? topics : [],
        token,
        backendUserId: activeBackendUserId,
        backendRegistered,
        tileRegistered,
        locationSynchronized,
        topicMembershipConfirmed,
        firebaseInstallationId: credentials.fcm.installation.fid,
        gcmAndroidId: credentials.gcm.androidId,
        gcmAppId: credentials.gcm.appId,
        firebaseProjectId: credentials.config.projectId,
        packageId: credentials.config.bundleId,
        installationCreatedAt: new Date(credentials.fcm.installation.createdAt).toISOString(),
        authTokenExpiresAt: new Date(
          credentials.fcm.installation.createdAt + credentials.fcm.installation.expiresIn,
        ).toISOString(),
        persistentMessageCount: receiver.persistentIds.length,
        latitude: this.settings.earthquakeLatitude,
        longitude: this.settings.earthquakeLongitude,
      })
    } catch (error) {
      receiver.destroy()
      if (this.receiver === receiver) this.receiver = null
      this.updateStatus({
        state: 'error',
        topics,
        subscribedTopics: [],
        lastCheckedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : 'FCM connection failed.',
      })
      this.logger.error('EarthquakeService', 'FCM receiver could not connect.', error)
    }
    return this.getStatus()
  }

  /** Loads an optional runtime override or the authorized configuration extracted from the APK. */
  private loadFirebaseConfig(): Types.FirebaseConfig | null {
    const serialized = process.env.EARTHQUAKE_FIREBASE_CONFIG
    if (!serialized) return { ...EARTHQUAKE_NETWORK_FIREBASE_CONFIG }
    try {
      const parsed = firebaseConfigSchema.parse(JSON.parse(serialized))
      return {
        projectId: parsed.projectId,
        appId: parsed.appId,
        apiKey: parsed.apiKey,
        messagingSenderId: parsed.messagingSenderId,
        ...(parsed.authDomain ? { authDomain: parsed.authDomain } : {}),
        ...(parsed.databaseURL ? { databaseURL: parsed.databaseURL } : {}),
        ...(parsed.storageBucket ? { storageBucket: parsed.storageBucket } : {}),
        ...(parsed.measurementId ? { measurementId: parsed.measurementId } : {}),
      }
    } catch (error) {
      this.logger.warn('EarthquakeService', 'Firebase client configuration is invalid.', error)
      return null
    }
  }

  /** Mirrors the APK token registration and returns its stable numeric backend user id. */
  private async registerEarthquakeNetworkBackend(
    token: string,
    existingUserId?: string,
  ): Promise<string> {
    const response = await fetch(EARTHQUAKE_NETWORK_REGISTER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({
        u_id: existingUserId ?? '0',
        r_id: token,
        lat: String(this.settings.earthquakeLatitude),
        lon: String(this.settings.earthquakeLongitude),
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      throw new Error(`Earthquake Network registration returned HTTP ${response.status}.`)
    }
    const userId = (await response.text()).trim()
    if (!/^\d+$/.test(userId) || userId === '0') {
      throw new Error('Earthquake Network registration returned an invalid user id.')
    }
    this.logger.info('EarthquakeService', 'FCM token registered with Earthquake Network backend.', {
      endpoint: EARTHQUAKE_NETWORK_REGISTER_URL,
      request: {
        u_id: existingUserId ?? '0',
        r_id: token,
        lat: this.settings.earthquakeLatitude,
        lon: this.settings.earthquakeLongitude,
      },
      response: { backendUserId: userId },
    })
    return userId
  }

  /** Mirrors the APK location-topic report after a successful token registration. */
  private async updateEarthquakeNetworkTile(userId: string, tile: string): Promise<void> {
    if (!tile) throw new Error('Earthquake Network tile topic is empty.')
    const response = await fetch(EARTHQUAKE_NETWORK_UPDATE_TILE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({ u_id: userId, tile }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      throw new Error(`Earthquake Network tile update returned HTTP ${response.status}.`)
    }
    this.logger.info('EarthquakeService', 'Earthquake Network tile registration updated.', {
      endpoint: EARTHQUAKE_NETWORK_UPDATE_TILE_URL,
      backendUserId: userId,
      tile,
    })
  }

  /** Synchronizes the fixed coordinates through the APK's dedicated location endpoint. */
  private async updateEarthquakeNetworkLocation(
    userId: string,
    previousLatitude?: number,
    previousLongitude?: number,
  ): Promise<void> {
    const latitude = this.settings.earthquakeLatitude
    const longitude = this.settings.earthquakeLongitude
    const changed =
      previousLatitude === undefined ||
      previousLongitude === undefined ||
      Math.abs(latitude - previousLatitude) >= 0.1 ||
      Math.abs(longitude - previousLongitude) >= 0.1
    const request = {
      u_id: userId,
      lat: String(latitude),
      lon: String(longitude),
      acc: '-1',
      upd: changed ? '1' : '0',
    }
    const response = await fetch(EARTHQUAKE_NETWORK_UPDATE_LOCATION_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(request),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      throw new Error(`Earthquake Network location update returned HTTP ${response.status}.`)
    }
    this.logger.info('EarthquakeService', 'Earthquake Network fixed location synchronized.', {
      endpoint: EARTHQUAKE_NETWORK_UPDATE_LOCATION_URL,
      request,
    })
  }

  /** Refreshes an expiring Firebase installation auth token as the mobile SDK does. */
  private async refreshFirebaseInstallationIfNeeded(
    credentials: Types.Credentials,
    firebase: Types.FirebaseConfig,
    vapidKey: string,
  ): Promise<Types.Credentials | undefined> {
    const expectedConfig = {
      bundleId: EARTHQUAKE_NETWORK_PACKAGE_ID,
      projectId: firebase.projectId,
      vapidKey,
    }
    if (JSON.stringify(credentials.config) !== JSON.stringify(expectedConfig)) return undefined

    const installation = credentials.fcm.installation
    const refreshBufferMs = 60 * 60 * 1000
    if (Date.now() + refreshBufferMs < installation.createdAt + installation.expiresIn) {
      return credentials
    }

    try {
      const endpoint =
        `https://firebaseinstallations.googleapis.com/v1/projects/` +
        `${encodeURIComponent(firebase.projectId)}/installations/` +
        `${encodeURIComponent(installation.fid)}/authTokens:generate`
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `FIS_v2 ${installation.refreshToken}`,
          'content-type': 'application/json',
          'x-goog-api-key': firebase.apiKey,
        },
        body: JSON.stringify({ installation: { sdkVersion: 'a:19.1.2' } }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        throw new Error(`Firebase installation refresh returned HTTP ${response.status}.`)
      }
      const refreshed = firebaseAuthTokenResponseSchema.parse(await response.json())
      const expiresIn = Number.parseInt(refreshed.expiresIn.slice(0, -1), 10) * 1000
      const updated = structuredClone(credentials)
      updated.fcm.installation = {
        ...installation,
        token: refreshed.token,
        createdAt: Date.now(),
        expiresIn,
      }
      this.logger.info('EarthquakeService', 'Firebase installation auth token refreshed.', {
        firebaseInstallationId: installation.fid,
        installationAuthToken: refreshed.token,
        refreshedAt: new Date(updated.fcm.installation.createdAt).toISOString(),
        expiresAt: new Date(
          updated.fcm.installation.createdAt + updated.fcm.installation.expiresIn,
        ).toISOString(),
        expiresInMs: updated.fcm.installation.expiresIn,
      })
      return updated
    } catch (error) {
      this.logger.warn(
        'EarthquakeService',
        'Firebase installation refresh failed; a new installation will be registered.',
        error,
      )
      return undefined
    }
  }

  /** Mirrors FirebaseMessaging.subscribeToTopic and removes any previous fixed-location tile. */
  private async synchronizeFirebaseTopics(
    firebase: Types.FirebaseConfig,
    installation: Types.InstallationData,
    desiredTopics: string[],
    previousTopics: string[],
  ): Promise<void> {
    for (const topic of desiredTopics) {
      await this.changeFirebaseTopicMembership(firebase, installation, topic, 'subscribe')
    }
    for (const topic of previousTopics) {
      if (!desiredTopics.includes(topic)) {
        await this.changeFirebaseTopicMembership(firebase, installation, topic, 'unsubscribe')
      }
    }
  }

  /** Calls the official Firebase Messaging installation topic endpoint used by the APK SDK. */
  private async changeFirebaseTopicMembership(
    firebase: Types.FirebaseConfig,
    installation: Types.InstallationData,
    topic: string,
    operation: 'subscribe' | 'unsubscribe',
  ): Promise<void> {
    const endpoint = createFirebaseTopicMembershipUrl(
      firebase.projectId,
      installation.fid,
      topic,
      operation,
    )
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-goog-api-key': firebase.apiKey,
        'x-goog-firebase-installations-auth': installation.token,
      },
      signal: AbortSignal.timeout(15_000),
    })
    const responseBody = await response.text()
    const details = {
      endpoint,
      operation,
      topic,
      firebaseInstallationId: installation.fid,
      projectId: firebase.projectId,
      status: response.status,
      statusText: response.statusText,
      responseBody,
    }
    if (!response.ok) {
      this.logger.error('EarthquakeService', 'Firebase topic membership request failed.', details)
      throw new Error(
        `Firebase topic ${operation} failed for ${topic} with HTTP ${response.status}.`,
      )
    }
    this.logger.info('EarthquakeService', 'Firebase topic membership confirmed.', details)
  }

  /** Converts a package message envelope to the common earthquake model. */
  private async receiveEnvelope(
    envelope: Types.MessageEnvelope,
    receiver: PushReceiver,
  ): Promise<void> {
    this.logger.info('EarthquakeService', 'Raw FCM message received.', envelope)
    try {
      const data = envelope.message.data ?? {}
      if (isIgnoredMessage(data)) return
      const earthquake = parseEarthquakeEnvelope(
        envelope,
        this.settings.earthquakeLatitude,
        this.settings.earthquakeLongitude,
      )
      await this.saveReceiverState({
        ...(await this.loadReceiverState()),
        persistentIds: receiver.persistentIds.slice(-500),
      })
      this.status = {
        ...this.status,
        persistentMessageCount: receiver.persistentIds.length,
      }
      this.emitStatus()
      if (!earthquake) {
        this.logger.warn('EarthquakeService', 'An FCM message had no valid earthquake coordinates.')
        return
      }
      await this.processEarthquake(earthquake)
    } catch (error) {
      this.logger.error(
        'EarthquakeService',
        'FCM earthquake message could not be processed.',
        error,
      )
    }
  }

  /** Runs one normalized event through shared production side effects. */
  private async processEarthquake(earthquake: EarthquakeEvent): Promise<EarthquakeReceivedEvent> {
    const title = this.createSessionTitle(earthquake)
    const session = await this.storage.upsertEarthquakeSession(earthquake, title)
    const shouldNotify = this.shouldNotify(earthquake)
    const presentation = this.resolvePresentation(earthquake, shouldNotify)
    if (shouldNotify) {
      this.showNativeNotification(earthquake, title, session.id)
    }
    if (presentation === 'fullscreen') this.showFullscreenWindow()
    const received = {
      session,
      presentation,
      shouldAlarm: this.shouldPlayAlarm(earthquake, presentation),
    }
    this.earthquakeListeners.forEach((listener) => {
      listener(received)
    })
    return received
  }

  /** Applies real-time and seismic-network notification settings without dropping sessions. */
  private shouldNotify(earthquake: EarthquakeEvent): boolean {
    if (earthquake.kind === 'realtime') {
      return this.settings.realtimeAlertsEnabled && (earthquake.estimatedIntensity ?? 0) >= 1.5
    }
    if (!this.settings.seismicNotificationsEnabled) return false
    const magnitude = earthquake.magnitude ?? 0
    const distance = earthquake.distanceKm ?? Number.POSITIVE_INFINITY
    return (
      magnitude >= this.settings.seismicMinimumMagnitude &&
      distance <= this.settings.seismicMaximumDistanceKm
    )
  }

  /** Chooses normal or fullscreen delivery while keeping mild realtime alerts non-disruptive. */
  private resolvePresentation(
    earthquake: EarthquakeEvent,
    shouldNotify: boolean,
  ): EarthquakeReceivedEvent['presentation'] {
    if (!shouldNotify) return 'none'
    if (earthquake.kind === 'seismic-network') {
      return this.settings.seismicNotificationPresentation
    }
    if (this.settings.realtimeNotificationPresentation === 'normal') return 'normal'
    return 'fullscreen'
  }

  /** Brings the existing hardened renderer forward for its fullscreen alert layer. */
  private showFullscreenWindow(): void {
    if (!this.fullscreenWindowState) {
      this.fullscreenWindowState = {
        bounds: this.window.getNormalBounds(),
        maximized: this.window.isMaximized(),
        visible: this.window.isVisible(),
      }
    }
    this.clearFullscreenRetries()
    if (this.window.isMinimized()) this.window.restore()
    this.window.show()
    const displayBounds = screen.getDisplayMatching(this.window.getBounds()).bounds
    if (this.window.isMaximized()) this.window.unmaximize()
    this.window.setBounds(displayBounds)
    this.window.setAlwaysOnTop(true, 'screen-saver')
    this.window.setFullScreen(true)
    this.window.focus()
    this.fullscreenRetryTimers = [150, 500].map((delay) =>
      setTimeout(() => {
        if (this.window.isDestroyed() || this.window.isFullScreen()) return
        this.window.setBounds(displayBounds)
        this.window.setFullScreen(true)
        this.window.show()
        this.window.focus()
      }, delay),
    )
  }

  /** Leaves the alert fullscreen state and restores the previous window geometry. */
  public dismissFullscreen(): void {
    this.clearFullscreenRetries()
    const previous = this.fullscreenWindowState
    this.fullscreenWindowState = null
    let restored = false
    const restoreWindow = (): void => {
      if (restored || this.window.isDestroyed()) return
      restored = true
      this.window.setAlwaysOnTop(this.settings.alwaysOnTop)
      if (!previous) return
      if (previous.maximized) this.window.maximize()
      else this.window.setBounds(previous.bounds)
      if (!previous.visible) this.window.hide()
    }
    if (!this.window.isFullScreen()) {
      restoreWindow()
      return
    }
    this.window.once('leave-full-screen', () => {
      setTimeout(restoreWindow, 100)
    })
    this.window.setFullScreen(false)
    setTimeout(restoreWindow, 750)
  }

  /** Cancels delayed fullscreen retries after dismissal or application shutdown. */
  private clearFullscreenRetries(): void {
    this.fullscreenRetryTimers.forEach((timer) => {
      clearTimeout(timer)
    })
    this.fullscreenRetryTimers = []
  }

  /** Plays the bundled realtime alarm only while presenting a fullscreen warning. */
  private shouldPlayAlarm(
    earthquake: EarthquakeEvent,
    presentation: EarthquakeReceivedEvent['presentation'],
  ): boolean {
    if (presentation !== 'fullscreen' || earthquake.kind !== 'realtime') return false
    if (this.settings.realtimeSilentWhenMild && (earthquake.estimatedIntensity ?? 0) < 3) {
      return false
    }
    return true
  }

  /** Shows an operating-system notification with a protocol-safe Windows activation target. */
  private showNativeNotification(
    earthquake: EarthquakeEvent,
    title: string,
    sessionId: string,
  ): void {
    try {
      if (Notification.isSupported()) {
        const notificationTitle =
          earthquake.kind === 'realtime' ? 'Real-time earthquake alert' : 'Seismic network'
        const body = `${title}${earthquake.distanceKm === undefined ? '' : ` · ${earthquake.distanceKm.toFixed(0)} km`}`
        const protocolUrl = this.notificationProtocol
          ? createEarthquakeNotificationUrl(sessionId)
          : null
        const notification = new Notification(
          process.platform === 'win32' && protocolUrl
            ? {
                toastXml: createWindowsEarthquakeToastXml(
                  notificationTitle,
                  body,
                  protocolUrl,
                  earthquake.kind === 'realtime',
                ),
              }
            : {
                title: notificationTitle,
                body,
                silent: earthquake.kind === 'realtime',
              },
        )
        notification.on('click', () => {
          this.openNotification(sessionId)
        })
        notification.show()
      } else {
        this.logger.warn('EarthquakeService', 'Native notifications are not supported.')
      }
    } catch (error) {
      this.logger.warn('EarthquakeService', 'Native earthquake notification failed.', error)
    }
  }

  /** Creates a compact human-readable session title for the sidebar and notification. */
  private createSessionTitle(earthquake: EarthquakeEvent): string {
    const magnitude =
      earthquake.magnitude === undefined ? '' : `M${earthquake.magnitude.toFixed(1)} `
    const place =
      earthquake.place ?? `${earthquake.latitude.toFixed(2)}, ${earthquake.longitude.toFixed(2)}`
    return `${magnitude}${place}`.trim()
  }

  /** Schedules the next connection/token check in the exact user-selected minute interval. */
  private scheduleNextCheck(): void {
    if (this.checkTimer) clearTimeout(this.checkTimer)
    const intervalMs = this.settings.fcmCheckIntervalMinutes * 60_000
    const deadline = Date.now() + intervalMs
    const nextCheckAt = new Date(deadline).toISOString()
    this.status = { ...this.status, nextCheckAt }
    this.emitStatus()
    const scheduleRemaining = (): void => {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        this.checkTimer = null
        void this.refresh()
        return
      }
      this.checkTimer = setTimeout(scheduleRemaining, Math.min(remaining, 2_147_000_000))
    }
    scheduleRemaining()
  }

  /** Replaces status and notifies every attached renderer bridge. */
  private updateStatus(status: EarthquakeServiceStatus): void {
    this.status = status
    this.emitStatus()
  }

  /** Emits a detached snapshot so listeners cannot mutate service state. */
  private emitStatus(): void {
    const snapshot = this.getStatus()
    this.statusListeners.forEach((listener) => {
      listener(snapshot)
    })
  }

  /** Loads reusable FCM credentials and deduplication identifiers from AppData. */
  private async loadReceiverState(): Promise<ReceiverState> {
    try {
      const value: unknown = JSON.parse(
        await readFile(join(this.dataRoot, 'fcm-state.json'), 'utf8'),
      )
      const encrypted = legacyEncryptedReceiverStateSchema.safeParse(value)
      if (encrypted.success) {
        if (!safeStorage.isEncryptionAvailable()) return { persistentIds: [], subscribedTopics: [] }
        const decrypted = safeStorage.decryptString(Buffer.from(encrypted.data.encrypted, 'base64'))
        const migrated = receiverStateSchema.parse(JSON.parse(decrypted))
        await this.saveReceiverState(migrated)
        return migrated
      }
      return receiverStateSchema.parse(value)
    } catch {
      return { persistentIds: [], subscribedTopics: [] }
    }
  }

  /** Persists the generated token credentials as readable JSON for reuse across restarts. */
  private async saveReceiverState(state: ReceiverState): Promise<void> {
    const validated = receiverStateSchema.parse(state)
    const operation = this.stateWriteTail
      .catch(() => undefined)
      .then(() =>
        writeFile(
          join(this.dataRoot, 'fcm-state.json'),
          `${JSON.stringify(validated, null, 2)}\n`,
          {
            encoding: 'utf8',
            mode: 0o600,
          },
        ),
      )
    this.stateWriteTail = operation
    await operation
  }
}
