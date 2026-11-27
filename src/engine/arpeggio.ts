import type { Midi } from '@tonejs/midi';

export interface SimpleNote {
  scoreTime?: number; // Original onset before expressive timing or arpeggio restoration
  p: number; // MIDI pitch 0..127
  s: number; // start time (seconds)
  d: number; // duration (seconds)
  v: number; // velocity 1..127
}

export interface RawArpeggioAnnotation {
  bar: number;
  num: number;
  den: number;
}

export interface RestoredArpeggioInfo {
  bar: number;
  time_sec: number;
  note_count: number;
  pitches: number[];
  before_ms: number;
  after_ms: number;
  action: string;
}

export const SCHEME_ARP_HOOK = String.raw`
#(define demo-arp-moments '())

#(define (Demo_arpeggio_collector_engraver ctx)
   (make-engraver
    (listeners
     ((arpeggio-event engraver event)
      (let* ((mom (ly:context-current-moment ctx))
             (main (ly:moment-main mom))
             (num (numerator main))
             (den (denominator main))
             (bar (ly:context-property ctx 'currentBarNumber 1)))
        (set! demo-arp-moments (cons (list bar num den) demo-arp-moments)))))
    ((finalize translator)
     (let ((port (open-output-file "annotations.json")))
       (display "[" port)
       (let loop ((items (reverse demo-arp-moments)) (first #t))
         (when (pair? items)
           (let ((it (car items)))
             (unless first (display "," port))
             (format port "{\"bar\":~a,\"num\":~a,\"den\":~a}" (car it) (cadr it) (caddr it))
             (loop (cdr items) #f))))
       (display "]\n" port)
       (close-output-port port)))))

% Keep the original engraving and expose its line breaks and musical positions to the player.
#(define (pn-moment column)
   (number->string (exact->inexact (ly:moment-main (ly:grob-property column 'when)))))

#(define (pn-staff-attributes grob)
   (let* ((system (ly:grob-system grob))
          (y (ly:grob-relative-coordinate grob system Y))
          (extent (ly:grob-extent system system Y)))
     (list (cons 'data-system (pn-moment (ly:spanner-bound system LEFT)))
           (cons 'data-end (pn-moment (ly:spanner-bound system RIGHT)))
           (cons 'data-top (number->string (- y (cdr extent))))
           (cons 'data-bottom (number->string (- y (car extent)))))))

#(define (pn-bar-engraver ctx)
  (let ((repeats '()))
   (define (record kind numbers)
     (set! repeats (cons (format #f "~a:~a:~a"
                        (exact->inexact (ly:moment-main (ly:context-current-moment ctx)))
                        kind (string-join (map number->string numbers) ",")) repeats)))
   (make-engraver
    (listeners
     ((volta-repeat-start-event engraver event)
      (record "start" (list (ly:event-property event 'repeat-count 2))))
     ((volta-repeat-end-event engraver event) (record "end" '()))
     ((alternative-event engraver event) (record "ending" (ly:event-property event 'volta-numbers '()))))
    (acknowledgers
     ((staff-symbol-interface engraver grob source)
      (ly:grob-set-property! grob 'output-attributes
       (lambda (piece)
         (cons (cons 'data-repeats (string-join (reverse repeats) ";")) (pn-staff-attributes piece)))))
     ((bar-line-interface engraver grob source)
      (let ((moment (number->string (exact->inexact (ly:moment-main (ly:context-current-moment ctx)))))
            (number (number->string (ly:context-property ctx 'currentBarNumber 1))))
        (ly:grob-set-property! grob 'output-attributes
          (lambda (piece)
            (list (cons 'data-line (pn-moment (ly:spanner-bound (ly:grob-system piece) LEFT)))
                  (cons 'data-moment moment) (cons 'data-number number))))))))))

\layout {
  \context { \Staff \consists #pn-bar-engraver }
  \context {
    \Voice
    \consists #Demo_arpeggio_collector_engraver
  }
}
`;

export function injectSchemeHook(lyCode: string): string {
  // lilypond-wasm bundles only Emmentaler + default TeX Gyre Latin fonts;
  // custom system font overrides (e.g. Mutopia's "DejaVu Sans"), exotic \char ##x.... glyphs,
  // and non-Latin/CJK Unicode characters can abort HarfBuzz/Pango inside WASM.
  let safeLy = lyCode
    // Remove external font-name overrides not bundled in lilypond-wasm
    .replace(/\\override\s+#'\(\s*font-name\s*\.\s*"[^"]*"\s*\)/g, '')
    .replace(/\\override\s+#\(\s*font-name\s*\.\s*"[^"]*"\s*\)/g, '')
    // Replace exotic \char ##x.... (e.g. Mutopia's \char ##x01C0 dental click) with safe ASCII
    .replace(/\\char\s+##x([0-9A-Fa-f]+)/g, (_, hex: string) => {
      const cp = parseInt(hex, 16);
      if (cp >= 0x20 && cp <= 0x7e) return `"${String.fromCharCode(cp).replace(/["\\]/g, '')}"`;
      if (cp === 0x2014 || cp === 0x2013) return '"-"';
      return '" "';
    })
    // Normalize & sanitize non-Latin characters inside quoted strings
    .replace(/"([^"\\]|\\.)*"/g, (quoted) =>
      quoted
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, "'")
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\u266D/g, 'b')
        .replace(/\u266F/g, '#')
        .replace(/[\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]+/g, '')
        .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '')
        .replace(/\(\s*\)/g, ''),
    )
    // LilyPond 2.18 -> 2.24 compatibility: \consists #Span_stem_engraver -> \consists "Span_stem_engraver"
    .replace(/\\consists\s+#([A-Z][A-Za-z0-9_]*engraver)\b/g, '\\consists "$1"');

  const m = safeLy.match(/\\version\s+"[^"]+"\s*/);
  if (m && m.index !== undefined) {
    const pos = m.index + m[0].length;
    return safeLy.slice(0, pos) + '\n' + SCHEME_ARP_HOOK + '\n' + safeLy.slice(pos);
  }
  return '\\version "2.24.3"\n' + SCHEME_ARP_HOOK + '\n' + safeLy;
}

function easeCurve(u: number): number {
  return 0.72 * u + 0.28 * Math.pow(u, 1.65);
}

/**
 * Generic Stage 4: restores every \arpeggio moment extracted by the LilyPond Scheme Engraver
 * into a smooth bottom-to-top rolled chord while preserving 100% of PianoFlow's dynamics & rubato.
 */
export function restoreArpeggios(
  scoreMidi: Midi,
  perfNotesIn: SimpleNote[],
  rawAnnotations: RawArpeggioAnnotation[],
  baseSweepMs = 240,
): { notes: SimpleNote[]; arpeggios: RestoredArpeggioInfo[]; duration: number } {
  const ppq = scoreMidi.header.ppq || 384;

  // Score notes sorted in the exact order used by SyMuPe tokenizer: (ticks, pitch)
  const scNotes: Array<{ ticks: number; pitch: number }> = [];
  for (const tr of scoreMidi.tracks) {
    for (const n of tr.notes) {
      scNotes.push({ ticks: n.ticks, pitch: n.midi });
    }
  }
  scNotes.sort((a, b) => a.ticks - b.ticks || a.pitch - b.pitch);

  // Clone perfNotes so original PianoFlow track stays untouched for A/B comparison
  const perfNotes: SimpleNote[] = perfNotesIn.map((n) => ({ ...n }));
  const aligned = scNotes.length === perfNotes.length;

  // Deduplicate identical whole-note moments across LH & RH voices
  const uniqueMap = new Map<string, { bar: number; num: number; den: number }>();
  for (const a of rawAnnotations) {
    const key = `${a.num}/${a.den}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, { bar: a.bar, num: a.num, den: a.den });
    }
  }
  const moments = Array.from(uniqueMap.values()).sort((a, b) => a.num / a.den - b.num / b.den);

  const restoredInfo: RestoredArpeggioInfo[] = [];

  for (const mom of moments) {
    const targetTick = Math.round((ppq * 4.0 * mom.num) / mom.den);
    const tol = Math.max(6, Math.round(ppq * 0.02));
    const idxs: number[] = [];
    for (let i = 0; i < scNotes.length; i++) {
      if (Math.abs(scNotes[i].ticks - targetTick) <= tol) idxs.push(i);
    }
    if (idxs.length < 2 || !aligned) continue;

    const chord = idxs.map((i) => perfNotes[i]);
    const beforeOrd = [...chord].sort((a, b) => a.s - b.s);
    const beforeSpanMs = Math.round((beforeOrd[beforeOrd.length - 1].s - beforeOrd[0].s) * 1000);
    const sortedPitches = [...chord].map((n) => n.p).sort((a, b) => a - b);
    const beforeAsc = beforeOrd.every((n, idx) => n.p === sortedPitches[idx]);

    chord.sort((a, b) => a.p - b.p);
    const k = chord.length;

    // Preserve if AI already rolled smoothly upward >= 280ms (e.g. final chord)
    if (beforeAsc && beforeSpanMs >= 280) {
      restoredInfo.push({
        bar: mom.bar,
        time_sec: Number(beforeOrd[0].s.toFixed(2)),
        note_count: k,
        pitches: chord.map((n) => n.p),
        before_ms: beforeSpanMs,
        after_ms: beforeSpanMs,
        action: 'preserved (AI already rolled upward)',
      });
      continue;
    }

    const sweepSec = (baseSweepMs / 1000) * (0.62 + 0.065 * Math.min(k, 10));
    const preShift = Math.min(0.11, sweepSec * 0.36);

    const origMinStart = Math.min(...chord.map((n) => n.s));
    const origMaxEnd = Math.max(...chord.map((n) => n.s + n.d));
    const rollStart = Math.max(0, origMinStart - preShift);

    for (let j = 0; j < k; j++) {
      const u = j / Math.max(1, k - 1);
      const newStart = rollStart + sweepSec * easeCurve(u);
      const newEnd = Math.max(chord[j].s + chord[j].d, origMaxEnd, newStart + 0.25);
      chord[j].s = Number(newStart.toFixed(4));
      chord[j].d = Number(Math.max(0.03, newEnd - newStart).toFixed(4));
    }

    restoredInfo.push({
      bar: mom.bar,
      time_sec: Number(rollStart.toFixed(2)),
      note_count: k,
      pitches: chord.map((n) => n.p),
      before_ms: beforeSpanMs,
      after_ms: Math.round(sweepSec * 1000),
      action: 'restored bottom-to-top roll',
    });
  }

  // Sort cleanly and prevent same-pitch overlaps
  perfNotes.sort((a, b) => a.s - b.s || a.p - b.p);
  const byPitch = new Map<number, SimpleNote[]>();
  for (const n of perfNotes) {
    let arr = byPitch.get(n.p);
    if (!arr) {
      arr = [];
      byPitch.set(n.p, arr);
    }
    arr.push(n);
  }
  for (const arr of byPitch.values()) {
    for (let i = 0; i < arr.length - 1; i++) {
      const maxEnd = arr[i + 1].s - 0.015;
      if (arr[i].s + arr[i].d > maxEnd) {
        arr[i].d = Number(Math.max(0.03, maxEnd - arr[i].s).toFixed(4));
      }
    }
  }

  const duration = perfNotes.reduce((mx, n) => Math.max(mx, n.s + n.d), 0);
  return { notes: perfNotes, arpeggios: restoredInfo, duration: Number(duration.toFixed(2)) };
}
