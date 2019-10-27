import { BaseBroker, BrokerOptions } from "./BaseBroker";
import proto from "../proto/broker_pb";
import { Observable } from "mz-observable";
import { RtcSocket } from "./RtcSocket";
import { performanceNow } from "./Timers";

export interface RemoteBrokerOptions extends Partial<BrokerOptions> {
  readonly remoteWs?: string;
  readonly rtcConfiguration: RTCConfiguration;
  readonly wrtc?: any;
  readonly ws?: any;
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
      throw new Error("RTCSessionDescription doesn't exist and options.wrtc.RTCSessionDescription is not defined");
    }

    if (typeof RTCPeerConnection === "undefined" && (!options.wrtc || !options.wrtc.RTCPeerConnection)) {
      throw new Error("RTCPeerConnection doesn't exist and options.wrtc.RTCPeerConnection is not defined");
    }

    if (typeof WebSocket === "undefined" && !options.ws) {
      throw new Error("WebSocket doesn't exist and options.ws is not defined");
    }

    if (options.remoteWs) {
      this.connectBroker(options.remoteWs);
    } else {
      console.warn('RemoteBroker(opts): opts.remoteWs is empty, this is allowed only for testing porpuses')
    }
  }

  connectBroker(remoteWs: string) {
    if (this.ws && this.ws.readyState == this.ws.OPEN) {
      this.ws.close();
    }

    const wsConstructor = this.options.ws || WebSocket;

    this.ws = new wsConstructor(remoteWs) as WebSocket;
    this.ws.binaryType = "arraybuffer";
    this.ws.addEventListener("message", ev => {
      this.onMessageObservable.notifyObservers(proto.BrokerMessage.deserializeBinary(ev.data));
    });

    const pingPacket = new proto.BrokerMessage();
    pingPacket.setPing(new proto.Header());

    let lastPing = 0;

    const pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === this.ws.OPEN) {
        lastPing = performanceNow();
        this.ws.send(pingPacket.serializeBinary());
      }
    }, 5000);

    this.onMessageObservable.add($ => {
      if ($.hasPong()) {
        this.onPing.notifyObservers(performanceNow() - lastPing);
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
