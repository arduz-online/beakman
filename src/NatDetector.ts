import { future } from "fp-future";
import { RtcSocket } from "./RtcSocket";

export enum NatType {
  Other = 0,
  SymmetricNAT = 1,
  NoNAT = -1 // No NAT (Open Internet, Blocked, Symmetric UDP Firewall)
}

const SLOW_ICE_TIMEOUT = 3000;

export async function detectNat(rtcConfiguration: RTCConfiguration): Promise<{ nat: NatType; timeout: boolean }> {
  const candidatePorts = new Map<number, Set<number>>();
  const candidates: RTCIceCandidate[] = [];
  const pc = new RTCPeerConnection(rtcConfiguration);
  const result = future<{ nat: NatType; timeout: boolean; candidates: RTCIceCandidate[] }>();

  const channel = pc.createDataChannel("foo");

  const start = performance.now();
  const endWithTimeout = start + SLOW_ICE_TIMEOUT;

  function finish() {
    if (candidatePorts.size === 1) {
      const ports = candidatePorts.values().next()!;

      if (ports.value.size === 1) {
        result.resolve({ nat: NatType.Other, timeout: performance.now() > endWithTimeout, candidates });
      } else {
        result.resolve({ nat: NatType.SymmetricNAT, timeout: performance.now() > endWithTimeout, candidates });
      }
    } else {
      result.resolve({ nat: NatType.NoNAT, timeout: performance.now() > endWithTimeout, candidates });
    }
  }

  pc.onicecandidate = function(e) {
    if (e.candidate) {
      candidates.push(e.candidate);
    }
    if (e.candidate && e.candidate.candidate.indexOf("srflx") !== -1) {
      const { candidate } = e;

      if (candidate.relatedPort !== null) {
        let set = candidatePorts.get(candidate.relatedPort);
        if (!set) {
          set = new Set();
          candidatePorts.set(candidate.relatedPort, set);
        }
        set.add(candidate.port!);
      }
    } else if (!e.candidate) {
      finish();
    }
  };

  pc.onicecandidateerror = err => {
    console.error("ICE Error", err);
  };

  setTimeout(() => {
    if (result.isPending) {
      finish();
    }
  }, SLOW_ICE_TIMEOUT * 1.1);

  const offer = await pc.createOffer({});
  await pc.setLocalDescription(offer);

  try {
    await result;
  } finally {
    pc.close();
    channel.close();
  }

  result.then($ => {
    if ($.timeout) {
      RtcSocket.slowIceResolutionDetected = true;
      console.info(
        `ICE Candidates gathering is slow. Tickle will be enabled for connections. Nat detection candidates:`,
        candidates
      );
    }
  });

  return result;
}