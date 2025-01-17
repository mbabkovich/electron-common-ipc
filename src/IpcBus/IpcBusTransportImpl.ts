import { IpcPacketBuffer, IpcPacketBufferCore, IpcPacketBufferList } from 'socket-serializer';

import type * as Client from './IpcBusClient';
import * as IpcBusUtils from './IpcBusUtils';
import * as IpcBusCommandHelpers from './IpcBusCommand-helpers';
import { IpcBusCommand, IpcBusMessage } from './IpcBusCommand';

import type { IpcBusTransport } from './IpcBusTransport';
import type { IpcBusConnector, PostCommandFunction, PostMessageFunction } from './IpcBusConnector';
import { JSONParserV1 } from 'json-helpers';
import { CastToMessagePort, DeferredRequestPromise } from './IpcBusTransport-helpers';
import type { QueryStateTransport } from './IpcBusQueryState';

const g_clientNumber_symbol_name = 'IpcBusTransportID';
/** @internal */
export abstract class IpcBusTransportImpl implements IpcBusTransport, IpcBusConnector.Client {
    protected _connector: IpcBusConnector;

    protected _logActivate: boolean;

    protected _requestFunctions: Map<string, DeferredRequestPromise>;
    protected _postCommand: PostCommandFunction;
    protected _postMessage: PostMessageFunction;
    protected _postRequestMessage: Function;

    constructor(connector: IpcBusConnector) {
        this._connector = connector;

        this._requestFunctions = new Map();
        this._postMessage = this._postCommand = this._postRequestMessage = this._deadMessageHandler as any;
    }

    private _deadMessageHandler(ipcCommand: IpcBusCommand): void {
        IpcBusUtils.Logger.enable && IpcBusUtils.Logger.error(`IPCBUS: not managed ${JSON.stringify(ipcCommand, null, 4)}`);
    }

    protected createPeer(process: Client.IpcBusProcess, name?: string): Client.IpcBusPeer {
        let clientNumber = IpcBusUtils.GetSingleton<number>(g_clientNumber_symbol_name);
        if (clientNumber == null) {
            clientNumber = 1;
        }
        else {
            ++clientNumber;
        }
        //        [static part -------------------------].[dynamic part ]
        let id = `${IpcBusUtils.CreateProcessID(process)}.${clientNumber}`;
        IpcBusUtils.RegisterSingleton(g_clientNumber_symbol_name, clientNumber);
        name = name || id;
        const peer: Client.IpcBusPeer = {
            id,
            process,
            name
        }
        return peer;
    }

    onLogReceived(ipcResponse: IpcBusMessage, args: any[], ipcPacketBufferCore?: IpcPacketBufferCore): void {
    }

    onCommandReceived(ipcCommand: IpcBusCommand): void {
        switch (ipcCommand.kind) {
            case IpcBusCommand.Kind.QueryState: {
                const queryState = this.queryState();
                this._postCommand({
                    kind: IpcBusCommand.Kind.QueryStateResponse,
                    data: {
                        id: ipcCommand.channel,
                        queryState
                    }
                } as any);
                break;
            }
        }
    }

    // We assume prior to call this function client is not empty and have listeners for this channel !!
    protected _onClientMessageReceived(client: IpcBusTransport.Client, local: boolean, ipcMessage: IpcBusMessage, args?: any[], messagePorts?: ReadonlyArray<Client.IpcMessagePortType>): boolean {
        const listeners = client.listeners(ipcMessage.channel);
        if (listeners.length === 0) {
            return false;
        }
        // IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info(`[IPCBusTransport] Emit message received on channel '${ipcCommand.channel}' from peer #${ipcCommand.peer.name}`);
        if (this._logActivate) {
            this._connector.ackMessage(ipcMessage, args, local, client.peer);
        }
        let messageHandled = false;
        if (ipcMessage.target && ipcMessage.target.peerid) {
            if (ipcMessage.target.peerid !== client.peer.id) {
                return false;
            }
            messageHandled = true;
        }
        const ipcBusEvent: Client.IpcBusEvent = { channel: ipcMessage.channel, sender: ipcMessage.peer };
        if (ipcMessage.request) {
            const settled = (resolve: boolean, argsResponse: any[]) => {
                // Reset functions as only one response per request is accepted
                ipcBusEvent.request.resolve = () => { };
                ipcBusEvent.request.reject = () => { };
                const ipcResponse: IpcBusMessage = {
                    kind: IpcBusCommand.Kind.RequestResponse,
                    channel: ipcMessage.request.id,
                    peer: client.peer,
                    target: IpcBusCommandHelpers.CreateMessageTarget(ipcMessage.peer),
                    request: ipcMessage.request
                };
                ipcMessage.request.resolve = resolve;
                messageHandled = true;
                if (this._logActivate) {
                    ipcResponse.stamp = ipcMessage.stamp;
                    this._connector.stampResponse(ipcResponse);
                }
                if (local) {
                    this.onRequestResponseReceived(true, ipcResponse, argsResponse);
                }
                else {
                    this._postRequestMessage(ipcResponse, argsResponse);
                }
            }
            ipcBusEvent.request = {
                resolve: (payload: Object | string) => {
                    IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info(`[IPCBusTransport] Resolve request received on channel '${ipcMessage.channel}' from peer #${ipcMessage.peer.name} - payload: ${JSON.stringify(payload)}`);
                    settled(true, [payload]);
                },
                reject: (err: string | Error) => {
                    let errResponse: string;
                    if (typeof err === 'string') {
                        errResponse = err;
                    }
                    else {
                        errResponse = JSON.stringify(err);
                    }
                    IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info(`[IPCBusTransport] Reject request received on channel '${ipcMessage.channel}' from peer #${ipcMessage.peer.name} - err: ${errResponse}`);
                    settled(false, [err]);
                }
            };
        }
        else {
            if (messagePorts && messagePorts.length) {
                ipcBusEvent.ports = messagePorts.map(CastToMessagePort);
            }
        }
        // Seems spread operator or call function does not like args=undefined !
        if (args) {
            for (let i = 0, l = listeners.length; i < l; ++i) {
                listeners[i].call(client, ipcBusEvent, ...args);
            }
        }
        else {
            for (let i = 0, l = listeners.length; i < l; ++i) {
                listeners[i].call(client, ipcBusEvent);
            }
        }
        return messageHandled;
    }

    onRequestResponseReceived(local: boolean, ipcResponse: IpcBusMessage, args: any[], ipcPacketBufferCore?: IpcPacketBufferCore): boolean {
        const deferredRequest = this._requestFunctions.get(ipcResponse.channel);
        if (deferredRequest) {
            this._requestFunctions.delete(ipcResponse.request.id);
            args = args || ipcPacketBufferCore.parseArrayAt(1);
            if (this._logActivate) {
                this._connector.ackResponse(ipcResponse, args, local, deferredRequest.client.peer);
            }
            // IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info(`[IPCBusTransport] Emit request response received on channel '${ipcCommand.channel}' from peer #${ipcCommand.peer.name} (replyChannel '${ipcCommand.request.replyChannel}')`);
            deferredRequest.settled(ipcResponse, args);
            return true;
        }
        return false;
    }

    // IpcConnectorClient~getArgs
    onConnectorArgsReceived(ipcMessage: IpcBusMessage, args: any[], messagePorts?: ReadonlyArray<Client.IpcMessagePortType>): boolean {
        switch (ipcMessage.kind) {
            case IpcBusCommand.Kind.SendMessage:
                return this.onMessageReceived(false, ipcMessage, args, undefined, messagePorts);
            case IpcBusCommand.Kind.RequestResponse:
                return this.onRequestResponseReceived(false, ipcMessage, args, undefined);
        }
        return false;
    }

    // IpcConnectorClient
    onConnectorPacketReceived(ipcMessage: IpcBusMessage, ipcPacketBufferCore: IpcPacketBufferCore, messagePorts?: ReadonlyArray<Client.IpcMessagePortType>): boolean {
        switch (ipcMessage.kind) {
            case IpcBusCommand.Kind.SendMessage:
                return this.onMessageReceived(false, ipcMessage, undefined, ipcPacketBufferCore, messagePorts);
            case IpcBusCommand.Kind.RequestResponse:
                return this.onRequestResponseReceived(false, ipcMessage, undefined, ipcPacketBufferCore);
        }
        return false;
    }

    // IpcConnectorClient
    onConnectorRawDataReceived(ipcMessage: IpcBusMessage, rawData: IpcPacketBuffer.RawData, messagePorts?: ReadonlyArray<Client.IpcMessagePortType>): boolean {
        // Prevent to create a huge buffer if not needed, keep working with a set of buffers
        const ipcPacketBufferCore = rawData.buffer ? new IpcPacketBuffer(rawData) : new IpcPacketBufferList(rawData);
        ipcPacketBufferCore.JSON = JSONParserV1;
        switch (ipcMessage.kind) {
            case IpcBusCommand.Kind.SendMessage:
                return this.onMessageReceived(false, ipcMessage, undefined, ipcPacketBufferCore, messagePorts);
            case IpcBusCommand.Kind.RequestResponse:
                return this.onRequestResponseReceived(false, ipcMessage, undefined, ipcPacketBufferCore);
        }
        return false;
    }

    // IpcConnectorClient
    onConnectorShutdown() {
        // Cut connection
        this._postMessage = this._postCommand = this._postRequestMessage = this._deadMessageHandler as any;
        // no messages to send, it is too late
    }

    // IpcConnectorClient
    onConnectorBeforeShutdown() {
        this.cancelRequest();
    }

    postMessage(client: IpcBusTransport.Client, target: Client.IpcBusPeer | Client.IpcBusPeerProcess | undefined, channel: string, args: any[], messagePorts?: ReadonlyArray<Client.IpcMessagePortType>): void {
        const ipcMessage: IpcBusMessage = {
            kind: IpcBusCommand.Kind.SendMessage,
            channel,
            peer: client.peer,
            target: target && IpcBusCommandHelpers.CreateMessageTarget(target)
        }

        if (this._logActivate) {
            this._connector.stampMessage(ipcMessage);
        }
        // Broadcast locally
        if (!this.onMessageReceived(true, ipcMessage, args, undefined, messagePorts)) {
        // Broadcast globally
            this._postMessage(ipcMessage, args, messagePorts);
        }
    }

    protected cancelRequest(client?: IpcBusTransport.Client): void {
        this._requestFunctions.forEach((request, key) => {
            if ((client == null) || (client === request.client)) {
                request.timeout();
                this._requestFunctions.delete(key);
                // if (this._logActivate) {
                //     this._connector.logMessageSend(null, );
                // }
            }
        });
    }

    postRequestMessage(client: IpcBusTransport.Client, target: Client.IpcBusPeer | Client.IpcBusPeerProcess | undefined, channel: string, timeoutDelay: number, args: any[]): Promise<Client.IpcBusRequestResponse> {
        timeoutDelay = IpcBusUtils.CheckTimeout(timeoutDelay);
        const ipcBusMessageRequest: IpcBusCommand.Request = {
            channel,
            id: IpcBusUtils.CreateUniqId()
        };
        const deferredRequest = new DeferredRequestPromise(client, ipcBusMessageRequest);
        // Register locally
        this._requestFunctions.set(ipcBusMessageRequest.id, deferredRequest);
        const ipcRequest: IpcBusMessage = {
            kind: IpcBusCommand.Kind.SendMessage,
            channel,
            peer: client.peer,
            target: target && IpcBusCommandHelpers.CreateMessageTarget(target),
            request: ipcBusMessageRequest
        }

        if (this._logActivate) {
            this._connector.stampMessage(ipcRequest);
        }
        // Broadcast locally
        if (!this.onMessageReceived(true, ipcRequest, args, undefined)) {
        // Broadcast globally, if not resolved by local clients
            if (timeoutDelay >= 0) {
                setTimeout(() => {
                    if (this._requestFunctions.delete(ipcBusMessageRequest.id)) {
                        deferredRequest.timeout();
                        // if (logSendMessage) {
                        //     this._connector.logMessageSend(logSendMessage, );
                        // }
                    }
                }, timeoutDelay);
            }
            this._postRequestMessage(ipcRequest, args);
        }
        return deferredRequest.promise;
    }

    connect(client: IpcBusTransport.Client | null, options: Client.IpcBusClient.ConnectOptions): Promise<Client.IpcBusPeer> {
        return this._connector.handshake(this, options)
            .then((handshake) => {
                this._logActivate = handshake.logLevel > 0;
                // Connect to ... connector
                this._postCommand = this._connector.postCommand.bind(this._connector);
                this._postMessage = this._connector.postMessage.bind(this._connector);
                this._postRequestMessage = this._connector.postMessage.bind(this._connector);
                return handshake;
            })
            .then((handshake) => {
                const peer = this.createPeer(handshake.process, options.peerName);
                return peer;
            });
    }

    close(client: IpcBusTransport.Client | null, options?: Client.IpcBusClient.ConnectOptions): Promise<void> {
        return this._connector.shutdown(options);
    }

    createDirectChannel(client: IpcBusTransport.Client): string {
        return IpcBusCommandHelpers.CreateTargetChannel(client.peer);
    }

    isTarget(ipcMessage: IpcBusMessage): boolean {
        return this._connector.isTarget(ipcMessage);
    }

    abstract getChannels(): string[];

    abstract addChannel(client: IpcBusTransport.Client, channel: string, count?: number): void;
    abstract removeChannel(client: IpcBusTransport.Client, channel?: string, all?: boolean): void;
    abstract queryState(): QueryStateTransport;

    abstract onMessageReceived(local: boolean, ipcMessage: IpcBusMessage, args?: any[], ipcPacketBufferCore?: IpcPacketBufferCore, messagePorts?: ReadonlyArray<Client.IpcMessagePortType>): boolean;
}
