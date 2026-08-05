/**
 * Verifies native tray creation, hover popup behavior, window restoration,
 * and safe close-to-tray gating.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import TrayService from '../src/main/services/TrayService'
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
    public readonly executeJavaScript = vi.fn(() => Promise.resolve({ width: 280, height: 120 }))
    public readonly webContents = {
      executeJavaScript: this.executeJavaScript,
      setBackgroundThrottling: vi.fn(),
    }
    public readonly isDestroyed = vi.fn(() => this.destroyed)
    public readonly isVisible = vi.fn(() => false)
    public readonly destroy = vi.fn(() => {
      this.destroyed = true
    })
    public readonly loadFile = vi.fn(() => electronMocks.pendingLoad ?? Promise.resolve())
    public readonly loadURL = vi.fn(() => electronMocks.pendingLoad ?? Promise.resolve())
    public readonly showInactive = vi.fn()
    public readonly hide = vi.fn()
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
  ({ error: vi.fn(), warn: vi.fn() }) as unknown as LoggerService

/** Flushes the pending microtask chain of the async popup show. */
const flushAsync = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('TrayService', () => {
  beforeEach(() => {
    electronMocks.instances.length = 0
    electronMocks.menuTemplates.length = 0
    electronMocks.tooltipWindows.length = 0
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
})
