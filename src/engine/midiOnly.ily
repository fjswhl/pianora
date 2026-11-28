% The MIDI pass still interprets the score and runs the arpeggio event listener.
% It never consumes graphical objects or fitted pages.
\layout { \context { \Score skipTypesetting = ##t } }
\paper { page-breaking = #(lambda (book) '()) }

% Read events from the MIDI voices, where repeats, relative pitches and
% transposition have already been interpreted. Each score has its own sidecar.
#(define pn-performance-count 0)
#(define pn-ornament-keys (make-hash-table))
#(define pn-ornament-scores (make-hash-table))

% Match audio-item.cc moment_to_real in the bundled LilyPond 2.26 MIDI writer.
#(define (pn-midi-moment ctx)
   (let ((m (ly:context-current-moment ctx)))
     (+ (ly:moment-main m) (* 9/40 (ly:moment-grace m)))))

#(define (pn-ornament-score ctx)
   (let ((index pn-performance-count) (first 0) (marks '()))
     (set! pn-performance-count (+ index 1))
     (hashq-set! pn-ornament-scores ctx
       (lambda (entry) (set! marks (cons entry marks))))
     (make-performer
       ((start-translation-timestep self)
        (set! first (min first (pn-midi-moment ctx))))
       ((finalize self)
        (when (pair? marks)
          (call-with-output-file (format #f "pn-ornaments-~a.tsv" index)
            (lambda (port)
              (for-each (lambda (m)
                (apply format port "~a\t~a\t~a\t~a\t~a\n"
                  (exact->inexact (- (car m) first)) (cdr m))) (reverse marks)))))))))

#(define (pn-ornament-staff ctx)
   (make-performer (listeners
     ((key-change-event self event)
      (hashq-set! pn-ornament-keys ctx (ly:event-property event 'pitch-alist))))))

#(define (pn-ornament-voice ctx)
   (let ((highest #f) (marked '()) (mark #f) (span #f) (trill-pitch #f))
     (define (mark-type event)
       (let ((kind (ly:event-property event 'articulation-type)))
         (and (memq kind '(trill prall mordent turn reverseturn)) kind)))
     (define (record pitch kind)
       (let* ((staff (ly:context-find ctx 'Staff))
              (key (hashq-ref pn-ornament-keys staff '()))
              (step (ly:pitch-notename pitch))
              (oct (ly:pitch-octave pitch))
              (neighbor (lambda (delta)
                (let* ((n (+ step delta)) (s (modulo n 7))
                       (p (ly:make-pitch (+ oct (floor (/ n 7))) s (assoc-get s key 0))))
                  (+ 60 (ly:pitch-semitones p)))))
              (put (hashq-ref pn-ornament-scores (ly:context-find ctx 'Score))))
         (when put (put (list (pn-midi-moment ctx) (+ 60 (ly:pitch-semitones pitch)) kind
                         (if (and span (ly:pitch? trill-pitch))
                             (+ 60 (ly:pitch-semitones trill-pitch)) (neighbor 1))
                         (neighbor -1))))))
     (make-performer
       (listeners
        ((note-event self e)
         (let* ((pitch (ly:event-property e 'pitch))
                (kind (any mark-type (ly:event-property e 'articulations '()))))
           (when (or (not highest) (ly:pitch<? highest pitch)) (set! highest pitch))
           (when kind (set! marked (acons pitch kind marked)))))
        ((articulation-event self e)
         (when (mark-type e) (set! mark (mark-type e))))
        ((trill-span-event self e)
         (set! span (= START (ly:event-property e 'span-direction)))
         (set! trill-pitch (ly:event-property e 'pitch))))
       ((stop-translation-timestep self)
        (for-each (lambda (entry) (record (car entry) (cdr entry))) marked)
        ;; Written grace notes at the end of a trill are its termination.
        (let ((kind (or mark (and span (zero? (ly:moment-grace (ly:context-current-moment ctx))) 'trill))))
          (when (and highest kind (not (assq highest marked))) (record highest kind)))
        (set! marked '())
        (set! highest #f)
        (set! mark #f)))))

\midi {
  \context { \Score \consists #pn-ornament-score }
  \context { \Staff \consists #pn-ornament-staff }
  \context { \Voice \consists #pn-ornament-voice }
}
