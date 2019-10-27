import { BaseBroker } from "../BaseBroker";
import { MockBroker } from "../Mocks";

declare var describe: any, it: any;

export async function testWebRtc(broker: BaseBroker) {
  await broker.connectedFuture;

  console.log("Broker connected");

  const connectionA = broker.options.socketBuilder(broker);
  const connectionB = broker.options.socketBuilder(broker);

  connectionA.onDataObservable.add($ => console.log("A received ", $));
  connectionB.onDataObservable.add($ => console.log("B received ", $));

  console.log("A", connectionA.socketId);
  console.log("B", connectionB.socketId);

  await connectionA.connect(connectionB.socketId);

  await connectionA.awaitableConnected;
  await connectionB.awaitableConnected;

  connectionA.send("Hi B", true);
  connectionB.send("Hi A", true);

  const list1 = await broker.requestServerList();

  if (list1.getServersList().some($ => $.getAlias() === broker.alias)) throw new Error("Should not be listening");

  console.log("Listening?");

  await broker.listen(() => {
    const connection = broker.options.socketBuilder(broker);

    connection.onDataObservable.add(m => console.log("host1:" + connection.socketId, ">", m));

    return connection.socketId;
  });

  console.log("Listening OK");

  console.log("Appears in server list?");
  const list2 = await broker.requestServerList();

  if (!list2.getServersList().some($ => $.getAlias() === broker.alias)) throw new Error("Should be listening");

  console.log("Appears in server list OK");

  const connection1 = await broker.connect(broker.alias!);
  const connection2 = await broker.connect(broker.alias!);

  await connection1.awaitableConnected;
  await connection2.awaitableConnected;

  connection1.send("hellon", true);
  connection2.send("hellow", true);
}

describe("test", () => {
  it("e2e works with a mocked broker", async () => {
    const mockedBroker = new MockBroker(false);
    await testWebRtc(mockedBroker);
  });
});
