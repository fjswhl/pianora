import { t, LocalizedError } from '../i18n';
import { renderMusicXmlToSvgPages } from './musicXmlSheet';
import type { ImportedScoreData } from './scoreImport';

export function importedSheetLoader(imported: Pick<ImportedScoreData, 'midiFile' | 'musicXmlText' | 'title' | 'composer'>) {
  const render = async () => {
    let xml = imported.musicXmlText;
    if (imported.midiFile) {
      const { default: MidiToMusicXML } = await import('../vendor/planetscore/MidiToMusicXML.js');
      xml = new MidiToMusicXML().convert(await imported.midiFile.arrayBuffer(), {
        title: imported.title,
        creator: imported.composer === t("MIDI 导入") ? '' : imported.composer,
        normalize: false, // Preserve leading rests for the playback cursor.
        muteChannels: [9], // The piano playback path also excludes percussion.
        autoSplit: true,
        divisions: 12, // Represent both sixteenths and triplet eighths.
      });
    }
    if (!xml) throw new LocalizedError("缺少可排版的乐谱数据");
    return renderMusicXmlToSvgPages(xml);
  };
  let pending: Promise<string[]> | null = null;
  return () => {
    pending ??= render().catch(err => {
      pending = null;
      throw err;
    });
    return pending;
  };
}
