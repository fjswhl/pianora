export interface ScorePreset {
  id: string;
  name: string;
  subtitle: string;
  ly: string;
}

export const SHORT_ETUDE_LY = String.raw`\version "2.24.3"
\header {
  title = "Lune Miniature"
  subtitle = "Pure-Browser Quick Etude"
  composer = "Pianora Etude"
  tagline = ##f
}
\include "english.ly"

\score {
  \new PianoStaff <<
    \new Staff = "upper" {
      \key df \major
      \time 9/8
      \tempo 4. = 46
      r8\pp <f' af'>4 <f'' af''>4. <df'' f''>4.~ |
      <df'' f''>8 <c'' ef''> <df'' f''> <c'' ef''>2. |
      <af'' df''' af'''>2.\arpeggio <af'' df''' af'''>4.\arpeggio |
      <af' df'' f'' af''>2.\arpeggio r4. \bar "|."
    }
    \new Staff = "lower" {
      \clef bass
      \key df \major
      \time 9/8
      r8 <df, af,>4~ <df, af,>2. |
      <gf, bf, df>2.~ <gf, bf, df>4. |
      <f af df' f'>2.\arpeggio <ff af bf df' ff'>4.\arpeggio |
      <df, af, df f>2.\arpeggio r4. \bar "|."
    }
  >>
  \layout { }
  \midi { }
}
`;

export async function loadScorePresets(): Promise<ScorePreset[]> {
  const list: ScorePreset[] = [
    {
      id: 'short_etude',
      name: '4 小节快速体验片段',
      subtitle: '含 3 处原谱琶音 · 秒出声',
      ly: SHORT_ETUDE_LY,
    },
  ];
  try {
    const r1 = await fetch('/presets/clair_de_lune.ly');
    if (r1.ok) {
      list.push({
        id: 'clair_de_lune',
        name: '德彪西《月光》全曲',
        subtitle: '72 小节 · 7 处原谱琶音',
        ly: await r1.text(),
      });
    }
  } catch {}
  try {
    const r2 = await fetch('/presets/rosee_dargent.ly');
    if (r2.ok) {
      list.push({
        id: 'rosee_dargent',
        name: '印象派夜曲《银露》',
        subtitle: '48 小节 · 原创测试曲',
        ly: await r2.text(),
      });
    }
  } catch {}
  return list;
}
