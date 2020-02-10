// import { IpcPacketBuffer } from 'socket-serializer';
import { IpcBusConnector } from './IpcBusConnector';
import { IpcBusCommand } from './IpcBusCommand';
import * as Client from './IpcBusClient';
import { IpcBusLogConfig } from './log/IpcBusLogConfig';
import { CreateIpcBusLog } from './log/IpcBusLog-factory';
import { CreateUniqId } from './IpcBusUtils';

// Implementation for renderer process
/** @internal */
export abstract class IpcBusConnectorImpl implements IpcBusConnector {
    protected _client: IpcBusConnector.Client;
    protected _process: Client.IpcBusProcess;
    protected _messageId: string;
    protected _messageCount: number;
    protected _log: IpcBusLogConfig;

    constructor(contextType: Client.IpcBusProcessType) {
        this._process = {
            type: contextType,
            pid: process ? process.pid: -1
        };

        this._log = CreateIpcBusLog();
        this._messageId = CreateUniqId();
        this._messageCount = 0;
    }

    get process(): Client.IpcBusProcess {
        return this._process;
    }

    protected addClient(client: IpcBusConnector.Client) {
        this._client = client;
    }

    protected removeClient(client: IpcBusConnector.Client) {
        if (this._client === client) {
            this._client = null;
        }
    }

    protected cloneCommand(command: IpcBusCommand): IpcBusCommand.LogCommand {
        const logCommand: IpcBusCommand.LogCommand = {
            kind: command.kind,
            peer: command.peer,
            channel: command.channel,
            request: command.request
        };
        return logCommand;
    }

    logMessageCreation(previousLog: IpcBusCommand.Log, ipcBusCommand: IpcBusCommand) {
        if (this._log.level >= IpcBusLogConfig.Level.Sent) {
            const id = `${this._messageId}-${this._messageCount++}`;
            ipcBusCommand.log = {
                id,
                kind: ipcBusCommand.kind,
                peer: ipcBusCommand.peer,
                timestamp: this._log.now,
                command: this.cloneCommand(ipcBusCommand),
                previous: previousLog,
            };
            while (previousLog) {
                ipcBusCommand.log.related_peer = previousLog.peer;
                previousLog = previousLog.previous;
            }
        }
    }

    logLocalResponse(previousLog: IpcBusCommand.Log, ipcBusCommandResponse: IpcBusCommand, argsResponse?: any[]) {
        if (this._log.level >= IpcBusLogConfig.Level.Sent) {
            // Clone first level
            const ipcBusCommandLog: IpcBusCommand = Object.assign({}, ipcBusCommandResponse);
            ipcBusCommandLog.kind = IpcBusCommand.Kind.LogRequestResponse;
            this.logMessageCreation(previousLog, ipcBusCommandLog);
            ipcBusCommandLog.log.local = true;
            this.postCommand(ipcBusCommandLog, argsResponse);
        }
    }

    logMessageReceived(peer: Client.IpcBusPeer, local: boolean, ipcBusCommandPrevious: IpcBusCommand, args?: any[]): IpcBusCommand.Log {
        if (this._log.level >= IpcBusLogConfig.Level.Received) {
            const ipcBusCommandLog: IpcBusCommand = {
                kind: IpcBusCommand.Kind.LogGetMessage,
                peer,
                channel: ''
            };
            this.logMessageCreation(ipcBusCommandPrevious.log, ipcBusCommandLog);
            ipcBusCommandLog.log.command = this.cloneCommand(ipcBusCommandPrevious);
            ipcBusCommandLog.log.related_peer = ipcBusCommandPrevious.peer;
            ipcBusCommandLog.log.local = local;
            // no args
            this.postCommand(ipcBusCommandLog);
            return ipcBusCommandLog.log;
        }
        return null;
    }

    abstract handshake(client: IpcBusConnector.Client, options: Client.IpcBusClient.ConnectOptions): Promise<IpcBusConnector.Handshake>;
    abstract shutdown(client: IpcBusConnector.Client, options: Client.IpcBusClient.CloseOptions): Promise<void>;
    abstract postCommand(ipcBusCommand: IpcBusCommand, args?: any[]): void;
    abstract postBuffer(buffer: Buffer): void;
}
