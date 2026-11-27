\version "2.24.3"
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
