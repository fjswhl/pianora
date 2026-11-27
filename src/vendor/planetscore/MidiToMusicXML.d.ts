export default class MidiToMusicXML {
  convert(data: ArrayBuffer, options: {
    title: string;
    creator: string;
    normalize: boolean;
    muteChannels: number[];
    autoSplit: boolean;
    divisions: number;
  }): string;
}
