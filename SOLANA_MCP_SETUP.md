# Solana MCP Server Setup

The Solana MCP (Model Context Protocol) server has been installed to assist with Solana smart contract development.

## Installation Status

✅ **MCP Server Installed**: `solana-mcp-server/` directory
✅ **Dependencies Installed**: Using `--legacy-peer-deps` to resolve version conflicts
✅ **Configuration Created**: `.cursor/mcp.json` for Cursor IDE integration

## Location

The MCP server is located at:
```
solana-mcp-server/
```

## Build Status

To build the MCP server:
```bash
cd solana-mcp-server
npm run build
# or
npx tsc
```

## Configuration

The MCP server is configured in `.cursor/mcp.json` for Cursor IDE integration.

For Claude Desktop, add to your configuration file:
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "solana": {
      "command": "node",
      "args": ["C:\\Users\\henry\\OneDrive\\Desktop\\Guess5\\solana-mcp-server\\dist\\index.js"]
    }
  }
}
```

## Available Tools

The MCP server provides tools for:
- Account management (getAccountInfo, checkAccountBalance)
- Transaction management (createTransaction, sendTransaction, simulateTransaction)
- Key management (generateKeypair, importKeypair)
- Program development (deployProgram, upgradeProgram)
- Token operations (createToken, transferTokens, mintTokens)

## Usage

Once configured, you can ask the AI assistant to:
- "Create a new Solana account and show me the keypair"
- "What's the current balance of address X?"
- "Help me deploy a Solana program to devnet"
- "Create and transfer SPL tokens"

## Note

The MCP server uses Solana web3.js v2.0, which may have dependency conflicts with some packages. The installation uses `--legacy-peer-deps` to resolve these conflicts.

