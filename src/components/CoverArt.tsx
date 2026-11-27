import { useEffect, useRef } from 'react';

// Resolution-independent prints for the three editions and the featured keyboard.
export function CoverArt({
  edition,
}: {
  edition: 'keyboard' | 'etude' | 'moon' | 'dew';
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      const dpr = Math.min(devicePixelRatio, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      if (edition === 'keyboard') {
        const scale = Math.max(width / 520, height / 290);
        ctx.translate(width * 0.49, height * 0.52);
        ctx.scale(scale, scale);
        ctx.rotate(-0.37);
        ctx.strokeStyle = '#638a76';
        ctx.lineWidth = 0.65;
        for (let i = 0; i < 24; i++) {
          ctx.beginPath();
          ctx.ellipse(122, -15, 170 + i * 6, 98 + i * 6, -0.32, 0, Math.PI * 2);
          ctx.stroke();
        }
        const project = (key: number, depth: number) => {
          const x = key * 13 - 200;
          return [
            x - depth * 0.14,
            28 * Math.sin(x / 81) + depth + 0.001 * x * x,
          ] as const;
        };
        const keyShape = (
          key: number,
          breadth: number,
          front: number,
          back: number,
          fill: string,
        ) => {
          ctx.beginPath();
          for (const [index, depth] of [
            [key, back],
            [key + breadth, back],
            [key + breadth, front],
            [key, front],
          ]) {
            ctx.lineTo(...project(index, depth));
          }
          ctx.closePath();
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.strokeStyle = '#193e32';
          ctx.lineWidth = 1;
          ctx.stroke();
        };
        for (let k = 0; k < 37; k++) {
          keyShape(k, 1, 57, 43, '#a5af98');
          keyShape(k, 1, 44, -53, '#edead4');
        }
        for (let k = 0; k < 36; k++) {
          if (![2, 6].includes(k % 7))
            keyShape(k + 0.68, 0.59, 3, -54, '#193e32');
        }
        return;
      }
      const colors = {
        etude: ['#b5c7ae', '#43664d'],
        moon: ['#aebdcb', '#435c75'],
        dew: ['#dcb9a6', '#875947'],
      };
      const [paper, ink] = colors[edition];
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, width, height);
      ctx.scale(width / 400, height / 160);
      const moonX = edition === 'moon' ? 269 : edition === 'dew' ? 205 : 111;
      ctx.fillStyle = '#f3ecce';
      ctx.beginPath();
      ctx.ellipse(
        moonX,
        55,
        28,
        (28 * (width / 400)) / (height / 160),
        0,
        0,
        2 * Math.PI,
      );
      ctx.fill();
      for (let i = 0; i < 44; i++) {
        ctx.beginPath();
        for (let x = -2; x <= 404; x += 2) {
          const y =
            edition === 'dew'
              ? 83 +
                i * 2.9 -
                56 * Math.exp(-((x - 240 + i * 0.9) ** 2) / 3200) +
                15 * Math.sin(x / 43 + i * 0.05)
              : 83 +
                i * 2.85 +
                28 * Math.sin(x / (edition === 'moon' ? 73 : 54) + i * 0.048) +
                16 * Math.cos(x / 40 - i * 0.04);
          ctx.lineTo(x, y);
        }
        ctx.strokeStyle = ink;
        ctx.lineWidth = 0.85;
        ctx.stroke();
      }
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [edition]);
  return <canvas ref={ref} className="cover-art" aria-hidden="true" />;
}
