import type { EventEmitter } from 'events';

// export namespace Electron {
//     export class MessagePortMain extends EventEmitter {
//     }
// }

// Special channels
export const IPCBUS_CHANNEL = '/electron-ipc-bus';
export const IPCBUS_CHANNEL_QUERY_STATE = `${IPCBUS_CHANNEL}/queryState`;

// see { ElectronProcessType } from 'electron-process-type/lib/v2'
export type IpcBusProcessType = 'native' | 'node' | 'renderer' | 'main' | 'worker' | 'undefined';

// These information are relative to Electron renderer process only
export interface IpcBusProcessContext {
    wcid?: number;  // WebContent Id
    frameid?: number; // Frame Id
    isMainFrame?: boolean;
}

export interface IpcBusProcess extends IpcBusProcessContext {
    type: IpcBusProcessType;
    pid: number;    // Process Id
    rid?: number;   // Process Electron/Chromium IPC Routing Id
}

export interface IpcBusPeerProcess {
    process: IpcBusProcess;
}

export interface IpcBusPeer extends IpcBusPeerProcess {
    readonly id: string;
    name: string;
}

export interface IpcBusRequest {
    resolve(payload: any): void;
    reject(err: any): void;
}

export interface IpcBusRequestResponse {
    readonly event: IpcBusEvent;
    readonly payload?: any;
    readonly err?: string;
}

interface MessagePortEventMap {
     'message': MessageEvent;
     'messageerror': MessageEvent;
     'close': Function;
}

export type IpcMessagePortType = Electron.MessagePortMain | MessagePort | IpcBusMessagePort;

export interface IpcBusMessagePortPost {
    postMessage(message: any, messagePorts?: Transferable[]): void;
}

// In order to ensure a common interface in Web/Electron/Node.js, we use an 'union' interface of 
// - EventTarget
// - EventEmitter
// - MessagePort
// - MessagePortMain
export interface IpcBusMessagePort extends IpcBusMessagePortPost {
    // Docs: https://electronjs.org/docs/api/message-port-main

    on<K extends keyof MessagePortEventMap>(event: K, listener: (messageEvent: MessagePortEventMap[K]) => void): this;
    off<K extends keyof MessagePortEventMap>(event: K, listener: (messageEvent: MessagePortEventMap[K]) => void): this;
    once<K extends keyof MessagePortEventMap>(event: K, listener: (messageEvent: MessagePortEventMap[K]) => void): this;
    addListener<K extends keyof MessagePortEventMap>(event: K, listener: (messageEvent: MessagePortEventMap[K]) => void): this;
    removeListener<K extends keyof MessagePortEventMap>(event: K, listener: (messageEvent: MessagePortEventMap[K]) => void): this;

    addEventListener<K extends keyof MessagePortEventMap>(type: K, listener: (this: MessagePort, ev: MessagePortEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
    removeEventListener<K extends keyof MessagePortEventMap>(type: K, listener: (this: MessagePort, ev: MessagePortEventMap[K]) => any, options?: boolean | EventListenerOptions): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;

    start(): void;
    close(): void;
}

export interface IpcBusEvent {
    readonly channel: string;
    readonly sender: IpcBusPeer;
    ports?: IpcBusMessagePort[];
    request?: IpcBusRequest;
}

export interface IpcBusListener {
    (event: IpcBusEvent, ...args: any[]): void;
}

export interface IpcTimeoutOptions {
    timeoutDelay?: number;
}

export interface IpcSocketBufferingOptions {
    socketBuffer?: number;
}

export interface IpcNetOptions {
    port?: number;
    host?: string;
    path?: string;
}

export interface IpcConnectOptions extends IpcNetOptions, IpcTimeoutOptions {
}

export namespace IpcBusClient {
    export interface ConnectOptions extends IpcConnectOptions, IpcSocketBufferingOptions {
        peerName?: string;
    }
    export interface ConnectFunction {
        (options?: ConnectOptions): Promise<void>;
        (path?: string, options?: ConnectOptions): Promise<void>;
        (port?: number, options?: ConnectOptions): Promise<void>;
        (port?: number, hostname?: string, options?: ConnectOptions): Promise<void>;
    }

    export interface CloseOptions extends IpcTimeoutOptions {
    }
    export interface CloseFunction {
        (options?: IpcBusClient.CloseOptions): Promise<void>;
    }

    export interface CreateOptions extends IpcNetOptions {
    }

    export interface CreateFunction {
        (): IpcBusClient | null ;
    }
    export let Create: IpcBusClient.CreateFunction;
}

export interface IpcBusClient extends EventEmitter {
    readonly peer: IpcBusPeer | null;

    connect: IpcBusClient.ConnectFunction;
    close: IpcBusClient.CloseFunction;

    createDirectChannel(): string;
    // legacy
    createResponseChannel(): string;

    send(channel: string, ...args: any[]): boolean;
    sendTo(target: IpcBusPeer | IpcBusPeerProcess, channel: string, ...args: any[]): boolean;
    request(channel: string, timeoutDelay: number, ...args: any[]): Promise<IpcBusRequestResponse>;
    requestTo(target: IpcBusPeer | IpcBusPeerProcess, channel: string, timeoutDelay: number, ...args: any[]): Promise<IpcBusRequestResponse>;

    postMessage(channel: string, message: any, messagePorts?: IpcMessagePortType[]): void;
    postMessageTo(target: IpcBusPeer | IpcBusPeerProcess, channel: string, message: any, messagePorts?: IpcMessagePortType[]): void;

    // EventEmitter API
    emit(event: string, ...args: any[]): boolean;

    addListener(channel: string, listener: IpcBusListener): this;
    removeListener(channel: string, listener: IpcBusListener): this;
    removeAllListeners(channel?: string): this;

    on(channel: string, listener: IpcBusListener): this;
    once(channel: string, listener: IpcBusListener): this;
    off(channel: string, listener: IpcBusListener): this;

    prependListener(channel: string, listener: IpcBusListener): this;
    prependOnceListener(channel: string, listener: IpcBusListener): this;
}
