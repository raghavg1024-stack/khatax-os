/** Finish unknown-length WAV headers after buffering a provider's streamed response. */
export function finalizeWav(audio: ArrayBuffer): ArrayBuffer {
  const view = new DataView(audio);
  const tag = (offset: number) =>
    new TextDecoder().decode(new Uint8Array(audio, offset, 4));
  if (audio.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE")
    throw new Error("Invalid WAV response");
  if (view.getUint32(4, true) === 0xffffffff)
    view.setUint32(4, audio.byteLength - 8, true);
  for (let offset = 12; offset + 8 <= audio.byteLength; ) {
    const size = view.getUint32(offset + 4, true),
      start = offset + 8;
    if (tag(offset) === "data") {
      if (size === 0xffffffff)
        view.setUint32(offset + 4, audio.byteLength - start, true);
      else if (size > audio.byteLength - start)
        throw new Error("Truncated WAV response");
      return audio;
    }
    if (size > audio.byteLength - start)
      throw new Error("Truncated WAV response");
    offset = start + size + (size % 2);
  }
  throw new Error("WAV response has no audio data");
}
