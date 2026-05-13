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

export interface TrelloBadges {
  checkItems: number;
  checkItemsChecked: number;
  comments: number;
  attachments: number;
  description: boolean;
  due: string | null;
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
  badges?: TrelloBadges;
  checklists?: TrelloChecklist[];
  actions?: TrelloComment[];
}

export interface TrelloCheckItem {
  id: string;
  name: string;
  state: 'complete' | 'incomplete';
  pos: number;
  idChecklist?: string;
}

export interface TrelloChecklist {
  id: string;
  name: string;
  idCard: string;
  pos: number;
  checkItems: TrelloCheckItem[];
}

export interface TrelloCommentData {
  text: string;
  card: { id: string; name: string };
}

export interface TrelloCommentAuthor {
  id: string;
  fullName: string;
  username: string;
}

export interface TrelloComment {
  id: string;
  type: 'commentCard';
  date: string;
  data: TrelloCommentData;
  memberCreator: TrelloCommentAuthor;
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