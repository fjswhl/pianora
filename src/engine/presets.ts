export interface ScorePreset {
  id: string;
  name: string;
  subtitle: string;
  url: string;
}

export const scorePresets: ScorePreset[] = [
  {
    id: 'short_etude',
    name: '4 小节快速体验片段',
    subtitle: '含 3 处原谱琶音',
    url: '/presets/short_etude.ly',
  },
  {
    id: 'clair_de_lune',
    name: '德彪西《月光》全曲',
    subtitle: '72 小节 · 7 处原谱琶音',
    url: '/presets/clair_de_lune.ly',
  },
  {
    id: 'rosee_dargent',
    name: '印象派夜曲《银露》',
    subtitle: '48 小节 · 原创测试曲',
    url: '/presets/rosee_dargent.ly',
  },
  {
    id: 'mozart_fantasia_k397',
    name: '莫扎特《D 小调幻想曲》K.397',
    subtitle: '91 小节 · 古典戏剧幻想曲',
    url: '/presets/mozart/mozart_fantasia_k397_Dm.ly',
  },
  {
    id: 'mozart_sonata_k331_tema',
    name: '莫扎特《A 大调奏鸣曲主题》K.331',
    subtitle: '36 小节 · 优雅行板主题',
    url: '/presets/mozart/mozart_sonata_k331_1_tema.ly',
  },
  {
    id: 'mozart_sonata_k545_1',
    name: '莫扎特《C 大调奏鸣曲》K.545 第一乐章',
    subtitle: '73 小节 · Allegro 简易奏鸣曲',
    url: '/presets/mozart/mozart_sonata_k545_1.ly',
  },
  {
    id: 'mozart_sonata_k545_2',
    name: '莫扎特《C 大调奏鸣曲》K.545 第二乐章',
    subtitle: '74 小节 · Andante 歌唱性行板',
    url: '/presets/mozart/mozart_sonata_k545_2.ly',
  },
];
