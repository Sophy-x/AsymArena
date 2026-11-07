import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import type { ArenaBridge } from '@shared/types'
import { MatchOrchestrator, createUpdateEmitter } from './orchestrator'
import { getPortableDataPath, migratePortableStore } from './portable-data'

let mainWindow: BrowserWindow | undefined
let controller: MatchOrchestrator
const roamingDataPath = app.getPath('userData')
const portableDataPath = getPortableDataPath(process.env.PORTABLE_EXECUTABLE_DIR)
if (portableDataPath) app.setPath('userData', portableDataPath)

function registerIpc(): void {
  ipcMain.on('arena:theme:set', (_event, theme: string) => {
    const colors: Record<string, { background: string; titlebar: string; symbol: string }> = {
      carbon: { background: '#111419', titlebar: '#171a20', symbol: '#e8edf3' },
      paper: { background: '#f0f2f5', titlebar: '#ffffff', symbol: '#202832' },
      rose: { background: '#151518', titlebar: '#1b1a1e', symbol: '#eee9ef' },
    }
    const selected = colors[theme]
    if (!selected || !mainWindow || mainWindow.isDestroyed()) return
    mainWindow.setBackgroundColor(selected.background)
    mainWindow.setTitleBarOverlay({ color: selected.titlebar, symbolColor: selected.symbol })
  })
  ipcMain.handle('arena:bootstrap', () => controller.bootstrap())
  ipcMain.handle('arena:profiles:save', (_event, profile) => controller.saveProfile(profile))
  ipcMain.handle('arena:profiles:delete', (_event, profileId: string) => controller.deleteProfile(profileId))
  ipcMain.handle('arena:profiles:test', (_event, profile) => controller.testProfile(profile))
  ipcMain.handle('arena:profiles:list-models', (_event, profile) => controller.listModels(profile))
  ipcMain.handle('arena:matches:create', (_event, input) => controller.createMatch(input))
  ipcMain.handle('arena:matches:get', (_event, matchId: string) => controller.getMatch(matchId))
  ipcMain.handle('arena:matches:list', () => controller.listMatches())
  ipcMain.handle('arena:matches:delete', (_event, matchId: string) => controller.deleteMatch(matchId))
  ipcMain.handle('arena:matches:start', (_event, matchId: string) => controller.startMatch(matchId))
  ipcMain.handle('arena:matches:human-observation', (_event, matchId: string, seatId: string) =>
    controller.getHumanObservation(matchId, seatId),
  )
  ipcMain.handle('arena:matches:human-action', (_event, matchId: string, seatId: string, tool: string, args) =>
    controller.submitHumanAction(matchId, seatId, tool, args),
  )
  ipcMain.handle('arena:matches:retry', (_event, matchId: string) => controller.retryMatch(matchId))
  ipcMain.handle('arena:matches:replay', (_event, matchId: string) => controller.getReplay(matchId))
  ipcMain.handle('arena:ratings:list', (_event, gameId?: string) => controller.getRatings(gameId))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1512,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    backgroundColor: '#111419',
    title: 'AsymArena',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#171a20',
      symbolColor: '#e8edf3',
      height: 38,
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  controller.onUpdate(createUpdateEmitter(mainWindow))
}

app.whenReady().then(async () => {
  if (portableDataPath) {
    try {
      await migratePortableStore(roamingDataPath, portableDataPath)
    } catch (error) {
      console.error('Failed to migrate the existing AsymArena data store', error)
    }
  }
  controller = new MatchOrchestrator()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

export type { ArenaBridge }
