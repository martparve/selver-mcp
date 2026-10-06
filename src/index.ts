#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerSearchTools } from './tools/search.js';
import { registerCartTools } from './tools/cart.js';

export const VERSION = '0.3.0';

// Sent to every MCP client at initialize; Claude Desktop and Claude Code put it in the system prompt.
// This replaces the need for a skill file or a pasted memory.
export const INSTRUCTIONS = `Estonian grocery shopping for Selver, Rimi and Barbora (Coop has no usable e-shop outside Haapsalu).
A browser MCP (chrome-devtools) is needed to show carts; neither MCP alone is enough.

Workflow:
1. search_products (Estonian terms; stores: selver/rimi/barbora) or compare_prices for a whole list across stores. Check pack sizes before comparing totals.
2. Quantities: sold_by_weight items are in kg and must be multiples of qty_step (tools snap up and report qty_adjusted). Rough weights: cucumber 0.3 kg, tomato 0.15 kg.
3. add_to_cart per store.
   - selver: cart is built server-side. Then call get_browser_sync_script(store=selver), open https://www.selver.ee/cart with chrome-devtools new_page, run replay_script with evaluate_script, check its returned items and grand_total.
   - rimi / barbora: the response has browser.steps and browser.script. Open the store tab (new_page, or select_page if one exists), run browser.script with evaluate_script, then navigate to the cart URL in the steps. The script's return value is the real cart. If it returns login_required (Barbora always, until the user logs in), ask the user to log in in that tab, then run the same script again. Never type the user's password.
4. Report per store: items, total, fees (Selver bag 0.50 EUR, Barbora 4 EUR under 39.99 EUR, Rimi minimum order 20 EUR) and that the tab is open for login and checkout.
remove_from_cart / clear_cart / view_cart follow the same split: server-side for selver, a script for rimi and barbora.`;

const server = new McpServer({ name: 'selver-mcp', version: VERSION }, { instructions: INSTRUCTIONS });

registerSearchTools(server);
registerCartTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
