/**
 * @file IconLayout.ts
 * @description Computes tray icon bar dimensions and proportions based on provider metrics and auto/manual icon layout settings.
 */

import type { ProviderResult, TrayIconLayoutSettings, UsageWindow } from '@shared/types'
import { PROVIDER_DESCRIPTORS } from '@shared/types'

/** A single bar specification to render: usage percentage (or null for empty track), height weight, and provider name. */
export interface IconBar {
  usedPercent: number | null
  weight: number
  provider: string
}

/** Set of provider names supported as dynamic tray icon bars. */
const barProviderNames = new Set(
  PROVIDER_DESCRIPTORS.filter((descriptor) => descriptor.barProvider).map(
    (descriptor) => descriptor.name,
  ),
)

/**
 * Computes default automatic bars, distributing vertical height equally among all metric windows.
 *
 * @param results - Array of provider query results
 * @returns Array of IconBar specifications
 */
const defaultBars = (results: ProviderResult[]): IconBar[] => {
  const bars: IconBar[] = []
  for (const result of results) {
    if ('windows' in result) {
      for (const window of result.windows) {
        bars.push({ usedPercent: window.usedPercent, weight: 1, provider: result.providerName })
      }
    }
  }
  return bars
}

/**
 * Groups metric windows by provider name for manual layout calculations.
 *
 * @param results - Array of provider query results
 * @returns Map of usage windows grouped by provider name
 */
const windowsByProvider = (results: ProviderResult[]): Map<string, UsageWindow[]> => {
  const grouped = new Map<string, UsageWindow[]>()
  for (const result of results) {
    if (!('windows' in result)) continue
    const windows = grouped.get(result.providerName) ?? []
    for (const window of result.windows) windows.push(window)
    if (windows.length > 0) grouped.set(result.providerName, windows)
  }
  return grouped
}

/**
 * Computes custom manual layout bars using user-configured provider weights and bar allocation.
 *
 * @param results - Array of provider query results
 * @param settings - Manual tray icon layout settings
 * @returns Array of weighted IconBar specifications
 */
const manualBars = (results: ProviderResult[], settings: TrayIconLayoutSettings): IconBar[] => {
  const grouped = windowsByProvider(results)
  const bars: IconBar[] = []
  let totalWeight = 0

  for (const [providerName, weight] of Object.entries(settings.bars)) {
    if (!barProviderNames.has(providerName)) continue
    const windows = grouped.get(providerName)
    if (!windows || windows.length === 0) {
      bars.push({ usedPercent: null, weight, provider: providerName })
      totalWeight += weight
      continue
    }
    const weightPerWindow = weight / windows.length
    for (const window of windows) {
      bars.push({
        usedPercent: window.usedPercent,
        weight: weightPerWindow,
        provider: window.providerName,
      })
    }
    totalWeight += weight
  }

  if (bars.length > 0 && totalWeight < 100) {
    bars.push({ usedPercent: null, weight: 100 - totalWeight, provider: 'None' })
  }

  return bars
}

/**
 * Builds the final ordered tray-icon bar specifications from metric windows.
 * Default mode shows all metric windows equally in provider display order;
 * manual mode uses the providers configured in layout settings.
 *
 * @param results - Array of provider query results
 * @param settings - Optional tray icon layout settings
 * @returns Non-empty array of IconBar specifications
 */
export const computeIconBars = (
  results: ProviderResult[],
  settings?: TrayIconLayoutSettings | null,
): IconBar[] => {
  const normalized = settings ?? { mode: 'auto' as const, bars: {} }
  const bars = normalized.mode === 'manual' ? manualBars(results, normalized) : defaultBars(results)
  if (bars.length === 0) bars.push({ usedPercent: null, weight: 1, provider: 'None' })
  return bars
}
