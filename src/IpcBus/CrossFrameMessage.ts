export interface CrossFrameMessage {
    uuid: string;
    channel: string;
    args?: any[];
}

export interface CrossFrameWrap {
    [CrossFrameMessage.CrossFrameKeyId]: CrossFrameMessage;
}

export namespace CrossFrameMessage {
    export const CrossFrameKeyId = '__cross-frame-message__';

    export function Decode(json: boolean, data: any): CrossFrameMessage {
        // We don't control all message events, they won't always be JSON
        try {
            let wrap: CrossFrameWrap = json ? JSON.parse(data, (key, value) => {
                return value && value.type === 'Buffer' ?
                    Buffer.from(value.data) :
                    value;
            }) : data;
            let packet = wrap[CrossFrameKeyId];
            if (packet) {
                return packet;
            }
        }
        catch (e) {
        }
        return null;
    }

    // Takes a channel and the arguments to emit with and serialises it
    // for transmission
    export function Encode(json: boolean, uuid: string, channel: string, args: any[]): any {
        let wrap: CrossFrameWrap = {
            [CrossFrameKeyId]: {
                uuid,
                channel,
                args: args
            }
        };
        return json ? JSON.stringify(wrap) : wrap;
    }
}
