% The MIDI pass still interprets the score and runs the arpeggio event listener.
% It never consumes graphical objects or fitted pages.
\layout { \context { \Score skipTypesetting = ##t } }
\paper { page-breaking = #(lambda (book) '()) }
