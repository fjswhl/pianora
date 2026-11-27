% LilyPond 2.26's SVG writer looks up even repeated noteheads by searching
% the whole SVG font. A named glyph depends only on font, size and name.
% Shaped strings carry horizontal advance state and must use the original writer.
#(let* ((backend (resolve-module '(lily output-svg)))
        (original (module-ref backend 'cache-font #f)))
   (when original
     (let ((paths (make-hash-table)))
       (module-set! backend 'cache-font
         (lambda (font size glyph)
           (if (string? glyph)
               (let* ((key (list font size glyph))
                      (hit (hash-ref paths key)))
                 (or hit
                     (let ((path (original font size glyph)))
                       (hash-set! paths key path)
                       path)))
               (original font size glyph)))))))
