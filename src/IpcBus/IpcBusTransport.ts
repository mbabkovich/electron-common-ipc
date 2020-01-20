import * as Client from './IpcBusClient';
import { IpcBusCommand } from './IpcBusCommand';

export interface IpcBusSender {
    send(channel: string, ...args: any[]): void;
}

export namespace IpcBusTransport {
    export interface Handshake {
        peer: Client.IpcBusPeer,
        process: Client.IpcBusProcess;
        instance: number;
    };
}

/** @internal */
export interface IpcBusTransport {
    readonly peer: Client.IpcBusPeer;

    ipcHandshake(options: Client.IpcBusClient.ConnectOptions): Promise<IpcBusTransport.Handshake>;
    ipcShutdown(options: Client.IpcBusClient.CloseOptions): Promise<void>;

    ipcConnect(client: Client.IpcBusClient | null, options: Client.IpcBusClient.ConnectOptions): Promise<void>;
    ipcClose(client: Client.IpcBusClient | null, options?: Client.IpcBusClient.CloseOptions): Promise<void>;

    ipcRequestMessage(channel: string, timeoutDelay: number, args: any[]): Promise<Client.IpcBusRequestResponse>;
    ipcSendMessage(channel: string, args: any[]): void;
    ipcPost(kind: IpcBusCommand.Kind, channel: string, ipcBusCommandRequest?: IpcBusCommand.Request, args?: any[]): void;
}
