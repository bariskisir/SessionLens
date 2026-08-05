/**
 * @file TooltipCardBuilder.ts
 * @description Transforms raw provider results into structured tooltip card models for system tray rendering.
 */

import type { TooltipCard, UsageSnapshot } from '@shared/types'

/** Mapping of normalized provider names to system tray icon SVG asset names. */
const ICON_KEYS: Record<string, string> = {
  codex: 'openai',
  claude: 'claude',
  antigravity: 'antigravity',
  commandcode: 'commandcode',
  copilot: 'copilot',
  warp: 'warp',
  synthetic: 'synthetic',
  chutes: 'chutes',
  zai: 'zai',
  elevenlabs: 'elevenlabs',
  alibaba: 'alibaba',
  minimax: 'minimax',
  kilo: 'kilo',
  codebuff: 'codebuff',
}

/**
 * Builds tooltip cards from a usage snapshot: metric results become metric cards,
 * balance results become balance cards, preserving provider display order.
 *
 * @param snapshot - Complete usage snapshot containing all provider results
 * @returns Array of formatted TooltipCard objects
 */
export const buildTooltipCards = (snapshot: UsageSnapshot): TooltipCard[] => {
  const metricCards: TooltipCard[] = []
  const balanceCards: TooltipCard[] = []
  for (const result of snapshot.results) {
    if ('windows' in result && result.windows.length > 0) {
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
        icon: ICON_KEYS[result.providerName.toLowerCase().replace(/\s+/g, '')] ?? null,
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

