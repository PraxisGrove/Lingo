export type TranslationUnit = {
  id: string;
  number: number;
  text: string;
};

export type TranslationRequest = {
  sessionId: string;
  pageRevision: number;
  sourceLanguage: string;
  targetLanguage: string;
  pageTitle?: string;
  siteHostname?: string;
  units: TranslationUnit[];
};

export type TranslationEvent =
  | {
      type: 'queued';
      sessionId: string;
      pageRevision: number;
      unitId: string;
    }
  | {
      type: 'translated';
      sessionId: string;
      pageRevision: number;
      unitId: string;
      text: string;
    }
  | {
      type: 'failed';
      sessionId: string;
      pageRevision: number;
      unitId: string;
      category: string;
      message: string;
    }
  | {
      type: 'paused';
      sessionId: string;
      pageRevision: number;
      unitId: null;
      reason: string;
    }
  | {
      type: 'completed';
      sessionId: string;
      pageRevision: number;
      unitId: null;
    };

export type TranslationOrchestrator = {
  translate(request: TranslationRequest): AsyncIterable<TranslationEvent>;
  cancel(sessionId: string): Promise<void>;
};
