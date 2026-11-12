import { NativeTranscriptStrategy } from "./strategies/native-transcript.strategy.js";
import { PlayerCaptionStrategy } from "./strategies/player-caption.strategy.js";
import { SpeechRecognitionStrategy } from "./strategies/speech-recognition.strategy.js";
import { TextTrackStrategy } from "./strategies/text-track.strategy.js";
import { TranscriptExtractor } from "./transcript-extractor.js";

export function createDefaultTranscriptExtractor(): TranscriptExtractor {
  return new TranscriptExtractor([
    new NativeTranscriptStrategy(),
    new TextTrackStrategy(),
    new PlayerCaptionStrategy(),
    new SpeechRecognitionStrategy(),
  ]);
}
