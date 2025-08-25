export interface TrelloBoard {
  id: string;
  name: string;
  desc: string;
  closed: boolean;
  url: string;
}

export interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
  pos: number;
  idBoard: string;
}

export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  closed: boolean;
  idList: string;
  idBoard: string;
  pos: number;
  due: string | null;
  labels: TrelloLabel[];
  url: string;
}

export interface TrelloLabel {
  id: string;
  name: string;
  color: string;
}

export interface TaskAnalysis {
  complexity: 'simple' | 'moderate' | 'complex';
  isVague: boolean;
  suggestedSplits?: string[];
  clarifyingQuestions?: string[];
  indicators: {
    lengthScore: number;
    vagueWords: string[];
    multipleActions: boolean;
    missingDetails: string[];
  };
}

export interface TrelloCredentials {
  apiKey: string;
  apiToken: string;
}