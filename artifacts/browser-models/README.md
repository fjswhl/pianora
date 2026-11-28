# Browser performance renders

The classical excerpt is the first eight measures of Beethoven’s Op. 22, second movement, from the DExter example score. The pop excerpt is the first sixteen measures of the Pianora demo arrangement of Jay Chou’s *Hong Chen Ke Zhan* (红尘客栈). The MIDI inputs use fixed velocity. Each output was generated in the score editor and downloaded from the studio.

[Recorded timings, note counts, velocity ranges, sustain events, source and output SHA-256 digests](results.json)

| Browser model | Classical | Pop |
| --- | --- | --- |
| DExter, 32-step DDIM | [MIDI](dexter-classical.mid) | [MIDI](dexter-pop.mid) |
| Pianist Transformer | [MIDI](pianist-classical.mid) | [MIDI](pianist-pop.mid) |
| VirtuosoNet | [MIDI](virtuosonet-classical.mid) | [MIDI](virtuosonet-pop.mid) |

For this run, Pianist Transformer used the MIDI inputs. DExter and VirtuosoNet used MusicXML. The seed was 42. The browser E2E checks the exported note-on pitch counts against the input MIDI and checks for varying velocity and read-only network traffic. Timings include rendering and exporting on the test computer, with model chunks served locally. Download times on a visitor’s connection will vary.

To reproduce against a running preview with the model packs installed, use Python with Playwright, mido and Chrome installed. From the repository root run:

```sh
PIANORA_BROWSER=chrome python scripts/verify-performance-models.py \
  artifacts/browser-models/inputs artifacts/browser-models/inputs \
  --output /tmp/pianora-browser-verification
```

## Pianist Transformer tempo regression

The full 101-measure *Hong Chen Ke Zhan* preset exercises overlapping decoder windows. The additional cases cover Beethoven in 9/8 and a 3/4 MIDI that changes from 80 to 150 BPM and includes an eight-second rest and a sustained final note. The check uses the editor and downloads the score, AI performance and arpeggio-restored MIDI. It compares pitches, the tempo and meter maps, note onsets, chord spreads and track lengths. The JSON records the AI performance before written arpeggios are restored.

[Timing measurements](pianist-timing.json) · [Full restored performance MIDI](pianist-red-dust-inn.mid)

```sh
python scripts/verify-pianist-timing.py --output /tmp/pianora-timing
```
