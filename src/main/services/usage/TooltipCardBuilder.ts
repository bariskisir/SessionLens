/**
 * @file TooltipCardBuilder.ts
 * @description Transforms raw provider results into structured tooltip card models for system tray rendering.
 */

import type { TooltipCard, UsageSnapshot } from '@shared/types'
import { providerIconKey } from '@shared/config/providers'

/**
 * Builds tooltip cards from a usage snapshot: metric results become metric cards,
 * balance results become balance cards, preserving provider display order.
 *
 * Icon keys are resolved from the provider descriptor catalog so no per-provider
 * mapping is hardcoded here.
 *
 * @param snapshot - Complete usage snapshot containing all provider results
 * @returns Array of formatted TooltipCard objects
 */
export const buildTooltipCards = (snapshot: UsageSnapshot): TooltipCard[] => {
  const metricCards: TooltipCard[] = []
  const balanceCards: TooltipCard[] = []

  for (const result of snapshot.results) {
    if ('windows' in result) {
      metricCards.push({
        title: result.providerName,
        plan: result.plan ?? null,
        metrics: result.windows.map((window) => ({
          label: window.label,
          percent: window.usedPercent,
          detail: window.resetText ?? '',
          sub: window.subLabel ?? null,
        })),
        lines: [],
        icon: providerIconKey(result.providerName),
        notice: result.notice ?? null,
      })
    } else if ('balanceText' in result) {
      balanceCards.push({
        title: result.providerName,
        plan: null,
        metrics: [],
        lines: [result.balanceText],
        icon: null,
      })
    }
  }

  return [...metricCards, ...balanceCards]
}
