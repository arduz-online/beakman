import { BaseBroker, BrokerOptions } from "./BaseBroker";
import proto from "../proto/broker_pb";
import { Observable } from "mz-observable";
import { RtcSocket } from "./RtcSocket";

export interface RemoteBrokerOptions extends Partial<BrokerOptions> {
  readonly remoteWs: string;
  readonly rtcConfiguration: RTCConfiguration;
  readonly wrtc?: any
}

export class RemoteBroker extends BaseBroker {
  options!: BrokerOptions & RemoteBrokerOptions;
  ws?: WebSocket;

  onPing = new Observable<number>();

  get isConnected() {
    if (this.connectedFuture.isPending) return false;
    if (!this.ws) return false;
    if (this.ws.readyState !== this.ws.OPEN) return false;
    if (!this.alias) return false;
    return true;
  }

  constructor(options: RemoteBrokerOptions) {
    super({ socketBuilder: broker => new RtcSocket(broker, options.rtcConfiguration, options.wrtc), ...options });

    if (typeof RTCSessionDescription === "undefined" && (!options.wrtc || !options.wrtc.RTCSessionDescription)) {
      throw new Error("RTCSessionDescription doesn't exist and wrtc.RTCSessionDescription is not defined");
    }

    if (typeof RTCPeerConnection === "undefined" && (!options.wrtc || !options.wrtc.RTCPeerConnection)) {
      throw new Error("RTCPeerConnection doesn't exist and wrtc.RTCPeerConnection is not defined");
    }

    this.ws = new WebSocket(options.remoteWs);
    this.ws.binaryType = "arraybuffer";
    this.ws.addEventListener("message", ev => {
      this.onMessageObservable.notifyObservers(proto.BrokerMessage.deserializeBinary(ev.data));
    });

    const pingPacket = new proto.BrokerMessage();
    pingPacket.setPing(new proto.Header());

    let lastPing = 0;

    const pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === this.ws.OPEN) {
        lastPing = performance.now();
        this.ws.send(pingPacket.serializeBinary());
      }
    }, 5000);

    this.onMessageObservable.add($ => {
      if ($.hasPong()) {
        this.onPing.notifyObservers(performance.now() - lastPing);
      }
    });

    this.ws.addEventListener("close", _ => {
      console.error("Disconnected!");
      clearInterval(pingTimer);
    });

    this.ws.addEventListener("error", ev => {
      this.connectedFuture.reject(Object.assign(new Error("Error while connecting"), ev));
    });
  }

  send(brokerMessage: proto.BrokerMessage): void {
    if (!this.ws) {
      throw new Error("Not connected yet (missing socket)");
    }
    if (this.ws.readyState !== this.ws.OPEN) {
      throw new Error(`Not connected (status: ${this.ws.readyState})`);
    }
    this.ws.send(brokerMessage.serializeBinary());
  }
}
