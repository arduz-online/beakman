# beakman

## Install

```bash
npm i -S beakman
```

## Usage

### As client: pick a server and send/receive messages

```ts
import { RemoteBroker } from 'beakman'

// Base configuration for WebRtc
const rtcConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478?transport=udp" }
  ]
}

// Connect to a signaling server
const broker = new RemoteBroker({
  rtcConfiguration,
  remoteWs: 'wss://open-signaling.beakman.tech'
})

// Get the server list
const serverListResponse = await broker.requestServerList()
const aServer = serverListResponse.getServersList().first()

// Connect to a server
const clientConnection = await broker.connect(aServer.alias)

// Listening messages FROM server
clientConnection.onDataObservable.add(message => {
  console.log(`receive message: ${message} from ${aServer.alias}`)
})

// Send messages TO server
clientConnection.send('a message');
```

### As server: host a room open for clients

```ts
import { RemoteBroker } from 'beakman'

// Connect to a signaling server
const broker = new RemoteBroker({
  remoteWs: 'wss://open-signaling.beakman.tech'
})

// Listen for new connections
await broker.listen(clientConnection => {
  console.log('A client got connected!', clientConnection)

  // Listening messages FROM client
  clientConnection.onDataObservable.add(message => {
    console.log(`receive message: ${message} from ${clientConnection.socketId}`)
  })

  // Send messages TO client
  clientConnection.send('message')
})
```

## Signaling server

There is a naive implementation of the signaling server in the folder [signaling-server](signaling-server).

Cloning the folder and running `npm start` is enough to run the signaling server.

## Running in Node.js

Node.js works out of the box as well as the browser. To run with Node it is necessary to provide `wrtc` and `ws` packages.

```ts
import { RemoteBroker } from 'beakman'
const wrtc = require('wrtc')
const ws = require('ws')

// Connect to a signaling server
const broker = new RemoteBroker({
  remoteWs: 'wss://open-signaling.beakman.tech',
  rtcConfiguration,
  wrtc,
  ws
})
```