import WebSocket = require("ws");
import * as proto from "beakman/proto/broker_pb";

export type Host = {
  data: proto.ServerData;
  ws: WebSocket;
  clients: Set<WebSocket>;
};

function generateId(prefix: string) {
  const id = "xxxxxxxxxxxxxxxxx".replace(/x/g, function() {
    return String.fromCharCode((65 + Math.random() * 26) | 0);
  });
  return prefix + id;
}

function getAliasFromSocket(socketId: string) {
  return socketId.substr(0, socketId.indexOf("|"));
}

export function initializeOnWebSocketServer(wss: WebSocket.Server, log: (...message: any) => void) {
  const peers = new Map<string, WebSocket>();
  const hosts = new Map<string, Host>();

  wss.on("connection", function connection(ws, req) {
    const alias = generateId("P");

    log(`Connecting ${alias}`);

    peers.set(alias, ws);

    ws.on("message", (data: Buffer | string) => {
      if (typeof data === "string") {
        ws.close();
        return;
      }

      const message = proto.BrokerMessage.deserializeBinary(data);

      if (message.hasWebrtcNegotiation()) {
        const request = message.getWebrtcNegotiation()!;

        const sourceAlias = getAliasFromSocket(request.getSender());
        const targetAlias = getAliasFromSocket(request.getReceiver());

        log(alias, `Negotiating ${request.getRtcType()}: ${request.getSender()} -> ${request.getReceiver()}`);

        if (!sourceAlias || !targetAlias) {
          log(alias, `> error in source or target aliases`);
          return;
        }

        if (sourceAlias !== alias) {
          log(alias, `> source alias does not match ${sourceAlias} != ${alias}`);
          return;
        }
        const peer = peers.get(targetAlias);

        if (peer) {
          peer.send(data);
          log(alias, `> Sent!`);
        } else {
          log(alias, `> unknown peer`);
          return;
        }
      } else if (message.hasServerSyn()) {
        const request = message.getServerSyn()!;
        log(alias, `SYN ${request.getSender()} ${request.getServerAlias()}`);

        const sourceAlias = getAliasFromSocket(request.getSender());

        if (!sourceAlias || sourceAlias !== alias) {
          log(alias, `> Bad source alias "${sourceAlias}"`);
          return;
        }

        const serverAlias = request.getServerAlias();
        const host = hosts.get(serverAlias);

        if (host) {
          const brokerMessage = new proto.BrokerMessage();
          brokerMessage.setServerSyn(request);
          host.ws.send(brokerMessage.serializeBinary());
          log(alias, `> Sent`);
        } else {
          log(alias, `> Unknown host`);
        }
      } else if (message.hasServerSynAck()) {
        const request = message.getServerSynAck()!;
        log(alias, `SYNACK ${request.getSender()} ${request.getReceiver()}`);

        const sourceAlias = getAliasFromSocket(request.getSender());

        if (!sourceAlias || sourceAlias !== alias) {
          log(alias, `> Bad source alias "${sourceAlias}"`);
          return;
        }

        const targetAlias = getAliasFromSocket(request.getReceiver());

        if (!targetAlias) {
          log(alias, `> Bad target alias "${sourceAlias}"`);
          return;
        }
        const peer = peers.get(targetAlias);
        if (peer) {
          const brokerMessage = new proto.BrokerMessage();
          brokerMessage.setServerSynAck(request);
          peer.send(brokerMessage.serializeBinary());
          log(alias, `> Sent`);
        } else {
          log(alias, `> Unknown peer "${targetAlias}"`);
        }
      } else if (message.hasCreateServerRequest()) {
        const request = message.getCreateServerRequest()!;
        const serverData = request.getData();

        log(alias, `Creating server`);

        if (!serverData) {
          ws.close();
          log(alias, `> Missing server data`);
          return;
        }

        if (hosts.has(alias)) {
          log(alias, `> Already created`);
          return;
        }

        const responseMessage = new proto.BrokerMessage();
        const response = new proto.CreateServerResponse();
        responseMessage.setCreateServerResponse(response);
        response.setAlias(alias);

        serverData.setAlias(alias);

        hosts.set(alias, {
          clients: new Set(),
          data: serverData,
          ws
        });

        ws.send(responseMessage.serializeBinary());
        log(alias, `> Success!`);
      } else if (message.hasServerListRequest()) {
        const responseMessage = new proto.BrokerMessage();
        const serverList = new proto.ServerList();
        responseMessage.setServerListResponse(serverList);

        hosts.forEach(host => {
          serverList.addServers(host.data);
        });

        ws.send(responseMessage.serializeBinary());

        log(alias, `Sending server list`);
      } else if (message.hasPing()) {
        log(alias, `PING`);
        const response = new proto.BrokerMessage();

        response.setPong(new proto.Header());

        ws.send(response.serializeBinary());
      }
    });

    setTimeout(() => {
      const message = new proto.BrokerMessage();
      const welcome = new proto.WelcomeMessage();
      message.setWelcome(welcome);
      welcome.setAlias(alias);

      ws.send(message.serializeBinary());
    }, 16);

    ws.on("close", () => {
      peers.delete(alias);
      hosts.delete(alias);
      log(`Disconnected: ${alias}`);
    });
  });

  return { hosts, peers };
}
