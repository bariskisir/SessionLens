/**
 * Owns the optional system tray icon and close-to-tray behavior.
 */

import { join } from 'node:path'
import { app, BrowserWindow, Menu, nativeImage, screen, Tray } from 'electron'
import type { NotificationLevel } from '@shared/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { AppSettings, TooltipCard } from '@shared/types'
import type { IconBar } from './usage/IconLayout'
import { renderTrayIconPng } from './usage/TrayIconRenderer'
import type LoggerService from './LoggerService'

type TraySettings = Pick<AppSettings, 'showTrayIcon' | 'minimizeToTrayOnClose'>

interface TrayTooltipData {
  cards: TooltipCard[]
  scale: number
}

interface TrayTooltipSize {
  width: number
  height: number
}

const TOOLTIP_MARGIN = 8

export default class TrayService {
  private tray: Tray | null = null
  private tooltipWindow: BrowserWindow | null = null
  private tooltipPageReady = false
  private tooltipShowRequested = false
  private tooltipData: TrayTooltipData = { cards: [], scale: 100 }
  private tooltipContentSize: TrayTooltipSize | null = null
  private refreshUsage: (() => void) | null = null
  private settings: TraySettings
  private quitting = false

  /** Creates the configured tray icon without exposing Electron objects to the renderer. */
  public constructor(
    private readonly window: BrowserWindow,
    settings: TraySettings,
    private readonly logger: LoggerService,
  ) {
    this.settings = {
      showTrayIcon: settings.showTrayIcon,
      minimizeToTrayOnClose: settings.minimizeToTrayOnClose,
    }
    this.updateTrayIcon()
  }

  /** Applies persisted tray preferences immediately. */
  public applySettings(settings: TraySettings): void {
    this.settings = {
      showTrayIcon: settings.showTrayIcon,
      minimizeToTrayOnClose: settings.minimizeToTrayOnClose,
    }
    this.updateTrayIcon()
  }

  public setUsage(bars: IconBar[]): void {
    if (!this.tray) return
    try {
      if (bars.length === 0 || bars.every((bar) => bar.provider === 'None')) {
        this.tray.setImage(this.getDefaultTrayImage())
        return
      }
      const image = nativeImage.createFromBuffer(renderTrayIconPng(bars))
      this.tray.setImage(image)
    } catch (error) {
      this.logger.error('TrayService', 'Usage tray icon could not be rendered.', error)
    }
  }

  /** Updates the HTML tooltip content rendered when the pointer hovers over the tray icon. */
  public setTooltip(cards: TooltipCard[], scale: number): void {
    this.tooltipData = { cards, scale }
    this.renderTooltip()
  }

  /** Applies a new tooltip scale to already loaded cards without waiting for a usage refresh. */
  public setTooltipScale(scale: number): void {
    this.tooltipData = { ...this.tooltipData, scale }
    this.renderTooltip()
  }

  /** Sets the usage refresh command once the refresh service has been created. */
  public setRefreshHandler(handler: () => void): void {
    this.refreshUsage = handler
  }

  /** Returns true only when hiding cannot strand the user without a working tray icon. */
  public shouldMinimizeOnClose(): boolean {
    return !this.quitting && this.settings.minimizeToTrayOnClose && this.tray !== null
  }

  public showNotification(level: NotificationLevel, message: string): boolean {
    if (!this.tray || process.platform !== 'win32') return false
    this.tray.displayBalloon({
      title: '',
      content: message,
      iconType: level === 'critical' ? 'error' : level === 'high' ? 'warning' : 'info',
    })
    return true
  }

  /** Prevents close-to-tray from intercepting an explicit application quit. */
  public prepareToQuit(): void {
    this.quitting = true
    this.destroyTrayIcon()
  }

  /** Releases native resources when the owning application window is replaced. */
  public dispose(): void {
    this.destroyTrayIcon()
  }

  /** Creates or removes the native icon to match the latest persisted setting. */
  private updateTrayIcon(): void {
    if (this.quitting || !this.settings.showTrayIcon) {
      this.destroyTrayIcon()
      return
    }
    if (this.tray) return

    try {
      const tray = new Tray(this.getDefaultTrayImage())
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Refresh', click: () => this.refreshUsage?.() },
          { label: 'Settings', click: () => this.showSettings() },
          { label: 'Exit', role: 'quit' },
        ]),
      )
      tray.on('click', () => this.showWindow())
      this.tray = tray
      // Do not use mouse-move here: Windows can queue several move events while
      // the pointer crosses the notification area, which reopens a just-hidden
      // popup. The native tray lifecycle is enter once, leave once.
      tray.on('mouse-enter', () => this.showTrayTooltip())
      tray.on('mouse-leave', () => this.hideTrayTooltip())
    } catch (error) {
      this.logger.error('TrayService', 'System tray icon could not be created.', error)
      this.tray = null
    }
  }

  /** Restores and focuses the application from either tray interaction. */
  private showWindow(): void {
    if (this.window.isDestroyed()) return
    if (this.window.isMinimized()) this.window.restore()
    this.window.show()
    this.window.focus()
  }

  /** Restores the window and asks the renderer to open its settings page. */
  private showSettings(): void {
    this.showWindow()
    if (!this.window.isDestroyed()) {
      this.window.webContents.send(IpcChannel.SettingsOpenRequested)
    }
  }

  /** Opens the non-focusable HTML tooltip above or beside the operating-system tray. */
  private showTrayTooltip(): void {
    if (!this.tray || this.quitting) return
    if (this.tooltipWindow?.isVisible()) return
    if (this.tooltipShowRequested) return
    this.tooltipShowRequested = true
    this.ensureTooltipWindow()
    if (!this.tooltipPageReady) return
    if (this.tooltipContentSize) this.placeAndShowTooltip()
    this.renderTooltip()
  }

  /** Hides the custom popup only when the pointer genuinely left the tray area. */
  private hideTrayTooltip(): void {
    if (!this.tooltipWindow?.isVisible()) return
    if (this.isCursorOverTray()) return
    this.tooltipShowRequested = false
    this.tooltipWindow.hide()
  }

  /** Returns true when the cursor is still within the tray icon bounds (with padding). */
  private isCursorOverTray(): boolean {
    if (!this.tray) return false
    try {
      const bounds = this.tray.getBounds()
      if (bounds.width === 0 && bounds.height === 0) return false
      const cursor = screen.getCursorScreenPoint()
      const pad = 12
      return (
        cursor.x >= bounds.x - pad &&
        cursor.x <= bounds.x + bounds.width + pad &&
        cursor.y >= bounds.y - pad &&
        cursor.y <= bounds.y + bounds.height + pad
      )
    } catch {
      return false
    }
  }

  private getDefaultTrayImage() {
    const iconPath = app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(app.getAppPath(), 'build', 'icon.png')
    const sourceImage = nativeImage.createFromPath(iconPath)
    if (sourceImage.isEmpty()) throw new Error(`Tray icon could not be read from ${iconPath}.`)
    return process.platform === 'win32' ? sourceImage : sourceImage.resize({ width: 16, height: 16 })
  }

  /** Lazily creates the browser popup so the app does not allocate it when tray hover is unused. */
  private ensureTooltipWindow(): void {
    if (this.tooltipWindow && !this.tooltipWindow.isDestroyed()) return
    const tooltip = new BrowserWindow({
      width: 300,
      height: 100,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    tooltip.setAlwaysOnTop(true, 'pop-up-menu')
    tooltip.setIgnoreMouseEvents(true)
    tooltip.once('closed', () => {
      if (this.tooltipWindow === tooltip) {
        this.tooltipWindow = null
        this.tooltipPageReady = false
        this.tooltipShowRequested = false
      }
    })
    tooltip.webContents.once('did-finish-load', () => {
      if (this.tooltipWindow !== tooltip) return
      this.tooltipPageReady = true
      this.renderTooltip()
    })
    this.tooltipWindow = tooltip
    const developmentUrl = process.env.VITE_DEV_SERVER_URL
    const loadTooltip = developmentUrl
      ? tooltip.loadURL(`${developmentUrl.replace(/\/$/, '')}/tray-tooltip/index.html`)
      : tooltip.loadFile(join(__dirname, '../renderer/tray-tooltip/index.html'))
    void loadTooltip.catch((error: unknown) => {
      this.logger.error('TrayService', 'Tray tooltip document could not be loaded.', error)
    })
  }

  /** Renders the latest cards into the isolated tooltip document without exposing Node APIs. */
  private renderTooltip(): void {
    const tooltip = this.tooltipWindow
    if (!tooltip || tooltip.isDestroyed() || !this.tooltipPageReady) return
    const payload = JSON.stringify(this.tooltipData)
    void tooltip.webContents
      .executeJavaScript(
        `window.setTooltip(${payload}); new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => { const panel = document.querySelector('.panel'); const rect = panel?.getBoundingClientRect(); resolve({ width: Math.ceil(rect?.width ?? 260), height: Math.ceil(rect?.height ?? 58) }); })))`,
        true,
      )
      .then((value: unknown) => {
        if (this.tooltipWindow !== tooltip || tooltip.isDestroyed()) return
        const measured = value as Partial<TrayTooltipSize>
        if (
          typeof measured.width !== 'number' ||
          !Number.isFinite(measured.width) ||
          typeof measured.height !== 'number' ||
          !Number.isFinite(measured.height)
        ) {
          return
        }
        this.tooltipContentSize = {
          width: Math.max(1, measured.width),
          height: Math.max(1, measured.height),
        }
        if (this.tooltipShowRequested) this.placeAndShowTooltip()
      })
      .catch((error: unknown) =>
        this.logger.warn('TrayService', 'Tray tooltip content could not be rendered.', error),
      )
  }

  /** Sizes the popup from its cards and anchors it within the display work area near the tray. */
  private placeAndShowTooltip(): void {
    const tray = this.tray
    const tooltip = this.tooltipWindow
    if (!tray || !tooltip || tooltip.isDestroyed()) return
    const contentSize = this.tooltipContentSize ?? { width: 260, height: 58 }
    const bounds = tray.getBounds()
    const display = screen.getDisplayNearestPoint({
      x: bounds.x + Math.floor(bounds.width / 2),
      y: bounds.y + Math.floor(bounds.height / 2),
    })
    const workArea = display.workArea
    const width = Math.min(workArea.width - TOOLTIP_MARGIN * 2, contentSize.width)
    const height = Math.min(workArea.height - TOOLTIP_MARGIN * 2, contentSize.height)
    const horizontalCenter = bounds.x + Math.floor(bounds.width / 2) - Math.floor(width / 2)
    const x = Math.min(
      workArea.x + workArea.width - width - TOOLTIP_MARGIN,
      Math.max(workArea.x + TOOLTIP_MARGIN, horizontalCenter),
    )
    const trayIsBelowWorkArea = bounds.y >= workArea.y + Math.floor(workArea.height / 2)
    const preferredY = trayIsBelowWorkArea
      ? bounds.y - height - TOOLTIP_MARGIN
      : bounds.y + bounds.height + TOOLTIP_MARGIN
    const y = Math.min(
      workArea.y + workArea.height - height - TOOLTIP_MARGIN,
      Math.max(workArea.y + TOOLTIP_MARGIN, preferredY),
    )
    tooltip.setBounds({ x, y, width, height })
    tooltip.showInactive()
  }

  /** Destroys the current native tray instance exactly once. */
  private destroyTrayIcon(): void {
    this.tray?.destroy()
    this.tray = null
    this.tooltipWindow?.destroy()
    this.tooltipWindow = null
    this.tooltipPageReady = false
    this.tooltipContentSize = null
  }
}
