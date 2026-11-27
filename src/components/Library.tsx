import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Feather,
  Music2,
} from 'lucide-react';
import { useStudioStore } from '../store/useStudioStore';
import { CoverArt } from './CoverArt';

export const editions = {
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
} as const;

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
            const e = editions[p.id as keyof typeof editions];
            return (
              <button
                className="score-card"
                key={p.id}
                onClick={() => openScore(p.id)}
              >
                <div className="jacket">
                  <CoverArt edition={e.art} />
                  <span className="catalogue-no">PN / 00{index + 1}</span>
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
