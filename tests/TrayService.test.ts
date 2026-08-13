/**
 * Verifies native tray creation, hover popup behavior, window restoration,
 * and safe close-to-tray gating.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { TooltipCard } from '@shared/types'
import TrayService, { withTimeout } from '../src/main/services/TrayService'
import type LoggerService from '../src/main/services/LoggerService'

const electronMocks = vi.hoisted(() => {
  class MockTray {
    public readonly handlers = new Map<string, () => void>()
    public readonly destroy = vi.fn()
    public readonly setContextMenu = vi.fn()
    public readonly setToolTip = vi.fn()
    public readonly setImage = vi.fn()
    public readonly bounds = { x: 100, y: 100, width: 20, height: 20 }
    public readonly getBounds = vi.fn(() => this.bounds)

    public on(event: string, listener: () => void): void {
      this.handlers.set(event, listener)
    }
  }

  class MockTooltip {
    private destroyed = false
    private visible = false
    public readonly executeJavaScript = vi.fn(() => Promise.resolve({ width: 280, height: 120 }))
    public readonly webContents = {
      executeJavaScript: this.executeJavaScript,
      setBackgroundThrottling: vi.fn(),
      on: vi.fn(),
    }
    public readonly isDestroyed = vi.fn(() => this.destroyed)
    public readonly isVisible = vi.fn(() => this.visible)
    public readonly destroy = vi.fn(() => {
      this.destroyed = true
      this.visible = false
    })
    public readonly loadFile = vi.fn(() => electronMocks.pendingLoad ?? Promise.resolve())
    public readonly loadURL = vi.fn(() => electronMocks.pendingLoad ?? Promise.resolve())
    public readonly showInactive = vi.fn(() => {
      this.visible = true
    })
    public readonly hide = vi.fn(() => {
      this.visible = false
    })
    public readonly setBounds = vi.fn()
    public readonly setAlwaysOnTop = vi.fn()
    public readonly setIgnoreMouseEvents = vi.fn()
  }

  return {
    MockTray,
    MockTooltip,
    instances: [] as MockTray[],
    menuTemplates: [] as unknown[][],
    imageEmpty: false,
    tooltipWindows: [] as MockTooltip[],
    notifications: [] as Array<{
      options: { body?: string; title?: string; silent?: boolean }
      handlers: Map<string, () => void>
      close: ReturnType<typeof vi.fn>
      show: () => void
    }>,
    pendingLoad: null as Promise<void> | null,
    quit: vi.fn(),
  }
})

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => 'C:\\repo',
    quit: electronMocks.quit,
  },
  BrowserWindow: class extends electronMocks.MockTooltip {
    public constructor() {
      super()
      electronMocks.tooltipWindows.push(this)
    }
  },
  Menu: {
    buildFromTemplate: vi.fn((template: unknown[]) => {
      electronMocks.menuTemplates.push(template)
      return template
    }),
  },
  nativeImage: {
    createFromPath: vi.fn(() => ({
      isEmpty: () => electronMocks.imageEmpty,
      resize: vi.fn(() => ({ resized: true })),
    })),
    createFromBuffer: vi.fn(() => ({ bufferPng: true })),
  },
  screen: {
    getDisplayNearestPoint: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })),
  },
  Tray: class extends electronMocks.MockTray {
    public constructor() {
      super()
      electronMocks.instances.push(this)
    }
  },
  Notification: class {
    public readonly handlers = new Map<string, () => void>()
    public readonly close = vi.fn()
    public constructor(
      public readonly options: { body?: string; title?: string; silent?: boolean },
    ) {
      electronMocks.notifications.push(this)
    }

    public on(event: string, listener: () => void): void {
      this.handlers.set(event, listener)
    }

    public show(): void {}
  },
}))

/** Creates the BrowserWindow capabilities used by TrayService. */
const createWindow = (): BrowserWindow =>
  ({
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  }) as unknown as BrowserWindow

/** Creates the logging capability used by TrayService. */
const createLogger = (): LoggerService =>
  ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) as unknown as LoggerService

/** Flushes the pending microtask chain of the async popup show. */
const flushAsync = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** One representative metric card used by the popup tests. */
const sampleCard: TooltipCard = {
  title: 'Codex',
  plan: 'Pro',
  metrics: [{ label: 'Daily', percent: 42, detail: '2h', sub: null }],
  lines: [],
  icon: 'codex',
  notice: null,
}

describe('TrayService', () => {
  beforeEach(() => {
    electronMocks.instances.length = 0
    electronMocks.menuTemplates.length = 0
    electronMocks.tooltipWindows.length = 0
    electronMocks.notifications.length = 0
    electronMocks.pendingLoad = null
    electronMocks.imageEmpty = false
    electronMocks.quit.mockClear()
  })

  it('does not create a tray icon while the preference is disabled', () => {
    const service = new TrayService(
      createWindow(),
      { showTrayIcon: false, minimizeToTrayOnClose: false },
      createLogger(),
    )

    expect(electronMocks.instances).toHaveLength(0)
    expect(service.shouldMinimizeOnClose()).toBe(false)
  })

  it('creates, restores from, and removes the tray icon dynamically', () => {
    const window = createWindow()
    const service = new TrayService(
      window,
      { showTrayIcon: false, minimizeToTrayOnClose: false },
      createLogger(),
    )

    service.applySettings({ showTrayIcon: true, minimizeToTrayOnClose: true })
    const tray = electronMocks.instances[0]
    expect(tray).toBeDefined()
    expect(service.shouldMinimizeOnClose()).toBe(true)

    tray?.handlers.get('click')?.()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()

    service.applySettings({ showTrayIcon: false, minimizeToTrayOnClose: false })
    expect(tray?.destroy).toHaveBeenCalledOnce()
    expect(service.shouldMinimizeOnClose()).toBe(false)
  })

  it('never hides the window when native tray creation fails', () => {
    electronMocks.imageEmpty = true
    const logger = createLogger()
    const service = new TrayService(
      createWindow(),
      { showTrayIcon: true, minimizeToTrayOnClose: true },
      logger,
    )

    expect(service.shouldMinimizeOnClose()).toBe(false)
    expect(logger.error).toHaveBeenCalledOnce()
  })

  it('destroys the icon and bypasses close-to-tray during application quit', () => {
    const service = new TrayService(
      createWindow(),
      { showTrayIcon: true, minimizeToTrayOnClose: true },
      createLogger(),
    )
    const tray = electronMocks.instances[0]

    service.prepareToQuit()

    expect(tray?.destroy).toHaveBeenCalledOnce()
    expect(service.shouldMinimizeOnClose()).toBe(false)
  })

  it('delivers native notifications through the OS toast channel', () => {
    const service = new TrayService(
      createWindow(),
      { showTrayIcon: true, minimizeToTrayOnClose: true },
      createLogger(),
    )

    expect(service.showNotification('critical', 'Codex Daily at 100%')).toBe(true)
    expect(electronMocks.notifications[0]?.options.body).toBe('Codex Daily at 100%')
  })

  it('declines native notifications while the tray icon is unavailable', () => {
    const service = new TrayService(
      createWindow(),
      { showTrayIcon: false, minimizeToTrayOnClose: false },
      createLogger(),
    )

    expect(service.showNotification('critical', 'Codex Daily at 100%')).toBe(false)
    expect(electronMocks.notifications).toHaveLength(0)
  })

  it('dismisses a read toast from the screen and the Action Center', () => {
    const service = new TrayService(
      createWindow(),
      { showTrayIcon: true, minimizeToTrayOnClose: true },
      createLogger(),
    )

    expect(service.showNotification('critical', 'Codex Daily at 100%')).toBe(true)
    const toast = electronMocks.notifications[0]
    toast?.handlers.get('click')?.()
    expect(toast?.close).toHaveBeenCalledOnce()
  })

  it('dismisses outstanding toasts when the application quits', () => {
    const service = new TrayService(
      createWindow(),
      { showTrayIcon: true, minimizeToTrayOnClose: true },
      createLogger(),
    )

    service.showNotification('high', 'first message')
    service.showNotification('critical', 'second message')
    const [first, second] = electronMocks.notifications

    service.prepareToQuit()
    expect(first?.close).toHaveBeenCalledOnce()
    expect(second?.close).toHaveBeenCalledOnce()
  })

  it('builds an unseparated Settings, Refresh, Exit menu and opens settings', () => {
    const window = createWindow()
    new TrayService(window, { showTrayIcon: true, minimizeToTrayOnClose: true }, createLogger())
    const menu = electronMocks.menuTemplates[0] as Array<{
      label?: string
      type?: string
      click?: () => void
    }>

    expect(menu.map((item) => item.label)).toEqual(['Settings', 'Refresh', 'Exit'])
    expect(menu.some((item) => item.type === 'separator')).toBe(false)

    menu[0]?.click?.()
    expect(window.webContents.send).toHaveBeenCalledWith('event:settings-open-requested')
  })

  it('pre-creates the popup, shows it on hover and hides it on leave', async () => {
    const service = new TrayService(
      createWindow(),
      { showTrayIcon: true, minimizeToTrayOnClose: true },
      createLogger(),
    )
    const tray = electronMocks.instances[0]
    expect(electronMocks.tooltipWindows).toHaveLength(1)
    service.setTooltip([sampleCard], 100)

    tray?.handlers.get('mouse-enter')?.()
    await flushAsync()
    const tooltip = electronMocks.tooltipWindows[0]
    expect(tooltip?.showInactive).toHaveBeenCalledOnce()

    tray?.handlers.get('mouse-leave')?.()
    expect(tooltip?.hide).toHaveBeenCalledOnce()
    expect(tooltip?.destroy).not.toHaveBeenCalled()

    service.dispose()
    expect(tooltip?.destroy).toHaveBeenCalledOnce()
    expect(electronMocks.instances[0]?.destroy).toHaveBeenCalledTimes(1)
  })

  it('waits for the pre-load to finish before rendering on hover', async () => {
    let resolveLoad!: () => void
    electronMocks.pendingLoad = new Promise<void>((resolve) => {
      resolveLoad = resolve
    })
    const service = new TrayService(
      createWindow(),
      { showTrayIcon: true, minimizeToTrayOnClose: true },
      createLogger(),
    )
    const tray = electronMocks.instances[0]
    const tooltip = electronMocks.tooltipWindows[0]
    service.setTooltip([sampleCard], 100)

    tray?.handlers.get('mouse-enter')?.()
    await flushAsync()
    expect(tooltip?.executeJavaScript).not.toHaveBeenCalled()

    resolveLoad()
    await flushAsync()
    expect(tooltip?.executeJavaScript).toHaveBeenCalledOnce()
    expect(tooltip?.showInactive).toHaveBeenCalledOnce()

    service.dispose()
  })

  it('reuses the same popup window across hovers', async () => {
    const service = new TrayService(
      createWindow(),
      { showTrayIcon: true, minimizeToTrayOnClose: true },
      createLogger(),
    )
    const tray = electronMocks.instances[0]
    service.setTooltip([sampleCard], 100)

    tray?.handlers.get('mouse-enter')?.()
    tray?.handlers.get('mouse-enter')?.()
    await flushAsync()
    const tooltip = electronMocks.tooltipWindows[0]
    expect(electronMocks.tooltipWindows).toHaveLength(1)
    expect(tooltip?.showInactive).toHaveBeenCalledOnce()

    tray?.handlers.get('mouse-leave')?.()
    expect(tooltip?.hide).toHaveBeenCalledOnce()

    tray?.handlers.get('mouse-enter')?.()
    await flushAsync()
    expect(electronMocks.tooltipWindows).toHaveLength(1)
    expect(tooltip?.showInactive).toHaveBeenCalledTimes(2)

    service.dispose()
  })

  it('keeps the default tray glyph and skips the popup while no data exists', async () => {
    const service = new TrayService(
      createWindow(),
      { showTrayIcon: true, minimizeToTrayOnClose: true },
      createLogger(),
    )
    const tray = electronMocks.instances[0]

    service.setTooltip([], 100)
    expect(tray?.setImage).toHaveBeenCalledWith({ resized: true })

    tray?.handlers.get('mouse-enter')?.()
    await flushAsync()
    const tooltip = electronMocks.tooltipWindows[0]
    expect(tooltip?.executeJavaScript).not.toHaveBeenCalled()
    expect(tooltip?.showInactive).not.toHaveBeenCalled()

    service.dispose()
  })

  it('treats only-hidden cards as missing data', async () => {
    const service = new TrayService(
      createWindow(),
      { showTrayIcon: true, minimizeToTrayOnClose: true },
      createLogger(),
    )
    const tray = electronMocks.instances[0]

    service.setTooltip([{ ...sampleCard, hide: true }], 100)
    expect(tray?.setImage).toHaveBeenCalledWith({ resized: true })

    tray?.handlers.get('mouse-enter')?.()
    await flushAsync()
    expect(electronMocks.tooltipWindows[0]?.showInactive).not.toHaveBeenCalled()

    service.dispose()
  })

  it('opens the popup as soon as the first card arrives', async () => {
    const service = new TrayService(
      createWindow(),
      { showTrayIcon: true, minimizeToTrayOnClose: true },
      createLogger(),
    )
    const tray = electronMocks.instances[0]
    const tooltip = electronMocks.tooltipWindows[0]

    tray?.handlers.get('mouse-enter')?.()
    await flushAsync()
    expect(tooltip?.showInactive).not.toHaveBeenCalled()

    service.setTooltip([sampleCard], 100)
    tray?.handlers.get('mouse-enter')?.()
    await flushAsync()
    expect(tooltip?.showInactive).toHaveBeenCalledOnce()

    service.dispose()
  })

  it('rebuilds the popup on the next hover when rendering fails', async () => {
    const service = new TrayService(
      createWindow(),
      { showTrayIcon: true, minimizeToTrayOnClose: true },
      createLogger(),
    )
    const tray = electronMocks.instances[0]
    const tooltip = electronMocks.tooltipWindows[0]
    service.setTooltip([sampleCard], 100)

    tooltip?.executeJavaScript.mockRejectedValueOnce(new Error('Render frame was disposed'))
    tray?.handlers.get('mouse-enter')?.()
    await flushAsync()
    expect(tooltip?.showInactive).not.toHaveBeenCalled()
    expect(tooltip?.destroy).toHaveBeenCalledOnce()

    tray?.handlers.get('mouse-enter')?.()
    await flushAsync()
    const rebuilt = electronMocks.tooltipWindows[1]
    expect(rebuilt).toBeDefined()
    expect(rebuilt?.executeJavaScript).toHaveBeenCalled()
    expect(rebuilt?.showInactive).toHaveBeenCalledOnce()

    service.dispose()
  })

  it('rebuilds the popup when the renderer never answers', async () => {
    vi.useFakeTimers()
    try {
      const service = new TrayService(
        createWindow(),
        { showTrayIcon: true, minimizeToTrayOnClose: true },
        createLogger(),
      )
      const tray = electronMocks.instances[0]
      const tooltip = electronMocks.tooltipWindows[0]
      service.setTooltip([sampleCard], 100)

      tooltip?.executeJavaScript.mockReturnValue(new Promise<never>(() => {}))
      tray?.handlers.get('mouse-enter')?.()
      await vi.advanceTimersByTimeAsync(4_000)
      expect(tooltip?.showInactive).not.toHaveBeenCalled()
      expect(tooltip?.destroy).toHaveBeenCalledOnce()

      tray?.handlers.get('mouse-enter')?.()
      await vi.advanceTimersByTimeAsync(100)
      const rebuilt = electronMocks.tooltipWindows[1]
      expect(rebuilt).toBeDefined()
      expect(rebuilt?.showInactive).toHaveBeenCalledOnce()

      service.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects withTimeout when the source promise never settles', async () => {
    vi.useFakeTimers()
    try {
      const pending = withTimeout(new Promise<never>(() => {}), 1_000)
      let error: unknown = null
      pending.catch((reason: unknown) => {
        error = reason
      })
      await vi.advanceTimersByTimeAsync(1_001)
      expect(error).toBeInstanceOf(Error)
    } finally {
      vi.useRealTimers()
    }
  })
})
