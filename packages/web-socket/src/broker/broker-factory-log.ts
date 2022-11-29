import { ConsoleLogger, GlobalContainer } from '@electron-common-ipc/universal';

import { BrokerToken, TransportToken } from '../constants';
import { createWebSocketBroker as createThin } from './broker-factory-thin';

import type { IpcBusBroker } from '@electron-common-ipc/universal';

export function createWebSocketBroker(): IpcBusBroker {
    const logger = new ConsoleLogger();
    const globalContainer = new GlobalContainer();

    return createThin({
        container: {
            instance: globalContainer,
            brokerToken: BrokerToken,
            transportToken: TransportToken,
        },
        logger,
    });
}