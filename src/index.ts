#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  CallToolResult,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { TrelloClient } from './trello-client.js';
import { TaskAnalyzer } from './task-analyzer.js';
import { TrelloCredentials } from './types.js';

dotenv.config();

const TRELLO_ID_RE = /^[a-f0-9]{24}$/i;
const PRIORITY_VALUES = ['low', 'medium', 'high', 'urgent'] as const;
const STATUS_VALUES = ['pending', 'in_progress', 'completed'] as const;
const FOCUS_VALUES = ['all', 'vague', 'complex', 'overdue'] as const;
const TASK_STATUS_FILTER = ['pending', 'in_progress', 'completed', 'all'] as const;

function requireString(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`Argument "${name}" must be a non-empty string`);
  }
  return v;
}

function optionalString(v: unknown, name: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new Error(`Argument "${name}" must be a string`);
  return v;
}

function requireTrelloId(v: unknown, name: string): string {
  const s = requireString(v, name);
  if (!TRELLO_ID_RE.test(s)) throw new Error(`Argument "${name}" must be a 24-char hex Trello ID`);
  return s;
}

function requireEnum<T extends string>(v: unknown, name: string, allowed: readonly T[]): T {
  const s = requireString(v, name);
  if (!allowed.includes(s as T)) {
    throw new Error(`Argument "${name}" must be one of: ${allowed.join(', ')}`);
  }
  return s as T;
}

function optionalEnum<T extends string>(v: unknown, name: string, allowed: readonly T[]): T | undefined {
  if (v === undefined || v === null) return undefined;
  return requireEnum(v, name, allowed);
}

function escapeMd(s: string): string {
  if (typeof s !== 'string') return '';
  return s.replace(/[\[\]`<>]/g, '\\$&');
}

const SP_PATTERNS: RegExp[] = [
  /\bsp\s*[:=]\s*(\d+(?:\.\d+)?)\b/i,
  /\b(\d+(?:\.\d+)?)\s*sp\b/i,
  /\bpoints?\s*[:=]\s*(\d+(?:\.\d+)?)\b/i,
  /\b(\d+(?:\.\d+)?)\s*(?:pts|points?)\b/i,
  /^\s*\(?\s*(\d+(?:\.\d+)?)\s*\)?\s*$/,
];

function extractStoryPoints(labels: { name?: string }[] | undefined): number | null {
  if (!Array.isArray(labels)) return null;
  for (const lbl of labels) {
    const n = lbl?.name;
    if (typeof n !== 'string' || n.length === 0) continue;
    for (const re of SP_PATTERNS) {
      const m = re.exec(n);
      if (m) {
        const v = parseFloat(m[1]);
        if (!isNaN(v)) return v;
      }
    }
  }
  return null;
}

function formatLabels(labels: { id: string; name: string; color: string }[] | undefined): string {
  if (!Array.isArray(labels) || labels.length === 0) return '_(none)_';
  return labels.map(l => {
    const name = l.name ? escapeMd(l.name) : '_(unnamed)_';
    const color = l.color || 'none';
    return `${name} [${color}, id: ${l.id}]`;
  }).join(', ');
}

interface TrelloMCPConfig {
  defaultBoardId?: string;
  credentials: TrelloCredentials;
}

class TrelloMCPServer {
  private server: Server;
  private trelloClient: TrelloClient;
  private config: TrelloMCPConfig;

  constructor() {
    this.validateEnvironment();
    
    this.config = {
      defaultBoardId: process.env.DEFAULT_TRELLO_BOARD_ID,
      credentials: {
        apiKey: process.env.TRELLO_API_KEY!,
        apiToken: process.env.TRELLO_API_TOKEN!,
      },
    };

    this.trelloClient = new TrelloClient(this.config.credentials);
    this.server = new Server(
      {
        name: 'trello-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  private validateEnvironment() {
    const required = ['TRELLO_API_KEY', 'TRELLO_API_TOKEN'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      console.error(`Missing required environment variables: ${missing.join(', ')}`);
      console.error('Please create a .env file with your Trello API credentials.');
      process.exit(1);
    }
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      return this.handleToolCall(request.params.name, request.params.arguments);
    });
  }

  private getTools(): Tool[] {
    return [
      {
        name: 'trello_list_boards',
        description: 'List all Trello boards accessible to the user',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'trello_get_board',
        description: 'Get information about a specific Trello board',
        inputSchema: {
          type: 'object',
          properties: {
            boardId: { type: 'string', description: 'The ID of the board to retrieve' },
          },
          required: ['boardId'],
        },
      },
      {
        name: 'trello_create_task',
        description: 'Create a new task (card) in a Trello list with task management features',
        inputSchema: {
          type: 'object',
          properties: {
            boardId: { type: 'string', description: 'The ID of the board' },
            listName: { 
              type: 'string', 
              description: 'Name of the list (To Do, In Progress, Done) or list ID',
              default: 'To Do'
            },
            title: { type: 'string', description: 'Title of the task' },
            description: { type: 'string', description: 'Detailed description of the task' },
            priority: { 
              type: 'string', 
              enum: ['low', 'medium', 'high', 'urgent'],
              description: 'Priority level of the task'
            },
            dueDate: { 
              type: 'string', 
              description: 'Due date in ISO format (YYYY-MM-DD) or relative (e.g., "tomorrow", "next week")'
            },
          },
          required: ['boardId', 'title'],
        },
      },
      {
        name: 'trello_update_task',
        description: 'Update an existing task with new information or move it to a different list',
        inputSchema: {
          type: 'object',
          properties: {
            cardId: { type: 'string', description: 'The ID of the card to update' },
            title: { type: 'string', description: 'New title for the task' },
            description: { type: 'string', description: 'Updated description' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: 'New status (maps to Trello lists)'
            },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'urgent'],
              description: 'Updated priority level'
            },
            dueDate: { type: 'string', description: 'Updated due date in ISO format' },
          },
          required: ['cardId'],
        },
      },
      {
        name: 'trello_analyze_board',
        description: 'Analyze all tasks on a board for complexity, clarity, and potential improvements',
        inputSchema: {
          type: 'object',
          properties: {
            boardId: { type: 'string', description: 'The ID of the board to analyze' },
            focusArea: {
              type: 'string',
              enum: ['all', 'vague', 'complex', 'overdue'],
              description: 'Specific area to focus analysis on',
              default: 'all'
            },
          },
          required: ['boardId'],
        },
      },
      {
        name: 'trello_split_task',
        description: 'Analyze a complex task and suggest how to split it into smaller, manageable tasks',
        inputSchema: {
          type: 'object',
          properties: {
            cardId: { type: 'string', description: 'The ID of the card to analyze and split' },
            autoCreate: {
              type: 'boolean',
              description: 'Whether to automatically create the suggested split tasks',
              default: false
            },
          },
          required: ['cardId'],
        },
      },
      {
        name: 'trello_clarify_task',
        description: 'Analyze a vague task and generate clarifying questions to improve it',
        inputSchema: {
          type: 'object',
          properties: {
            cardId: { type: 'string', description: 'The ID of the card to analyze' },
          },
          required: ['cardId'],
        },
      },
      {
        name: 'trello_get_tasks',
        description: 'Get all tasks from a board or specific list with filtering options. Shows checklist/comment counts via badges.',
        inputSchema: {
          type: 'object',
          properties: {
            boardId: { type: 'string', description: 'The ID of the board' },
            listName: { type: 'string', description: 'Filter by specific list name (optional)' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'all'],
              description: 'Filter by task status',
              default: 'all'
            },
            fullDesc: {
              type: 'boolean',
              description: 'If true, return full descriptions. If false, return 100-char preview.',
              default: false
            },
          },
          required: ['boardId'],
        },
      },
      {
        name: 'trello_setup_board',
        description: 'Set up a board with default lists for task management (To Do, In Progress, Done)',
        inputSchema: {
          type: 'object',
          properties: {
            boardId: { type: 'string', description: 'The ID of the board to setup' },
          },
          required: ['boardId'],
        },
      },
      {
        name: 'trello_get_card',
        description: 'Get full card detail including full (untruncated) description, optionally with checklists and comments',
        inputSchema: {
          type: 'object',
          properties: {
            cardId: { type: 'string', description: 'The ID of the card' },
            includeChecklists: { type: 'boolean', description: 'Include checklists and their items', default: false },
            includeComments: { type: 'boolean', description: 'Include latest comments', default: false },
          },
          required: ['cardId'],
        },
      },
      {
        name: 'trello_list_comments',
        description: 'List comments on a Trello card (newest first)',
        inputSchema: {
          type: 'object',
          properties: {
            cardId: { type: 'string', description: 'The ID of the card' },
            limit: { type: 'number', description: 'Max comments to fetch (1-50)', default: 50 },
          },
          required: ['cardId'],
        },
      },
      {
        name: 'trello_add_comment',
        description: 'Post a new comment to a Trello card',
        inputSchema: {
          type: 'object',
          properties: {
            cardId: { type: 'string', description: 'The ID of the card' },
            text: { type: 'string', description: 'Comment text (max 16384 chars)' },
          },
          required: ['cardId', 'text'],
        },
      },
      {
        name: 'trello_list_checklists',
        description: 'List all checklists on a card with their items',
        inputSchema: {
          type: 'object',
          properties: {
            cardId: { type: 'string', description: 'The ID of the card' },
          },
          required: ['cardId'],
        },
      },
      {
        name: 'trello_add_checklist',
        description: 'Create a new checklist on a card, optionally seeded with items',
        inputSchema: {
          type: 'object',
          properties: {
            cardId: { type: 'string', description: 'The ID of the card' },
            name: { type: 'string', description: 'Checklist name' },
            items: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional initial check-item names',
            },
          },
          required: ['cardId', 'name'],
        },
      },
      {
        name: 'trello_add_check_item',
        description: 'Add a single item to an existing checklist',
        inputSchema: {
          type: 'object',
          properties: {
            checklistId: { type: 'string', description: 'The ID of the checklist' },
            name: { type: 'string', description: 'Item text' },
          },
          required: ['checklistId', 'name'],
        },
      },
      {
        name: 'trello_toggle_check_item',
        description: 'Mark a check-item complete or incomplete',
        inputSchema: {
          type: 'object',
          properties: {
            cardId: { type: 'string', description: 'The ID of the parent card' },
            itemId: { type: 'string', description: 'The ID of the check-item' },
            complete: { type: 'boolean', description: 'true = complete, false = incomplete' },
          },
          required: ['cardId', 'itemId', 'complete'],
        },
      },
      {
        name: 'trello_list_labels',
        description: 'List all labels defined on a board (name, color, id)',
        inputSchema: {
          type: 'object',
          properties: {
            boardId: { type: 'string', description: 'The ID of the board' },
          },
          required: ['boardId'],
        },
      },
      {
        name: 'trello_create_label',
        description: 'Create a new label on a board',
        inputSchema: {
          type: 'object',
          properties: {
            boardId: { type: 'string', description: 'The ID of the board' },
            name: { type: 'string', description: 'Label name (e.g. "SP:3", "bug", "frontend")' },
            color: {
              type: 'string',
              enum: ['yellow', 'purple', 'blue', 'red', 'green', 'orange', 'black', 'sky', 'pink', 'lime', ''],
              description: 'Trello label color, or empty string for no color',
              default: '',
            },
          },
          required: ['boardId', 'name'],
        },
      },
      {
        name: 'trello_update_label',
        description: 'Rename or recolor an existing label',
        inputSchema: {
          type: 'object',
          properties: {
            labelId: { type: 'string', description: 'The ID of the label' },
            name: { type: 'string', description: 'New name (optional)' },
            color: {
              type: 'string',
              enum: ['yellow', 'purple', 'blue', 'red', 'green', 'orange', 'black', 'sky', 'pink', 'lime', ''],
              description: 'New color (optional)',
            },
          },
          required: ['labelId'],
        },
      },
      {
        name: 'trello_delete_label',
        description: 'Delete a label from the board (removes from all cards)',
        inputSchema: {
          type: 'object',
          properties: {
            labelId: { type: 'string', description: 'The ID of the label' },
          },
          required: ['labelId'],
        },
      },
      {
        name: 'trello_add_label_to_card',
        description: 'Attach an existing label to a card',
        inputSchema: {
          type: 'object',
          properties: {
            cardId: { type: 'string', description: 'The ID of the card' },
            labelId: { type: 'string', description: 'The ID of the label to attach' },
          },
          required: ['cardId', 'labelId'],
        },
      },
      {
        name: 'trello_remove_label_from_card',
        description: 'Detach a label from a card (does not delete the label)',
        inputSchema: {
          type: 'object',
          properties: {
            cardId: { type: 'string', description: 'The ID of the card' },
            labelId: { type: 'string', description: 'The ID of the label to detach' },
          },
          required: ['cardId', 'labelId'],
        },
      },
      {
        name: 'trello_get_story_points',
        description: 'Extract story-point value from card labels (parses "SP:N", "N SP", "N pts", or pure-number labels)',
        inputSchema: {
          type: 'object',
          properties: {
            cardId: { type: 'string', description: 'The ID of the card' },
          },
          required: ['cardId'],
        },
      },
    ];
  }

  private async handleToolCall(toolName: string, rawArgs: unknown): Promise<CallToolResult> {
    const args = (rawArgs && typeof rawArgs === 'object') ? rawArgs as Record<string, unknown> : {};
    try {
      switch (toolName) {
        case 'trello_list_boards':
          return await this.listBoards();

        case 'trello_get_board':
          return await this.getBoard(requireTrelloId(args.boardId, 'boardId'));

        case 'trello_create_task':
          return await this.createTask(args);

        case 'trello_update_task':
          return await this.updateTask(args);

        case 'trello_analyze_board':
          return await this.analyzeBoard(
            requireTrelloId(args.boardId, 'boardId'),
            optionalEnum(args.focusArea, 'focusArea', FOCUS_VALUES) ?? 'all'
          );

        case 'trello_split_task':
          return await this.splitTask(
            requireTrelloId(args.cardId, 'cardId'),
            typeof args.autoCreate === 'boolean' ? args.autoCreate : false
          );

        case 'trello_clarify_task':
          return await this.clarifyTask(requireTrelloId(args.cardId, 'cardId'));

        case 'trello_get_tasks':
          return await this.getTasks(args);

        case 'trello_setup_board':
          return await this.setupBoard(requireTrelloId(args.boardId, 'boardId'));

        case 'trello_get_card':
          return await this.getCardDetail(
            requireTrelloId(args.cardId, 'cardId'),
            args.includeChecklists === true,
            args.includeComments === true,
          );

        case 'trello_list_comments':
          return await this.listComments(
            requireTrelloId(args.cardId, 'cardId'),
            typeof args.limit === 'number' ? args.limit : 50,
          );

        case 'trello_add_comment':
          return await this.addComment(
            requireTrelloId(args.cardId, 'cardId'),
            requireString(args.text, 'text'),
          );

        case 'trello_list_checklists':
          return await this.listChecklists(requireTrelloId(args.cardId, 'cardId'));

        case 'trello_add_checklist':
          return await this.addChecklist(
            requireTrelloId(args.cardId, 'cardId'),
            requireString(args.name, 'name'),
            Array.isArray(args.items) ? args.items.map((i, idx) => requireString(i, `items[${idx}]`)) : undefined,
          );

        case 'trello_add_check_item':
          return await this.addCheckItem(
            requireTrelloId(args.checklistId, 'checklistId'),
            requireString(args.name, 'name'),
          );

        case 'trello_toggle_check_item':
          if (typeof args.complete !== 'boolean') {
            throw new Error('Argument "complete" must be a boolean');
          }
          return await this.toggleCheckItem(
            requireTrelloId(args.cardId, 'cardId'),
            requireTrelloId(args.itemId, 'itemId'),
            args.complete,
          );

        case 'trello_list_labels':
          return await this.listLabels(requireTrelloId(args.boardId, 'boardId'));

        case 'trello_create_label':
          return await this.createLabel(
            requireTrelloId(args.boardId, 'boardId'),
            requireString(args.name, 'name'),
            optionalString(args.color, 'color') ?? '',
          );

        case 'trello_update_label':
          return await this.updateLabel(
            requireTrelloId(args.labelId, 'labelId'),
            optionalString(args.name, 'name'),
            optionalString(args.color, 'color'),
          );

        case 'trello_delete_label':
          return await this.deleteLabel(requireTrelloId(args.labelId, 'labelId'));

        case 'trello_add_label_to_card':
          return await this.addLabelToCard(
            requireTrelloId(args.cardId, 'cardId'),
            requireTrelloId(args.labelId, 'labelId'),
          );

        case 'trello_remove_label_from_card':
          return await this.removeLabelFromCard(
            requireTrelloId(args.cardId, 'cardId'),
            requireTrelloId(args.labelId, 'labelId'),
          );

        case 'trello_get_story_points':
          return await this.getStoryPoints(requireTrelloId(args.cardId, 'cardId'));

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }

  private async listBoards(): Promise<CallToolResult> {
    const boards = await this.trelloClient.getBoards();
    const boardList = boards.map(board => `- **${escapeMd(board.name)}** (ID: ${board.id})${board.desc ? `\\n  ${escapeMd(board.desc)}` : ''}`).join('\\n');
    
    return {
      content: [{
        type: 'text',
        text: `## Available Trello Boards\\n\\n${boardList}`
      }]
    };
  }

  private async getBoard(boardId: string): Promise<CallToolResult> {
    const board = await this.trelloClient.getBoard(boardId);
    const lists = await this.trelloClient.getLists(boardId);
    const cards = await this.trelloClient.getBoardCards(boardId);
    
    const listsInfo = lists.map(list => {
      const listCards = cards.filter(card => card.idList === list.id && !card.closed);
      return `- **${escapeMd(list.name)}**: ${listCards.length} tasks`;
    }).join('\\n');

    return {
      content: [{
        type: 'text',
        text: `## Board: ${escapeMd(board.name)}\\n\\n${board.desc ? `**Description:** ${escapeMd(board.desc)}\\n\\n` : ''}**Lists:**\\n${listsInfo}\\n\\n**Total Tasks:** ${cards.filter(c => !c.closed).length}\\n**Board URL:** ${board.url}`
      }]
    };
  }

  private async createTask(args: Record<string, unknown>): Promise<CallToolResult> {
    const boardId = requireTrelloId(args.boardId, 'boardId');
    const listName = optionalString(args.listName, 'listName') ?? 'To Do';
    const title = requireString(args.title, 'title');
    const description = optionalString(args.description, 'description') ?? '';
    const priority = optionalEnum(args.priority, 'priority', PRIORITY_VALUES);
    const dueDate = optionalString(args.dueDate, 'dueDate');

    const lists = await this.trelloClient.ensureDefaultLists(boardId);
    
    // Determine target list
    let targetList;
    if (listName.toLowerCase().includes('progress') || listName.toLowerCase().includes('doing')) {
      targetList = lists.inProgress;
    } else if (listName.toLowerCase().includes('done') || listName.toLowerCase().includes('complete')) {
      targetList = lists.done;
    } else {
      targetList = lists.todo;
    }

    // Build description with priority
    let fullDescription = description;
    if (priority) {
      fullDescription = `**Priority:** ${priority.toUpperCase()}\\n\\n${description}`;
    }

    // Parse due date
    let parsedDueDate: string | undefined;
    if (dueDate) {
      parsedDueDate = this.parseDueDate(dueDate);
    }

    const card = await this.trelloClient.createCard(
      targetList.id,
      title,
      fullDescription,
      'bottom',
      parsedDueDate
    );

    // Analyze the created task
    const analysis = TaskAnalyzer.analyzeTask(card);
    let analysisText = '';
    
    if (analysis.isVague || analysis.complexity === 'complex') {
      analysisText = `\\n\\n**⚠️ Task Analysis:**\\n- Complexity: ${analysis.complexity}\\n- Clarity: ${analysis.isVague ? 'Needs clarification' : 'Clear'}`;
      
      if (analysis.clarifyingQuestions?.length) {
        analysisText += `\\n\\n**Suggested questions for clarity:**\\n${analysis.clarifyingQuestions.map(q => `- ${q}`).join('\\n')}`;
      }
    }

    return {
      content: [{
        type: 'text',
        text: `## Task Created Successfully\\n\\n**Title:** ${escapeMd(card.name)}\\n**List:** ${escapeMd(targetList.name)}\\n**Card ID:** ${card.id}\\n**URL:** ${card.url}${analysisText}`
      }]
    };
  }

  private async updateTask(args: Record<string, unknown>): Promise<CallToolResult> {
    const cardId = requireTrelloId(args.cardId, 'cardId');
    const title = optionalString(args.title, 'title');
    const description = optionalString(args.description, 'description');
    const status = optionalEnum(args.status, 'status', STATUS_VALUES);
    const priority = optionalEnum(args.priority, 'priority', PRIORITY_VALUES);
    const dueDate = optionalString(args.dueDate, 'dueDate');

    const card = await this.trelloClient.getCard(cardId);

    const updates: {
      name?: string;
      desc?: string;
      idList?: string;
      due?: string;
    } = {};

    if (title) updates.name = title;
    if (description !== undefined) {
      updates.desc = priority ? `**Priority:** ${priority.toUpperCase()}\\n\\n${description}` : description;
    }
    if (dueDate) updates.due = this.parseDueDate(dueDate);
    
    // Handle status changes by moving to appropriate list
    if (status) {
      const lists = await this.trelloClient.ensureDefaultLists(card.idBoard);
      
      switch (status) {
        case 'pending':
          updates.idList = lists.todo.id;
          break;
        case 'in_progress':
          updates.idList = lists.inProgress.id;
          break;
        case 'completed':
          updates.idList = lists.done.id;
          break;
      }
    }

    const updatedCard = await this.trelloClient.updateCard(cardId, updates);
    
    return {
      content: [{
        type: 'text',
        text: `## Task Updated Successfully\\n\\n**Title:** ${escapeMd(updatedCard.name)}\\n**Card ID:** ${updatedCard.id}\\n**URL:** ${updatedCard.url}`
      }]
    };
  }

  private async analyzeBoard(boardId: string, focusArea: string = 'all'): Promise<CallToolResult> {
    const cards = await this.trelloClient.getBoardCards(boardId);
    const activeCards = cards.filter(card => !card.closed);
    
    const analyses = activeCards.map(card => ({
      card,
      analysis: TaskAnalyzer.analyzeTask(card)
    }));

    // Filter based on focus area
    let filteredAnalyses = analyses;
    switch (focusArea) {
      case 'vague':
        filteredAnalyses = analyses.filter(a => a.analysis.isVague);
        break;
      case 'complex':
        filteredAnalyses = analyses.filter(a => a.analysis.complexity === 'complex');
        break;
      case 'overdue':
        filteredAnalyses = analyses.filter(a => a.card.due && new Date(a.card.due) < new Date());
        break;
    }

    const summary = {
      total: activeCards.length,
      vague: analyses.filter(a => a.analysis.isVague).length,
      complex: analyses.filter(a => a.analysis.complexity === 'complex').length,
      overdue: analyses.filter(a => a.card.due && new Date(a.card.due) < new Date()).length,
    };

    let report = `## Board Analysis Report\\n\\n`;
    report += `**Summary:**\\n`;
    report += `- Total active tasks: ${summary.total}\\n`;
    report += `- Vague tasks: ${summary.vague}\\n`;
    report += `- Complex tasks: ${summary.complex}\\n`;
    report += `- Overdue tasks: ${summary.overdue}\\n\\n`;

    if (filteredAnalyses.length > 0) {
      report += `**Detailed Analysis (${focusArea} focus):**\\n\\n`;
      
      filteredAnalyses.slice(0, 10).forEach(({ card, analysis }) => {
        report += `### ${escapeMd(card.name)}\\n`;
        report += `- **Complexity:** ${analysis.complexity}\\n`;
        report += `- **Clarity:** ${analysis.isVague ? '⚠️ Needs clarification' : '✅ Clear'}\\n`;
        
        if (analysis.clarifyingQuestions?.length) {
          report += `- **Questions:** ${analysis.clarifyingQuestions[0]}\\n`;
        }
        
        if (analysis.suggestedSplits?.length) {
          report += `- **Can be split:** Yes (${analysis.suggestedSplits.length} suggestions)\\n`;
        }
        
        report += `- **Card ID:** ${card.id}\\n\\n`;
      });
    }

    return {
      content: [{
        type: 'text',
        text: report
      }]
    };
  }

  private async splitTask(cardId: string, autoCreate: boolean = false): Promise<CallToolResult> {
    const card = await this.trelloClient.getCard(cardId);
    const analysis = TaskAnalyzer.analyzeTask(card);
    
    if (!analysis.suggestedSplits?.length) {
      return {
        content: [{
          type: 'text',
          text: `## Task Split Analysis\\n\\nThe task "${escapeMd(card.name)}" doesn't appear to need splitting. It's already appropriately scoped.`
        }]
      };
    }

    let report = `## Task Split Suggestions\\n\\n**Original Task:** ${escapeMd(card.name)}\\n\\n**Suggested splits:**\\n`;

    analysis.suggestedSplits.forEach((suggestion, index) => {
      report += `${index + 1}. ${escapeMd(suggestion)}\\n`;
    });

    if (autoCreate) {
      const createdCards = [];
      for (const suggestion of analysis.suggestedSplits) {
        const newCard = await this.trelloClient.createCard(
          card.idList,
          suggestion,
          `Split from: ${card.name}\\n\\nOriginal task: ${card.url}`,
          'bottom'
        );
        createdCards.push(newCard);
      }
      
      report += `\\n\\n**✅ Created ${createdCards.length} new tasks:**\\n`;
      createdCards.forEach(newCard => {
        report += `- [${escapeMd(newCard.name)}](${newCard.url})\\n`;
      });
      
      report += `\\n**Note:** Consider archiving the original task if it's now fully covered by the splits.`;
    }

    return {
      content: [{
        type: 'text',
        text: report
      }]
    };
  }

  private async clarifyTask(cardId: string): Promise<CallToolResult> {
    const card = await this.trelloClient.getCard(cardId);
    const analysis = TaskAnalyzer.analyzeTask(card);
    
    let report = `## Task Clarity Analysis\\n\\n**Task:** ${escapeMd(card.name)}\\n\\n`;
    
    if (!analysis.isVague) {
      report += `✅ This task appears to be clearly defined.`;
    } else {
      report += `⚠️ This task could benefit from clarification.\\n\\n`;
      report += `**Issues found:**\\n`;
      
      if (analysis.indicators.vagueWords.length) {
        report += `- Vague language detected: ${analysis.indicators.vagueWords.join(', ')}\\n`;
      }
      
      if (analysis.indicators.missingDetails.length) {
        report += `- Missing details: ${analysis.indicators.missingDetails.join(', ')}\\n`;
      }
      
      if (analysis.clarifyingQuestions?.length) {
        report += `\\n**Questions to clarify:**\\n`;
        analysis.clarifyingQuestions.forEach((question, index) => {
          report += `${index + 1}. ${question}\\n`;
        });
      }
    }

    return {
      content: [{
        type: 'text',
        text: report
      }]
    };
  }

  private async getTasks(args: Record<string, unknown>): Promise<CallToolResult> {
    const boardId = requireTrelloId(args.boardId, 'boardId');
    const listName = optionalString(args.listName, 'listName');
    const status = optionalEnum(args.status, 'status', TASK_STATUS_FILTER) ?? 'all';
    const fullDesc = args.fullDesc === true;

    let cards;
    if (listName) {
      const lists = await this.trelloClient.getLists(boardId);
      const targetList = lists.find(list => 
        list.name.toLowerCase().includes(listName.toLowerCase())
      );
      
      if (!targetList) {
        return {
          content: [{
            type: 'text',
            text: `List "${listName}" not found on board.`
          }],
          isError: true
        };
      }
      
      cards = await this.trelloClient.getCards(targetList.id);
    } else {
      cards = await this.trelloClient.getBoardCards(boardId);
    }

    // Filter by status
    const activeCards = cards.filter(card => !card.closed);
    let filteredCards = activeCards;
    
    if (status !== 'all') {
      const lists = await this.trelloClient.getLists(boardId);
      const listMap = new Map(lists.map(list => [list.id, list.name.toLowerCase()]));
      
      filteredCards = activeCards.filter(card => {
        const listName = listMap.get(card.idList) || '';
        switch (status) {
          case 'pending':
            return listName.includes('todo') || listName.includes('to do');
          case 'in_progress':
            return listName.includes('progress') || listName.includes('doing');
          case 'completed':
            return listName.includes('done') || listName.includes('complete');
          default:
            return true;
        }
      });
    }

    const taskList = filteredCards.map(card => {
      const dueText = card.due ? ` (Due: ${new Date(card.due).toLocaleDateString()})` : '';
      const b = card.badges;
      const badgeBits: string[] = [];
      if (b) {
        if (b.checkItems > 0) badgeBits.push(`☑ ${b.checkItemsChecked}/${b.checkItems}`);
        if (b.comments > 0) badgeBits.push(`💬 ${b.comments}`);
        if (b.attachments > 0) badgeBits.push(`📎 ${b.attachments}`);
      }
      const sp = extractStoryPoints(card.labels);
      if (sp !== null) badgeBits.push(`SP:${sp}`);
      const badgeText = badgeBits.length ? ` [${badgeBits.join(' ')}]` : '';
      const labelText = (card.labels && card.labels.length)
        ? `\\n  Labels: ${card.labels.map(l => escapeMd(l.name || l.color || l.id)).join(', ')}`
        : '';
      const descBody = fullDesc
        ? escapeMd(card.desc)
        : escapeMd(card.desc.substring(0, 100)) + (card.desc.length > 100 ? '...' : '');
      return `- **${escapeMd(card.name)}**${dueText}${badgeText}\\n  ID: ${card.id}${labelText}\\n  ${descBody}`;
    }).join('\\n\\n');

    return {
      content: [{
        type: 'text',
        text: `## Tasks${listName ? ` in ${listName}` : ''} (${status})\\n\\n${taskList || 'No tasks found.'}`
      }]
    };
  }

  private async getCardDetail(
    cardId: string,
    includeChecklists: boolean,
    includeComments: boolean,
  ): Promise<CallToolResult> {
    const card = await this.trelloClient.getCard(cardId, {
      checklists: includeChecklists,
      comments: includeComments,
    });

    const sp = extractStoryPoints(card.labels);

    let report = `## Card: ${escapeMd(card.name)}\\n\\n`;
    report += `**Card ID:** ${card.id}\\n`;
    report += `**URL:** ${card.url}\\n`;
    if (card.due) report += `**Due:** ${new Date(card.due).toISOString()}\\n`;
    report += `**Labels:** ${formatLabels(card.labels)}\\n`;
    if (sp !== null) report += `**Story Points:** ${sp}\\n`;
    report += `\\n**Description:**\\n${escapeMd(card.desc) || '_(empty)_'}\\n`;

    if (includeChecklists && card.checklists?.length) {
      report += `\\n**Checklists:**\\n`;
      for (const cl of card.checklists) {
        const done = cl.checkItems.filter(i => i.state === 'complete').length;
        report += `\\n### ${escapeMd(cl.name)} (${done}/${cl.checkItems.length}) — ID: ${cl.id}\\n`;
        for (const item of cl.checkItems) {
          const mark = item.state === 'complete' ? 'x' : ' ';
          report += `- [${mark}] ${escapeMd(item.name)}  _(itemId: ${item.id})_\\n`;
        }
      }
    }

    if (includeComments && card.actions?.length) {
      report += `\\n**Comments (${card.actions.length}):**\\n`;
      for (const c of card.actions) {
        const author = escapeMd(c.memberCreator?.fullName ?? c.memberCreator?.username ?? 'unknown');
        const date = new Date(c.date).toISOString();
        report += `- **${author}** (${date}): ${escapeMd(c.data?.text ?? '')}\\n`;
      }
    }

    return { content: [{ type: 'text', text: report }] };
  }

  private async listComments(cardId: string, limit: number): Promise<CallToolResult> {
    const comments = await this.trelloClient.getCardComments(cardId, limit);
    if (!comments.length) {
      return { content: [{ type: 'text', text: '_No comments on this card._' }] };
    }
    const body = comments.map(c => {
      const author = escapeMd(c.memberCreator?.fullName ?? c.memberCreator?.username ?? 'unknown');
      const date = new Date(c.date).toISOString();
      return `- **${author}** (${date}) [id: ${c.id}]: ${escapeMd(c.data?.text ?? '')}`;
    }).join('\\n');
    return { content: [{ type: 'text', text: `## Comments (${comments.length})\\n\\n${body}` }] };
  }

  private async addComment(cardId: string, text: string): Promise<CallToolResult> {
    const c = await this.trelloClient.addComment(cardId, text);
    return {
      content: [{
        type: 'text',
        text: `## Comment Posted\\n\\n**Comment ID:** ${c.id}\\n**Date:** ${new Date(c.date).toISOString()}`,
      }],
    };
  }

  private async listChecklists(cardId: string): Promise<CallToolResult> {
    const checklists = await this.trelloClient.getCardChecklists(cardId);
    if (!checklists.length) {
      return { content: [{ type: 'text', text: '_No checklists on this card._' }] };
    }
    let report = `## Checklists (${checklists.length})\\n`;
    for (const cl of checklists) {
      const done = cl.checkItems.filter(i => i.state === 'complete').length;
      report += `\\n### ${escapeMd(cl.name)} (${done}/${cl.checkItems.length}) — ID: ${cl.id}\\n`;
      for (const item of cl.checkItems) {
        const mark = item.state === 'complete' ? 'x' : ' ';
        report += `- [${mark}] ${escapeMd(item.name)}  _(itemId: ${item.id})_\\n`;
      }
    }
    return { content: [{ type: 'text', text: report }] };
  }

  private async addChecklist(
    cardId: string,
    name: string,
    items: string[] | undefined,
  ): Promise<CallToolResult> {
    const cl = await this.trelloClient.createChecklist(cardId, name);
    const created: string[] = [];
    if (items && items.length) {
      for (const itemName of items) {
        const added = await this.trelloClient.addCheckItem(cl.id, itemName);
        created.push(added.name);
      }
    }
    let body = `## Checklist Created\\n\\n**Name:** ${escapeMd(cl.name)}\\n**Checklist ID:** ${cl.id}`;
    if (created.length) {
      body += `\\n\\n**Items added (${created.length}):**\\n` + created.map(n => `- ${escapeMd(n)}`).join('\\n');
    }
    return { content: [{ type: 'text', text: body }] };
  }

  private async addCheckItem(checklistId: string, name: string): Promise<CallToolResult> {
    const item = await this.trelloClient.addCheckItem(checklistId, name);
    return {
      content: [{
        type: 'text',
        text: `## Check-item Added\\n\\n**Name:** ${escapeMd(item.name)}\\n**Item ID:** ${item.id}\\n**State:** ${item.state}`,
      }],
    };
  }

  private async toggleCheckItem(
    cardId: string,
    itemId: string,
    complete: boolean,
  ): Promise<CallToolResult> {
    const newState = complete ? 'complete' : 'incomplete';
    const item = await this.trelloClient.updateCheckItem(cardId, itemId, newState);
    return {
      content: [{
        type: 'text',
        text: `## Check-item Updated\\n\\n**Name:** ${escapeMd(item.name)}\\n**State:** ${item.state}`,
      }],
    };
  }

  private async listLabels(boardId: string): Promise<CallToolResult> {
    const labels = await this.trelloClient.getBoardLabels(boardId);
    if (!labels.length) {
      return { content: [{ type: 'text', text: '_No labels on this board._' }] };
    }
    const body = labels.map(l => {
      const name = l.name ? escapeMd(l.name) : '_(unnamed)_';
      return `- **${name}** [${l.color || 'none'}] — id: ${l.id}`;
    }).join('\\n');
    return { content: [{ type: 'text', text: `## Board Labels (${labels.length})\\n\\n${body}` }] };
  }

  private async createLabel(
    boardId: string,
    name: string,
    color: string,
  ): Promise<CallToolResult> {
    const label = await this.trelloClient.createLabel(boardId, name, color);
    return {
      content: [{
        type: 'text',
        text: `## Label Created\\n\\n**Name:** ${escapeMd(label.name)}\\n**Color:** ${label.color || 'none'}\\n**Label ID:** ${label.id}`,
      }],
    };
  }

  private async updateLabel(
    labelId: string,
    name: string | undefined,
    color: string | undefined,
  ): Promise<CallToolResult> {
    if (name === undefined && color === undefined) {
      throw new Error('At least one of "name" or "color" must be provided');
    }
    const label = await this.trelloClient.updateLabel(labelId, { name, color });
    return {
      content: [{
        type: 'text',
        text: `## Label Updated\\n\\n**Name:** ${escapeMd(label.name)}\\n**Color:** ${label.color || 'none'}\\n**Label ID:** ${label.id}`,
      }],
    };
  }

  private async deleteLabel(labelId: string): Promise<CallToolResult> {
    await this.trelloClient.deleteLabel(labelId);
    return {
      content: [{ type: 'text', text: `## Label Deleted\\n\\nLabel ${labelId} removed from board.` }],
    };
  }

  private async addLabelToCard(cardId: string, labelId: string): Promise<CallToolResult> {
    await this.trelloClient.addLabelToCard(cardId, labelId);
    return {
      content: [{ type: 'text', text: `## Label Attached\\n\\nLabel ${labelId} added to card ${cardId}.` }],
    };
  }

  private async removeLabelFromCard(cardId: string, labelId: string): Promise<CallToolResult> {
    await this.trelloClient.removeLabelFromCard(cardId, labelId);
    return {
      content: [{ type: 'text', text: `## Label Detached\\n\\nLabel ${labelId} removed from card ${cardId}.` }],
    };
  }

  private async getStoryPoints(cardId: string): Promise<CallToolResult> {
    const card = await this.trelloClient.getCard(cardId);
    const sp = extractStoryPoints(card.labels);
    const labelList = formatLabels(card.labels);
    if (sp === null) {
      return {
        content: [{
          type: 'text',
          text: `## Story Points\\n\\n**Card:** ${escapeMd(card.name)}\\n**Labels:** ${labelList}\\n\\n_No story-point value detected in labels._ Supported formats: "SP:N", "N SP", "N pts", "Points: N", or pure-number labels.`,
        }],
      };
    }
    return {
      content: [{
        type: 'text',
        text: `## Story Points\\n\\n**Card:** ${escapeMd(card.name)}\\n**Story Points:** ${sp}\\n**Labels:** ${labelList}`,
      }],
    };
  }

  private async setupBoard(boardId: string): Promise<CallToolResult> {
    const lists = await this.trelloClient.ensureDefaultLists(boardId);
    
    return {
      content: [{
        type: 'text',
        text: `## Board Setup Complete\\n\\nCreated/verified default lists:\\n- **${escapeMd(lists.todo.name)}** (ID: ${lists.todo.id})\\n- **${escapeMd(lists.inProgress.name)}** (ID: ${lists.inProgress.id})\\n- **${escapeMd(lists.done.name)}** (ID: ${lists.done.id})\\n\\nBoard is now ready for task management!`
      }]
    };
  }

  private parseDueDate(dateStr: string): string {
    if (typeof dateStr !== 'string' || dateStr.length === 0) {
      throw new Error('dueDate must be a non-empty string');
    }

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);

    switch (dateStr.toLowerCase()) {
      case 'today':
        return now.toISOString();
      case 'tomorrow':
        return tomorrow.toISOString();
      case 'next week':
        return nextWeek.toISOString();
      default: {
        const parsed = new Date(dateStr);
        if (isNaN(parsed.getTime())) {
          throw new Error(`Invalid dueDate: "${dateStr}". Use ISO format (YYYY-MM-DD) or one of: today, tomorrow, next week.`);
        }
        return parsed.toISOString();
      }
    }
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

// Start the server
const server = new TrelloMCPServer();
server.start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});