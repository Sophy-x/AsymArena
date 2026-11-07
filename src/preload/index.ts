import { contextBridge, ipcRenderer } from 'electron'
import type { ArenaBridge, CreateMatchInput, ModelProfile } from '@shared/types'

const bridge: ArenaBridge = {
  setTheme: (theme) => ipcRenderer.send('arena:theme:set', theme),
  getBootstrap: () => ipcRenderer.invoke('arena:bootstrap'),
  saveProfile: (profile: ModelProfile) => ipcRenderer.invoke('arena:profiles:save', profile),
  deleteProfile: (profileId: string) => ipcRenderer.invoke('arena:profiles:delete', profileId),
  testProfile: (profile: ModelProfile) => ipcRenderer.invoke('arena:profiles:test', profile),
  listModels: (profile: ModelProfile) => ipcRenderer.invoke('arena:profiles:list-models', profile),
  createMatch: (input: CreateMatchInput) => ipcRenderer.invoke('arena:matches:create', input),
  getMatch: (matchId: string) => ipcRenderer.invoke('arena:matches:get', matchId),
  listMatches: () => ipcRenderer.invoke('arena:matches:list'),
  deleteMatch: (matchId: string) => ipcRenderer.invoke('arena:matches:delete', matchId),
  startMatch: (matchId: string) => ipcRenderer.invoke('arena:matches:start', matchId),
  getHumanObservation: (matchId: string, seatId: string) => ipcRenderer.invoke('arena:matches:human-observation', matchId, seatId),
  submitHumanAction: (matchId: string, seatId: string, tool: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke('arena:matches:human-action', matchId, seatId, tool, args),
  retryMatch: (matchId: string) => ipcRenderer.invoke('arena:matches:retry', matchId),
  getReplay: (matchId: string) => ipcRenderer.invoke('arena:matches:replay', matchId),
  getRatings: (gameId?: string) => ipcRenderer.invoke('arena:ratings:list', gameId),
  onMatchUpdated: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: Parameters<typeof callback>[0]) => callback(snapshot)
    ipcRenderer.on('arena:match-updated', listener)
    return () => ipcRenderer.removeListener('arena:match-updated', listener)
  },
}

contextBridge.exposeInMainWorld('arena', bridge)
