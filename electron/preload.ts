// Preload: exposes native macOS speech (the `say` command) to the renderer.
// Web Speech API is unreliable inside Electron, so on macOS we bridge to the
// native synthesizer — it also uses downloaded Premium/Enhanced voices.
import { contextBridge, ipcRenderer } from 'electron';

if (process.platform === 'darwin') {
  contextBridge.exposeInMainWorld('nativeSpeech', {
    speak: (opts: { text: string; voice?: string; rate?: number }) =>
      ipcRenderer.invoke('speech:speak', opts),
    cancel: () => ipcRenderer.invoke('speech:cancel'),
    voices: () => ipcRenderer.invoke('speech:voices'),
  });
}

// General bridge: read bundled assets (wasm/model files cannot be fetch()ed
// from a file:// page) and request macOS camera permission.
contextBridge.exposeInMainWorld('nativeBridge', {
  readAsset: (relPath: string) => ipcRenderer.invoke('assets:read', relPath),
  requestCamera: () => ipcRenderer.invoke('camera:request'),
});
