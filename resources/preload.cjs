// Sandboxed preload: must stay CommonJS and dependency-free.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('fastdsh', {
  retry: () => ipcRenderer.send('harness:retry'),
  openLog: () => ipcRenderer.send('harness:open-log')
})
