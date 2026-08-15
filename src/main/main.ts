import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import path from 'node:path'
import { Harness } from './harness.js'

const userData = app.getPath('userData')
const dshHome = path.join(userData, 'harness')
const logFile = path.join(userData, 'logs', 'harness.log')
const loadingPage = path.join(app.getAppPath(), 'resources', 'loading.html')

let mainWindow: BrowserWindow | null = null

/**
 * dsh requires Node ^22.19.0 || >=24.0.0 (node:sqlite, native TS type
 * stripping). The Harness child runs on Electron's embedded Node, so check
 * it up front and fail with a clear message instead of a broken install.
 */
function checkNodeVersion (): string | null {
  const [major, , patch] = process.versions.node.split('.').map(Number)
  const ok = (major === 22 && patch >= 19) || major >= 24
  return ok ? null : process.versions.node
}

const harness = new Harness(dshHome, logFile, {
  onStateChange: (state, detail) => {
    if (mainWindow === null) return
    if (state === 'ready') {
      void mainWindow.loadURL(harness.url)
    } else if (state === 'failed') {
      void mainWindow.loadFile(loadingPage, { hash: `error=${encodeURIComponent(detail ?? 'unknown error')}` })
    } else if (state === 'starting') {
      void mainWindow.loadFile(loadingPage)
    }
  }
})

function createWindow (): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'resources', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  // Only ever navigate to the local Harness origin; open everything else in
  // the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(harness.url)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(harness.url)) event.preventDefault()
  })

  mainWindow.on('closed', () => { mainWindow = null })
  void mainWindow.loadFile(loadingPage)
}

/** Application menu: standard roles plus Harness lifecycle actions. */
function installMenu (): void {
  const template: MenuItemConstructorOptions[] = []
  if (process.platform === 'darwin') {
    template.push({ role: 'appMenu' })
  }
  template.push(
    { role: 'editMenu' },
    {
      label: 'Harness',
      submenu: [
        {
          label: 'Restart Harness',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => { void harness.restart() }
        },
        {
          label: 'View Harness Log',
          click: () => { void shell.openPath(logFile) }
        }
      ]
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  )
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    const badNode = checkNodeVersion()
    if (badNode !== null) {
      dialog.showErrorBox(
        'Unsupported Node.js runtime',
        `FastDSH needs Node ^22.19.0 or >=24.0.0 but this build embeds ${badNode}. Please upgrade the Electron version.`
      )
      app.quit()
      return
    }

    ipcMain.on('harness:retry', () => { void harness.restart() })
    ipcMain.on('harness:open-log', () => { void shell.openPath(logFile) })

    installMenu()
    createWindow()
    void harness.start()
  })

  app.on('window-all-closed', () => { app.quit() })
  app.on('before-quit', (event) => {
    if (harness.currentState !== 'stopped') {
      event.preventDefault()
      void harness.stop().finally(() => app.quit())
    }
  })
}
