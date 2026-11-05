/**
 * Minimal system tray icon: an instant, animation-free usage popup on hover.
 */

import { join } from 'node:path'
import { app, BrowserWindow, Menu, nativeImage, Notification, screen, Tray } from 'electron'
import type { Rectangle } from 'electron'
import type { NotificationLevel } from '@shared/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { AppSettings, TooltipCard, TooltipPosition } from '@shared/types'
import type { IconBar } from './usage/IconLayout'
import { renderTrayIconPng, TRAY_ICON_SIZE } from './usage/TrayIconRenderer'
import type LoggerService from './LoggerService'

type TraySettings = Pick<AppSettings, 'showTrayIcon' | 'minimizeToTrayOnClose'> &
  Partial<Pick<AppSettings, 'visual'>>

type TooltipSide = 'above' | 'below'

const TOOLTIP_MARGIN = 8

/** Linux desktops whose default panel sits along the top edge. */
const TOP_PANEL_DESKTOPS = /(gnome|unity|pantheon|budgie|xfce|mate)/i

/** Maximum wait for the hidden tooltip renderer to answer a measure request. */
const TOOLTIP_MEASURE_TIMEOUT_MS = 3_000

/**
 * Rejects when the source promise does not settle within the timeout.
 *
 * @param promise - Source promise to observe
 * @param timeoutMs - Timeout duration in milliseconds
 * @returns The source promise's settlement, or a rejection on timeout
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Operation timed out after ${timeoutMs} ms.`)),
      timeoutMs,
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * Reads the desktop identifiers exported by Linux display managers.
 *
 * @param environment - Environment variables to inspect
 * @returns Combined desktop identifiers, or an empty string
 */
export const detectDesktopEnvironment = (environment: NodeJS.ProcessEnv = process.env): string =>
  [environment.XDG_CURRENT_DESKTOP, environment.XDG_SESSION_DESKTOP, environment.DESKTOP_SESSION]
    .filter((value): value is string => Boolean(value))
    .join(':')

/**
 * Resolves the preferred popup side from the user setting or the platform.
 * Windows and KDE keep their panel at the bottom, while GNOME and macOS place
 * theirs at the top, so automatic placement mirrors the desktop's panel.
 *
 * @param position - Configured tooltip position
 * @param platform - Host platform
 * @param desktopEnvironment - Linux desktop identifiers
 * @returns Preferred side relative to the tray icon
 */
export const resolveTooltipSide = (
  position: TooltipPosition,
  platform: NodeJS.Platform = process.platform,
  desktopEnvironment: string = detectDesktopEnvironment(),
): TooltipSide => {
  if (position === 'above' || position === 'below') return position
  if (platform === 'win32') return 'above'
  if (platform === 'darwin') return 'below'
  return TOP_PANEL_DESKTOPS.test(desktopEnvironment) ? 'below' : 'above'
}

export default class TrayService {
  private tray: Tray | null = null
  private tooltip: BrowserWindow | null = null
  private tooltipLoad: Promise<BrowserWindow | null> | null = null
  private tooltipData: { cards: TooltipCard[]; scale: number } = { cards: [], scale: 100 }
  private activeNotifications = new Set<Notification>()
  private hovering = false
  private refreshUsage: (() => void) | null = null
  private settings: TraySettings
  private tooltipSide: TooltipSide
  private readonly desktopEnvironment: string
  private quitting = false

  public constructor(
    private readonly window: BrowserWindow,
    settings: TraySettings,
    private readonly logger: LoggerService,
    private readonly platform: NodeJS.Platform = process.platform,
    desktopEnvironment: string = detectDesktopEnvironment(),
  ) {
    this.settings = { ...settings }
    this.desktopEnvironment = desktopEnvironment
    this.tooltipSide = resolveTooltipSide(
      settings.visual?.position ?? 'auto',
      platform,
      desktopEnvironment,
    )
    this.updateTrayIcon()
  }

  public applySettings(settings: TraySettings): void {
    this.settings = { ...settings }
    this.tooltipSide = resolveTooltipSide(
      settings.visual?.position ?? 'auto',
      this.platform,
      this.desktopEnvironment,
    )
    this.updateTrayIcon()
  }

  public setUsage(bars: IconBar[]): void {
    if (!this.tray) return
    try {
      const image =
        bars.length === 0 || bars.every((bar) => bar.provider === 'None')
          ? this.defaultTrayImage()
          : nativeImage.createFromBuffer(renderTrayIconPng(bars))
      this.tray.setImage(image)
    } catch (error) {
      this.logger.error('TrayService', 'Usage tray icon could not be rendered.', error)
    }
  }

  public setTooltip(cards: TooltipCard[], scale: number): void {
    this.tooltipData = { cards, scale }
    // With no data to display, keep the default tray glyph and never open the
    // popup, even when hovering.
    if (!cards.some((card) => !card.hide)) {
      this.setUsage([])
      if (this.tooltip && !this.tooltip.isDestroyed() && this.tooltip.isVisible()) {
        this.tooltip.hide()
      }
    }
  }

  public setTooltipScale(scale: number): void {
    this.tooltipData = { ...this.tooltipData, scale }
  }

  public setRefreshHandler(handler: () => void): void {
    this.refreshUsage = handler
  }

  public shouldMinimizeOnClose(): boolean {
    return !this.quitting && this.settings.minimizeToTrayOnClose && this.tray !== null
  }

  public showNotification(_level: NotificationLevel, message: string): boolean {
    if (!this.tray) return false
    const notification = new Notification({ body: message, silent: false })
    // Reading the toast only dismisses it: it must never open a window or
    // launch a fresh app instance.
    notification.on('click', () => {
      this.logger.info('TrayService', 'Notification read and dismissed.', { body: message })
      this.removeNotification(notification)
    })
    this.activeNotifications.add(notification)
    notification.show()
    return true
  }

  public prepareToQuit(): void {
    this.quitting = true
    // Leave no stale toasts in the Action Center: clicking one after the app
    // exits would launch a bare executable (dev) or a second app instance.
    for (const notification of this.activeNotifications) {
      this.removeNotification(notification)
    }
    this.destroyTrayIcon()
  }

  /** Dismisses a toast from the screen and, on Windows, from the Action Center. */
  private removeNotification(notification: Notification): void {
    this.activeNotifications.delete(notification)
    try {
      notification.close()
    } catch (error) {
      this.logger.warn('TrayService', 'Notification could not be dismissed.', error)
    }
  }

  public dispose(): void {
    this.destroyTrayIcon()
  }

  private updateTrayIcon(): void {
    if (this.quitting || !this.settings.showTrayIcon) {
      this.destroyTrayIcon()
      return
    }
    if (this.tray) return
    try {
      const tray = new Tray(this.defaultTrayImage())
      this.tray = tray
      this.updateContextMenu()
      tray.on('click', () => {
        // Linux SNI has no hover events, so activation toggles the usage
        // popup. Hosts that treat a single left click as activation send it
        // directly; GNOME's AppIndicator extension only sends it for a double
        // or middle click and opens the context menu on a single left click.
        if (this.platform === 'linux') this.toggleTooltipOnLinuxClick()
        else this.showWindow()
      })
      tray.on('mouse-enter', () => this.onTrayEnter())
      tray.on('mouse-leave', () => this.onTrayLeave())
      // No tooltip is ever set: on Windows `setToolTip` turns the native hover
      // tooltip on (an empty string still draws an empty rounded box over the
      // tray icon), while leaving it unset keeps the custom popup alone.
      // Pre-create the popup so the first hover is as instant as later ones.
      void this.ensureTooltipWindow()
    } catch (error) {
      this.logger.error('TrayService', 'System tray icon could not be created.', error)
      this.tray = null
    }
  }

  /** Builds the action menu shown by the tray host. */
  private updateContextMenu(): void {
    const tray = this.tray
    if (!tray) return
    tray.setContextMenu(
      Menu.buildFromTemplate([
        // Linux hosts that open this menu on a single left click cannot send
        // an activation (GNOME's AppIndicator extension is one), so expose the
        // HTML popup here as well and hint at the activation gesture.
        ...(this.platform === 'linux'
          ? [
              {
                label: 'Usage (double-click)',
                click: () => this.toggleTooltipOnLinuxClick(),
              },
            ]
          : []),
        { label: 'Settings', click: () => this.showSettings() },
        { label: 'Refresh', click: () => this.refreshUsage?.() },
        { label: 'Exit', role: 'quit' },
      ]),
    )
  }

  private onTrayEnter(): void {
    // A missed mouse-leave must not disable the popup permanently: skip only
    // while it is already open, and attempt the show for every other enter.
    if (this.tooltip && !this.tooltip.isDestroyed() && this.tooltip.isVisible()) {
      // The popup can still sink below other windows while visible; re-raise it.
      this.tooltip.setAlwaysOnTop(false)
      this.tooltip.setAlwaysOnTop(true, 'pop-up-menu')
      this.tooltip.moveTop()
      return
    }
    this.hovering = true
    void this.showTooltip()
  }

  private onTrayLeave(): void {
    this.hovering = false
    if (this.tooltip && !this.tooltip.isDestroyed()) this.tooltip.hide()
  }

  /** Toggles the usage popup on Linux primary activation (click). */
  private toggleTooltipOnLinuxClick(): void {
    if (this.tooltip && !this.tooltip.isDestroyed() && this.tooltip.isVisible()) {
      this.tooltip.hide()
      this.hovering = false
      return
    }
    this.hovering = true
    void this.showTooltip()
  }

  /** Returns the pre-created popup, creating and loading it once on first use. */
  private ensureTooltipWindow(): Promise<BrowserWindow | null> {
    if (this.tooltipLoad) return this.tooltipLoad
    if (this.tooltip && !this.tooltip.isDestroyed()) return Promise.resolve(this.tooltip)
    this.tooltipLoad = this.loadTooltipWindow()
    return this.tooltipLoad
  }

  private async loadTooltipWindow(): Promise<BrowserWindow | null> {
    const tooltip = this.createTooltipWindow()
    try {
      const devUrl = process.env.VITE_DEV_SERVER_URL
      if (devUrl) await tooltip.loadURL(`${devUrl.replace(/\/$/, '')}/tray-tooltip/index.html`)
      else await tooltip.loadFile(join(__dirname, '../renderer/tray-tooltip/index.html'))
    } catch (error) {
      this.logger.error('TrayService', 'Tray tooltip document could not be loaded.', error)
      this.destroyTooltipWindow()
      return null
    }
    return tooltip
  }

  /** Renders the cards into the ready popup and shows it next to the tray. */
  private async showTooltip(): Promise<void> {
    if (!this.tray || this.quitting) return
    // No usage data yet (offline or first refresh pending): an empty popup is
    // noise, so skip it and keep the default tray glyph.
    if (!this.tooltipData.cards.some((card) => !card.hide)) return
    const tooltip = await this.ensureTooltipWindow()
    if (!tooltip || tooltip.isDestroyed() || tooltip.isVisible()) return
    if (this.quitting || !this.hovering) return
    let size: { width: number; height: number }
    try {
      size = await this.measureTooltip(tooltip)
    } catch (error) {
      this.logger.warn('TrayService', 'Tray tooltip content could not be rendered.', error)
      // A hung or dead renderer must not poison every future hover: drop the
      // popup so the next hover rebuilds a fresh window.
      this.invalidateTooltipWindow(tooltip)
      return
    }
    if (this.tooltip !== tooltip || tooltip.isDestroyed() || tooltip.isVisible()) return
    if (this.quitting || !this.hovering) return
    try {
      this.placeAndShow(tooltip, size)
    } catch (error) {
      this.logger.warn('TrayService', 'Tray tooltip popup could not be shown.', error)
      this.invalidateTooltipWindow(tooltip)
    }
  }

  private createTooltipWindow(): BrowserWindow {
    const previous = this.tooltip
    this.tooltip = null
    if (previous && !previous.isDestroyed()) previous.destroy()
    const tooltip = new BrowserWindow({
      width: 280,
      height: 120,
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
    // Keep the renderer fully active while hidden so executeJavaScript still works
    // after hide/show cycles (a background-throttled renderer rejects scripts).
    tooltip.webContents.setBackgroundThrottling(false)
    // If the popup renderer dies while hidden, drop the window so the next
    // hover recreates it instead of failing silently forever.
    tooltip.webContents.on('render-process-gone', () => this.invalidateTooltipWindow(tooltip))
    this.tooltip = tooltip
    return tooltip
  }

  /** Renders the cards and returns the natural panel size. */
  private async measureTooltip(tooltip: BrowserWindow): Promise<{ width: number; height: number }> {
    // Inject the payload as a JSON literal (safe for quotes, newlines, and
    // non-ASCII text) instead of a base64 round-trip that garbled unicode.
    const payload = JSON.stringify(this.tooltipData)
    const measured = (await withTimeout(
      tooltip.webContents.executeJavaScript(
        `(()=>{try{window.setTooltip(${payload})}catch(e){return{error:String(e)}}const p=document.querySelector('.panel');if(!p)return{error:'no panel'};const r=p.getBoundingClientRect();return{width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`,
      ),
      TOOLTIP_MEASURE_TIMEOUT_MS,
    )) as { width?: number; height?: number; error?: string }
    if (measured.error) throw new Error(`Tooltip render failed: ${measured.error}`)
    return {
      width: Math.max(1, Math.ceil(measured.width ?? 260)),
      height: Math.max(1, Math.ceil(measured.height ?? 60)),
    }
  }

  /**
   * Anchors the popup above or below the tray icon, inside the display work
   * area. Linux AppIndicator hosts often expose no tray geometry, so the
   * fallback anchors against the matching corner of the work area instead.
   */
  private placeAndShow(tooltip: BrowserWindow, size: { width: number; height: number }): void {
    const anchor = this.trayAnchor()
    const display = anchor
      ? screen.getDisplayNearestPoint({
          x: anchor.x + Math.floor(anchor.width / 2),
          y: anchor.y + Math.floor(anchor.height / 2),
        })
      : screen.getPrimaryDisplay()
    const work = display.workArea
    const width = Math.max(1, Math.min(size.width, work.width - TOOLTIP_MARGIN * 2))
    const height = Math.max(1, Math.min(size.height, work.height - TOOLTIP_MARGIN * 2))
    const x = anchor
      ? clamp(
          anchor.x + Math.floor(anchor.width / 2) - Math.floor(width / 2),
          work.x + TOOLTIP_MARGIN,
          work.x + work.width - width - TOOLTIP_MARGIN,
        )
      : work.x + work.width - width - TOOLTIP_MARGIN
    const y = anchor
      ? this.verticalPosition(anchor, height, work)
      : this.tooltipSide === 'below'
        ? work.y + TOOLTIP_MARGIN
        : work.y + work.height - height - TOOLTIP_MARGIN
    tooltip.setBounds({ x, y, width, height })
    tooltip.showInactive()
    // Windows keeps the topmost style across hide/show cycles, but a
    // focusable:false window raised with showInactive() can still drop
    // behind other windows on later shows. Toggling the flag forces Electron
    // to re-apply the topmost z-order, and moveTop() raises the popup without
    // activating it.
    tooltip.setAlwaysOnTop(false)
    tooltip.setAlwaysOnTop(true, 'pop-up-menu')
    tooltip.moveTop()
  }

  /** Returns the tray icon rectangle when the window manager exposes one. */
  private trayAnchor(): Rectangle | null {
    // Electron only implements getBounds() on macOS and Windows; Linux
    // AppIndicator hosts own the icon geometry and report nothing useful.
    if (this.platform === 'linux') return null
    const bounds = this.tray?.getBounds()
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null
    const center = {
      x: bounds.x + Math.floor(bounds.width / 2),
      y: bounds.y + Math.floor(bounds.height / 2),
    }
    const display = screen.getDisplayNearestPoint(center).bounds
    const isInside =
      center.x >= display.x &&
      center.x <= display.x + display.width &&
      center.y >= display.y &&
      center.y <= display.y + display.height
    return isInside ? bounds : null
  }

  /** Picks the configured side, falling back to the side that fits on screen. */
  private verticalPosition(anchor: Rectangle, height: number, work: Rectangle): number {
    const minY = work.y + TOOLTIP_MARGIN
    const maxY = work.y + work.height - height - TOOLTIP_MARGIN
    const above = anchor.y - height - TOOLTIP_MARGIN
    const below = anchor.y + anchor.height + TOOLTIP_MARGIN
    const preferred = this.tooltipSide === 'above' ? above : below
    if (preferred >= minY && preferred <= maxY) return preferred
    const opposite = this.tooltipSide === 'above' ? below : above
    if (opposite >= minY && opposite <= maxY) return opposite
    return clamp(preferred, minY, maxY)
  }

  private showWindow(): void {
    if (this.window.isDestroyed()) return
    if (this.window.isMinimized()) this.window.restore()
    this.window.show()
    this.window.focus()
  }

  private showSettings(): void {
    this.showWindow()
    if (!this.window.isDestroyed()) {
      this.window.webContents.send(IpcChannel.SettingsOpenRequested)
    }
  }

  private defaultTrayImage() {
    const iconPath = app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(app.getAppPath(), 'build', 'icon.png')
    const sourceImage = nativeImage.createFromPath(iconPath)
    if (sourceImage.isEmpty()) throw new Error(`Tray icon could not be read from ${iconPath}.`)
    return sourceImage.resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE })
  }

  /** Drops a broken popup so the next hover rebuilds it from scratch. */
  private invalidateTooltipWindow(stale: BrowserWindow): void {
    if (this.tooltip !== stale) return
    this.destroyTooltipWindow()
  }

  /** Destroys the popup so it consumes no memory while disabled or quitting. */
  private destroyTooltipWindow(): void {
    const tooltip = this.tooltip
    this.tooltip = null
    this.tooltipLoad = null
    if (tooltip && !tooltip.isDestroyed()) tooltip.destroy()
  }

  private destroyTrayIcon(): void {
    this.hovering = false
    this.tray?.destroy()
    this.tray = null
    this.destroyTooltipWindow()
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
