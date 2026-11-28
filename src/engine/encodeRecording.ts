// Transfer one second of stereo PCM at a time rather than duplicating the entire take.
export function encodeRecording(audio: AudioBuffer): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./mp3.worker.ts', import.meta.url), {type:'module'});
    let offset = 0;
    function send() {
      if (offset >= audio.length) {
        worker.postMessage({rate:audio.sampleRate});
        return;
      }
      const length = Math.min(audio.sampleRate, audio.length - offset);
      const left = new Float32Array(length), right = new Float32Array(length);
      audio.copyFromChannel(left, 0, offset);
      audio.copyFromChannel(right, 1, offset);
      offset += length;
      worker.postMessage({rate:audio.sampleRate, left, right}, [left.buffer, right.buffer]);
    }
    worker.onerror = e => { worker.terminate(); reject(new Error(e.message)); };
    worker.onmessage = e => {
      if (e.data instanceof Blob) { worker.terminate(); resolve(e.data); }
      else send();
    };
    send();
  });
}
