/**
 * Browser voice client.
 *
 * mic ──AudioWorklet──▶ PCM16 @ 24 kHz ──ws(binary)──▶ relay ──▶ xAI
 * speaker ◀──scheduled AudioBuffer queue◀──ws(binary)◀── relay ◀──
 *
 * Two things matter here and both are easy to get wrong:
 *
 * 1. **Resampling.** getUserMedia gives you the hardware rate (usually 48 kHz).
 *    The API wants 24 kHz. We run the AudioContext at 24 kHz and let the browser
 *    resample on the way in — far better than doing it by hand in JS.
 *
 * 2. **Playback scheduling.** Audio arrives as ~20ms chunks. Playing each on
 *    arrival produces clicks and drift. Instead each chunk is scheduled against a
 *    running cursor, so they butt up sample-accurately.
 */

const SAMPLE_RATE = 24_000;

/** Inline worklet — avoids a second file fetch and keeps the contract in one place. */
const WORKLET_SRC = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      // Float32 [-1,1] -> PCM16 little-endian.
      const samples = input[0];
      const pcm = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}
registerProcessor('capture', Capture);
`;

export class VoiceSession {
  constructor({ profileId, memo, onNotice }) {
    this.profileId = profileId;
    this.memo = memo ?? null;
    this.onNotice = onNotice ?? (() => {});
    this.socket = null;
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.playCursor = 0;
    this.playing = false;
    this.muted = false;
  }

  async start() {
    // Mic first — a permission denial should happen before we open a socket.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    await this.ctx.audioWorklet.addModule(
      URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' })),
    );

    const url = new URL('/voice', location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('profile', this.profileId);

    this.socket = new WebSocket(url);
    this.socket.binaryType = 'arraybuffer';

    this.socket.onopen = () => {
      this.socket.send(JSON.stringify({ type: 'start', memo: this.memo }));
      this.#startCapture();
    };

    this.socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.#enqueueAudio(event.data);
        return;
      }
      try {
        const notice = JSON.parse(event.data);
        if (notice.__relay) this.onNotice(notice);
      } catch {
        /* ignore */
      }
    };

    this.socket.onerror = () => this.onNotice({ kind: 'error', message: 'connection failed' });
    this.socket.onclose = (event) =>
      this.onNotice({
        kind: 'status',
        state: 'closed',
        detail: event.reason || `code ${event.code}`,
      });

    // The AudioContext can be suspended by the browser (tab backgrounded, OS
    // audio change). The session then looks alive but hears and says nothing —
    // indistinguishable from "it stopped" unless we say so.
    this.ctx.onstatechange = () => {
      if (this.ctx?.state === 'suspended') {
        this.onNotice({ kind: 'error', message: 'audio suspended — click the page to resume' });
        void this.ctx.resume();
      }
    };
  }

  #startCapture() {
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'capture');
    this.node.port.onmessage = (event) => {
      if (this.muted) return;
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(event.data);
    };
    source.connect(this.node);
    // Worklets need a sink to be pulled; a zero-gain node keeps it running
    // without echoing the mic to the speakers.
    const silent = this.ctx.createGain();
    silent.gain.value = 0;
    this.node.connect(silent).connect(this.ctx.destination);
  }

  /**
   * Schedule a chunk against a running cursor.
   *
   * The cursor never goes backwards, so chunks butt up sample-accurately. If we
   * fall behind (tab throttled, network hiccup) the cursor is nudged forward to
   * `currentTime` rather than trying to catch up — a small gap beats a
   * cascading pile-up of late buffers.
   */
  #enqueueAudio(arrayBuffer) {
    const pcm = new Int16Array(arrayBuffer);
    if (pcm.length === 0) return;

    const buffer = this.ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);

    const now = this.ctx.currentTime;
    if (this.playCursor < now) this.playCursor = now + 0.02;
    source.start(this.playCursor);
    this.playCursor += buffer.duration;

    this.playing = true;
    source.onended = () => {
      if (this.ctx && this.playCursor <= this.ctx.currentTime + 0.05) {
        this.playing = false;
        this.onNotice({ kind: 'speaking', active: false });
      }
    };
    this.onNotice({ kind: 'speaking', active: true });
  }

  /** Barge-in: stop the investor talking and drop anything queued. */
  interrupt() {
    this.socket?.send(JSON.stringify({ type: 'interrupt' }));
    this.playCursor = this.ctx?.currentTime ?? 0;
  }

  setMuted(muted) {
    this.muted = muted;
  }

  stop() {
    try { this.socket?.close(); } catch { /* ignore */ }
    try { this.node?.disconnect(); } catch { /* ignore */ }
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    try { this.ctx?.close(); } catch { /* ignore */ }
    this.socket = null;
    this.ctx = null;
    this.stream = null;
  }
}
