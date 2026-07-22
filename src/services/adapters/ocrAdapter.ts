// OCR adapter — Mathpix-shaped interface with a deterministic mock for dev/tests.
// A real Mathpix (or backend proxy) implementation can be dropped in behind this
// interface with no UI change. No network calls in the mock.

import { OCR_TRANSCRIPTION_SAMPLE } from "@/seed";

export interface OcrResult {
  text: string;
  flaggedSymbols: string[];
}

export interface OcrAdapter {
  transcribe(file: { name: string }): Promise<OcrResult>;
}

export const mockOcrAdapter: OcrAdapter = {
  async transcribe() {
    // Deterministic: mirrors the §9 OCR sample and flags the two uncertain symbols.
    return {
      text: OCR_TRANSCRIPTION_SAMPLE,
      flaggedSymbols: ["T_max", "H"],
    };
  },
};

export const ocrAdapter: OcrAdapter = mockOcrAdapter;
