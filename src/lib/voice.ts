type RecognitionResult = {
  isFinal: boolean;
  0: { transcript: string };
  length: number;
};
type BrowserRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<RecognitionResult>;
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
export type VoiceHandle = { stop: () => void };
export function browserRecognition(
  language: string,
  onText: (text: string, final: boolean) => void,
  onEnd: () => void,
  onError: (message: string) => void,
): VoiceHandle {
  const win = window as unknown as {
    SpeechRecognition?: new () => BrowserRecognition;
    webkitSpeechRecognition?: new () => BrowserRecognition;
  };
  const Recognition = win.SpeechRecognition || win.webkitSpeechRecognition;
  if (!Recognition)
    throw new Error(
      "Browser speech is unavailable here. Use Chrome or Edge, or type your command below.",
    );
  const recognition = new Recognition();
  recognition.lang = language;
  recognition.interimResults = true;
  recognition.continuous = false;
  let hasFinal = false, failed = false;
  recognition.onresult = (e) => {
    let text = "";
    let final = false;
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
      final ||= e.results[i].isFinal;
    }
    if (final && text.trim()) hasFinal = true;
    onText(text, final);
  };
  recognition.onerror = (e) => {
    failed = true;
    onError(
      e.error === "not-allowed"
        ? "Microphone access was denied. Allow it in browser settings or type your command."
        : `Browser speech could not start (${e.error}). You can type instead.`,
    );
  };
  recognition.onend = () => {
    if (!hasFinal && !failed)
      onError("No speech was recognized. Check your selected microphone and language, then retry or type your command.");
    onEnd();
  };
  recognition.start();
  return { stop: () => recognition.stop() };
}
export async function streamingRecognition(
  language: string,
  onText: (text: string, final: boolean) => void,
  onEnd: () => void,
  onError: (message: string) => void,
  onLevel: (level: number) => void,
  onReady?: () => void,
  recovery: { fileRecovery?: boolean; onRecover?: () => void; onLanguage?: (code: string) => void } = {},
): Promise<VoiceHandle> {
  // Unlock audio in the mic button's user gesture, before permission/network awaits.
  // Mobile browsers can leave a context created in a WebSocket callback suspended.
  const context = new AudioContext();
  const resumed = context.resume().then(() => true, () => false);
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (error) {
    void context.close().catch(() => {});
    throw error;
  }
  let node: AudioWorkletNode | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let ended = false;
  let stopping = false, hasFinal = false, hasText = false, frames = 0, peak = 0;
  let recovering = false;
  let recoveryAbort: AbortController | undefined;
  const captured: ArrayBuffer[] = [];
  let socket: WebSocket;
  try {
    socket = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/voice?language=${encodeURIComponent(language)}`,
    );
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    void context.close().catch(() => {});
    throw new Error("Could not start the voice connection. Retry or type your command.");
  }
  let timer: number | undefined;
  let stopTimer: number | undefined;
  let sessionTimer: number | undefined;
  const cleanup = () => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    clearTimeout(stopTimer);
    clearTimeout(sessionTimer);
    recoveryAbort?.abort();
    stream.getTracks().forEach((t) => t.stop());
    node?.disconnect();
    source?.disconnect();
    if (context.state !== "closed") void context.close().catch(() => {});
    if (socket.readyState < 2) socket.close();
    onEnd();
  };
  const fail = (message: string) => {
    if (ended) return;
    onError(message);
    cleanup();
  };
  const noSpeechMessage = () => frames === 0
    ? "Your browser is not sending microphone audio. Check microphone permission and the selected input device, or try Chrome or Edge."
    : peak < 0.003
      ? "The microphone is connected but no audible voice was detected. Unmute it and select the correct microphone in browser settings."
      : "Microphone audio is reaching recognition, but no words were returned. Select your spoken language and retry, or switch speech mode.";
  const recover = async () => {
    if (ended || recovering) return;
    if (!recovery.fileRecovery || !frames || frames > 875 || peak < 0.003) {
      fail(noSpeechMessage());
      return;
    }
    recovering = true;
    stopping = true;
    clearTimeout(timer);
    clearTimeout(stopTimer);
    clearTimeout(sessionTimer);
    stream.getTracks().forEach(t => t.stop());
    node?.disconnect();
    source?.disconnect();
    if (socket.readyState < 2) socket.close();
    recovery.onRecover?.();
    recoveryAbort = new AbortController();
    stopTimer = window.setTimeout(() => recoveryAbort?.abort(), 30000);
    try {
      const bytes = captured.reduce((total, frame) => total + frame.byteLength, 0);
      const wav = new Uint8Array(44 + bytes);
      const view = new DataView(wav.buffer);
      const label = (offset: number, value: string) => [...value].forEach((c,i) => view.setUint8(offset+i,c.charCodeAt(0)));
      label(0,"RIFF"); view.setUint32(4,36+bytes,true); label(8,"WAVE"); label(12,"fmt ");
      view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
      view.setUint32(24,16000,true); view.setUint32(28,32000,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
      label(36,"data"); view.setUint32(40,bytes,true);
      let offset = 44;
      for (const frame of captured) { wav.set(new Uint8Array(frame),offset); offset += frame.byteLength; }
      const response = await fetch(`/api/transcribe?language=${encodeURIComponent(language)}`, {
        method:"POST", headers:{"Content-Type":"audio/wav"}, body:wav, signal:recoveryAbort.signal,
      });
      const result = await response.json();
      if (ended) return;
      if (!response.ok || typeof result.text !== "string" || !result.text.trim())
        throw new Error(result.error || "Speech-to-text returned no words. Check the microphone and retry.");
      hasFinal = true;
      if (typeof result.language === "string") recovery.onLanguage?.(result.language);
      onText(result.text.trim(),true);
      cleanup();
    } catch (error) {
      if (!ended) fail(error instanceof Error && error.name !== "AbortError" ? error.message : "Speech-to-text timed out. Please retry a shorter recording.");
    }
  };
  timer = window.setTimeout(() => {
    onError("Voice connection timed out. Try again or type your command.");
    cleanup();
  }, 18000);
  const worklet = `class PcmCapture extends AudioWorkletProcessor {constructor(){super();this.buffer=[];this.phase=0;}process(inputs){const audio=inputs[0]?.[0];if(!audio)return true;const ratio=sampleRate/16000;for(let i=0;i<audio.length;i++){this.phase+=1;if(this.phase>=ratio){this.phase-=ratio;this.buffer.push(Math.max(-1,Math.min(1,audio[i])));if(this.buffer.length===512){const data=new ArrayBuffer(1024);const view=new DataView(data);let energy=0;for(let j=0;j<512;j++){view.setInt16(j*2,Math.round(this.buffer[j]*32767),true);energy+=this.buffer[j]*this.buffer[j];}this.port.postMessage({pcm:data,level:Math.sqrt(energy/512)},[data]);this.buffer=[];}}}return true;}}registerProcessor('pcm-capture',PcmCapture);`;
  socket.onmessage = async (event) => {
    if (ended) return;
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "connected") {
        const blob = URL.createObjectURL(
          new Blob([worklet], { type: "application/javascript" }),
        );
        try {
          await context.audioWorklet.addModule(blob);
        } finally {
          URL.revokeObjectURL(blob);
        }
        if (ended) return;
        source = context.createMediaStreamSource(stream);
        node = new AudioWorkletNode(context, "pcm-capture");
        node.port.onmessage = (e) => {
          if (ended || stopping) return;
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(e.data.pcm);
            frames++;
            if (recovery.fileRecovery && captured.length < 875) captured.push(e.data.pcm.slice(0));
            peak = Math.max(peak, Number(e.data.level) || 0);
            onLevel(e.data.level);
          }
        };
        source.connect(node);
        node.connect(context.destination);
        if (!await resumed || context.state !== "running") throw new Error("Microphone audio could not start");
        if (ended) return;
        clearTimeout(timer);
        timer = window.setTimeout(() => {
          if (!hasText) void recover();
        }, 20000);
        sessionTimer = window.setTimeout(() => fail("Speech recognition did not finish. Record a shorter command, then press Stop listening."), 60000);
        onReady?.();
      }
      if (msg.type === "transcript" && msg.text) {
        hasFinal = true;
        if (typeof msg.language === "string") recovery.onLanguage?.(msg.language);
        onText(msg.text, true);
        cleanup();
      }
      if (msg.type === "interim" && typeof msg.text === "string") {
        if (msg.text.trim()) hasText = true;
        onText(msg.text, false);
      }
      if (msg.type === "error") {
        onError(msg.message || "Speech provider error.");
        cleanup();
      }
    } catch {
      onError("Could not process the microphone stream.");
      cleanup();
    }
  };
  socket.onerror = () => {
    if (ended) return;
    clearTimeout(timer);
    onError("Voice connection failed. Check the server and retry.");
    cleanup();
  };
  socket.onclose = () => {
    if (recovering) return;
    if (!ended && !hasFinal)
      return void recover();
    clearTimeout(timer);
    cleanup();
  };
  return {
    stop: () => {
      if (recovering) { cleanup(); return; }
      if (ended || stopping) return;
      // A cancelled permission/connection startup must not later open the mic.
      if (!node || socket.readyState !== WebSocket.OPEN) {
        cleanup();
        return;
      }
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "commit" }));
      stopping = true;
      clearTimeout(timer);
      clearTimeout(sessionTimer);
      stream.getTracks().forEach((t) => t.stop());
      node?.disconnect();
      source?.disconnect();
      stopTimer = window.setTimeout(() => void recover(), recovery.fileRecovery ? 3000 : 12000);
    },
  };
}

// Compatibility for callers migrating from the original single-provider client.
export const gnaniRecognition = streamingRecognition;
