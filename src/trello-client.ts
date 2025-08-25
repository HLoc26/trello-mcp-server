import fetch from 'node-fetch';
import { TrelloBoard, TrelloList, TrelloCard, TrelloCredentials, TaskAnalysis } from './types.js';

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

  private async makeRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    params: Record<string, string> = {},
    body?: any
  ): Promise<T> {
    const url = this.buildUrl(endpoint, params);
    
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Trello API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  // Board operations
  async getBoards(memberId: string = 'me'): Promise<TrelloBoard[]> {
    return this.makeRequest<TrelloBoard[]>(`/members/${memberId}/boards`);
  }

  async getBoard(boardId: string): Promise<TrelloBoard> {
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
    return this.makeRequest<TrelloList[]>(`/boards/${boardId}/lists`);
  }

  async getList(listId: string): Promise<TrelloList> {
    return this.makeRequest<TrelloList>(`/lists/${listId}`);
  }

  async createList(boardId: string, name: string, pos: string = 'bottom'): Promise<TrelloList> {
    return this.makeRequest<TrelloList>('/lists', 'POST', {
      idBoard: boardId,
      name,
      pos,
    });
  }

  async updateList(listId: string, updates: Partial<Pick<TrelloList, 'name' | 'closed' | 'pos'>>): Promise<TrelloList> {
    const params: Record<string, string> = {};
    if (updates.name) params.name = updates.name;
    if (updates.closed !== undefined) params.closed = updates.closed.toString();
    if (updates.pos !== undefined) params.pos = updates.pos.toString();

    return this.makeRequest<TrelloList>(`/lists/${listId}`, 'PUT', params);
  }

  // Card operations
  async getCards(listId: string): Promise<TrelloCard[]> {
    return this.makeRequest<TrelloCard[]>(`/lists/${listId}/cards`);
  }

  async getBoardCards(boardId: string): Promise<TrelloCard[]> {
    return this.makeRequest<TrelloCard[]>(`/boards/${boardId}/cards`);
  }

  async getCard(cardId: string): Promise<TrelloCard> {
    return this.makeRequest<TrelloCard>(`/cards/${cardId}`);
  }

  async createCard(
    listId: string,
    name: string,
    desc: string = '',
    pos: string = 'bottom',
    due?: string
  ): Promise<TrelloCard> {
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