export interface ScorePreset {
  id: string;
  name: string;
  subtitle: string;
  composer: string;
  url: string;
  scoreType?: string;
}

export const scorePresets: ScorePreset[] = [
  // Pianora Originals & Quick Start
  {
    id: 'short_etude',
    name: '4 小节快速体验片段',
    subtitle: '含 3 处原谱琶音',
    composer: 'Pianora',
    url: '/presets/short_etude.ly',
  },
  {
    id: 'clair_de_lune',
    name: '德彪西《月光》全曲',
    subtitle: '72 小节 · 7 处原谱琶音',
    composer: 'Debussy',
    url: '/presets/clair_de_lune.ly',
  },
  {
    id: 'rosee_dargent',
    name: '印象派夜曲《银露》',
    subtitle: '48 小节 · 原创测试曲',
    composer: 'Pianora',
    url: '/presets/rosee_dargent.ly',
  },

  // J. S. Bach
  {
    id: 'bach_goldberg_aria',
    name: '巴赫《哥德堡变奏曲》咏叹调 BWV 988',
    subtitle: '32 小节 · 巴洛克典范',
    composer: 'Bach',
    url: '/presets/bach/bach_goldberg_aria_BWV988.ly',
  },
  {
    id: 'bach_invention_01',
    name: '巴赫《C 大调二部创意曲 No.1》BWV 772',
    subtitle: '22 小节 · 复调入门经典',
    composer: 'Bach',
    url: '/presets/bach/bach_invention_01_BWV772.ly',
  },
  {
    id: 'bach_wtc1_prelude1',
    name: '巴赫《平均律第一册 C 大调前奏曲》BWV 846',
    subtitle: '35 小节 · 分解和弦经典',
    composer: 'Bach',
    url: '/presets/bach/bach_wtc1_prelude1_C_BWV846.ly',
  },

  // W. A. Mozart
  {
    id: 'mozart_fantasia_k397',
    name: '莫扎特《D 小调幻想曲》K.397',
    subtitle: '91 小节 · 古典戏剧幻想曲',
    composer: 'Mozart',
    url: '/presets/mozart/mozart_fantasia_k397_Dm.ly',
  },
  {
    id: 'mozart_sonata_k331_tema',
    name: '莫扎特《A 大调奏鸣曲主题》K.331',
    subtitle: '36 小节 · 优雅行板主题',
    composer: 'Mozart',
    url: '/presets/mozart/mozart_sonata_k331_1_tema.ly',
  },
  {
    id: 'mozart_sonata_k545_1',
    name: '莫扎特《C 大调奏鸣曲》K.545 第一乐章',
    subtitle: '73 小节 · Allegro 简易奏鸣曲',
    composer: 'Mozart',
    url: '/presets/mozart/mozart_sonata_k545_1.ly',
  },
  {
    id: 'mozart_sonata_k545_2',
    name: '莫扎特《C 大调奏鸣曲》K.545 第二乐章',
    subtitle: '74 小节 · Andante 歌唱性行板',
    composer: 'Mozart',
    url: '/presets/mozart/mozart_sonata_k545_2.ly',
  },

  // L. van Beethoven
  {
    id: 'beethoven_fur_elise',
    name: '贝多芬《致爱丽丝》WoO 59',
    subtitle: '105 小节 · 浪漫回旋小品',
    composer: 'Beethoven',
    url: '/presets/beethoven/beethoven_fur_elise_WoO59.ly',
  },
  {
    id: 'beethoven_pathetique_1',
    name: '贝多芬《悲怆奏鸣曲》Op.13 第一乐章',
    subtitle: '312 小节 · Grave – Allegro',
    composer: 'Beethoven',
    url: '/presets/beethoven/beethoven_pathetique_1.ly',
  },
  {
    id: 'beethoven_pathetique_2',
    name: '贝多芬《悲怆奏鸣曲》Op.13 第二乐章',
    subtitle: '73 小节 · Adagio cantabile',
    composer: 'Beethoven',
    url: '/presets/beethoven/beethoven_pathetique_2.ly',
  },
  {
    id: 'beethoven_pathetique_3',
    name: '贝多芬《悲怆奏鸣曲》Op.13 第三乐章',
    subtitle: '210 小节 · Rondo Allegro',
    composer: 'Beethoven',
    url: '/presets/beethoven/beethoven_pathetique_3.ly',
  },
  {
    id: 'beethoven_tempest_1',
    name: '贝多芬《暴风雨奏鸣曲》Op.31 No.2 第一乐章',
    subtitle: '232 小节 · 戏剧浪漫杰作',
    composer: 'Beethoven',
    url: '/presets/beethoven/beethoven_tempest_op31_no2_1.ly',
  },

  // R. Schumann
  {
    id: 'schumann_op15_no1',
    name: '舒曼《童年情景》Op.15 No.1 异国与异国人民',
    subtitle: '22 小节 · 抒情小品',
    composer: 'Schumann',
    url: '/presets/schumann/schumann_op15_no1.ly',
  },
  {
    id: 'schumann_traumerei',
    name: '舒曼《梦幻曲》Op.15 No.7',
    subtitle: '24 小节 · 浪漫主义诗篇',
    composer: 'Schumann',
    url: '/presets/schumann/schumann_traumerei_op15_no7.ly',
  },

  // F. Liszt
  {
    id: 'liszt_consolation_1',
    name: '李斯特《安慰曲 No.1》S.172',
    subtitle: '25 小节 · E 大调温情行板',
    composer: 'Liszt',
    url: '/presets/liszt/liszt_consolation_no1.ly',
  },
  {
    id: 'liszt_consolation_3',
    name: '李斯特《安慰曲 No.3》降 D 大调 S.172',
    subtitle: '61 小节 · 柔情夜曲代表作',
    composer: 'Liszt',
    url: '/presets/liszt/liszt_consolation_no3_Db.ly',
  },
  {
    id: 'liszt_consolation_4',
    name: '李斯特《安慰曲 No.4》降 D 大调 S.172',
    subtitle: '34 小节 · 圣咏风格沉思',
    composer: 'Liszt',
    url: '/presets/liszt/liszt_consolation_no4.ly',
  },

  // C. Debussy
  {
    id: 'debussy_arabesque_1',
    name: '德彪西《第一号阿拉伯风格曲》',
    subtitle: '106 小节 · 流动印象派名曲',
    composer: 'Debussy',
    url: '/presets/debussy/debussy_arabesque_1.ly',
  },
  {
    id: 'debussy_arabesque_2',
    name: '德彪西《第二号阿拉伯风格曲》',
    subtitle: '110 小节 · 轻快灵动谐谑',
    composer: 'Debussy',
    url: '/presets/debussy/debussy_arabesque_2.ly',
  },

  // E. Satie
  {
    id: 'satie_gnossienne_1',
    name: '萨蒂《玄秘曲 No.1》',
    subtitle: '82 小节 · 神秘极简东方调式',
    composer: 'Satie',
    url: '/presets/satie/satie_gnossienne_1.ly',
  },
  {
    id: 'satie_gymnopedie_1',
    name: '萨蒂《裸体歌舞 No.1》',
    subtitle: '47 小节 · 慵懒忧郁名曲',
    composer: 'Satie',
    url: '/presets/satie/satie_gymnopedie_1.ly',
  },
  {
    id: 'satie_gymnopedie_2',
    name: '萨蒂《裸体歌舞 No.2》',
    subtitle: '65 小节 · 轻盈哀愁',
    composer: 'Satie',
    url: '/presets/satie/satie_gymnopedie_2.ly',
  },
  {
    id: 'satie_gymnopedie_3',
    name: '萨蒂《裸体歌舞 No.3》',
    subtitle: '59 小节 · 静谧沉思',
    composer: 'Satie',
    url: '/presets/satie/satie_gymnopedie_3.ly',
  },

  {
    id: 'say_goodbye',
    name: '说了再见',
    composer: '周杰伦',
    subtitle: '钢琴伴奏 · MusicXML',
    scoreType: 'MusicXML',
    url: '/presets/mandopop/周杰伦 - 说了再见.musicxml',
  },
  {
    id: 'red_dust_inn',
    name: '红尘客栈',
    composer: '周杰伦',
    subtitle: '钢琴改编 · MusicXML',
    scoreType: 'MusicXML',
    url: '/presets/mandopop/周杰伦 - 红尘客栈.musicxml',
  },
  {
    id: 'sunny_day',
    name: '晴天',
    composer: '周杰伦',
    subtitle: '钢琴改编 · MIDI',
    scoreType: 'MIDI',
    url: '/presets/mandopop/晴天.mid',
  },
  {
    id: 'nocturne',
    name: '夜曲',
    composer: '周杰伦',
    subtitle: '钢琴改编 · MIDI',
    scoreType: 'MIDI',
    url: '/presets/mandopop/夜曲.mid',
  },
  {
    id: 'east_wind',
    name: '东风破',
    composer: '周杰伦',
    subtitle: '钢琴改编 · MIDI',
    scoreType: 'MIDI',
    url: '/presets/mandopop/东风破.mid',
  },
  {
    id: 'a_thousand_years',
    name: '一千年以后',
    composer: '林俊杰',
    subtitle: '钢琴改编 · MIDI',
    scoreType: 'MIDI',
    url: '/presets/mandopop/一千年以后.mid',
  },
  {
    id: 'practice_love',
    name: '修炼爱情',
    composer: '林俊杰',
    subtitle: '钢琴改编 · MIDI',
    scoreType: 'MIDI',
    url: '/presets/mandopop/修炼爱情.mid',
  },
  {
    id: 'cao_cao',
    name: '曹操',
    composer: '林俊杰',
    subtitle: '钢琴改编 · MIDI',
    scoreType: 'MIDI',
    url: '/presets/mandopop/曹操.mid',
  },
  {
    id: 'back_to_back',
    name: '背对背拥抱',
    composer: '林俊杰',
    subtitle: '钢琴改编 · MIDI',
    scoreType: 'MIDI',
    url: '/presets/mandopop/背对背拥抱.mid',
  },
];
