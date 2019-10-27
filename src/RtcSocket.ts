import { Observable } from "mz-observable";
import future, { IFuture } from "fp-future";
import proto from "../proto/broker_pb";
import { BaseBroker, RTCDoubleSDP, ISocket } from "./BaseBroker";

export class RtcSocket implements ISocket {
  // Sometimes ICE gathering process is TOO slow, we have this flag to detect
  // those scenarios and DO NOT wait for all the candidates to send the offer.
  // Instead, we use good ol' tickle (if possible)
  static slowIceResolutionDetected = false;

  public socketId: string;

  public awaitableConnected: IFuture<void> = future();
  public onDataObservable = new Observable<string | ArrayBuffer | ArrayBufferView>();
  public onError = new Observable<Error>();
  public onDisconnected = new Observable<void>();

  private reliableDataChannel?: RTCDataChannel;
  private unreliableDataChannel?: RTCDataChannel;

  private _remoteSocket?: string;

  private hasRemoteConnectionFuture = future<void>();
  private waitForCandidatesFuture = future<RTCSessionDescription>();

  // Think of offerPeer as our local client. It's going to create a data channel
  // and an offer and send them to the other peer.
  private peer?: RTCPeerConnection;

  private closed = false;

  // TODO: Cleanupo observables after disconnect or error

  set remoteSocket(value: string) {
    if (typeof this._remoteSocket === "string" && value !== this._remoteSocket) {
      throw new Error("Remote socket cannot be changed");
    }
    if (!value) throw new Error("Remote socket must be a value");
    this._remoteSocket = value;
  }

  get remoteSocket(): string {
    return this._remoteSocket!;
  }

  constructor(public broker: BaseBroker, public rtcConfiguration: RTCConfiguration, private wrtc?: any) {
    this.socketId = broker.getSocketId();

    broker.onWebRTCObservable.add(message => {
      if (message.getRtcType() === proto.WebRTCMessageType.WEBRTC_ICE_CANDIDATE) {
        if (message.getReceiver() == this.socketId) {
          this.ensurePeer(message.getSender());
          const candidate = JSON.parse(message.getJson());
          // https://stackoverflow.com/questions/38198751/domexception-error-processing-ice-candidate?rq=1
          const addCandidate = async () => {
            await this.hasRemoteConnectionFuture;
            if (candidate !== null) {
              await this.peer!.addIceCandidate(candidate);
            }
          };
          addCandidate().catch($ => {
            this.throwError($);
          });
        }
      } else if (message.getRtcType() === proto.WebRTCMessageType.WEBRTC_SESSION) {
        if (message.getReceiver() == this.socketId) {
          const offer = JSON.parse(message.getJson());
          this.ensurePeer(message.getSender());
          if (offer.type === "offer") {
            this.processOffer(offer).catch($ => this.throwError($));
          } else if (offer.type === "answer") {
            this.processAnswer(offer).catch($ => this.throwError($));
          } else {
            this.throwError(new Error("Unknown SESSION message type " + message.getJson()));
          }
        }
      }
    });
  }

  private throwError(err: Error) {
    if (this.awaitableConnected.isPending) {
      this.awaitableConnected.reject(err);
    }
    if (this.onError.hasObservers()) {
      this.onError.notifyObservers(err);
    } else {
      throw err;
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.peer && this.peer.close();
    this.reliableDataChannel && this.reliableDataChannel.close();
    this.unreliableDataChannel && this.unreliableDataChannel.close();
    if (this.awaitableConnected.isPending) {
      this.awaitableConnected.reject(new Error("Manually closed"));
    }
    this.onDataObservable.clear();
    this.onDisconnected.notifyObservers();
    this.onDisconnected.clear();
  }

  get isConnected(): boolean {
    if (!this.reliableDataChannel) return false;
    if (this.reliableDataChannel.readyState !== "open") return false;

    return true;
  }

  send(data: string | ArrayBuffer, reliable = true) {
    let channel = this.reliableDataChannel;

    if (!reliable && this.unreliableDataChannel && this.unreliableDataChannel.readyState === "open") {
      channel = this.unreliableDataChannel;
    }

    if (!channel) {
      this.throwError(new Error("There are no DataChannels"));
      return;
    }

    if (channel.readyState !== "open") {
      this.throwError(
        new Error(`Data channel ${channel.label} is in state ${channel.readyState}. Cannot send any data.`)
      );
      return;
    }

    channel.send(data as string);
  }

  ensurePeer(remoteSocket: string) {
    if (this.peer) {
      return;
    }

    const peerConnectionConstructor = (this.wrtc && this.wrtc.RTCPeerConnection) || RTCPeerConnection;

    this.peer = new peerConnectionConstructor(this.rtcConfiguration) as RTCPeerConnection;
    this.remoteSocket = remoteSocket;

    this.peer.addEventListener("connectionstatechange", _ => {
      console.log(this.socketId, "connectionstatechange", this.peer!.connectionState);

      if (this.peer!.connectionState === "disconnected") {
        this.close();
      } else if (this.peer!.connectionState === "failed" && this.awaitableConnected.isPending) {
        this.awaitableConnected.reject(new Error("Connection failed"));
        this.close();
      }
    });

    this.peer.addEventListener("icecandidateerror", ev => {
      console.log(this.socketId, "icecandidateerror", ev);
    });

    this.peer.addEventListener("iceconnectionstatechange", _ => {
      console.log(this.socketId, "iceconnectionstatechange", this.peer!.iceConnectionState);
    });

    this.peer.addEventListener("icegatheringstatechange", _ => {
      console.log(this.socketId, "icegatheringstatechange", this.peer!.iceGatheringState);
    });

    this.peer.addEventListener("negotiationneeded", () => {
      this.initializeOffer().catch($ => this.throwError($));
    });

    this.peer.addEventListener("signalingstatechange", _ => {
      console.log(this.socketId, "signalingstatechange", this.peer!.signalingState);
    });

    this.peer.addEventListener("statsended", _ => {
      console.log(this.socketId, "statsended");
    });

    this.peer.addEventListener("track", ev => {
      console.log(this.socketId, "track", ev);
    });

    // This will be called for each offer candidate. A candidate is a potential
    // address that the other peer can attempt to connect to. Note that
    // event.candidate can be null, so we must guard against that. The two peers
    // will exchange candidates until they find a connection that works.
    this.peer.addEventListener("icecandidate", ev => {
      // These would normally be sent to answerPeer over some other transport,
      // like a websocket, but since this is local we can just set it here.
      this.broker.sendCandidate(this.socketId, remoteSocket, ev.candidate);

      if (!ev.candidate) {
        // after setLocalDescription the ICE gathering process will start, it
        // will gather candidates and report a null candidate at the end (this if)
        // then we send the offer or answer hidrated with all the candidates
        this.waitForCandidatesFuture.resolve(this.peer!.localDescription!);
      }
    });

    this.peer.addEventListener("datachannel", (event: RTCDataChannelEvent) => {
      this.registerDataChannel(event.channel.label, event.channel);
    });
  }

  async connect(remotePeer: string) {
    console.log(this.socketId, "connect to", remotePeer);
    this.ensurePeer(remotePeer);

    this.reliableDataChannel = this.peer!.createDataChannel("main", {});
    this.registerDataChannel("main", this.reliableDataChannel);

    this.unreliableDataChannel = this.peer!.createDataChannel("unreliable", { ordered: false, maxRetransmits: 0 });
    this.registerDataChannel("unreliable", this.unreliableDataChannel);

    return this.awaitableConnected;
  }

  private async initializeOffer() {
    const offer = await this.peer!.createOffer();

    const sessionDescriptionConstructor = (this.wrtc && this.wrtc.RTCSessionDescription) || RTCSessionDescription;

    const newOffer = new sessionDescriptionConstructor(offer) as RTCSessionDescription;

    await this.peer!.setLocalDescription(newOffer);

    let noffer = newOffer;

    if (this.peer!.canTrickleIceCandidates === false || !RtcSocket.slowIceResolutionDetected) {
      console.info(this.socketId, "Waiting for candidates (initialize offer)");
      noffer = await this.waitForCandidatesFuture;
    }

    this.broker.sendSessionMessage(this.socketId, this.remoteSocket, {
      sdp: noffer.sdp,
      type: noffer.type,
      originalSdp: newOffer.sdp
    });
  }

  private async processOffer(offer: RTCDoubleSDP) {
    await this.peer!.setRemoteDescription(offer);

    const answer = await this.peer!.createAnswer({});
    const sessionDescriptionConstructor = (this.wrtc && this.wrtc.RTCSessionDescription) || RTCSessionDescription;
    const newAnswer = new sessionDescriptionConstructor(answer) as RTCSessionDescription;
    await this.peer!.setLocalDescription(newAnswer);

    let nanswer = newAnswer;

    if (this.peer!.canTrickleIceCandidates === false || !RtcSocket.slowIceResolutionDetected) {
      console.info(this.socketId, "Waiting for candidates (process offer)");
      nanswer = await this.waitForCandidatesFuture;
    }

    this.broker.sendSessionMessage(this.socketId, this.remoteSocket, {
      sdp: nanswer.sdp,
      type: nanswer.type,
      originalSdp: newAnswer.sdp
    });
  }

  private async processAnswer(answer: RTCDoubleSDP) {
    try {
      await this.peer!.setRemoteDescription(answer);
    } catch (e) {
      // Firefox and Chrome use different standard versions. Sometimes it fails
      // to process the SDP message WITH candidates, so we have to send the
      // original SDP to try using an interactive ICE
      if (e.message.includes("SDP Parse Error")) {
        // TODO: register this scenario
        const sessionDescriptionConstructor = (this.wrtc && this.wrtc.RTCSessionDescription) || RTCSessionDescription;
        const newAnswer = new sessionDescriptionConstructor({
          sdp: answer.originalSdp,
          type: answer.type
        }) as RTCSessionDescription;

        await this.peer!.setRemoteDescription(newAnswer);
      } else {
        throw e;
      }
    }
    this.hasRemoteConnectionFuture.resolve();
  }

  private registerDataChannel(name: string, channel: RTCDataChannel) {
    if (name === "main") {
      this.reliableDataChannel = channel;
    } else if (name === "unreliable") {
      this.unreliableDataChannel = channel;
    } else {
      this.throwError(new Error("Unknown data channel " + name));
      return;
    }

    channel.binaryType = "arraybuffer";

    channel.addEventListener("onerror", evt => {
      if (this.awaitableConnected.isPending) {
        this.awaitableConnected.reject(new Error("Error in DataChannel"));
      }
      console.error("Error in DataChannel", evt);
    });

    if (name === "main") {
      channel.addEventListener("open", () => {
        if (this.awaitableConnected.isPending) {
          this.awaitableConnected.resolve();
        }
      });

      channel.addEventListener("close", () => {
        this.close();
      });
    }

    channel.addEventListener("message", evt => {
      this.onDataObservable.notifyObservers(evt.data);
    });
  }
}
