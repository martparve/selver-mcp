# selver-mcp

MCP server for searching [Selver.ee](https://www.selver.ee) products and managing your shopping cart. Works with Claude Code, Claude Desktop, and any MCP-compatible client.

## Setup

```bash
git clone <repo-url>
cd selver-mcp
npm install
npm run build
```

## Install

### Claude Code

```bash
claude mcp add selver-mcp node /absolute/path/to/selver-mcp/dist/index.js
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "selver-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/selver-mcp/dist/index.js"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `search_products` | Search Selver.ee by query. Returns products with prices, nutrition, stock status. |
| `add_to_cart` | Add products to a guest cart by SKU. |
| `view_cart` | View cart contents and total. |
| `remove_from_cart` | Remove products from cart by SKU. |
| `open_cart` | Open selver.ee/cart in your default browser for checkout. |

## Usage tips

- Use Estonian search terms: "kana" (chicken), "riis" (rice), "lohe" (salmon), "muna" (eggs)
- Cart persists between sessions via `~/.selver-mcp/cart.json`
- After adding items, use `open_cart` to check out in your browser

## Requirements

- Node.js 18+
- No API keys or configuration needed
