const ipcBusModule = require('electron-common-ipc');

window.ipcRenderer.on('init-window', (event, id, busPath, busTimeout) => {
    const ipcClient = ipcBusModule.IpcBusClient.Create();
    return ipcClient.connect(busPath, { peerName: 'client Renderer', timeoutDelay: busTimeout })
    .then(() => {

        ipcClient.on('client Renderer ACK', (event) => {
            if (event.request) {
                event.request.resolve('ACK');
            }
        });

        ipcClient.on('test-perf', (event, counter, obj) => {
            console.log(`test-perf ${counter} - ${obj.buffer.length}`)
        });

        window.ipcRenderer.send(`ready-${id}`, { resolve: true });
    })
    .catch((err) => {
        window.ipcRenderer.send(`ready-${id}`, { reject: true, error: err });
    });
});

