import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Feather,
  Music2,
} from 'lucide-react';
import { useStudioStore } from '../store/useStudioStore';
import { CoverArt, type CoverEdition } from './CoverArt';

interface EditionMeta {
  name: string;
  title: string;
  credit: string;
  bars: number;
  art: Exclude<CoverEdition, 'keyboard'>;
}

export const editions: Record<string, EditionMeta> = {
  short_etude: {
    name: '月光小品',
    title: 'Lune Miniature',
    credit: 'Pianora',
    bars: 4,
    art: 'etude',
  },
  clair_de_lune: {
    name: '月光',
    title: 'Clair de lune',
    credit: 'Claude Debussy',
    bars: 72,
    art: 'moon',
  },
  rosee_dargent: {
    name: '银露',
    title: 'Rosée d’argent',
    credit: 'Pianora 原创',
    bars: 48,
    art: 'dew',
  },
  mozart_fantasia_k397: {
    name: 'D 小调幻想曲 K.397',
    title: 'Fantasia in D minor',
    credit: 'W. A. Mozart',
    bars: 91,
    art: 'fantasia',
  },
  mozart_sonata_k331_tema: {
    name: 'A 大调奏鸣曲主题 K.331',
    title: 'Sonata KV 331 · Tema',
    credit: 'W. A. Mozart',
    bars: 36,
    art: 'tema',
  },
  mozart_sonata_k545_1: {
    name: 'C 大调奏鸣曲 K.545 I',
    title: 'Sonata K.545 · Allegro',
    credit: 'W. A. Mozart',
    bars: 73,
    art: 'allegro',
  },
  mozart_sonata_k545_2: {
    name: 'C 大调奏鸣曲 K.545 II',
    title: 'Sonata K.545 · Andante',
    credit: 'W. A. Mozart',
    bars: 74,
    art: 'andante',
  },
};

export function Library({ openScore }: { openScore: (id: string) => void }) {
  const presets = useStudioStore((s) => s.presets);
  return (
    <>
      <section className="feature">
        <div className="feature-art">
          <CoverArt edition="keyboard" />
        </div>
        <div className="feature-copy">
          <span className="feature-kicker">
            <Feather size={15} /> 入门选曲
          </span>
          <h2>Lune Miniature</h2>
          <p>从四小节的《月光小品》开始，聆听同一份乐谱的不同演绎。</p>
          <button onClick={() => openScore('short_etude')}>
            打开乐谱 <ArrowRight size={16} />
          </button>
        </div>
      </section>
      <section className="shelf">
        <header>
          <h2>精选曲谱</h2>
          <span>
            <BookOpen size={15} /> {presets.length} 部作品
          </span>
        </header>
        <div className="score-grid">
          {presets.map((p, index) => {
            const e = editions[p.id] ?? {
              name: p.name,
              title: p.name,
              credit: p.subtitle,
              bars: 0,
              art: 'etude' as const,
            };
            return (
              <button
                className="score-card"
                key={p.id}
                onClick={() => openScore(p.id)}
              >
                <div className="jacket">
                  <CoverArt edition={e.art} />
                  <span className="catalogue-no">PN / {String(index + 1).padStart(3, '0')}</span>
                </div>
                <div className="card-copy">
                  <div>
                    <h3>{e.title}</h3>
                    <ArrowUpRight size={17} />
                  </div>
                  <p>
                    {e.name} · {e.credit}
                  </p>
                  <footer>
                    <Music2 size={13} /> 钢琴独奏 <span>{e.bars} 小节</span>
                  </footer>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}
