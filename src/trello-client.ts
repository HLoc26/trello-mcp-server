import {
  TrelloBoard,
  TrelloList,
  TrelloCard,
  TrelloCredentials,
  TrelloChecklist,
  TrelloCheckItem,
  TrelloComment,
  TrelloLabel,
} from './types.js';

const COMMENT_MAX_LEN = 16384;
const VALID_LABEL_COLORS = new Set([
  'yellow', 'purple', 'blue', 'red', 'green', 'orange',
  'black', 'sky', 'pink', 'lime', 'null', '',
]);

const TRELLO_ID_RE = /^[a-f0-9]{24}$/i;
const FETCH_TIMEOUT_MS = 10_000;

function assertTrelloId(id: string, label: string): void {
  if (typeof id !== 'string' || !TRELLO_ID_RE.test(id)) {
    throw new Error(`Invalid ${label}: must be a 24-char hex Trello ID`);
  }
}

export class TrelloClient {
  private credentials: TrelloCredentials;
  private baseUrl = 'https://api.trello.com/1';

  constructor(credentials: TrelloCredentials) {
    this.credentials = credentials;
  }

  private buildUrl(endpoint: string, params: Record<string, string> = {}): string {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.set('key', this.credentials.apiKey);
    url.searchParams.set('token', this.credentials.apiToken);

    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    return url.toString();
  }

  private redactUrl(url: string): string {
    try {
      const u = new URL(url);
      if (u.searchParams.has('key')) u.searchParams.set('key', 'REDACTED');
      if (u.searchParams.has('token')) u.searchParams.set('token', 'REDACTED');
      return u.toString();
    } catch {
      return '[unparseable url]';
    }
  }

  private async makeRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    params: Record<string, string> = {},
    body?: any
  ): Promise<T> {
    const url = this.buildUrl(endpoint, params);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Trello network error (${method} ${this.redactUrl(url).replace(this.baseUrl, '')}): ${msg}`);
    }

    if (!response.ok) {
      throw new Error(`Trello API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  // Board operations
  async getBoards(memberId: string = 'me'): Promise<TrelloBoard[]> {
    if (memberId !== 'me') assertTrelloId(memberId, 'memberId');
    return this.makeRequest<TrelloBoard[]>(`/members/${memberId}/boards`);
  }

  async getBoard(boardId: string): Promise<TrelloBoard> {
    assertTrelloId(boardId, 'boardId');
    return this.makeRequest<TrelloBoard>(`/boards/${boardId}`);
  }

  async createBoard(name: string, desc: string = ''): Promise<TrelloBoard> {
    return this.makeRequest<TrelloBoard>('/boards', 'POST', {
      name,
      desc,
    });
  }

  // List operations
  async getLists(boardId: string): Promise<TrelloList[]> {
    assertTrelloId(boardId, 'boardId');
    return this.makeRequest<TrelloList[]>(`/boards/${boardId}/lists`);
  }

  async getList(listId: string): Promise<TrelloList> {
    assertTrelloId(listId, 'listId');
    return this.makeRequest<TrelloList>(`/lists/${listId}`);
  }

  async createList(boardId: string, name: string, pos: string = 'bottom'): Promise<TrelloList> {
    assertTrelloId(boardId, 'boardId');
    return this.makeRequest<TrelloList>('/lists', 'POST', {
      idBoard: boardId,
      name,
      pos,
    });
  }

  async updateList(listId: string, updates: Partial<Pick<TrelloList, 'name' | 'closed' | 'pos'>>): Promise<TrelloList> {
    assertTrelloId(listId, 'listId');
    const params: Record<string, string> = {};
    if (updates.name) params.name = updates.name;
    if (updates.closed !== undefined) params.closed = updates.closed.toString();
    if (updates.pos !== undefined) params.pos = updates.pos.toString();

    return this.makeRequest<TrelloList>(`/lists/${listId}`, 'PUT', params);
  }

  // Card operations
  async getCards(listId: string): Promise<TrelloCard[]> {
    assertTrelloId(listId, 'listId');
    return this.makeRequest<TrelloCard[]>(`/lists/${listId}/cards`);
  }

  async getBoardCards(boardId: string): Promise<TrelloCard[]> {
    assertTrelloId(boardId, 'boardId');
    return this.makeRequest<TrelloCard[]>(`/boards/${boardId}/cards`, 'GET', {
      fields: 'name,desc,due,idList,idBoard,closed,labels,url,pos,badges',
    });
  }

  async getCard(
    cardId: string,
    opts: { checklists?: boolean; comments?: boolean } = {},
  ): Promise<TrelloCard> {
    assertTrelloId(cardId, 'cardId');
    const params: Record<string, string> = {};
    if (opts.checklists) params.checklists = 'all';
    if (opts.comments) params.actions = 'commentCard';
    return this.makeRequest<TrelloCard>(`/cards/${cardId}`, 'GET', params);
  }

  // Checklist operations
  async getCardChecklists(cardId: string): Promise<TrelloChecklist[]> {
    assertTrelloId(cardId, 'cardId');
    return this.makeRequest<TrelloChecklist[]>(`/cards/${cardId}/checklists`);
  }

  async createChecklist(cardId: string, name: string): Promise<TrelloChecklist> {
    assertTrelloId(cardId, 'cardId');
    return this.makeRequest<TrelloChecklist>('/checklists', 'POST', {
      idCard: cardId,
      name,
    });
  }

  async deleteChecklist(checklistId: string): Promise<void> {
    assertTrelloId(checklistId, 'checklistId');
    await this.makeRequest<void>(`/checklists/${checklistId}`, 'DELETE');
  }

  async addCheckItem(checklistId: string, name: string, pos: string = 'bottom'): Promise<TrelloCheckItem> {
    assertTrelloId(checklistId, 'checklistId');
    return this.makeRequest<TrelloCheckItem>(`/checklists/${checklistId}/checkItems`, 'POST', {
      name,
      pos,
    });
  }

  async updateCheckItem(
    cardId: string,
    itemId: string,
    state: 'complete' | 'incomplete',
  ): Promise<TrelloCheckItem> {
    assertTrelloId(cardId, 'cardId');
    assertTrelloId(itemId, 'itemId');
    return this.makeRequest<TrelloCheckItem>(`/cards/${cardId}/checkItem/${itemId}`, 'PUT', {
      state,
    });
  }

  // Comment operations
  async getCardComments(cardId: string, limit: number = 50): Promise<TrelloComment[]> {
    assertTrelloId(cardId, 'cardId');
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    return this.makeRequest<TrelloComment[]>(`/cards/${cardId}/actions`, 'GET', {
      filter: 'commentCard',
      limit: safeLimit.toString(),
    });
  }

  async addComment(cardId: string, text: string): Promise<TrelloComment> {
    assertTrelloId(cardId, 'cardId');
    if (typeof text !== 'string' || text.length === 0) {
      throw new Error('Comment text must be a non-empty string');
    }
    if (text.length > COMMENT_MAX_LEN) {
      throw new Error(`Comment text exceeds ${COMMENT_MAX_LEN} char limit`);
    }
    return this.makeRequest<TrelloComment>(`/cards/${cardId}/actions/comments`, 'POST', {
      text,
    });
  }

  async deleteComment(cardId: string, actionId: string): Promise<void> {
    assertTrelloId(cardId, 'cardId');
    assertTrelloId(actionId, 'actionId');
    await this.makeRequest<void>(`/cards/${cardId}/actions/${actionId}/comments`, 'DELETE');
  }

  // Label operations
  async getBoardLabels(boardId: string, limit: number = 1000): Promise<TrelloLabel[]> {
    assertTrelloId(boardId, 'boardId');
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    return this.makeRequest<TrelloLabel[]>(`/boards/${boardId}/labels`, 'GET', {
      limit: safeLimit.toString(),
    });
  }

  async createLabel(boardId: string, name: string, color: string): Promise<TrelloLabel> {
    assertTrelloId(boardId, 'boardId');
    const colorValue = (color ?? '').toLowerCase();
    if (!VALID_LABEL_COLORS.has(colorValue)) {
      throw new Error(`Invalid label color "${color}". Allowed: ${[...VALID_LABEL_COLORS].filter(Boolean).join(', ')} or empty for no color`);
    }
    return this.makeRequest<TrelloLabel>('/labels', 'POST', {
      idBoard: boardId,
      name,
      color: colorValue === '' ? 'null' : colorValue,
    });
  }

  async updateLabel(labelId: string, updates: { name?: string; color?: string }): Promise<TrelloLabel> {
    assertTrelloId(labelId, 'labelId');
    const params: Record<string, string> = {};
    if (updates.name !== undefined) params.name = updates.name;
    if (updates.color !== undefined) {
      const c = updates.color.toLowerCase();
      if (!VALID_LABEL_COLORS.has(c)) {
        throw new Error(`Invalid label color "${updates.color}"`);
      }
      params.color = c === '' ? 'null' : c;
    }
    return this.makeRequest<TrelloLabel>(`/labels/${labelId}`, 'PUT', params);
  }

  async deleteLabel(labelId: string): Promise<void> {
    assertTrelloId(labelId, 'labelId');
    await this.makeRequest<void>(`/labels/${labelId}`, 'DELETE');
  }

  async addLabelToCard(cardId: string, labelId: string): Promise<{ idLabels: string[] }> {
    assertTrelloId(cardId, 'cardId');
    assertTrelloId(labelId, 'labelId');
    return this.makeRequest<{ idLabels: string[] }>(`/cards/${cardId}/idLabels`, 'POST', {
      value: labelId,
    });
  }

  async removeLabelFromCard(cardId: string, labelId: string): Promise<void> {
    assertTrelloId(cardId, 'cardId');
    assertTrelloId(labelId, 'labelId');
    await this.makeRequest<void>(`/cards/${cardId}/idLabels/${labelId}`, 'DELETE');
  }

  async createCard(
    listId: string,
    name: string,
    desc: string = '',
    pos: string = 'bottom',
    due?: string
  ): Promise<TrelloCard> {
    assertTrelloId(listId, 'listId');
    const params: Record<string, string> = {
      idList: listId,
      name,
      desc,
      pos,
    };

    if (due) {
      params.due = due;
    }

    return this.makeRequest<TrelloCard>('/cards', 'POST', params);
  }

  async updateCard(cardId: string, updates: {
    name?: string;
    desc?: string;
    idList?: string;
    pos?: string;
    due?: string | null;
    closed?: boolean;
  }): Promise<TrelloCard> {
    assertTrelloId(cardId, 'cardId');
    if (updates.idList) assertTrelloId(updates.idList, 'idList');
    const params: Record<string, string> = {};
    if (updates.name) params.name = updates.name;
    if (updates.desc !== undefined) params.desc = updates.desc;
    if (updates.idList) params.idList = updates.idList;
    if (updates.pos) params.pos = updates.pos;
    if (updates.due !== undefined) params.due = updates.due || '';
    if (updates.closed !== undefined) params.closed = updates.closed.toString();

    return this.makeRequest<TrelloCard>(`/cards/${cardId}`, 'PUT', params);
  }

  async deleteCard(cardId: string): Promise<void> {
    assertTrelloId(cardId, 'cardId');
    await this.makeRequest<void>(`/cards/${cardId}`, 'DELETE');
  }

  async moveCard(cardId: string, targetListId: string, position: string = 'bottom'): Promise<TrelloCard> {
    return this.updateCard(cardId, {
      idList: targetListId,
      pos: position,
    });
  }

  // Board structure operations
  async ensureDefaultLists(boardId: string): Promise<{ todo: TrelloList; inProgress: TrelloList; done: TrelloList }> {
    assertTrelloId(boardId, 'boardId');
    const lists = await this.getLists(boardId);
    
    let todoList = lists.find(list => list.name.toLowerCase().includes('todo') || list.name.toLowerCase().includes('to do'));
    let inProgressList = lists.find(list => list.name.toLowerCase().includes('progress') || list.name.toLowerCase().includes('doing'));
    let doneList = lists.find(list => list.name.toLowerCase().includes('done') || list.name.toLowerCase().includes('complete'));

    if (!todoList) {
      todoList = await this.createList(boardId, 'To Do', 'top');
    }

    if (!inProgressList) {
      inProgressList = await this.createList(boardId, 'In Progress', lists.length > 1 ? '2' : 'bottom');
    }

    if (!doneList) {
      doneList = await this.createList(boardId, 'Done', 'bottom');
    }

    return {
      todo: todoList,
      inProgress: inProgressList,
      done: doneList,
    };
  }
}