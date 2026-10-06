---
name: selver-cart
description: Use this skill when the user wants to shop at Estonian online grocery stores (Selver, Rimi, Barbora) - search products, compare prices across stores, build a cart in one or several stores, and open it in the browser for checkout. Coordinates selver-mcp with chrome-devtools-mcp. Handles weight-based goods (qty in kg, fixed steps).
---

# Grocery Cart Workflow (Selver, Rimi, Barbora)

Two MCPs work together:

- **`selver-mcp`** searches all stores and manages carts. Despite the name it covers `selver`, `rimi`, and `barbora`.
- **`chrome-devtools-mcp`** shows the cart in a real browser so the user can log in and check out.

Coop is not supported: its Tallinn, Tartu, and Pärnu e-shops run on Wolt and Bolt Food; only Haapsalu has its own web shop.

## How carts differ per store

| Store | Cart lives | What `add_to_cart` does | Login |
|---|---|---|---|
| `selver` | On Selver's server (guest cart held by the MCP) | Adds immediately; then run `get_browser_sync_script` to show it | At checkout only |
| `rimi` | In the browser session | Resolves products and returns a script to run in the rimi.ee tab | Optional (guest cart works) |
| `barbora` | In the logged-in browser session | Resolves products and returns a script to run in the barbora.ee tab | Required before the script works |

## When to use

- "Lisa Selverist / Rimist / Barborast ... carti", "Osta ...", "Ava mu cart"
- "Compile this list in Selver and Rimi and compare", "Kus on odavam?"
- "Mis maksab X Selveris?"

## Workflow

### 1. Search

`search_products` with an **Estonian** term and `stores: [...]`. Default is Selver only; pass several stores to compare. Rimi names are abbreviated ("Br. rinnafil." = broileri rinnafilee). `sort: "price_asc"` for cheapest.

Each product carries `price`, `original_price`/`discount_pct`, `unit_price` + `unit_price_per`, `in_stock`, `category`, `nutrition` (Selver only), and the ordering rules `qty_step`, `min_qty`, `sold_by_weight`.

### 2. Compare a whole list

`compare_prices` with `items: [{query, qty}]` and `stores`. It returns top candidates per line per store with line totals and an estimated total per store. Check the candidates: the same query can match a 300 g pack in one store and a kg price in another. Then pick SKUs per store and call `add_to_cart` for each store the user wants.

### 3. Quantities

- `sold_by_weight: false`: pieces. `sold_by_weight: true`: **kg**, a multiple of `qty_step` (Selver 0.3, Rimi 0.3, Barbora 0.35 are common). The tools snap up and report `qty_adjusted`.
- Rough weights: cucumber 0.3 kg, tomato 0.15 kg, banana 0.2 kg, chicken fillet pack 0.4 to 0.6 kg.

### 4. Add to cart

`add_to_cart` with `store`, `items: [{sku, qty}]`.

- **Selver** returns the server cart with the real `grand_total`. Then call `get_browser_sync_script` (store selver) and follow it: `new_page` on the cart URL, `evaluate_script` with `replay_script`. Verify `items` and `grand_total` in its return value.
- **Rimi / Barbora** return `resolved`, `failed`, and `browser.script`. Follow `browser.steps`: open the store tab (`new_page`, or `select_page` if one exists), run `browser.script` with `evaluate_script`, then navigate to the cart URL in `browser.steps`. The script's return value is the truth: `ok`, `applied`, `cart.items`, `cart.total`. For Barbora, `login_required: true` means: tell the user to log in in that tab, wait, run the same script again. Never type the user's password.

### 5. Changes later

- Selver: `remove_from_cart` / `clear_cart` server-side, then rerun the sync script.
- Rimi / Barbora: `remove_from_cart` / `clear_cart` return a script; run it in the store tab. `view_cart` with `store` returns a read-only script.

### 6. Report

Per store: item list with quantities, total, fees to expect (Selver bag fee 0.50 €, Barbora 4 € under 39.99 €, Rimi minimum order 20 €), and which tab is open for checkout.

## Pitfalls

- **"Toote samm on muutunud (0.3)"** (Selver): qty not a multiple of the step; resend a multiple of `qty_step`.
- **Cart empty in the browser**: the sync/apply script was skipped or ran before the page rendered. Run it again.
- **Rimi script says no XSRF-TOKEN**: the tab is not on www.rimi.ee/epood or has not finished loading. Navigate there and rerun.
- **Barbora login_required**: expected before login. The user logs in; you rerun.
- **"Browser already running"** (chrome-devtools-mcp): use `list_pages`, or ask the user to run `pkill -f 'chrome-devtools-mcp/chrome-profile'`.
- **Guest cart expired** (Selver): `add_to_cart` recreates it and sets `cart_recreated: true`; re-add earlier items.

## Example

User: "Pane kokku 2 kanafileed, kilo tomateid ja 2 täispiima nii Selveris kui Rimis ja ütle, kus odavam."

1. `compare_prices(items: [{query: "kanafilee", qty: 2}, {query: "tomat", qty: 1}, {query: "täispiim", qty: 2}], stores: ["selver", "rimi"], candidates: 3)`.
2. Pick comparable products per store (same pack size), state both totals.
3. `add_to_cart(store: "selver", items: [...])`, then `get_browser_sync_script(store: "selver")` and run it.
4. `add_to_cart(store: "rimi", items: [...])`, open rimi.ee, run `browser.script`, navigate to the checkout URL.
5. Reply with both carts, totals, and the fee notes.
