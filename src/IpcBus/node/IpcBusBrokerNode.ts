import type * as net from 'net';

import { IpcPacketWriter, IpcPacketBufferList, SocketWriter, WriteBuffersToSocket } from 'socket-serializer';

import type * as Client from '../IpcBusClient';
import { IpcBusCommand } from '../IpcBusCommand';
import { CreateUniqId } from '../IpcBusUtils';
import { ChannelsRefCount } from '../IpcBusChannelMap';

import { IpcBusBrokerImpl } from './IpcBusBrokerImpl';
import type { IpcBusBrokerSocket } from './IpcBusBrokerSocket';
import { JSONParserV1 } from 'json-helpers';

const PeerName = 'IPCBus:NetBrokerBridge';

/** @internal */
export class IpcBusBrokerNode extends IpcBusBrokerImpl {
    private _socketWriter: SocketWriter;
    private _packetOut: IpcPacketWriter;

    private _peer: Client.IpcBusPeer;

    private _subscribedChannels: ChannelsRefCount;

    constructor(contextType: Client.IpcBusProcessType) {
        super(contextType);

        this._peer = {
            id: `${contextType}.${CreateUniqId()}`,
            process: {
                type: contextType,
                pid: process ? process.pid : -1
            },
            name: PeerName
        }
       
        this._packetOut = new IpcPacketWriter();
        this._packetOut.JSON = JSONParserV1;
        this._subscribedChannels = new ChannelsRefCount();
    }

    protected _reset(closeServer: boolean) {
        this.onBridgeClosed();
        super._reset(closeServer);
    }

    protected onBridgeConnected(socketClient: IpcBusBrokerSocket, ipcBusCommand: IpcBusCommand) {
        if (this._socketWriter == null) {
            this._socketWriter = new SocketWriter(socketClient.socket);

            if (Array.isArray(ipcBusCommand.channels)) {
                this._subscribedChannels.addRefs(ipcBusCommand.channels);
            }

            const channels = this._subscriptions.getChannels();
            for (let i = 0, l = channels.length; i < l; ++i) {
                this.broadcastToBridgeAddChannel(channels[i]);
            }
            this._subscriptions.client = {
                channelAdded: (channel) => {
                    this.broadcastToBridgeAddChannel(channel);
                },
                channelRemoved: (channel) => {
                    this.broadcastToBridgeRemoveChannel(channel);
                }
            };
        }
    }

    protected onBridgeClosed(socket?: net.Socket) {
        if (this._socketWriter && ((socket == null) || (socket === this._socketWriter.socket))) {
            this._subscriptions.client = null;
            this._socketWriter = null;
            this._subscribedChannels.clear();
        }
    }

    protected onBridgeAddChannel(socket: net.Socket, ipcBusCommand: IpcBusCommand) {
        this._subscribedChannels.addRef(ipcBusCommand.channel);
    }

    protected onBridgeRemoveChannel(socket: net.Socket, ipcBusCommand: IpcBusCommand) {
        this._subscribedChannels.release(ipcBusCommand.channel);
    }

    protected broadcastToBridgeAddChannel(channel: string) {
        const ipcBusCommand: IpcBusCommand = {
            kind: IpcBusCommand.Kind.BrokerAddChannelListener,
            channel,
            peer: this._peer
        };
        this._packetOut.write(this._socketWriter, [ipcBusCommand]);
    }

    protected broadcastToBridgeRemoveChannel(channel: string) {
        const ipcBusCommand: IpcBusCommand = {
            kind: IpcBusCommand.Kind.BrokerRemoveChannelListener,
            channel,
            peer: this._peer
        };
        this._packetOut.write(this._socketWriter, [ipcBusCommand]);
    }

    protected broadcastToBridgeMessage(socket: net.Socket, ipcBusCommand: IpcBusCommand, ipcPacketBufferList: IpcPacketBufferList) {
        // if we have channels, it would mean we have a socketBridge, so do not test it
        if (this._subscribedChannels.has(ipcBusCommand.channel)) {
            if (socket !== this._socketWriter.socket) {
                WriteBuffersToSocket(this._socketWriter.socket, ipcPacketBufferList.buffers);
            }
        }
    }

    protected broadcastToBridge(socket: net.Socket, ipcBusCommand: IpcBusCommand, ipcPacketBufferList: IpcPacketBufferList) {
        if (this._socketWriter) {
            WriteBuffersToSocket(this._socketWriter.socket, ipcPacketBufferList.buffers);
        }
    }
}
