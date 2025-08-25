# Trello MCP Server Setup Guide

This guide walks you through integrating the Trello MCP Server with Claude Code to replace the built-in todo system with Trello-based project management.

## Prerequisites

1. **Trello Account**: Active Trello account with access to create boards
2. **Node.js**: Version 18 or higher
3. **Claude Code**: Latest version with MCP support

## Step 1: Get Trello API Credentials

### 1.1 Get API Key
1. Visit https://trello.com/app-key
2. Copy your **API Key** - you'll need this for configuration

### 1.2 Generate API Token
1. In the same page, look for the **Token** link or visit:
   ```
   https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&name=Claude%20Code%20MCP&key=YOUR_API_KEY_HERE
   ```
   (Replace `YOUR_API_KEY_HERE` with your actual API key)

2. Click **Allow** to authorize the application
3. Copy the generated **Token**

### 1.3 Get Board ID (Optional)
1. Open your target Trello board in a browser
2. The URL will look like: `https://trello.com/b/BOARD_ID/board-name`
3. Copy the `BOARD_ID` part for default board configuration

## Step 2: Project Setup

### 2.1 Build the MCP Server
```bash
# Navigate to the project directory
cd /path/to/trello-mcp-server

# Install dependencies
npm install

# Build the server
npm run build
```

### 2.2 Configure Environment
```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your credentials
nano .env
```

Update `.env` with your Trello credentials:
```env
TRELLO_API_KEY=your_actual_api_key_here
TRELLO_API_TOKEN=your_actual_token_here
DEFAULT_TRELLO_BOARD_ID=your_board_id_here
```

## Step 3: Claude Code Integration

### Option A: Project-Level Configuration (Recommended)

1. **Create `.mcp.json` in your project directory:**
   ```json
   {
     "mcpServers": {
       "trello": {
         "command": "node",
         "args": ["/full/path/to/trello-mcp-server/build/index.js"],
         "env": {
           "TRELLO_API_KEY": "your_api_key",
           "TRELLO_API_TOKEN": "your_api_token",
           "DEFAULT_TRELLO_BOARD_ID": "your_board_id"
         }
       }
     }
   }
   ```

2. **Update paths** in the configuration to match your system

### Option B: Global Configuration

```bash
# Add MCP server globally to Claude Code
claude mcp add-json '{
  "command": "node",
  "args": ["/full/path/to/trello-mcp-server/build/index.js"],
  "env": {
    "TRELLO_API_KEY": "your_api_key",
    "TRELLO_API_TOKEN": "your_api_token",
    "DEFAULT_TRELLO_BOARD_ID": "your_board_id"
  }
}'
```

## Step 4: Verification

### 4.1 Test the MCP Server
```bash
# Test manually using MCP Inspector
npx @modelcontextprotocol/inspector build/index.js
```

### 4.2 Test with Claude Code
1. Start Claude Code in a directory with `.mcp.json`
2. Ask Claude: "List my Trello boards"
3. You should see your boards listed

### 4.3 Setup Your First Board
```
Claude, please set up my Trello board with ID 'your_board_id' for task management.
```

## Step 5: Usage Patterns

### Basic Workflow
1. **Create tasks** with intelligent analysis:
   ```
   Claude, create a task on my board: "Implement user authentication with JWT tokens and password hashing"
   ```

2. **Analyze and split complex tasks**:
   ```
   Claude, analyze my board for complex tasks that should be split.
   ```

3. **Track progress** by updating task status:
   ```
   Claude, move the authentication task to in progress status.
   ```

### Advanced Features
1. **Board analysis**:
   ```
   Claude, analyze my project board and identify any vague or unclear tasks.
   ```

2. **Task clarification**:
   ```
   Claude, help clarify this task: [card_id]
   ```

3. **Automatic task management**:
   ```
   Claude, review all tasks in my "To Do" list and flag any that need more details.
   ```

## Troubleshooting

### Common Issues

#### 1. "Missing required environment variables" Error
- **Solution**: Ensure `.env` file exists with correct `TRELLO_API_KEY` and `TRELLO_API_TOKEN`
- **Check**: File permissions allow reading `.env`

#### 2. "Trello API error: 401" (Unauthorized)
- **Solution**: Verify API key and token are correct
- **Check**: Token has read/write permissions
- **Generate**: New token if expired

#### 3. "Board not found" Error
- **Solution**: Verify board ID is correct
- **Check**: You have access to the board
- **Test**: List boards first to see available boards

#### 4. MCP Server Not Connecting
- **Solution**: Check file paths in `.mcp.json` are absolute and correct
- **Verify**: Node.js can execute `build/index.js`
- **Test**: Run server manually: `node build/index.js`

### Debug Mode
```bash
# Run server with debug output
DEBUG=* node build/index.js
```

### Logging
Check Claude Code logs for MCP connection issues:
```bash
# On macOS
tail -f ~/Library/Logs/Claude\ Code/main.log

# On Linux
tail -f ~/.config/claude-code/logs/main.log
```

## Security Considerations

1. **API Credentials**: Keep `.env` file private and never commit to version control
2. **Token Scope**: Use minimal required permissions (read/write for boards you need)
3. **Token Rotation**: Regularly rotate API tokens
4. **Board Access**: Only configure access to boards you need Claude to manage

## Performance Tips

1. **Default Board**: Set `DEFAULT_TRELLO_BOARD_ID` to avoid repeated board lookups
2. **Batch Operations**: Use board-wide analysis instead of individual card operations
3. **Filtering**: Use specific list names and status filters to reduce API calls

## Next Steps

1. **Customize Task Analysis**: Modify `task-analyzer.ts` for your specific project needs
2. **Add Labels**: Extend the system to use Trello labels for categorization
3. **Automation**: Set up webhooks for real-time updates
4. **Team Integration**: Share `.mcp.json` configuration with your team

## Support

- **GitHub Issues**: Report bugs and request features
- **Trello API Docs**: https://developer.atlassian.com/cloud/trello/
- **MCP Documentation**: https://modelcontextprotocol.io/docs