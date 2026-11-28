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

The 101-measure *Hong Chen Ke Zhan* preset exercises overlapping decoder windows. Each take keeps its accumulated timing across barlines. The decoder follows the model’s local note intervals, smooths its pulse over one quarter note, and gradually tempers a persistent tempo bias over roughly three measures. The opening rest and the spacing between entrances across full-measure rests follow the score.

The browser check downloads the original, performed and arpeggio-restored MIDI. It compares pitches, the tempo and meter maps, chord spreads and durations. It measures the time between successive bar entrances and checks that the performance can vary its pace and carry timing across them. The other fixtures cover Beethoven in 9/8 and a 3/4 MIDI with a change from 80 to 150 BPM, an eight-second rest and a sustained final note.

Listen to measures 9–16 excerpted from two independent full renders with the same Abbey Steinway D soundfont: [seed 42](pianist-red-dust-bars-9-16-seed-42.mp3) and [seed 73](pianist-red-dust-bars-9-16-seed-73.mp3). Each clip plays at its generated speed.

[Timing measurements](pianist-timing.json) · [Full restored performance, seed 42](pianist-red-dust-inn.mid)

```sh
python scripts/verify-pianist-timing.py --output /tmp/pianora-timing-42
python scripts/verify-pianist-timing.py --cases full --seed 73 --output /tmp/pianora-timing-73
```
