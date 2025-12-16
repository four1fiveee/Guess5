# MCP Server Configuration

This project is configured with two Solana MCP servers to assist with smart contract development.

## Configured MCP Servers

### 1. Solana MCP (Official)
- **Name**: `solanaMcp`
- **Type**: Remote MCP server
- **Endpoint**: `https://mcp.solana.com/mcp`
- **Tools Available**:
  - `Solana Expert: Ask For Help` - Ask detailed questions about Solana
  - `Solana Documentation Search` - Search Solana documentation
  - `Ask Solana Anchor Framework Expert` - Anchor Framework specific questions

### 2. Solana Web3.js MCP Server
- **Name**: `solana-web3js`
- **Type**: Local MCP server
- **Location**: `solana-mcp-server/dist/index.js`
- **Tools Available**:
  - Account management (getAccountInfo, checkAccountBalance)
  - Transaction management (createTransaction, sendTransaction)
  - Key management (generateKeypair, importKeypair)
  - Program development (deployProgram, upgradeProgram)
  - Token operations (createToken, transferTokens)

## Configuration File

The MCP servers are configured in `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "solanaMcp": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.solana.com/mcp"]
    },
    "solana-web3js": {
      "command": "node",
      "args": ["${workspaceFolder}/solana-mcp-server/dist/index.js"]
    }
  }
}
```

## Usage

### In Cursor IDE

1. The MCP servers are automatically available when you open the project
2. Use Agent Mode (Cmd/Ctrl + I) to interact with the MCP tools
3. Ask questions like:
   - "Make me an anchor escrow program"
   - "How are CPI events implemented in Anchor 0.31?"
   - "Build an AMM that supports token-2022"
   - "What are the best practices for handling decimal values in Solana programs?"

### Example Queries

- **Anchor Framework**: "How can I implement a staking mechanism with time-locked rewards?"
- **Account Management**: "Check the balance of address X"
- **Program Deployment**: "Deploy this program to devnet"
- **Token Operations**: "Create and transfer SPL tokens"

## User Rules (Optional)

Add to your Cursor user rules for better MCP tool usage:

```
<MCP_USE_GUIDELINE>
  <INSTRUCTION>
    If you are working on a Solana-related project. Make frequent use of the following MCP tools to accomplish your goals.
  </INSTRUCTION>
  <TOOLS>
    The following Solana tools are at your disposal:
    - "Solana Expert: Ask For Help": Use this tool to ask detailed questions about Solana (how-to, concepts, APIs, SDKs, errors). Provide as much context as possible when using it.
    - "Solana Documentation Search": Use this tool to search the Solana documentation corpus for relevant information based on a query.
    - "Ask Solana Anchor Framework Expert": Use this tool for any questions specific to the Anchor Framework, including its APIs, SDKs, and error handling.
  </TOOLS>
</MCP_USE_GUIDELINE>
```

## Troubleshooting

### Solana Web3.js MCP Server Error

If you see an error with the `solana-web3js` server:
1. Navigate to `solana-mcp-server/`
2. Run `npm install --legacy-peer-deps`
3. Run `npm run build`
4. Restart Cursor

### Remote MCP Server Connection Issues

If the `solanaMcp` remote server fails to connect:
- Check your internet connection
- Verify `npx mcp-remote` is available
- The remote server should work automatically via npx

## Notes

- The remote Solana MCP server (`solanaMcp`) requires no local setup and works immediately
- The local Solana Web3.js MCP server requires building before use
- Both servers complement each other - use the remote one for documentation/expert advice, and the local one for actual blockchain operations

