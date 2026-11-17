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
  recognition.onresult = (e) => {
    let text = "";
    let final = false;
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
      final ||= e.results[i].isFinal;
    }
    onText(text, final);
  };
  recognition.onerror = (e) =>
    onError(
      e.error === "not-allowed"
        ? "Microphone access was denied. Allow it in browser settings or type your command."
        : `Browser speech could not start (${e.error}). You can type instead.`,
    );
  recognition.onend = onEnd;
  recognition.start();
  return { stop: () => recognition.stop() };
}
export async function streamingRecognition(
  language: string,
  onText: (text: string, final: boolean) => void,
  onEnd: () => void,
  onError: (message: string) => void,
  onLevel: (level: number) => void,
): Promise<VoiceHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  let context: AudioContext | undefined;
  let node: AudioWorkletNode | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let ended = false;
  let socket: WebSocket;
  try {
    socket = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/voice?language=${encodeURIComponent(language)}`,
    );
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Could not start the voice connection. Retry or type your command.");
  }
  let timer: number | undefined;
  let stopTimer: number | undefined;
  const cleanup = () => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    clearTimeout(stopTimer);
    stream.getTracks().forEach((t) => t.stop());
    node?.disconnect();
    source?.disconnect();
    if (context && context.state !== "closed") void context.close().catch(() => {});
    if (socket.readyState < 2) socket.close();
    onEnd();
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
        clearTimeout(timer);
        context = new AudioContext();
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
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(e.data.pcm);
            onLevel(e.data.level);
          }
        };
        source.connect(node);
        node.connect(context.destination);
        await context.resume();
      }
      if (msg.type === "transcript" && msg.text) {
        onText(msg.text, true);
        cleanup();
      }
      if (msg.type === "interim" && typeof msg.text === "string")
        onText(msg.text, false);
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
    clearTimeout(timer);
    cleanup();
  };
  return {
    stop: () => {
      if (ended) return;
      // A cancelled permission/connection startup must not later open the mic.
      if (!node || socket.readyState !== WebSocket.OPEN) {
        cleanup();
        return;
      }
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "commit" }));
      stream.getTracks().forEach((t) => t.stop());
      node?.disconnect();
      source?.disconnect();
      stopTimer = window.setTimeout(cleanup, 12000);
    },
  };
}

// Compatibility for callers migrating from the original single-provider client.
export const gnaniRecognition = streamingRecognition;
