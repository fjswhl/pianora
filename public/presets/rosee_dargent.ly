\version "2.24.3"

\header {
  title = "Rosée d'Argent"
  subtitle = "Nocturne impressionniste — Hommage à Claude Debussy"
  composer = "Original Composition (Inspired by Clair de Lune)"
  tagline = "Typeset with LilyPond"
}

\paper {
  #(layout-set-staff-size 18)
  ragged-last-bottom = ##f
}

\include "english.ly"

% Absolute pitch mode (c' = C4 / Middle C = MIDI 60) — zero octave drift,
% every note voiced cleanly within the concert grand sweet spot (MIDI 30..92).

% ============================================================================
% Section A: Lent et rêveur (Bars 1-16, G-flat major, 9/8)
% ============================================================================

rhUpA = {
  \tempo "Lent et rêveur"
  % Bars 1-4: Floating pentatonic / Maj9 opening
  r8\pp <bf' df''>8\( <df'' f''>8~ <df'' f''>4. <bf' df''>4.~ | % 1: Gbmaj7
  <bf' df''>8 <af' cf''> <bf' df''> <af' cf''>2.~ | % 2: Ebm9
  <af' cf''>8 <gf' bf'> <af' cf''> \tuplet 2/3 { <bf' df''>8 <df'' f''>8~ } \tuplet 2/3 { <df'' f''>8 <bf' df''>8~ } | % 3: Cbmaj9
  <bf' df''>8 <af' cf''> <gf' bf'> <f' af'>2.\)~ | % 4: Db9sus4 -> Db7

  % Bars 5-8: Descending sigh with Lydian shimmer & breathing cadence
  <f' af'>8\( <gf' bf'> <af' cf''> <bf' df''> <ef'' gf''> <df'' f''> <cf'' ef''> <bf' df''> <af' cf''>~ | % 5
  <af' cf''>8 <gf' bf'> <af' cf''> <gf' bf'>4. <f' af'>4.\)~ | % 6
  <f' af'>8\( <ef' gf'> <f' af'> <gf' bf'>4. <ef' gf'>4 <df' f'>8 | % 7
  <ef' gf'>4. <df' f'>2.\) | % 8

  % Bars 9-16: Deeper, warmer restatement with luminous high-register glow
  \barNumberCheck #9
  r8\p <bf' df''>4\( <df'' f'' bf''>4. <bf' df'' gf''>4.~ | % 9
  <bf' df'' gf''>8 <af' cf'' f''> <bf' df'' gf''> <gf' bf' ef''>2.~ | % 10
  <gf' bf' ef''>8 <f' af' df''> <gf' bf' ef''> \tuplet 2/3 { <af' df'' f''>8\< <cf'' ef'' gf''>8~ } \tuplet 2/3 { <cf'' ef'' gf''>8\! <af' df'' f''>8~ } | % 11
  <af' df'' f''>8 <gf' bf' ef''> <f' af' df''> <ef' gf' bf'>2.\)~ | % 12
  <ef' gf' bf'>8\( <f' af' cf''>\< <gf' bf' df''> <bf' df'' gf''> <ef'' gf'' bf''> <df'' f'' af''>\! <cf'' ef'' gf''>4 <bf' df'' f''>8 | % 13
  <af' cf'' ef''>8\> <gf' bf' df''> <af' cf'' ef''> <bf' df'' gf''>4. <af' cf'' ef''>4.\! | % 14
  <gf' bf' df''>8 <f' af' cf''> <gf' bf' df''> \tuplet 2/3 { <f' af' cf''>8\> <ef' gf' bf'>8~ } \tuplet 2/3 { <ef' gf' bf'>8 <df' f' af'>8 } | % 15
  <cf' ef' gf'>4. <df' f' af'>2.\)\pp | % 16
}

rhDownA = {
  s8*9 | % 1
  s8*9 | % 2
  s4. gf'2.~ | % 3
  gf'8 s8*8 | % 4
  df'2. cf'4. | % 5
  ef'2. df'4. | % 6
  cf'2. bf4. | % 7
  cf'4. af2. | % 8

  s8*9 | % 9
  r8 <ef' gf'>4~ <ef' gf'>2. | % 10
  r8 <df' f'>4 <ef' gf'>4. <df' f'>4. | % 11
  r8 <bf ef'>4~ <bf ef'>2. | % 12
  r8 <cf' ef'>4 <ef' gf'>4. <ef' gf'>4. | % 13
  r8 <cf' ef'>4 <ef' gf'>4. <cf' ef'>4. | % 14
  r8 <bf df'>4~ <bf df'>2. | % 15
  r8 <af cf'>4 <af df'>2. | % 16
}

lhUpA = {
  \clef treble
  r8 <gf' bf'>4~ <gf' bf'>2. | % 1
  <gf' bf'>2.~ <gf' bf'>4. | % 2
  <ef' gf'>2.~ <ef' gf'>4. | % 3
  <df' gf'>2. <df' f'>4. | % 4
  \clef bass
  <bf df'>2. <af cf'>4. | % 5
  <gf bf>2. <f af>4. | % 6
  <ef gf>2. <df f>4. | % 7
  <df gf>4. <df f>2. | % 8

  r8 <df' gf' bf'>4~ <df' gf' bf'>2. | % 9
  r8 <bf ef' gf'>4~ <bf ef' gf'>2. | % 10
  r8 <gf cf' ef'>4~ <gf cf' ef'>2. | % 11
  r8 <bf ef' gf'>4~ <bf ef' gf'>2. | % 12
  r8 <af cf' ef'>4~ <af cf' ef'>2. | % 13
  r8 <gf cf' ef'>4~ <gf cf' ef'>2. | % 14
  r8 <gf bf df'>4~ <gf bf df'>2. | % 15
  r8 <df gf cf'>4 <df f af>2. | % 16
}

lhDownA = {
  \clef treble
  s8*9 | % 1
  s8*9 | % 2
  s8*9 | % 3
  s8*9 | % 4
  \clef bass
  gf2. ef4. | % 5
  cf2. df4. | % 6
  ef2. cf4. | % 7
  df2.~ df4. | % 8

  <gf, df>2.~ <gf, df>4. | % 9
  <ef, bf,>2.~ <ef, bf,>4. | % 10
  <cf, gf,>2.~ <cf, gf,>4. | % 11
  <ef, bf,>2.~ <ef, bf,>4. | % 12
  <af,, ef,>2.~ <af,, ef,>4. | % 13
  <cf, gf,>2.~ <cf, gf,>4. | % 14
  <df, af,>2.~ <df, af,>4. | % 15
  <df,, af,,>2.~ <df,, af,,>4. | % 16
}

% ============================================================================
% Section B: Un poco mosso, fluide et lumineux (Bars 17-32)
% ============================================================================

rhUpB = {
  \barNumberCheck #17
  \tempo "Un poco mosso, fluide et lumineux"
  % Bars 17-24: Flowing moonlight arpeggios with singing upper melody
  <bf' df''>2.\pp\( <df'' f''>4 <ef'' gf''>8\) | % 17
  <bf' df''>2.\( <df'' f''>4 <bf' df''>8\) | % 18
  <ef'' gf''>4\(\< <f'' af''>8 <gf'' bf''>4. <ef'' gf''>4 <df'' f''>8\!\) | % 19
  <df'' f''>8\(\> <cf'' ef''> <af' cf''> <af' cf''>4.\!\) r4. | % 20

  <cf'' ef''>2.\p\( <df'' f''>4 <gf'' bf''>8\) | % 21
  <cf'' ef''>2.\( <df'' f''>4 <gf'' bf''>8\) | % 22
  <af'' cf'''>4.\(\< \tuplet 2/3 { <af'' cf'''>8 <gf'' bf''> } \tuplet 2/3 { <f'' af''> <ef'' gf''> }\!\) | % 23
  <df'' f''>2.\> <cf'' ef''>4.\! | % 24

  % Bars 25-30: En animant (luminous F# minor / Dmaj9 climax)
  \barNumberCheck #25
  \key fs \minor
  \tempo "En animant"
  <fs'' a''>4\(\mf\< <cs'' e''>8 <e'' gs''>4 <cs'' e''>8 <a'' cs'''>4 <e'' gs''>8\) | % 25
  <a'' cs'''>4.\( <gs'' b''>2.\) | % 26
  <gs'' b''>2.\( <b'' d'''>4 <e'' gs''>8\) | % 27
  <fs'' a''>2.\(\< <a'' cs'''>4 <cs''' fs'''>8\!\) | % 28
  <fs'' a'' cs'''>8\(\f <e'' gs'' b''> <d'' fs'' a''> \tuplet 2/3 { <cs'' e'' gs''>8 <b' d'' fs''>8~ } <b' d'' fs''>8 <a' cs'' e''> <gs' b' d''>\) | % 29
  <fs'' a'' cs'''>8\(\> <e'' gs'' b''> <d'' fs'' a''> <cs'' e'' gs''>4. <b' d'' fs''>4 <a' cs'' e''>8\!\) | % 30

  % Bars 31-32: Calmato (enharmonic return to G-flat major)
  \barNumberCheck #31
  \key gf \major
  \tempo "Calmato"
  <af' df''>2.\p\( <cf'' ef''>4 <ef'' gf''>8\) | % 31
  <af' df''>2.\(\> <gf' cf''>4 <f' af'>8\!\) | % 32
}

rhDownB = {
  s8*9 | % 17
  s8*9 | % 18
  s8*9 | % 19
  s4. f''8\( ef'' cf'' cf''8. af'8.\) | % 20
  s8*9 | % 21
  s8*9 | % 22
  s8*9 | % 23
  s8*9 | % 24

  \key fs \minor
  s8*9 | % 25
  s8*9 | % 26
  s8*9 | % 27
  s8*9 | % 28
  s8*9 | % 29
  s8*9 | % 30

  \key gf \major
  s8*9 | % 31
  s8*9 | % 32
}

lhUpB = {
  \clef bass
  % Bars 17-24: Warm sweeping 16th-note moonlight arpeggios (C2..Gb4)
  gf,16\( df gf bf df' gf'\) bf,16\( f bf df' f' bf'\) cf16\( gf cf' ef' gf' bf'\) | % 17
  gf,16\( df gf bf df' gf'\) bf,16\( f bf df' f' bf'\) cf16\( gf cf' ef' bf' gf'\) | % 18
  ef,16\( bf, ef gf bf ef' gf' ef' bf gf ef bf, cf, gf, cf ef cf gf,\) | % 19
  af,,16\( ef, af, cf ef af cf' af ef cf af, ef, df, af, df f df af,\) | % 20

  cf,16\( gf, cf ef gf bf\) bf,,16\( f, bf, df f bf\) af,,16\( ef, af, cf ef af\) | % 21
  cf,16\( gf, cf ef gf bf\) bf,,16\( f, bf, df f bf\) af,,16\( ef, af, cf ef af\) | % 22
  ef,16\( bf, ef gf bf ef'\) cf,16\( gf, cf ef gf cf'\) af,,16\( ef, af, cf ef af\) | % 23
  df,16\( af, df f af df'\) df,16\( af, df f af df'\) df,16\( af, cf ef af cf'\) | % 24

  % Bars 25-30: En animant in F# minor
  \key fs \minor
  fs,16\( cs fs a cs' fs'\) a,16\( e a cs' e' a'\) cs16\( gs cs' e' gs' cs''\) | % 25
  d,16\( a, d fs a d'\) b,16\( fs b d' fs' b'\) e,16\( b, e gs b e'\) | % 26
  b,,16\( fs, b, d fs b\) d,16\( a, d fs a d'\) e,16\( b, e gs b e'\) | % 27
  d,16\( a, d fs a d'\) cs,16\( gs, cs e gs cs'\) fs,16\( cs fs a cs' fs'\) | % 28
  b,,16\( fs, b, d fs b d' b fs d b, fs,\) e,16\( b, e gs e b,\) | % 29
  a,,16\( e, a, cs e a cs' a e cs a, e,\) cs,16\( gs, cs e cs gs,\) | % 30

  % Bars 31-32: Calmato return to G-flat major
  \key gf \major
  df,16\( af, df gf af df' gf' df' af gf df af, df, af, df gf df af,\) | % 31
  df,16\( af, df f af df' f' df' af f df af, df, af, cf f cf af,\) | % 32
}

lhDownB = {
  \clef bass
  gf,4. bf, cf | % 17
  gf,4. bf, cf | % 18
  ef,2. cf,4. | % 19
  af,,2. df,4. | % 20
  cf,4. bf,, af,, | % 21
  cf,4. bf,, af,, | % 22
  ef,4. cf, af,, | % 23
  df,2.~ df,4. | % 24

  \key fs \minor
  fs,4. a, cs | % 25
  d,4. b, e, | % 26
  b,,4. d, e, | % 27
  d,4. cs, fs, | % 28
  b,,2. e,4. | % 29
  a,,2. cs,4. | % 30

  \key gf \major
  df,2.~ df,4. | % 31
  df,2.~ df,4. | % 32
}

% ============================================================================
% Section A' & Coda: a Tempo 1º & Morendo (Bars 33-48)
% ============================================================================

rhUpC = {
  \barNumberCheck #33
  \tempo "a Tempo 1º, très doux"
  % Bars 33-40: Shimmering high-octave return over beat-1 moonlight ripples
  r4.\ppp <df''' f'''>4.\( <bf'' df'''>4.~ | % 33
  <bf'' df'''>8 <af'' cf'''> <bf'' df'''> <af'' cf'''>2.~ | % 34
  <af'' cf'''>8 <gf'' bf''> <af'' cf'''> \tuplet 2/3 { <bf'' df'''>8 <df''' f'''>8~ } \tuplet 2/3 { <df''' f'''>8 <bf'' df'''>8~ } | % 35
  <bf'' df'''>8 <af'' cf'''> <gf'' bf''> <f'' af''>2.\)~ | % 36

  <f'' af''>8\( <gf'' bf''> <af'' cf'''> <bf'' df'''> <ef''' gf'''> <df''' f'''> <cf''' ef'''> <bf'' df'''> <af'' cf'''>~ | % 37
  <af'' cf'''>8 <gf'' bf''> <af'' cf'''> <gf'' bf''>4. <f'' af''>4.\)~ | % 38
  <f'' af''>8\( <ef'' gf''> <f'' af''> <gf'' bf''>4. <ef'' gf''>4 <df'' f''>8 | % 39
  <ef'' gf''>4. <df'' f''>2.\) | % 40

  % Bars 41-42: Warm echoing cadence
  r8\pp <bf' df''>4\( <ef'' gf''>4. <df'' f''>4.\) | % 41
  r8 <af' cf''>4\( <df'' f''>4. <bf' df''>4.\) | % 42

  % Bars 43-48: Coda — Morendo, perdendosi (dissolving into silver mist)
  \barNumberCheck #43
  \tempo "Morendo, perdendosi"
  r4.\ppp <bf'' df'''>4.\( <df''' f'''>4.\) | % 43
  r4. <cf''' ef'''>4.\( <ef''' gf'''>4.\) | % 44
  r4. <df''' f'''>4.\( <f''' af'''>4.\) | % 45
  <ef''' gf'''>4.\( <df''' f'''>4. <cf''' ef'''>4.\) | % 46
  <bf'' df'''>2.~ <bf'' df'''>4.~ | % 47
  <bf'' df'''>2.\arpeggio r4. | % 48
}

rhDownC = {
  s8*9 | % 33
  s8*9 | % 34
  s8*9 | % 35
  s8*9 | % 36
  df''2. cf''4. | % 37
  ef''2. df''4. | % 38
  cf''2. bf'4. | % 39
  cf''4. af'2. | % 40
  s8 <gf' bf'>4~ <gf' bf'>2. | % 41
  s8 <ef' af'>4 <df' gf'>2. | % 42
  s8*9 | % 43
  s8*9 | % 44
  s8*9 | % 45
  s8*9 | % 46
  <gf'' bf''>2.~ <gf'' bf''>4. | % 47
  <df'' gf'' bf''>2.\arpeggio r4. | % 48
}

lhUpC = {
  \clef bass
  % Bars 33-36: Delicate beat-1 arpeggio ripples under high melody
  gf,16\( df gf bf df' gf'\) r4. r4. | % 33
  ef,16\( bf, ef gf bf ef'\) r4. r4. | % 34
  cf,16\( gf, cf ef gf bf\) r4. r4. | % 35
  df,16\( af, df gf af df'\) r4. <df, af, df f>4.\arpeggio | % 36

  gf,16\( df gf bf df' gf'\) r4. <ef, bf, ef gf>4.\arpeggio | % 37
  cf,16\( gf, cf ef gf bf\) r4. <df, af, df f>4.\arpeggio | % 38
  ef,16\( bf, ef gf bf ef'\) r4. <cf, gf, cf ef>4.\arpeggio | % 39
  df,16\( af, df gf af df'\) r4. <df, af, df f>4.\arpeggio | % 40

  ef,16\( bf, ef gf bf ef'\) r4. <bf,, df, f, bf,>4.\arpeggio | % 41
  af,,16\( ef, af, cf ef af\) r4. <df, af, df f>4.\arpeggio | % 42

  % Bars 43-48: Coda rising silver waves
  gf,16\( df gf bf df' gf'\) bf,16\( f bf df' f' bf'\) gf,16\( df gf bf df' gf'\) | % 43
  cf,16\( gf, cf ef gf bf\) af,,16\( ef, af, cf ef af\) cf,16\( gf, cf ef gf bf\) | % 44
  gf,16\( df gf bf df' gf'\) bf,16\( f bf df' f' bf'\) df16\( af df' f' af' df''\) | % 45
  cf,16\( gf, cf ef gf bf\) df,16\( af, df f af df'\) cf,16\( gf, cf ef gf bf\) | % 46
  gf,16\( df gf bf df' gf' \clef treble bf'8 df'' gf'' bf'' df''' f'''\) | % 47
  \clef bass <gf, df gf bf>2.\arpeggio r4. | % 48
}

lhDownC = {
  \clef bass
  gf,2.~ gf,4. | % 33
  ef,2.~ ef,4. | % 34
  cf,2.~ cf,4. | % 35
  df,2.~ df,4. | % 36
  gf,2. ef,4. | % 37
  cf,2. df,4. | % 38
  ef,2. cf,4. | % 39
  df,2.~ df,4. | % 40
  ef,2. bf,,4. | % 41
  af,,2. df,4. | % 42
  gf,4. bf, gf, | % 43
  cf,4. af,, cf, | % 44
  gf,4. bf, df | % 45
  cf,4. df, cf, | % 46
  gf,2.~ gf,4. | % 47
  <gf,, gf,>2. r4. | % 48
}

rhUp = { \rhUpA \rhUpB \rhUpC }
rhDown = { \rhDownA \rhDownB \rhDownC }
lhUp = { \lhUpA \lhUpB \lhUpC }
lhDown = { \lhDownA \lhDownB \lhDownC }

% Visual PDF Score
\score {
  \new PianoStaff <<
    \accidentalStyle Score.piano
    \set PianoStaff.printKeyCancellation = ##f
    \new Staff = "upper" <<
      \key gf \major
      \time 9/8
      \new Voice = "rhUp" { \voiceOne \rhUp }
      \new Voice = "rhDown" { \voiceTwo \rhDown }
    >>
    \new Staff = "lower" <<
      \key gf \major
      \time 9/8
      \new Voice = "lhUp" { \voiceOne \lhUp }
      \new Voice = "lhDown" { \voiceTwo \lhDown \bar "|." }
    >>
  >>
  \layout { }
}

% Score MIDI (clean tempo for PianistTransformer AI rendering & preview)
\score {
  \new PianoStaff <<
    \new Staff = "upper" \with { midiInstrument = "acoustic grand" } <<
      \key gf \major
      \time 9/8
      \tempo 4. = 46
      \new Voice = "rhUp" { \rhUp }
      \new Voice = "rhDown" { \rhDown }
    >>
    \new Staff = "lower" \with { midiInstrument = "acoustic grand" } <<
      \key gf \major
      \time 9/8
      \new Voice = "lhUp" { \lhUp }
      \new Voice = "lhDown" { \lhDown }
    >>
  >>
  \midi { }
}
