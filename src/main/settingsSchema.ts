/**
 * @file settingsSchema.ts
 * @description Centralizes persisted and IPC settings validation, normalization, default values, and schema definitions using Zod.
 */

import {
  APP_LOCALES,
  DEFAULT_SMALL_MODEL_SELECTOR,
  DEFAULT_SETTINGS,
  ICON_LAYOUT_MODES,
  LOG_LEVELS,
  NAVBAR_POSITIONS,
  PAGE_ZOOM_LIMITS,
  PROVIDER_DESCRIPTORS,
  PROVIDER_TYPES,
  REFRESH_MAX_MINUTES,
  TIME_FORMATS,
  THEME_MODES,
  VISUAL_SCALE_LIMITS,
  type AppSettings,
  type AppSettingsPatch,
  type IconLayoutMode,
  type NotificationSettings,
  type ProviderDescriptor,
  type ProviderSettings,
  type TrayIconLayoutSettings,
} from '@shared/types'
import { z } from 'zod'

/** Zod schema for Telegram integration notification settings. */
const telegramSettingsSchema = z.object({
  token: z.string().max(500).nullable(),
  // Accept legacy numeric IDs while persisting all identifiers as text (for example, @channelname).
  chatId: z.union([z.string().max(128), z.number()]).transform((value) => String(value).trim()),
  enabled: z.boolean(),
})

/** Zod schema for Discord webhook notification settings. */
const discordSettingsSchema = z.object({
  webhookUrl: z.string().max(2_000).nullable(),
  username: z.string().max(80),
  enabled: z.boolean(),
})

/** Zod schema for threshold notification configuration. */
const notificationSettingsSchema = z.object({
  high: z.number().min(1).max(100),
  critical: z.number().min(1).max(100),
  telegram: telegramSettingsSchema,
  discord: discordSettingsSchema,
  enabled: z.boolean(),
})

/** Zod schema for refresh interval settings. */
const refreshSettingsSchema = z.object({
  minute: z.number().min(1).max(REFRESH_MAX_MINUTES),
})

/** Zod schema for tray icon layout configuration. */
const trayIconLayoutSchema = z.object({
  mode: z.enum(ICON_LAYOUT_MODES),
  bars: z.record(z.string(), z.number()),
})

/** Zod schema for visual settings (scale, icon layout). */
const visualSettingsSchema = z.object({
  scale: z.number().min(VISUAL_SCALE_LIMITS.min).max(VISUAL_SCALE_LIMITS.max),
  iconLayout: trayIconLayoutSchema,
})

/** Zod schema for model selection preferences. */
const modelSettingsSchema = z.object({
  smallModelSelector: z.string().max(300),
})

/** Zod schema for individual provider settings. */
const providerSettingsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(PROVIDER_TYPES),
  credential: z.string().max(200).nullable(),
  apiKey: z.string().max(500).nullable(),
  enabled: z.boolean(),
  refreshToken: z.boolean(),
  id: z.string().max(100).nullable(),
  startWindowAfterReset: z.boolean().nullable(),
})

/** Comprehensive Zod schema defining all fields in application settings. */
const settingsFieldsSchema = z.object({
  settingsRevision: z.literal(4),
  uiLanguage: z.enum(APP_LOCALES),
  theme: z.enum(THEME_MODES),
  navbarPosition: z.enum(NAVBAR_POSITIONS),
  pageZoom: z.number().min(PAGE_ZOOM_LIMITS.min).max(PAGE_ZOOM_LIMITS.max),
  timeFormat: z.enum(TIME_FORMATS),
  startOnStartup: z.boolean(),
  alwaysOnTop: z.boolean(),
  showTrayIcon: z.boolean(),
  minimizeToTrayOnClose: z.boolean(),
  autoUpdate: z.boolean(),
  unattendedUpdates: z.boolean(),
  logLevel: z.enum(LOG_LEVELS),
  refresh: refreshSettingsSchema,
  notification: notificationSettingsSchema,
  visual: visualSettingsSchema,
  providers: z.array(providerSettingsSchema),
  models: modelSettingsSchema,
})

/** Full Zod schema including refinement rules for inter-field constraints. */
export const settingsSchema = settingsFieldsSchema.superRefine((settings, context) => {
  if (settings.minimizeToTrayOnClose && !settings.showTrayIcon) {
    context.addIssue({
      code: 'custom',
      path: ['minimizeToTrayOnClose'],
      message: 'Minimize to tray requires the tray icon to be enabled.',
    })
  }
  if (settings.notification.high >= settings.notification.critical) {
    context.addIssue({
      code: 'custom',
      path: ['notification'],
      message: 'The high threshold must be below the critical threshold.',
    })
  }
})

/** Partial Zod schema for validating patch objects sent from settings page. */
export const settingsPatchSchema = settingsFieldsSchema
  .omit({ settingsRevision: true })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'At least one setting must be provided.')

/**
 * Returns an object record only when a persisted value can contain named settings.
 *
 * @param value - Value to check
 * @returns Record object or null
 */
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/**
 * Clamps and repairs a provider entry so manual edits cannot corrupt the persisted document.
 *
 * @param provider - Raw ProviderSettings item
 * @param descriptor - Matching ProviderDescriptor or null
 * @returns Normalized ProviderSettings object
 */
const normalizeProvider = (
  provider: ProviderSettings,
  descriptor: ProviderDescriptor | null,
): ProviderSettings => ({
  name: provider.name.trim() || (descriptor?.name ?? provider.name),
  type: PROVIDER_TYPES.includes(provider.type)
    ? provider.type
    : (descriptor?.authenticationKind ?? 'apiKey'),
  credential: provider.credential?.trim() || (descriptor?.credentialName ?? null),
  apiKey: provider.apiKey?.trim() || null,
  enabled: provider.enabled,
  refreshToken: provider.refreshToken,
  id: provider.id?.trim() || (descriptor?.id ?? null),
  startWindowAfterReset:
    provider.startWindowAfterReset ?? descriptor?.startWindowAfterReset ?? null,
})

/**
 * Normalizes notification settings and ensures high threshold is strictly below critical threshold.
 *
 * @param notification - NotificationSettings object
 * @returns Normalized NotificationSettings object
 */
const normalizeNotification = (notification: NotificationSettings): NotificationSettings => {
  const telegram = {
    token: notification.telegram.token?.trim() || null,
    chatId: notification.telegram.chatId.trim(),
    enabled: notification.telegram.enabled,
  }
  const discord = {
    webhookUrl: notification.discord.webhookUrl?.trim() || null,
    username: notification.discord.username.trim() || 'Session Lens',
    enabled: notification.discord.enabled,
  }
  let high = notification.high
  let critical = notification.critical
  if (high >= critical) {
    const adjusted = Math.min(100, high + 10)
    if (adjusted > high) critical = adjusted
    else high = Math.max(1, critical - 10)
  }
  return { high, critical, telegram, discord, enabled: notification.enabled }
}

/**
 * Normalizes icon layout bars by dropping blank keys and non-positive weights.
 *
 * @param layout - TrayIconLayoutSettings object
 * @returns Clean TrayIconLayoutSettings object
 */
const normalizeIconLayout = (layout: TrayIconLayoutSettings): TrayIconLayoutSettings => {
  const mode: IconLayoutMode = layout.mode === 'manual' ? 'manual' : 'auto'
  const barProviderNames = new Set(
    PROVIDER_DESCRIPTORS.filter((descriptor) => descriptor.barProvider).map(
      (descriptor) => descriptor.name,
    ),
  )
  const bars: Record<string, number> = {}
  for (const [key, weight] of Object.entries(layout.bars)) {
    const trimmed = key.trim()
    if (trimmed && Number.isFinite(weight) && weight > 0 && barProviderNames.has(trimmed)) {
      bars[trimmed] = weight
    }
  }
  return { mode, bars }
}

/**
 * Reconciles persisted providers against the registered descriptor catalog, preserving order and adding missing providers.
 *
 * @param providers - Array of persisted ProviderSettings
 * @returns Reconciled non-empty array of ProviderSettings
 */
export const mergeRegisteredProviders = (providers: ProviderSettings[]): ProviderSettings[] => {
  const merged = providers
    .map((provider) => {
      const descriptor = PROVIDER_DESCRIPTORS.find(
        (entry) => entry.id === provider.id || entry.name === provider.name,
      )
      return normalizeProvider(provider, descriptor ?? null)
    })
    .filter(
      (provider, index, all) =>
        all.findIndex((entry) => (entry.id ?? entry.name) === (provider.id ?? provider.name)) ===
        index,
    )

  for (const descriptor of PROVIDER_DESCRIPTORS) {
    const exists = merged.some(
      (provider) => provider.id === descriptor.id || provider.name === descriptor.name,
    )
    if (!exists) {
      merged.push({
        name: descriptor.name,
        type: descriptor.authenticationKind,
        credential: descriptor.credentialName,
        apiKey: null,
        enabled: false,
        refreshToken: true,
        id: descriptor.id,
        startWindowAfterReset: descriptor.startWindowAfterReset,
      })
    }
  }

  return merged
}

/**
 * Builds the default settings document with every registered provider entry present.
 * Providers whose credentials were detected on the machine are enabled automatically.
 *
 * @param configuredProviderIds - Provider descriptor IDs with usable credentials
 * @returns Default AppSettings object with all provider descriptors registered
 */
const defaultSettingsWithProviders = (
  configuredProviderIds: readonly string[] = [],
): AppSettings => ({
  ...structuredClone(DEFAULT_SETTINGS),
  providers: mergeRegisteredProviders([]).map((provider) =>
    provider.id !== null && configuredProviderIds.includes(provider.id)
      ? { ...provider, enabled: true }
      : provider,
  ),
})

/**
 * Rebuilds a complete settings document with defaults, valid ranges, and merged providers.
 *
 * @param input - Unknown input document read from disk
 * @param configuredProviderIds - Provider IDs with usable credentials, used only when no document exists
 * @returns Fully validated and normalized AppSettings object
 */
export const normalizeSettings = (
  input: unknown,
  configuredProviderIds?: readonly string[],
): AppSettings => {
  const persisted = asRecord(input)
  if (!persisted) return defaultSettingsWithProviders(configuredProviderIds)

  const candidate: unknown = {
    ...structuredClone(DEFAULT_SETTINGS),
    ...persisted,
    settingsRevision: 4,
  }
  const parsed = settingsSchema.safeParse(candidate)
  if (!parsed.success) return defaultSettingsWithProviders(configuredProviderIds)

  const settings = parsed.data
  return {
    ...settings,
    refresh: {
      minute:
        settings.refresh.minute > 0 && settings.refresh.minute <= REFRESH_MAX_MINUTES
          ? settings.refresh.minute
          : DEFAULT_SETTINGS.refresh.minute,
    },
    notification: normalizeNotification(settings.notification),
    visual: {
      scale: Math.min(
        VISUAL_SCALE_LIMITS.max,
        Math.max(VISUAL_SCALE_LIMITS.min, settings.visual.scale),
      ),
      iconLayout: normalizeIconLayout(settings.visual.iconLayout),
    },
    models: {
      smallModelSelector: settings.models.smallModelSelector.trim() || DEFAULT_SMALL_MODEL_SELECTOR,
    },
    providers: mergeRegisteredProviders(settings.providers),
  }
}

/**
 * Normalizes a patch produced by the settings page before it is persisted.
 *
 * @param patch - Incoming partial settings patch
 * @returns Sanitized AppSettingsPatch object
 */
export const normalizeSettingsPatch = (patch: AppSettingsPatch): AppSettingsPatch => {
  const normalized: AppSettingsPatch = { ...patch }
  if (patch.refresh !== undefined) {
    normalized.refresh = {
      minute:
        patch.refresh.minute > 0 && patch.refresh.minute <= REFRESH_MAX_MINUTES
          ? patch.refresh.minute
          : DEFAULT_SETTINGS.refresh.minute,
    }
  }
  if (patch.notification !== undefined) {
    normalized.notification = normalizeNotification({
      ...DEFAULT_SETTINGS.notification,
      ...patch.notification,
    })
  }
  if (patch.visual !== undefined) {
    normalized.visual = {
      ...patch.visual,
      scale: Math.min(
        VISUAL_SCALE_LIMITS.max,
        Math.max(VISUAL_SCALE_LIMITS.min, patch.visual.scale ?? DEFAULT_SETTINGS.visual.scale),
      ),
      iconLayout: normalizeIconLayout(
        patch.visual.iconLayout ?? DEFAULT_SETTINGS.visual.iconLayout,
      ),
    }
  }
  if (patch.models !== undefined) {
    normalized.models = {
      smallModelSelector: patch.models.smallModelSelector?.trim() || DEFAULT_SMALL_MODEL_SELECTOR,
    }
  }
  if (patch.providers !== undefined) {
    normalized.providers = mergeRegisteredProviders(patch.providers)
  }
  return normalized
}

/**
 * Migrates persisted generic settings and drops fields owned by removed features.
 *
 * @param input - Raw persisted data
 * @param configuredProviderIds - Provider IDs with usable credentials, used only when no document exists
 * @returns Validated AppSettings object
 */
export const parsePersistedSettings = (
  input: unknown,
  configuredProviderIds?: readonly string[],
): AppSettings => normalizeSettings(input, configuredProviderIds)
