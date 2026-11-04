// [INPUT]: an RTCPeerConnection-shaped object (iceGatheringState + onicecandidate + onicegatheringstatechange).
// [OUTPUT]: waitForUsableOffer(pc, options) → a promise that settles when the offer is worth sending.
// [POS]: The non-trickle offer is sent once gathering is "good enough": complete, or `graceMs` after the first
//        server-reflexive candidate (a relayed one usually lands within that), or `timeoutMs` as the ceiling.
//        Waiting for a dead STUN/TURN server to time out used to hold every P2P attempt for the whole
//        ceiling. Candidate text is only inspected for its type; it is never stored or logged.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
export interface GatheringPeer {
  iceGatheringState: string;
  onicecandidate: ((event: { candidate: { candidate: string } | null }) => void) | null;
  onicegatheringstatechange: (() => void) | null;
}

export function waitForUsableOffer(
  pc: GatheringPeer,
  { timeoutMs, graceMs }: { timeoutMs: number; graceMs: number },
): Promise<void> {
  // Hermes has no Promise.withResolvers.
  return new Promise<void>((resolve) => {
    let grace: ReturnType<typeof setTimeout> | undefined;
    const ceiling = setTimeout(finish, timeoutMs); // half-gathered is still usable
    function finish() {
      clearTimeout(ceiling);
      clearTimeout(grace);
      resolve();
    }
    pc.onicecandidate = (event) => {
      if (event.candidate === null) return finish();
      if (grace === undefined && event.candidate.candidate.includes(' typ srflx')) grace = setTimeout(finish, graceMs);
    };
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
  });
}
