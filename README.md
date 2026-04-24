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

## Checkout in a real browser

selver-mcp builds a Selver guest cart on the server side - but to see and check out that cart in your browser, the cart token needs to be injected into `localStorage` on selver.ee. A separate browser-control MCP handles this.

Install [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) alongside:

```bash
claude mcp add chrome-devtools --scope user -- npx -y chrome-devtools-mcp@latest
```

Then ask Claude to "open my Selver cart in the browser" - it will navigate to selver.ee, set the cart token in localStorage, and reload to show your items.

## Usage tips

- Use Estonian search terms: "kana" (chicken), "riis" (rice), "lohe" (salmon), "muna" (eggs)
- Cart persists between sessions via `~/.selver-mcp/cart.json`

## Requirements

- Node.js 18+
- No API keys or configuration needed
