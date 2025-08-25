# Trello MCP Server for Claude Code

A Model Context Protocol (MCP) server that integrates Trello with Claude Code, providing advanced project planning and task management capabilities with intelligent task analysis.

## Features

### 🎯 Core Task Management
- **Create, read, update, and delete tasks** across Trello boards and lists
- **Automatic board setup** with standard lists (To Do, In Progress, Done)
- **Priority management** with visual indicators
- **Due date handling** with natural language support ("tomorrow", "next week")
- **Status tracking** that maps to Trello list positions

### 🧠 Intelligent Task Analysis
- **Complexity assessment** (simple/moderate/complex) based on content analysis
- **Vague task detection** using natural language processing
- **Automatic task splitting** for overly complex tasks
- **Clarity validation** with generated clarifying questions
- **Board-wide analysis** with focused reporting

### 🔧 Advanced Features
- **Batch operations** for efficient task management
- **Natural language due dates** (today, tomorrow, next week)
- **Priority-based task organization**
- **Comprehensive task filtering** by status, priority, or due date
- **Real-time task intelligence** during creation

## Installation

1. **Clone and setup the project:**
   ```bash
   git clone <repository-url>
   cd trello-mcp-server
   npm install
   ```

2. **Configure Trello API credentials:**
   - Copy `.env.example` to `.env`
   - Get your Trello API key from: https://trello.com/app-key
   - Generate an API token by visiting: https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&name=Claude%20Code%20MCP&key=YOUR_API_KEY
   - Update `.env` with your credentials:
     ```env
     TRELLO_API_KEY=your_api_key_here
     TRELLO_API_TOKEN=your_api_token_here
     DEFAULT_TRELLO_BOARD_ID=optional_default_board_id
     ```

3. **Build the server:**
   ```bash
   npm run build
   ```

## Claude Code Integration

### Project-Level Configuration (Recommended)

Create `.mcp.json` in your project root:
```json
{
  "mcpServers": {
    "trello": {
      "command": "node",
      "args": ["/path/to/trello-mcp-server/build/index.js"],
      "env": {
        "TRELLO_API_KEY": "your_api_key",
        "TRELLO_API_TOKEN": "your_api_token",
        "DEFAULT_TRELLO_BOARD_ID": "your_default_board_id"
      }
    }
  }
}
```

### Global Configuration

Add to your Claude Code configuration:
```bash
claude mcp add-json '{
  "command": "node",
  "args": ["/path/to/trello-mcp-server/build/index.js"],
  "env": {
    "TRELLO_API_KEY": "your_api_key",
    "TRELLO_API_TOKEN": "your_api_token"
  }
}'
```

## Usage Examples

### Basic Task Management

```typescript
// List available boards
await trello_list_boards();

// Setup a board with default lists
await trello_setup_board({ boardId: "board_id" });

// Create a task with intelligence
await trello_create_task({
  boardId: "board_id",
  title: "Implement user authentication",
  description: "Create login/logout functionality with JWT tokens",
  priority: "high",
  dueDate: "next week"
});

// Update task status (automatically moves between lists)
await trello_update_task({
  cardId: "card_id",
  status: "in_progress"
});
```

### Intelligent Task Analysis

```typescript
// Analyze entire board for improvements
await trello_analyze_board({
  boardId: "board_id",
  focusArea: "vague" // or "complex", "overdue", "all"
});

// Get clarifying questions for a vague task
await trello_clarify_task({
  cardId: "card_id"
});

// Split a complex task into smaller ones
await trello_split_task({
  cardId: "card_id",
  autoCreate: true // Automatically create the suggested splits
});
```

### Advanced Filtering

```typescript
// Get tasks by status
await trello_get_tasks({
  boardId: "board_id",
  status: "in_progress"
});

// Get tasks from specific list
await trello_get_tasks({
  boardId: "board_id",
  listName: "To Do"
});
```

## Available Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `trello_list_boards` | List all accessible boards | - |
| `trello_get_board` | Get board details with statistics | `boardId` |
| `trello_create_task` | Create task with intelligence | `boardId`, `title`, `description`, `priority`, `dueDate` |
| `trello_update_task` | Update task or change status | `cardId`, `title`, `description`, `status` |
| `trello_analyze_board` | Analyze board for improvements | `boardId`, `focusArea` |
| `trello_split_task` | Split complex tasks | `cardId`, `autoCreate` |
| `trello_clarify_task` | Generate clarifying questions | `cardId` |
| `trello_get_tasks` | Filter and retrieve tasks | `boardId`, `listName`, `status` |
| `trello_setup_board` | Setup default task management lists | `boardId` |

## Task Intelligence Features

### Complexity Detection
The system automatically identifies task complexity based on:
- **Content length** and sentence structure
- **Technical keywords** (API, database, authentication, etc.)
- **Multiple action verbs** indicating compound tasks
- **Implementation complexity** indicators

### Vague Task Detection
Automatically flags tasks containing:
- **Unclear language** ("somehow", "figure out", "handle", etc.)
- **Missing acceptance criteria**
- **Ambiguous requirements**
- **Incomplete implementation details**

### Automatic Task Splitting
Intelligently suggests task splits based on:
- **Natural language conjunctions** ("and", "or")
- **Comma-separated requirements**
- **Complex implementation patterns**
- **Standard development phases** (planning, implementation, testing)

## Development

### Running in Development Mode
```bash
npm run dev  # Watches for changes and rebuilds
```

### Testing with MCP Inspector
```bash
npx @modelcontextprotocol/inspector build/index.js
```

### Environment Variables
- `TRELLO_API_KEY` - Your Trello API key (required)
- `TRELLO_API_TOKEN` - Your Trello API token (required)  
- `DEFAULT_TRELLO_BOARD_ID` - Default board for operations (optional)

## Architecture

### Components
- **TrelloClient**: Core API wrapper with full CRUD operations
- **TaskAnalyzer**: Natural language processing for task intelligence
- **MCP Server**: Protocol implementation with comprehensive tool handlers

### Data Flow
```
Claude Code → MCP Client → Trello MCP Server → Trello REST API → Trello Boards
```

### Task State Mapping
- **Pending** → "To Do" list
- **In Progress** → "In Progress" list  
- **Completed** → "Done" list

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and feature requests, please open an issue on GitHub or refer to the Trello API documentation for API-related questions.