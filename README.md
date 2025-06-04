# Crossmint Checkout MCP Server

A Model Context Protocol (MCP) server implementation for Crossmint Checkout, enabling AI agents to facilitate Amazon purchases using cryptocurrency payments.

## Features

- Search Amazon products with filtering capabilities
- Create orders with cryptocurrency payments (USDC or CREDIT)
- Support for multiple chains (Ethereum Sepolia, Base Sepolia)
- Real-time balance checking
- Order status tracking and polling
- Transaction management
- Comprehensive logging system

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Crossmint API key
- Search API key (for Amazon product search)
- Agent wallet address with sufficient funds

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
CROSSMINT_API_KEY=your_crossmint_api_key
SEARCH_API_KEY=your_search_api_key
AGENT_WALLET_ADDRESS=your_wallet_address
RECIPIENT_EMAIL=recipient@email.com
RECIPIENT_NAME=Recipient Name
RECIPIENT_ADDRESS_LINE1=123 Main St
RECIPIENT_ADDRESS_LINE2=Apt 4B
RECIPIENT_CITY=New York
RECIPIENT_STATE=NY
RECIPIENT_POSTAL_CODE=10001
RECIPIENT_COUNTRY=US
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/Crossmint/checkout-mcp-demo.git
cd checkout-mcp-demo
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Usage

Start the MCP server:
```bash
npm start
```

### Available Tools

1. **Search Amazon Products**
   - Query: Search term for Amazon products
   - Returns: Filtered list of products with prices and ASINs

2. **Create Order**
   - Parameters:
     - ASIN: Amazon product identifier
     - Token: Payment token (usdc or credit)
     - Chain: Blockchain network (ethereum-sepolia or base-sepolia)
   - Returns: Order details including ID and transaction information

3. **Send Transaction**
   - Parameters:
     - SerializedTransaction: Transaction data from order creation
     - Token: Payment token
     - Chain: Blockchain network
   - Returns: Transaction status

4. **Check Order Status**
   - Parameters:
     - OrderId: Order identifier
     - Chain: Blockchain network
   - Returns: Current order status

5. **Poll Order Status**
   - Parameters:
     - OrderId: Order identifier
     - Chain: Blockchain network
   - Returns: Final order status (completion, failure, or timeout)

6. **Get Token Balance**
   - Parameters:
     - Token: Token to check (usdc or credit)
     - WalletAddress (optional): Address to check (defaults to agent wallet)
   - Returns: Token balances across supported chains

## Supported Chains and Tokens

- Ethereum Sepolia:
  - USDC
  - CREDIT
- Base Sepolia:
  - USDC
  - CREDIT

## Error Handling

The server includes comprehensive error handling for:
- Insufficient funds
- Invalid payment methods
- API errors
- Transaction failures
- Network issues

## Logging

The server implements a structured logging system that:
- Logs all API requests and responses
- Tracks order creation flow
- Monitors balance checks
- Records transaction status
- Provides detailed error information

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
