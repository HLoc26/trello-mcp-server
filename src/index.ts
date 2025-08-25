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

// Load environment variables
dotenv.config();

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
        description: 'Get all tasks from a board or specific list with filtering options',
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
    ];
  }

  private async handleToolCall(toolName: string, args: any): Promise<CallToolResult> {
    try {
      switch (toolName) {
        case 'trello_list_boards':
          return await this.listBoards();
          
        case 'trello_get_board':
          return await this.getBoard(args.boardId);
          
        case 'trello_create_task':
          return await this.createTask(args);
          
        case 'trello_update_task':
          return await this.updateTask(args);
          
        case 'trello_analyze_board':
          return await this.analyzeBoard(args.boardId, args.focusArea);
          
        case 'trello_split_task':
          return await this.splitTask(args.cardId, args.autoCreate);
          
        case 'trello_clarify_task':
          return await this.clarifyTask(args.cardId);
          
        case 'trello_get_tasks':
          return await this.getTasks(args);
          
        case 'trello_setup_board':
          return await this.setupBoard(args.boardId);
          
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
    const boardList = boards.map(board => `- **${board.name}** (ID: ${board.id})${board.desc ? `\\n  ${board.desc}` : ''}`).join('\\n');
    
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
      return `- **${list.name}**: ${listCards.length} tasks`;
    }).join('\\n');

    return {
      content: [{
        type: 'text',
        text: `## Board: ${board.name}\\n\\n${board.desc ? `**Description:** ${board.desc}\\n\\n` : ''}**Lists:**\\n${listsInfo}\\n\\n**Total Tasks:** ${cards.filter(c => !c.closed).length}\\n**Board URL:** ${board.url}`
      }]
    };
  }

  private async createTask(args: any): Promise<CallToolResult> {
    const { boardId, listName = 'To Do', title, description = '', priority, dueDate } = args;
    
    // Ensure default lists exist
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
        text: `## Task Created Successfully\\n\\n**Title:** ${card.name}\\n**List:** ${targetList.name}\\n**Card ID:** ${card.id}\\n**URL:** ${card.url}${analysisText}`
      }]
    };
  }

  private async updateTask(args: any): Promise<CallToolResult> {
    const { cardId, title, description, status, priority, dueDate } = args;
    const card = await this.trelloClient.getCard(cardId);
    
    const updates: any = {};
    
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
        text: `## Task Updated Successfully\\n\\n**Title:** ${updatedCard.name}\\n**Card ID:** ${updatedCard.id}\\n**URL:** ${updatedCard.url}`
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
        report += `### ${card.name}\\n`;
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
          text: `## Task Split Analysis\\n\\nThe task "${card.name}" doesn't appear to need splitting. It's already appropriately scoped.`
        }]
      };
    }

    let report = `## Task Split Suggestions\\n\\n**Original Task:** ${card.name}\\n\\n**Suggested splits:**\\n`;
    
    analysis.suggestedSplits.forEach((suggestion, index) => {
      report += `${index + 1}. ${suggestion}\\n`;
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
        report += `- [${newCard.name}](${newCard.url})\\n`;
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
    
    let report = `## Task Clarity Analysis\\n\\n**Task:** ${card.name}\\n\\n`;
    
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

  private async getTasks(args: any): Promise<CallToolResult> {
    const { boardId, listName, status = 'all' } = args;
    
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
      return `- **${card.name}**${dueText}\\n  ID: ${card.id}\\n  ${card.desc.substring(0, 100)}${card.desc.length > 100 ? '...' : ''}`;
    }).join('\\n\\n');

    return {
      content: [{
        type: 'text',
        text: `## Tasks${listName ? ` in ${listName}` : ''} (${status})\\n\\n${taskList || 'No tasks found.'}`
      }]
    };
  }

  private async setupBoard(boardId: string): Promise<CallToolResult> {
    const lists = await this.trelloClient.ensureDefaultLists(boardId);
    
    return {
      content: [{
        type: 'text',
        text: `## Board Setup Complete\\n\\nCreated/verified default lists:\\n- **${lists.todo.name}** (ID: ${lists.todo.id})\\n- **${lists.inProgress.name}** (ID: ${lists.inProgress.id})\\n- **${lists.done.name}** (ID: ${lists.done.id})\\n\\nBoard is now ready for task management!`
      }]
    };
  }

  private parseDueDate(dateStr: string): string {
    // Handle relative dates
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
      default:
        // Try to parse as ISO date
        const parsed = new Date(dateStr);
        return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
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