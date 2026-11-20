import { test } from "node:test";
import assert from "node:assert/strict";
import { browserRecognition, streamingRecognition } from "../src/lib/voice";

test("microphone tracks close on socket startup failure and cancellation cannot restart capture", async () => {
  const names = ["navigator", "location", "window", "WebSocket", "AudioContext"];
  const before = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const set = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  let stops = 0, ends = 0, errors = 0, closes = 0;
  const startup: string[] = [];
  const stream = { getTracks: () => [{ stop: () => stops++ }] };
  try {
    set("AudioContext", class {
      state = "running";
      constructor() { startup.push("context"); }
      async resume() { startup.push("resume"); }
      async close() { this.state = "closed"; closes++; }
    });
    set("navigator", { mediaDevices: { getUserMedia: async () => { startup.push("permission"); return stream; } } });
    set("location", { protocol: "https:", host: "shop.example" });
    set("window", { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) });
    set("WebSocket", class { constructor() { throw new Error("Private constructor details"); } });
    await assert.rejects(() => streamingRecognition("hi-IN", () => {}, () => ends++, () => errors++, () => {}), /Could not start the voice connection/);
    assert.equal(stops, 1);
    assert.equal(closes, 1);
    assert.deepEqual(startup, ["context", "resume", "permission"], "Audio must unlock before the first permission/network await");

    let instance: Socket | undefined;
    class Socket {
      static OPEN = 1;
      readyState = 0;
      onmessage: ((event: { data: string }) => unknown) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() { instance = this; }
      close() {
        this.readyState = 3;
        this.onclose?.();
        this.onerror?.(); // Browsers can emit an error when cancelling CONNECTING.
      }
      send() { assert.fail("A cancelled startup must not send a commit or audio"); }
    }
    set("WebSocket", Socket);
    const handle = await streamingRecognition("ur-IN", () => assert.fail("No transcript after cancellation"), () => ends++, () => errors++, () => {});
    handle.stop();
    assert.equal(stops, 2);
    assert.equal(closes, 2);
    assert.equal(ends, 1);

    set("navigator", { mediaDevices: { getUserMedia: async () => { throw new Error("Permission denied"); } } });
    await assert.rejects(() => streamingRecognition("hi-IN", () => {}, () => {}, () => {}, () => {}), /Permission denied/);
    assert.equal(closes, 3, "Permission denial must release the pre-unlocked audio context");
    assert.equal(errors, 0);
    await instance?.onmessage?.({ data: JSON.stringify({ type: "connected" }) });
    handle.stop();
    assert.equal(stops, 2);
    assert.equal(ends, 1);
  } finally {
    for (const [name, descriptor] of before) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("speech stalls report missing frames, muted input, provider silence, and missing final results", async () => {
  const names = ["navigator", "location", "window", "WebSocket", "AudioContext", "AudioWorkletNode", "clearTimeout"];
  const before = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const set = (name: string, value: unknown) => Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  const timers = new Map<number,{fn:()=>void;ms:number}>();
  let next = 0, socket: Socket, node: Node;
  const errors: string[] = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    onmessage: ((event:{data:string})=>Promise<void>) | null = null;
    onclose: (()=>void) | null = null;
    constructor() { socket = this; }
    close() { this.readyState = 3; this.onclose?.(); }
    send() {}
  }
  class Node {
    port: {onmessage:((event:{data:{pcm:ArrayBuffer;level:number}})=>void)|null} = {onmessage:null};
    constructor() { node = this; }
    connect() {}
    disconnect() {}
  }
  const fire = (ms:number) => {
    const row = [...timers].find(([,timer])=>timer.ms===ms);
    assert.ok(row,`Expected ${ms}ms timeout`);
    timers.delete(row[0]); row[1].fn();
  };
  try {
    set("navigator", {mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
    set("location",{protocol:"https:",host:"shop.example"});
    set("window",{setTimeout:(fn:()=>void,ms:number)=>{timers.set(++next,{fn,ms});return next;}});
    set("clearTimeout",(id:number)=>timers.delete(id));
    set("WebSocket",Socket);
    set("AudioContext",class {
      state="running"; destination={};
      audioWorklet={async addModule(){}};
      async resume(){} async close(){this.state="closed";}
      createMediaStreamSource(){return {connect(){},disconnect(){}};}
    });
    set("AudioWorkletNode",Node);
    const start = async () => {
      const handle=await streamingRecognition("en-IN",()=>{},()=>{},message=>errors.push(message),()=>{});
      await socket!.onmessage!({data:'{"type":"connected"}'});
      return handle;
    };
    await start(); fire(20000); assert.match(errors.pop()!,/not sending microphone audio/); assert.equal(timers.size,0);
    await start(); node!.port.onmessage!({data:{pcm:new ArrayBuffer(1024),level:0}});
    fire(20000); assert.match(errors.pop()!,/no audible voice/);
    await start(); node!.port.onmessage!({data:{pcm:new ArrayBuffer(1024),level:0.1}});
    fire(20000); assert.match(errors.pop()!,/no words were returned/);
    const handle=await start(); handle.stop(); fire(12000); assert.match(errors.pop()!,/not sending microphone audio/);
    await start(); socket!.close(); assert.match(errors.pop()!,/closed without recognizing/);
    await start(); await socket!.onmessage!({data:'{"type":"interim","text":"Ravi"}'});
    fire(20000); assert.equal(errors.length,0);
    fire(60000); assert.match(errors.pop()!,/did not finish/); assert.equal(timers.size,0);
    assert.equal(errors.length,0,"Cleanup must not produce duplicate socket errors");
    let recognition: {onend:()=>void};
    set("window",{SpeechRecognition:class {constructor(){recognition=this as unknown as typeof recognition;}start(){}stop(){} }});
    browserRecognition("en-IN",()=>{},()=>{},message=>errors.push(message));
    recognition!.onend(); assert.match(errors.pop()!,/No speech was recognized/);
  } finally {
    for(const [name,descriptor] of before) {
      if(descriptor) Object.defineProperty(globalThis,name,descriptor);
      else Reflect.deleteProperty(globalThis,name);
    }
  }
});

test("streaming readiness waits for running capture and startup cancellation releases audio", async () => {
  const names = ["navigator", "location", "window", "WebSocket", "AudioContext", "AudioWorkletNode"];
  const before = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const set = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  let moduleReady: () => void = () => {};
  let timeout: () => void = () => {};
  let ready = 0, stops = 0, closes = 0, errors = 0, connections = 0;
  let socket: Socket;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    onmessage: ((event: { data: string }) => Promise<void>) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { socket = this; }
    close() { this.readyState = 3; this.onclose?.(); }
    send() {}
  }
  try {
    set("navigator", { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => stops++ }] }) } });
    set("location", { protocol: "https:", host: "shop.example" });
    set("window", { setTimeout: (fn: () => void) => { timeout = fn; return 0; } });
    set("WebSocket", Socket);
    set("AudioContext", class {
      state = "running";
      destination = {};
      audioWorklet = { addModule: () => new Promise<void>((resolve) => { moduleReady = resolve; }) };
      async resume() {}
      async close() { this.state = "closed"; closes++; }
      createMediaStreamSource() { return { connect() { connections++; }, disconnect() {} }; }
    });
    set("AudioWorkletNode", class {
      port = { onmessage: null };
      connect() { connections++; }
      disconnect() {}
    });
    const start = () => streamingRecognition("en-IN", () => {}, () => {}, () => errors++, () => {}, () => ready++);
    const handle = await start();
    assert.equal(ready, 0);
    const connecting = socket!.onmessage!({ data: '{"type":"connected"}' });
    assert.equal(ready, 0, "Provider connection alone must not announce microphone readiness");
    moduleReady();
    await connecting;
    assert.equal(ready, 1);
    assert.equal(connections, 2);
    handle.stop();
    await socket!.onmessage!({ data: '{"type":"transcript","text":"Ravi 200 credit"}' });
    assert.equal(closes, 1);
    assert.equal(errors, 0);

    await start();
    const pending = socket!.onmessage!({ data: '{"type":"connected"}' });
    timeout();
    moduleReady();
    await pending;
    assert.equal(ready, 1, "Timed-out worklet startup must not become ready later");
    assert.equal(errors, 1);
    assert.equal(closes, 2);
    assert.ok(stops >= 2);
  } finally {
    for (const [name, descriptor] of before) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
