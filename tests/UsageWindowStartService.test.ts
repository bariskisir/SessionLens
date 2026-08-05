import { describe, expect, it, vi } from 'vitest'
import type { AppSettings, UsageWindow } from '../src/shared/types'
import UsageWindowStartService from '../src/main/services/usage/UsageWindowStartService'
import type WindowStartRequestSender from '../src/main/services/usage/WindowStartRequestSender'
import type LoggerService from '../src/main/services/LoggerService'

const createLogger = (): LoggerService =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }) as unknown as LoggerService

const createSender = (): {
  sender: WindowStartRequestSender
  started: ReturnType<typeof vi.fn>
} => {
  const started = vi.fn().mockResolvedValue(undefined)
  return {
    sender: { startAsync: started } as unknown as WindowStartRequestSender,
    started,
  }
}

const window = (overrides: Partial<UsageWindow>): UsageWindow => ({
  providerName: 'Codex',
  label: 'Session',
  usedPercent: 40,
  ...overrides,
})

const settings = (provider: Partial<AppSettings['providers'][number]>): AppSettings =>
  ({
    providers: [
      {
        name: 'Codex',
        id: 'codex',
        enabled: true,
        startWindowAfterReset: true,
        ...provider,
      },
    ],
    models: { smallModelSelector: 'nano,mini,haiku' },
  }) as AppSettings

describe('UsageWindowStartService', () => {
  it('arms on the first observation without sending a request', async () => {
    const { sender, started } = createSender()
    const service = new UsageWindowStartService(sender, createLogger())

    await service.observeAsync(
      [window({ usedPercent: 60, resetAt: '2026-01-01T00:00:00Z' })],
      settings({}),
    )

    expect(started).not.toHaveBeenCalled()
  })

  it('sends a minimal request after a usage reset drops below 5%', async () => {
    const { sender, started } = createSender()
    const service = new UsageWindowStartService(sender, createLogger())

    await service.observeAsync(
      [window({ usedPercent: 60, resetAt: '2026-01-01T00:00:00Z' })],
      settings({}),
    )
    await service.observeAsync(
      [window({ usedPercent: 0, resetAt: '2026-01-01T00:00:00Z' })],
      settings({}),
    )

    expect(started).toHaveBeenCalledTimes(1)
    expect(started).toHaveBeenCalledWith({
      providerName: 'codex',
      smallModelSelector: 'nano,mini,haiku',
      windowLabel: 'Session',
      windowSubLabel: null,
    })
  })

  it('warns when the reset timestamp moves later on an unused session', async () => {
    const { sender, started } = createSender()
    const service = new UsageWindowStartService(sender, createLogger())

    await service.observeAsync(
      [window({ usedPercent: 0, resetAt: '2026-01-01T00:00:00Z' })],
      settings({}),
    )
    await service.observeAsync(
      [window({ usedPercent: 0, resetAt: '2026-01-01T01:00:00Z' })],
      settings({}),
    )

    expect(started).toHaveBeenCalledTimes(1)
  })

  it('does not warm providers whose option is disabled', async () => {
    const { sender, started } = createSender()
    const service = new UsageWindowStartService(sender, createLogger())

    const disabledSettings = settings({ startWindowAfterReset: false })
    await service.observeAsync([window({ usedPercent: 60 })], disabledSettings)
    await service.observeAsync([window({ usedPercent: 0 })], disabledSettings)

    expect(started).not.toHaveBeenCalled()
  })

  it('does not warm unsupported providers', async () => {
    const { sender, started } = createSender()
    const service = new UsageWindowStartService(sender, createLogger())

    const unsupported = settings({ id: 'deepseek', name: 'DeepSeek' })
    await service.observeAsync(
      [{ providerName: 'DeepSeek', label: 'Session', usedPercent: 60 }],
      unsupported,
    )
    await service.observeAsync(
      [{ providerName: 'DeepSeek', label: 'Session', usedPercent: 0 }],
      unsupported,
    )

    expect(started).not.toHaveBeenCalled()
  })

  it('retries a failed request on the next refresh and succeeds', async () => {
    const started = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined)
    const sender = { startAsync: started } as unknown as WindowStartRequestSender
    const logger = createLogger()
    const service = new UsageWindowStartService(sender, logger)

    await service.observeAsync([window({ usedPercent: 60 })], settings({}))
    await service.observeAsync([window({ usedPercent: 0 })], settings({}))
    await service.observeAsync([window({ usedPercent: 0 })], settings({}))

    expect(started).toHaveBeenCalledTimes(2)
  })
})
