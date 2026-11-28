import { Mp3Encoder } from '@breezystack/lamejs';

let encoder: Mp3Encoder;
const packets: BlobPart[] = [];
self.onmessage = ({ data }: MessageEvent<{ rate: number; left?: Float32Array; right?: Float32Array }>) => {
  encoder ??= new Mp3Encoder(2, data.rate, 160);
  if (data.left && data.right) {
    const pcm = (samples: Float32Array) => Int16Array.from(samples, v =>
      Math.round(Math.max(-1, Math.min(1, v)) * (v < 0 ? 32768 : 32767)));
    const bytes = encoder.encodeBuffer(pcm(data.left), pcm(data.right));
    if (bytes.length) packets.push(new Uint8Array(bytes));
    self.postMessage(null);
  } else {
    packets.push(new Uint8Array(encoder.flush()));
    self.postMessage(new Blob(packets, {type:'audio/mpeg'}));
  }
};
