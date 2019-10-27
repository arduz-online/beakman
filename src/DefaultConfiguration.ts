// This configuration is passed when we create a new peer connection object.
// It provides a set of servers used to establish a connection. STUN servers
// are used to discover our external IP address, and TURN servers (none listed
// here) are used to proxy a connection when a peer is behind a restrictive
// firewall that prevents a direct connection.
export const peerConnectionConfig: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478?transport=udp" },
    {
      urls: ["stun:stun2.l.google.com:19302", "stun:stun3.l.google.com:19302", "stun:stun4.l.google.com:19302"]
    }
  ]
};
