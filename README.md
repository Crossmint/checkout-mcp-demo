# Crossmint Checkout MCP Server

A Model Control Protocol (MCP) server that enables AI assistants (like Claude) to help users search for and purchase products on Amazon using Crossmint's payment infrastructure.

**Note:** This project is currently designed and tested for macOS environments. Linux support is likely, but Windows is untested.

## Features

- **Amazon Product Search**: Search for products using SearchAPI.io
- **Crossmint Integration**: Create orders and process payments using Crossmint's API
- **MCP Protocol Support**: Implements the Model Control Protocol for AI assistant integration
- **Automated Shipping**: Uses environment variables for shipping information
- **Order & Transaction Polling**: Tools to poll order status and check wallet balances
- **Credit Balance Check**: Always checks your balance before purchase and displays it with search results
- **Error Handling**: Comprehensive error handling and validation

## Prerequisites

- macOS (tested), Linux (likely works), Windows (untested)
- Node.js 18 or higher
- npm or yarn
- Crossmint API key
- SearchAPI.io API key
- Ethereum wallet address for the agent

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/crossmint-checkout.git
cd crossmint-checkout
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with the following variables:
```env
# API Keys
SEARCH_API_KEY=your_searchapi_key
CROSSMINT_API_KEY=your_crossmint_key

# Agent Configuration
AGENT_WALLET_ADDRESS=your_ethereum_wallet_address

# Shipping Information (all will be automatically uppercased)
RECIPIENT_EMAIL=your_email@example.com
RECIPIENT_NAME=Your Name
RECIPIENT_ADDRESS_LINE1=123 Main St
RECIPIENT_ADDRESS_LINE2=Apt 4B (optional)
RECIPIENT_CITY=Your City
RECIPIENT_STATE=Your State
RECIPIENT_POSTAL_CODE=12345
RECIPIENT_COUNTRY=US

# Payment/Token/Chain
CHECKOUT_PAYMENT_METHOD=credit   # or usdc, or a token address
CHECKOUT_CHAIN=ethereum-sepolia  # or your preferred chain

# Environment (optional, defaults to 'test')
ENVIRONMENT=test
```

## Building and Running

1. Build the TypeScript code:
```bash
npm run build
```

2. Run the MCP server:
```bash
npm run crossmint-checkout
```

## Integration with Claude or Other AI Assistants

1. Configure your AI assistant to use the MCP server (see scripts/update-claude-config.js for Claude integration).
2. Use prompts like:
   - "I want to buy wireless headphones."
   - "Search Amazon for a USB-C charger and help me buy it."
   - "Buy this https://www.amazon.com/dp/B07ZPKN6YR"

## Available Tools / Functions

### 1. `search`
- **Description:** Search for products on Amazon and display your current CREDIT (or other token) balance.
- **Parameters:**
  - `query` (string): Search query for Amazon products
- **Returns:**
  - List of products (title, price, ASIN, rating, reviews, URL)
  - Your current balance (formatted)

### 2. `get-credit-balance`
- **Description:** Get the token balance for a wallet (defaults to your agent wallet if not provided)
- **Parameters:**
  - `walletAddress` (string, optional): Wallet address to check balance for
- **Returns:**
  - Formatted balance for the specified token and chain

### 3. `create-order`
- **Description:** Create an order for an Amazon product (checks your balance first)
- **Parameters:**
  - `asin` (string): Amazon ASIN of the product to order
- **Logic:**
  - Checks your balance for the selected token/chain before proceeding
  - If insufficient, returns a message to top up
  - If sufficient, creates the order and returns order details

### 4. `send-transaction`
- **Description:** Send a transaction to complete the order
- **Parameters:**
  - `serializedTransaction` (string): Serialized transaction data from create-order
- **Returns:**
  - Transaction status and ID

### 5. `poll-order-status`
- **Description:** Poll an order until it is completed, failed, or times out (default: 50 attempts, 2s interval, ~100 seconds)
- **Parameters:**
  - `orderId` (string): Order ID to poll for status
- **Returns:**
  - Final status or timeout message

### 6. `check-order-status` (manual status check)
- **Description:** Check the current status of an order immediately (no polling)
- **Parameters:**
  - `orderId` (string): Order ID to check
- **Returns:**
  - Current order phase/status

## Error Handling

- Input validation for all parameters
- Specific error codes for different types of errors
- Detailed error messages
- Stack traces in test environment

## Environment Variables

- `CHECKOUT_PAYMENT_METHOD`: Token to use for payment and balance checks (e.g., `credit`, `usdc`, or a token address)
- `CHECKOUT_CHAIN`: Blockchain network to use (e.g., `ethereum-sepolia`)
- `AGENT_WALLET_ADDRESS`: Wallet address used for all balance checks and payments by default

## Development

### Project Structure
```
.
├── src/
│   └── index.ts           # Main server implementation
├── scripts/
│   ├── generate-agent-wallet.js    # (Optional) Agent wallet generation
│   ├── transfer-credits.js         # (Optional) Credit transfer utility
│   └── update-claude-config.js     # Claude config helper
├── build/                 # Compiled JavaScript files
├── .env                   # Environment variables
├── package.json
└── tsconfig.json
```

### Testing

- Use the available tools via Claude or your AI assistant.
- You can also call the MCP server directly using JSON-RPC over stdio.

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## License

MIT

## Notes
- This project is currently focused on macOS. Linux is likely compatible. Windows is untested.
- Remove or ignore any `.DS_Store` or large asset/demo files before publishing.
- For support, open an issue or submit a pull request.
