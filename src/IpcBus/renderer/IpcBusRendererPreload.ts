import { Create as CreateIpcBusClientWindow } from './IpcBusClientRenderer-factory';
import type { IpcWindow } from './IpcBusConnectorRenderer';

let electron: any;
try {
    // Will work in a preload or with nodeIntegration=true
    electron = require('electron');
}
catch (err) {
}

const trace = false; // true;
export const ElectronCommonIPCNamespace = 'ElectronCommonIPC';

function CreateGlobals(windowLocal: any, ipcWindow: IpcWindow) {
    return {
        CreateIpcBusClient: () => {
            trace && console.log(`${ElectronCommonIPCNamespace}.CreateIpcBusClient`);
            // 'ipcRenderer as any', ipcRenderer does not cover all EventListener interface !
            const ipcBusClient = CreateIpcBusClientWindow('renderer', (windowLocal.self === windowLocal.top), ipcWindow);
            return ipcBusClient;
        }
    }
}

// This function could be called in advance in the preload file of the BrowserWindow
// Then ipcbus is supported in sandbox or nodeIntegration=false process

// By default this function is always trigerred in index-browser in order to offer an access to ipcBus

export function PreloadElectronCommonIPCAutomatic(): boolean {
    return _PreloadElectronCommonIPC(false);
}

export function PreloadElectronCommonIPC(contextIsolation: boolean): boolean {
    return _PreloadElectronCommonIPC(contextIsolation);
}

function _PreloadElectronCommonIPC(contextIsolation: boolean): boolean {
    if (electron && electron.ipcRenderer) {
        const windowLocal = window as any;
        if (contextIsolation) {
            try {
                electron.contextBridge.exposeInMainWorld(ElectronCommonIPCNamespace, CreateGlobals(windowLocal, electron.ipcRenderer));
            }
            catch (error) {
                console.error(error);
                contextIsolation = false;
            }
        }

        if (!contextIsolation) {
            windowLocal[ElectronCommonIPCNamespace] = CreateGlobals(windowLocal, electron.ipcRenderer);
        }
    }
    return IsElectronCommonIPCAvailable();
}

export function IsElectronCommonIPCAvailable(): boolean {
    try {
        const windowLocal = window as any;
        const electronCommonIPCSpace = windowLocal[ElectronCommonIPCNamespace];
        return (electronCommonIPCSpace != null);
    }
    catch (err) {
    }
    return false;
}

