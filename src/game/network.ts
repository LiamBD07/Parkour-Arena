import { COURSES, type PeerState } from '../../shared/game';
import { POSES } from '../../shared/movement';
export interface Member {
  id: string;
  name: string;
  skin: string;
  classId: string;
  mmr: number;
  bot: boolean;
}
export interface Match {
  room: string;
  map: string;
  members: Member[];
  startsAt: number;
}
interface Callbacks {
  onQueue: (waiting: number, wait: number) => void;
  onMatch: (match: Match) => void;
  onState: (state: PeerState) => void;
  onDisconnect: (id: string) => void;
  onError: (error: string) => void;
}
interface Peer {
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
  pending: RTCIceCandidateInit[];
}
export class ArenaNetwork {
  private socket: WebSocket;
  private peers = new Map<string, Peer>();
  id = '';
  private closed = false;
  constructor(
    map: string,
    classId: string,
    private stun: string,
    private callbacks: Callbacks,
    private token?: string,
  ) {
    this.socket = new WebSocket(
      `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/arena`,
    );
    this.socket.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'hello') {
          this.id = msg.id;
          this.send({
            type: 'join',
            map,
            courseVersion: COURSES.find((c) => c.id === map)!.version,
            classId,
            region: Intl.DateTimeFormat().resolvedOptions().timeZone.split('/')[0] || 'unknown',
            token: this.token,
          });
        }
        if (msg.type === 'queued') callbacks.onQueue(msg.waiting, msg.wait);
        if (msg.type === 'matched') {
          for (const member of msg.members as Member[])
            if (!member.bot && member.id !== this.id) this.makePeer(member.id);
          callbacks.onMatch(msg);
        }
        if (msg.type === 'signal') await this.receiveSignal(msg.from, msg.data);
        if (msg.type === 'state') this.receiveState(msg);
        if (msg.type === 'disconnected') {
          this.peers.get(msg.id)?.pc.close();
          this.peers.delete(msg.id);
          callbacks.onDisconnect(msg.id);
        }
        if (msg.type === 'error') callbacks.onError(msg.error);
      } catch {
        /* Ignore malformed remote state; the WebSocket fallback remains usable. */
      }
    };
    this.socket.onerror = () =>
      callbacks.onError('Arena connection failed. Solo practice is still available.');
    this.socket.onclose = () => {
      if (!this.closed)
        callbacks.onError('Arena disconnected. Connected rivals will be replaced by bots.');
    };
  }
  private send(data: unknown) {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(data));
  }
  private receiveState(state: PeerState) {
    if (
      !state ||
      typeof state.id !== 'string' ||
      !Array.isArray(state.p) ||
      state.p.length !== 3 ||
      !state.p.every((v) => Number.isFinite(v) && Math.abs(v) < 300) ||
      Math.abs(state.p[0]) > 70 ||
      state.p[1] < -20 ||
      state.p[1] > 45 ||
      state.p[2] < -20 ||
      state.p[2] > 240 ||
      !Number.isFinite(state.yaw) ||
      Math.abs(state.yaw) > 100 ||
      !Number.isFinite(state.progress) ||
      state.progress < 0 ||
      state.progress > 1 ||
      !POSES.includes(state.pose) ||
      (state.phase !== undefined &&
        (!Number.isFinite(state.phase) || state.phase < 0 || state.phase > 1)) ||
      (state.wallSide !== undefined &&
        (!Number.isFinite(state.wallSide) || Math.abs(state.wallSide) > 1))
    )
      return;
    this.callbacks.onState(state);
  }
  private makePeer(id: string) {
    if (this.peers.has(id) || !('RTCPeerConnection' in window)) return;
    try {
      const pc = new RTCPeerConnection({ iceServers: this.stun ? [{ urls: this.stun }] : [] });
      const peer: Peer = { pc, pending: [] };
      this.peers.set(id, peer);
      const attach = (channel: RTCDataChannel) => {
        peer.channel = channel;
        channel.onmessage = (event) => {
          try {
            this.receiveState({ ...JSON.parse(event.data), id });
          } catch {
            /* Ignore malformed peer packets. */
          }
        };
      };
      pc.onicecandidate = (event) => {
        if (event.candidate)
          this.send({ type: 'signal', to: id, data: { candidate: event.candidate.toJSON() } });
      };
      pc.ondatachannel = (event) => attach(event.channel);
      if (this.id < id) {
        attach(pc.createDataChannel('position', { ordered: false, maxRetransmits: 0 }));
        void (async () => {
          await pc.setLocalDescription(await pc.createOffer());
          this.send({ type: 'signal', to: id, data: { description: pc.localDescription } });
        })().catch(() => {});
      }
    } catch {
      /* WebSocket relay covers unsupported or blocked WebRTC. */
    }
  }
  private async receiveSignal(
    id: string,
    signal: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit },
  ) {
    this.makePeer(id);
    const peer = this.peers.get(id);
    if (!peer) return;
    try {
      if (signal.description) {
        await peer.pc.setRemoteDescription(signal.description);
        for (const c of peer.pending) await peer.pc.addIceCandidate(c);
        peer.pending = [];
        if (signal.description.type === 'offer') {
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          this.send({ type: 'signal', to: id, data: { description: peer.pc.localDescription } });
        }
      }
      if (signal.candidate) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(signal.candidate);
        else peer.pending.push(signal.candidate);
      }
    } catch {
      /* A failed ICE negotiation falls back to the existing server relay. */
    }
  }
  sendState(state: Omit<PeerState, 'id'>) {
    let needsRelay = false;
    for (const peer of this.peers.values()) {
      if (peer.channel?.readyState === 'open' && peer.channel.bufferedAmount < 20000)
        peer.channel.send(JSON.stringify(state));
      else needsRelay = true;
    }
    if (needsRelay || state.finished) this.send({ ...state, type: 'state' });
  }
  close() {
    this.closed = true;
    this.send({ type: 'leave' });
    this.socket.close();
    for (const peer of this.peers.values()) peer.pc.close();
    this.peers.clear();
  }
}
