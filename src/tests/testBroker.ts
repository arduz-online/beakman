declare var  it: any;

import { BaseBroker, ISocket } from "../BaseBroker";
import { RtcSocket } from "../RtcSocket";

export function testWebRtc(broker: BaseBroker) {
  const openSockets: ISocket[] = [];

  it("broker gets connected", async () => {
    await broker.connectedFuture;
  });

  it("test two connections", async () => {
    const connectionA = broker.options.socketBuilder(broker) as RtcSocket;
    const connectionB = broker.options.socketBuilder(broker)as RtcSocket;
    openSockets.push(connectionA, connectionB);

    connectionA.onDataObservable.add($ => console.log("A received ", $));
    connectionB.onDataObservable.add($ => console.log("B received ", $));

    console.log("A", connectionA.socketId);
    console.log("B", connectionB.socketId);

    connectionA.log = (...args) => console.log("A", ...args)
    connectionB.log = (...args) => console.log("B", ...args)

    await connectionA.connect(connectionB.socketId);

    await connectionA.awaitableConnected;
    await connectionB.awaitableConnected;

    connectionA.send("Hi B", true);
    connectionB.send("Hi A", true);
  });

  it("check it doesn't appear in server lists", async () => {
    const list1 = await broker.requestServerList();

    if (list1.getServersList().some($ => $.getAlias() === broker.alias)) throw new Error("Should not be listening");
  });

  it("start listening", async () => {
    await broker.listen({}, connection => {
      openSockets.push(connection);

      (connection as RtcSocket).log = (...args) => console.log(connection.socketId, ...args);

      connection.onDataObservable.add(m => console.log("host1:" + connection.socketId, ">", m));
    });
  });

  it("check it does appear in server lists", async () => {
    const list2 = await broker.requestServerList();

    if (!list2.getServersList().some($ => $.getAlias() === broker.alias)) throw new Error("Should be listening");
  });

  it("establish connections to broker", async () => {
    const connectionA = await broker.connect(broker.alias!) as RtcSocket;
    const connectionB = await broker.connect(broker.alias!) as RtcSocket;

    connectionA.log = (...args) => console.log("A", ...args)
    connectionB.log = (...args) => console.log("B", ...args)

    await connectionA.awaitableConnected;
    await connectionB.awaitableConnected;

    connectionA.send("hellon", true);
    connectionB.send("hellow", true);

    openSockets.push(connectionA, connectionB);
  });

  it("closes everything", async () => {
    openSockets.forEach($ => $.close());
  });
}
