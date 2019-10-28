import proto from "../proto/broker_pb";
import { Observable } from "mz-observable";
import future, { IFuture } from "fp-future";

export type RTCDoubleSDP = { sdp: string; type: RTCSdpType; originalSdp: string };

export interface ISocket {
  readonly socketId: string;
  readonly awaitableConnected: IFuture<void>;
  readonly onDataObservable: Observable<string | ArrayBuffer | ArrayBufferView>;
  readonly onError: Observable<Error>;
  readonly onDisconnected: Observable<void>;
  readonly isConnected: boolean;
  readonly broker: BaseBroker;
  close(): void;
  send(data: string | ArrayBuffer, reliable?: boolean): void;
  connect(remotePeer: string): Promise<void>;
}

export type SocketBuilder = (broker: BaseBroker) => ISocket;

export interface BrokerOptions {
  readonly socketBuilder: SocketBuilder;

  // Protocol is used to differentiate application protocol versions or deployments
  readonly protocol?: string;
}

export type PartialServerData = {
  // Server name
  name?: string;

  // metadata object
  meta?: any;
};

export abstract class BaseBroker {
  async connect(serverAlias: string): Promise<ISocket> {
    const connection = this.options.socketBuilder(this);

    const ret = future<ISocket>();

    const observer = this.onMessageObservable.add(message => {
      if (message.hasServerSynAck()) {
        const packet = message.getServerSynAck()!;
        if (packet.getReceiver() === connection.socketId) {
          this.onMessageObservable.remove(observer);
          connection.connect(packet.getSender());
          ret.resolve(connection);
        }
      }
    });

    this.sendSyn(connection.socketId, serverAlias);

    setTimeout(() => {
      if (ret.isPending) {
        ret.reject(new Error(`Server ${serverAlias} did not respond`));
      }
    }, 5000);

    return ret;
  }
  public onMessageObservable = new Observable<proto.BrokerMessage>();
  public onWebRTCObservable = new Observable<proto.WebRtcMessage>();
  public onServerListObservable = new Observable<proto.ServerList>();

  public lastServerList: proto.ServerList | null = null;

  public connectedFuture = future<void>();

  public alias?: string;

  // It must return the socketId of the new connection
  public onCreateConnectionCallback?: (socket: ISocket) => void;

  private socketCount = 0;
  private listeningFuture = future<void>();

  abstract get isConnected(): boolean;

  abstract send(brokerMessage: proto.BrokerMessage): void;

  constructor(public readonly options: BrokerOptions) {
    this.onMessageObservable.add($ => {
      if ($.hasWebrtcNegotiation()) {
        this.onWebRTCObservable.notifyObservers($.getWebrtcNegotiation()!);
      } else if ($.hasWelcome()) {
        const packet = $.getWelcome()!;
        this.alias = packet.getAlias();
        this.connectedFuture.resolve();
      } else if ($.hasServerSyn()) {
        const packet = $.getServerSyn()!;
        if (packet.getServerAlias() === this.alias) {
          if (this.onCreateConnectionCallback) {
            const socket = this.options.socketBuilder(this);
            this.onCreateConnectionCallback(socket);
            this.sendSynAck(socket.socketId, packet.getSender());
          }
        }
      } else if ($.hasCreateServerResponse()) {
        const packet = $.getCreateServerResponse()!;

        if (packet.getAlias() === this.alias) {
          this.listeningFuture.resolve();
        }
      } else if ($.hasServerListResponse()) {
        const packet = $.getServerListResponse()!;
        this.lastServerList = packet;
        this.onServerListObservable.notifyObservers(packet);
      }
    });
  }

  async listen(options: PartialServerData, cb: BaseBroker["onCreateConnectionCallback"]) {
    if (!cb) throw new Error("A callback is required");
    this.onCreateConnectionCallback = cb;

    const wireMessage = new proto.BrokerMessage();

    const serverData = new proto.ServerData();
    serverData.setAlias(this.alias!);
    serverData.setName(options.name || this.alias! + " server");

    if (this.options.protocol) {
      serverData.setProtocol(this.options.protocol);
    }

    if (typeof options.meta !== "undefined") {
      serverData.setMeta(JSON.stringify(options.meta));
    }

    const request = new proto.CreateServerRequest();
    request.setAlias(this.alias!);
    request.setData(serverData);

    wireMessage.setCreateServerRequest(request);

    this.send(wireMessage);

    // TODO: timeout?

    return this.listeningFuture;
  }

  async requestServerList(): Promise<proto.ServerList> {
    const wireMessage = new proto.BrokerMessage();

    const serverListRequest = new proto.ServerListRequest();

    if (this.options.protocol) {
      serverListRequest.setProtocol(this.options.protocol);
    }

    wireMessage.setServerListRequest(serverListRequest);

    const ret = future<proto.ServerList>();

    this.onServerListObservable.addOnce(list => ret.resolve(list));

    this.send(wireMessage);

    // TODO: timeout ret?

    return ret;
  }

  sendCandidate(sender: string, receiver: string, candidate: RTCIceCandidate | null) {
    const wireMessage = new proto.BrokerMessage();
    const message = new proto.WebRtcMessage();

    message.setRtcType(proto.WebRTCMessageType.WEBRTC_ICE_CANDIDATE);
    message.setSender(sender);
    message.setReceiver(receiver);
    message.setJson(JSON.stringify(candidate));

    wireMessage.setWebrtcNegotiation(message);
    this.send(wireMessage);
  }

  sendSessionMessage(sender: string, receiver: string, newOffer: RTCDoubleSDP) {
    const wireMessage = new proto.BrokerMessage();
    const message = new proto.WebRtcMessage();

    message.setRtcType(proto.WebRTCMessageType.WEBRTC_SESSION);
    message.setSender(sender);
    message.setReceiver(receiver);
    message.setJson(JSON.stringify(newOffer));

    wireMessage.setWebrtcNegotiation(message);
    this.send(wireMessage);
  }

  sendSynAck(sender: string, receiver: string) {
    const wireMessage = new proto.BrokerMessage();
    const message = new proto.ServerSynAck();

    message.setSender(sender);
    message.setReceiver(receiver);

    wireMessage.setServerSynAck(message);

    this.send(wireMessage);
  }

  getSocketId(): string {
    if (!this.alias) {
      throw new Error("Cannot get socketId without an alias");
    }
    return this.alias + "|" + (this.socketCount++).toString(36);
  }

  sendSyn(sender: string, serverAlias: string) {
    const wireMessage = new proto.BrokerMessage();
    const syn = new proto.ServerSyn();

    syn.setSender(sender);
    syn.setServerAlias(serverAlias);

    wireMessage.setServerSyn(syn);
    this.send(wireMessage);
  }
}
