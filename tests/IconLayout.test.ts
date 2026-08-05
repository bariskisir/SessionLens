import { describe, expect, it } from 'vitest'
import { computeIconBars } from '../src/main/services/usage/IconLayout'

describe('computeIconBars', () => {
  it('uses a provider allocation as its total icon share across all of its windows', () => {
    const bars = computeIconBars(
      [
        {
          providerName: 'Codex',
          windows: [
            { providerName: 'Codex', label: 'Session', usedPercent: 40 },
            { providerName: 'Codex', label: 'Weekly', usedPercent: 60 },
          ],
        },
      ],
      { mode: 'manual', bars: { Codex: 50 } },
    )

    expect(bars.map((bar) => bar.weight)).toEqual([25, 25, 50])
  })

  it('preserves manual ordering and reserves a bar when a provider has no result', () => {
    const bars = computeIconBars(
      [
        {
          providerName: 'Codex',
          windows: [{ providerName: 'Codex', label: 'Session', usedPercent: 40 }],
        },
      ],
      { mode: 'manual', bars: { Claude: 50, Codex: 50 } },
    )

    expect(bars).toEqual([
      { provider: 'Claude', usedPercent: null, weight: 50 },
      { provider: 'Codex', usedPercent: 40, weight: 50 },
    ])
  })
})
