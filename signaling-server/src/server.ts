import http = require("http");
import WebSocket = require("ws");
import express = require("express");
import { initializeOnWebSocketServer } from ".";

const server = http.createServer();
const wss = new WebSocket.Server({ server: server });
const app = express();
const port = process.env.PORT || 3000;

server.on("request", app);

function log(...args: any[]) {
  console.log(...args);
}

const signaling = initializeOnWebSocketServer(wss, log);

app.get("/hosts", (_req, res) => {
  const ret: any[] = [];

  signaling.hosts.forEach((value) => {
    ret.push(value.data.toObject());
  });

  res.setHeader("content-type", "application/json");
  res.send({ data: ret });
});

server.listen(port, function() {
  const addr = server.address() as any;
  console.log("Listening " + addr.port);
});
