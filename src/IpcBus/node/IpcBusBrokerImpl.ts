import * as net from 'net';

import type { IpcPacketBufferList } from 'socket-serializer';
import { WriteBuffersToSocket } from 'socket-serializer';

import type * as Client from '../IpcBusClient';
import type * as Broker from './IpcBusBroker';
import * as IpcBusUtils from '../IpcBusUtils';
import { ChannelConnectionMap } from '../IpcBusChannelMap';

import { IpcBusCommand } from '../IpcBusCommand';

import {IpcBusBrokerSocketClient, IpcBusBrokerSocket } from './IpcBusBrokerSocket';

interface IpcBusPeerSocket extends Client.IpcBusPeer {
    socket?: net.Socket;
}

/** @internal */
export abstract class IpcBusBrokerImpl implements Broker.IpcBusBroker, IpcBusBrokerSocketClient {
    // protected _ipcBusBrokerClient: Client.IpcBusClient;
    private _socketClients: Map<net.Socket, IpcBusBrokerSocket>;

    private _server: net.Server;
    private _netBinds: { [key: string]: (...args: any[]) => void };

    protected _connectCloseState: IpcBusUtils.ConnectCloseState<void>;

    protected _subscriptions: ChannelConnectionMap<net.Socket, string>;
    private _peers: Map<string, IpcBusPeerSocket>;

    constructor(contextType: Client.IpcBusProcessType) {
        this._subscriptions = new ChannelConnectionMap('IPCBus:Broker');
        this._peers = new Map();

        // Callbacks
        this._netBinds = {};
        this._netBinds['error'] = this._onServerError.bind(this);
        this._netBinds['close'] = this._onServerClose.bind(this);
        this._netBinds['connection'] = this._onServerConnection.bind(this);

        // this._onQueryState = this._onQueryState.bind(this);
        this._socketClients = new Map<net.Socket, IpcBusBrokerSocket>();

        this._connectCloseState = new IpcBusUtils.ConnectCloseState<void>();

        // this._ipcBusBrokerClient = CreateIpcBusClientNet(contextType);
    }

    protected _reset(closeServer: boolean) {
        if (this._server) {
            const server = this._server;
            this._server = null;
            for (let key in this._netBinds) {
                server.removeListener(key, this._netBinds[key]);
            }

            this._socketClients.forEach((socket) => {
                socket.release(closeServer);
            });

            server.close();
            server.unref();
        }
        this._connectCloseState.shutdown();
        this._socketClients.clear();
        this._subscriptions.clear();
    }

    // IpcBusBroker API
    connect(arg1: Broker.IpcBusBroker.ConnectOptions | string | number, arg2?: Broker.IpcBusBroker.ConnectOptions | string, arg3?: Broker.IpcBusBroker.ConnectOptions): Promise<void> {
        return this._connectCloseState.connect(() => {
            const options = IpcBusUtils.CheckConnectOptions(arg1, arg2, arg3);
            if ((options.port == null) && (options.path == null)) {
                return Promise.reject('Connection options not provided');
            }
            return new Promise<void>((resolve, reject) => {
                const server = net.createServer();
                server.unref();

                let timer: NodeJS.Timer = null;
                let fctReject: (msg: string) => void;

                const removeLocalListeners = () => {
                    if (timer) {
                        clearTimeout(timer);
                        timer = null;
                    }
                    server.removeListener('listening', catchListening);
                    server.removeListener('error', catchError);
                    server.removeListener('close', catchClose);
                };

                // Below zero = infinite
                if (options.timeoutDelay >= 0) {
                    timer = setTimeout(() => {
                        timer = null;
                        const msg = `[IPCBus:Broker] error = timeout (${options.timeoutDelay} ms) on ${JSON.stringify(options)}`;
                        fctReject(msg);
                    }, options.timeoutDelay);
                }

                const catchError = (err: any) => {
                    const msg = `[IPCBus:Broker] error = ${err} on ${JSON.stringify(options)}`;
                    fctReject(msg);
                };

                const catchClose = () => {
                    const msg = `[IPCBus:Broker] close on ${JSON.stringify(options)}`;
                    fctReject(msg);
                };

                const catchListening = (_server: any) => {
                    removeLocalListeners();
                    this._server = server;
                    IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info(`[IPCBus:Broker] Listening for incoming connections on ${JSON.stringify(options)}`);
                    for (let key in this._netBinds) {
                        this._server.addListener(key, this._netBinds[key]);
                    }
                    resolve();
                };

                fctReject = (msg: string) => {
                    removeLocalListeners();
                    this._reset(false);
                    IpcBusUtils.Logger.enable && IpcBusUtils.Logger.error(msg);
                    reject(msg);
                };
                server.addListener('listening', catchListening);
                server.addListener('error', catchError);
                server.addListener('close', catchClose);
                if (options.path) {
                    server.listen(options.path);
                }
                else if (options.port && options.host) {
                    server.listen(options.port, options.host);
                }
                else {
                    server.listen(options.port);
                }
            });
        });
    }

    close(options?: Broker.IpcBusBroker.CloseOptions): Promise<void> {
        return this._connectCloseState.close(() => {
            options = options || {};
            if (options.timeoutDelay == null) {
                options.timeoutDelay = IpcBusUtils.IPC_BUS_TIMEOUT;
            }
            return new Promise<void>((resolve, reject) => {
                if (this._server) {
                    const server = this._server;
                    let timer: NodeJS.Timer;
                    const catchClose = () => {
                        clearTimeout(timer);
                        server.removeListener('close', catchClose);
                        resolve();
                    };

                    // Below zero = infinite
                    if (options.timeoutDelay >= 0) {
                        timer = setTimeout(() => {
                            server.removeListener('close', catchClose);
                            const msg = `[IPCBus:Broker] stop, error = timeout (${options.timeoutDelay} ms) on ${JSON.stringify(options)}`;
                            IpcBusUtils.Logger.enable && IpcBusUtils.Logger.error(msg);
                            reject(msg);
                        }, options.timeoutDelay);
                    }
                    server.addListener('close', catchClose);
                    this._reset(true);
                }
                else {
                    resolve();
                }
            });
        });
    }

    protected _socketCleanUp(socket: any): void {
        this.onBridgeClosed(socket);
        // Broadcast peers destruction ?
        this._subscriptions.removeConnection(socket);
        for (const peer of this._peers.values()) {
            if (peer.socket === socket) {
                this._peers.delete(peer.id);
            }
        }
        IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info(`[IPCBus:Broker] Connection closed !`);
    }

    protected _onSocketConnected(socket: net.Socket): void {
        this._socketClients.set(socket, new IpcBusBrokerSocket(socket, this));
    }

    onSocketError(socket: net.Socket, err: string): void {
        // Not closing server
        if (this._server) {
            this._socketClients.delete(socket);
            this._socketCleanUp(socket);
        }
    }

    onSocketClose(socket: net.Socket): void {
        // Not closing server
        if (this._server) {
            this._socketClients.delete(socket);
            this._socketCleanUp(socket);
        }
    }

    onSocketEnd(socket: net.Socket): void {
        this.onSocketClose(socket);
    }

    protected _onServerClose(): void {
        const msg = `[IPCBus:Broker] server close`;
        IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info(msg);
        this._reset(false);
    }

    protected _onServerError(err: any) {
        const msg = `[IPCBus:Broker] server error ${err}`;
        IpcBusUtils.Logger.enable && IpcBusUtils.Logger.error(msg);
        this._reset(true);
    }

    protected _onServerConnection(socket: net.Socket, _server: net.Server): void {
        IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info(`[IPCBus:Broker] Incoming connection !`);
        // IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info('[IPCBus:Broker] socket.address=' + JSON.stringify(socket.address()));
        // IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info('[IPCBus:Broker] socket.localAddress=' + socket.localAddress);
        // IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info('[IPCBus:Broker] socket.remoteAddress=' + socket.remoteAddress);
        IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info('[IPCBus:Broker] socket.remotePort=' + socket.remotePort);
        this._onSocketConnected(socket);
    }

    // protected _onServerData(packet: IpcPacketBuffer, socket: net.Socket, server: net.Server): void {
    onSocketCommand(socket: net.Socket, ipcBusCommand: IpcBusCommand, ipcPacketBufferList: IpcPacketBufferList): void {
        switch (ipcBusCommand.kind) {
            // case IpcBusCommand.Kind.Handshake:
            // case IpcBusCommand.Kind.Shutdown:
            //     break;

            case IpcBusCommand.Kind.Connect:
                break;

            case IpcBusCommand.Kind.Close:
                this._socketCleanUp(socket);
                break;

            case IpcBusCommand.Kind.AddChannelListener: {
                let peerSocket = this._peers.get(ipcBusCommand.peer.id);
                if (peerSocket == null) {
                    peerSocket = { ...ipcBusCommand.peer, socket };
                }
                this._subscriptions.addRef(ipcBusCommand.channel, peerSocket.id, socket, ipcBusCommand.peer);
                break;
            }

            case IpcBusCommand.Kind.RemoveChannelListener:
                this._subscriptions.release(ipcBusCommand.channel, ipcBusCommand.peer.id, ipcBusCommand.peer);
                break;

            case IpcBusCommand.Kind.RemoveChannelAllListeners:
                this._subscriptions.releaseAll(ipcBusCommand.channel, ipcBusCommand.peer.id, ipcBusCommand.peer);
                break;

            case IpcBusCommand.Kind.RemoveListeners:
                this._subscriptions.removePeer(ipcBusCommand.peer);
                break;

            // Socket can come from C++ process, Node.js process or main bridge
            case IpcBusCommand.Kind.SendMessage:
                const signature = IpcBusUtils.GetProcessIdentifierFromSignature(ipcBusCommand.target);
                if (signature) {
                    const peer = this._peers.get(signature.peerid);
                    if (peer) {
                        WriteBuffersToSocket(peer.socket, ipcPacketBufferList.buffers);
                        return;
                    }
                }
                this._subscriptions.forEachChannel(ipcBusCommand.channel, (connData) => {
                    // Prevent echo message
                    if (connData.conn !== socket) {
                        WriteBuffersToSocket(connData.conn, ipcPacketBufferList.buffers);
                    }
                });
                // if not coming from main bridge => forward
                this.broadcastToBridgeMessage(socket, ipcBusCommand, ipcPacketBufferList);
                break;

            // Socket can come from C++ process, Node.js process or main bridge
            case IpcBusCommand.Kind.RequestResponse: {
                const signature = IpcBusUtils.GetProcessIdentifierFromSignature(ipcBusCommand.target);
                if (signature) {
                    const peer = this._peers.get(signature.peerid);
                    if (peer) {
                        WriteBuffersToSocket(peer.socket, ipcPacketBufferList.buffers);
                        return;
                    }
                }
                // Response if not for a socket client, forward to main bridge
                this.broadcastToBridge(socket, ipcBusCommand, ipcPacketBufferList);
                break;
            }

            // Socket can come from C++ process, Node.js process or main bridge
            case IpcBusCommand.Kind.RequestClose: {
                // if not coming from main bridge => forward
                this.broadcastToBridge(socket, ipcBusCommand, ipcPacketBufferList);
                break;
            }

            case IpcBusCommand.Kind.LogGetMessage:
            case IpcBusCommand.Kind.LogLocalSendRequest:
            case IpcBusCommand.Kind.LogLocalRequestResponse:
                this.broadcastToBridge(socket, ipcBusCommand, ipcPacketBufferList);
                break;

            // BridgeClose/Connect received are coming from IpcBusBridge only !
            case IpcBusCommand.Kind.BridgeConnect: {
                const socketClient = this._socketClients.get(socket);
                this.onBridgeConnected(socketClient, ipcBusCommand);
                break;
            }
            case IpcBusCommand.Kind.BridgeAddChannelListener:
                this.onBridgeAddChannel(socket, ipcBusCommand);
                break;

            case IpcBusCommand.Kind.BridgeRemoveChannelListener:
                this.onBridgeRemoveChannel(socket, ipcBusCommand);
                break;

            case IpcBusCommand.Kind.BridgeClose:
                this.onBridgeClosed();
                break;

            default:
                console.log(JSON.stringify(ipcBusCommand, null, 4));
                throw 'IpcBusBrokerImpl: Not valid packet !';
        }
    }

    queryState(): Object {
        return null;
    }
    
    protected onBridgeConnected(socketClient: IpcBusBrokerSocket, ipcBusCommand: IpcBusCommand) {
    }

    protected onBridgeClosed(socket?: net.Socket) {
    }

    protected onBridgeAddChannel(socket: net.Socket, ipcBusCommand: IpcBusCommand) {
    }

    protected onBridgeRemoveChannel(socket: net.Socket, ipcBusCommand: IpcBusCommand) {
    }

    protected broadcastToBridgeAddChannel(channel: string) {
    }

    protected broadcastToBridgeRemoveChannel(channel: string) {
    }

    protected abstract broadcastToBridgeMessage(socket: net.Socket, ipcBusCommand: IpcBusCommand, ipcPacketBufferList: IpcPacketBufferList): void;
    protected abstract broadcastToBridge(socket: net.Socket, ipcBusCommand: IpcBusCommand, ipcPacketBufferList: IpcPacketBufferList): void;
}
