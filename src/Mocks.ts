import { ISocket, BaseBroker } from "./BaseBroker";
import future, { IFuture } from "fp-future";
import proto from "../proto/broker_pb";
import { Observable } from "mz-observable";
import { RtcSocket } from "./RtcSocket";
import { peerConnectionConfig } from "./DefaultConfiguration";

export class MockSocket implements ISocket {
  socketId!: string;

  awaitableConnected: IFuture<void> = future();
  onDataObservable = new Observable<string | ArrayBuffer | ArrayBufferView>();
  onError = new Observable<Error>();
  onDisconnected = new Observable<void>();
  isConnected: boolean = false;

  private remoteSocket?: MockSocket;

  constructor(public broker: MockBroker) {
    this.socketId = broker.getSocketId();

    broker.onMessageObservable.add($ => {
      if ($.hasWebrtcNegotiation()) {
        const rtc = $.getWebrtcNegotiation()!;

        if (rtc.getRtcType() == proto.WebRTCMessageType.WEBRTC_ICE_CANDIDATE) {
          const socketA = broker.connections.get(rtc.getSender())! as MockSocket;
          const socketB = broker.connections.get(rtc.getReceiver())! as MockSocket;

          if (!socketA) {
            console.log({ socketA, connections: broker.connections });
            throw new Error(`Socket A not found`);
          }
          if (!socketB) {
            console.log({ socketB, connections: broker.connections });
            throw new Error(`Socket B not found`);
          }

          if (false === socketA instanceof MockSocket) throw new Error(`Socket A is not a mocked socket`);
          if (false === socketB instanceof MockSocket) throw new Error(`Socket B is not a mocked socket`);

          socketA.remoteSocket = socketB;
          socketB.remoteSocket = socketA;

          socketA.awaitableConnected.resolve();
          socketB.awaitableConnected.resolve();
        }
      }
    });
  }

  connect(remotePeer: string): Promise<void> {
    console.log(`Connecting ${this.socketId} to ${remotePeer}`);

    this.awaitableConnected.then(() => {
      this.isConnected = true;
    });

    setTimeout(() => {
      this.broker.sendCandidate(this.socketId, remotePeer, null);
    }, Math.random() * 10);

    return this.awaitableConnected;
  }

  close(): void {
    if (this.remoteSocket) {
      const remote = this.remoteSocket;
      delete this.remoteSocket;
      remote.close();
    }
    this.isConnected = false;
    this.onDisconnected.notifyObservers();
  }

  send(data: string | ArrayBuffer): void {
    if (!this.remoteSocket) throw new Error("Not connected yet");
    this.remoteSocket.onDataObservable.notifyObservers(data);
  }
}

export class MockBroker extends BaseBroker {
  private isListening = false;
  public connections = new Map<string, ISocket>();

  get isConnected() {
    return true;
  }

  constructor(useRealPeerConnection = false) {
    super({
      socketBuilder: () => {
        const sock = useRealPeerConnection ? new RtcSocket(this, peerConnectionConfig) : new MockSocket(this);
        this.connections.set(sock.socketId, sock);
        sock.onDisconnected.add(() => {
          this.connections.delete(sock.socketId);
        });

        return sock;
      }
    });

    this.onMessageObservable.add(message => {
      if (message.hasCreateServerRequest()) {
        const packet = message.getCreateServerRequest()!;
        const response = new proto.BrokerMessage();
        const createServer = new proto.CreateServerResponse();
        createServer.setAlias(packet.getAlias());
        response.setCreateServerResponse(createServer);
        this.isListening = true;
        this.send(response);
      } else if (message.hasServerListRequest()) {
        const response = new proto.BrokerMessage();
        const serverList = new proto.ServerList();
        response.setServerListResponse(serverList);

        if (this.isListening == true) {
          const serverData = new proto.ServerData();
          serverData.setAlias(this.alias!);
          serverData.setName(this.alias!);
          serverList.addServers(serverData);
        }

        this.send(response);
      } else if (message.hasPing()) {
        const response = new proto.BrokerMessage();
        response.setPong(new proto.Header());
        this.send(response);
      }
    });

    const wireWelcome = new proto.BrokerMessage();
    const syntheticWelcome = new proto.WelcomeMessage();
    syntheticWelcome.setAlias(
      Math.random()
        .toString(16)
        .substr(2)
        .toUpperCase()
    );
    wireWelcome.setWelcome(syntheticWelcome);
    this.onMessageObservable.notifyObservers(wireWelcome);

    console.info("Mock Broker:", this.alias);
  }

  send(brokerMessage: proto.BrokerMessage): void {
    this.onMessageObservable.notifyObservers(brokerMessage);
  }
}
