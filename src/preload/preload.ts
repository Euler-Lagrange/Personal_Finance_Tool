import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("finance", {
  rpc: (method: string, arg?: unknown) => ipcRenderer.invoke("rpc", method, arg),
});
