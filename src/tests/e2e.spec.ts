/// <reference path="../../wrtc.d.ts" />
import { MockBroker } from "../Mocks";
import * as wrtc from "wrtc";
import { RemoteBroker } from "../RemoteBroker";
import { peerConnectionConfig } from "../DefaultConfiguration";
import * as http from "http";
import * as WebSocket from "ws";
import future from "fp-future";
import { testWebRtc } from "./testBroker";

declare var describe: any, it: any;

const initializeOnWebSocketServer = require("../../signaling-server/src/index").initializeOnWebSocketServer;

describe("mocked broker with mocked sockets", () => {
  const mockedBroker = new MockBroker(false);
  testWebRtc(mockedBroker);
});

describe("mocked broker with wrtc", () => {
  const mockedBroker = new MockBroker(true, wrtc);
  testWebRtc(mockedBroker);
});

describe("test with signaling server", () => {
  const server = http.createServer();
  const wss = new WebSocket.Server({ server: server });
  const port = 3000;

  const serverStarted = future<void>();

  it("starts the server", async () => {
    initializeOnWebSocketServer(wss, console.log.bind(console));
    server.listen(port, () => {
      serverStarted.resolve();
    });
    await serverStarted;
  });

  const broker = new RemoteBroker({
    rtcConfiguration: peerConnectionConfig,
    wrtc,
    ws: WebSocket
  });

  it("connects the broker", async () => {
    broker.connectBroker(`ws://127.0.0.1:${port}`);
  });

  testWebRtc(broker);

  it("stops the server", () => {
    wss.close();
    server.close();
  });
});
