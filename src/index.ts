import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";
import fetch from 'node-fetch';

dotenv.config();

// Custom logger that won't interfere with JSON-RPC
const logger = {
  info: (message: string, data?: any) => {
    process.stderr.write(JSON.stringify({ type: 'log', level: 'info', message, data }) + '\n');
  },
  error: (message: string, data?: any) => {
    process.stderr.write(JSON.stringify({ type: 'log', level: 'error', message, data }) + '\n');
  }
};

const CROSSMINT_API_BASE = "https://staging.crossmint.com/";
const USER_AGENT = "crossmint-checkout/1.0";

// --- Supported Chains and Token Matrix ---
type SupportedChain =
  | 'ethereum-sepolia'
  | 'base-sepolia';
type SupportedToken = 'usdc' | 'credit';

const SUPPORTED_CHAINS: Record<SupportedChain, SupportedToken[]> = {
  'ethereum-sepolia': ['usdc', 'credit'],
  'base-sepolia': ['usdc', 'credit'],
};

const SUPPORTED_PAYMENT_METHODS = ['credit', 'usdc'];

function resolvePaymentConfig(token: string, chain: string) {
  const userToken = token.toLowerCase();
  const userChain = chain.toLowerCase();

  if (!SUPPORTED_PAYMENT_METHODS.includes(userToken)) {
    throw new Error(`Unsupported payment method: ${userToken}`);
  }

  if (!(userChain in SUPPORTED_CHAINS)) {
    throw new Error(`Unsupported chain: ${userChain}`);
  }
  const supportedTokens = SUPPORTED_CHAINS[userChain as SupportedChain];
  if (!supportedTokens.includes(userToken as SupportedToken)) {
    throw new Error(`Token '${userToken}' is not supported on chain '${userChain}'`);
  }

  return {
    token: userToken,
    chain: userChain,
  };
}

// Helper function for making Crossmint API requests
async function makeCrossmintRequest(
  endpoint: string,
  method: string = "GET",
  body?: any,
  useBearerAuth: boolean = false
): Promise<any | null> {
  const headers = {
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
    ...(useBearerAuth 
      ? { "Authorization": `Bearer ${process.env.CROSSMINT_API_KEY}` }
      : { "X-API-KEY": process.env.CROSSMINT_API_KEY || "" }
    )
  };
  try {
    logger.info('Crossmint API Request', { method, endpoint, body });
    const response = await fetch(`${CROSSMINT_API_BASE}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const responseData = await response.json();
    logger.info('Crossmint API Response', { status: response.status, data: responseData });
    if (!response.ok) {
      try {
        throw new Error(`HTTP error! status: ${response.status}, message: ${responseData.message || JSON.stringify(responseData)}`);
      } catch (error) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    }
    return responseData;
  } catch (error) {
    logger.error('Crossmint API Error', { error });
    throw error;
  }
}

// Amazon search helper
async function searchAmazonProducts(query: string): Promise<any> {
  const params = new URLSearchParams({
    engine: 'amazon_search',
    q: query,
    amazon_domain: 'amazon.com',
    page: '1'
  });
  const url = `https://www.searchapi.io/api/v1/search?${params.toString()}`;
  try {
    const myHeaders = {
      "Authorization": `Bearer ${process.env.SEARCH_API_KEY}`
    };
    const response = await fetch(url, {
      method: 'GET',
      headers: myHeaders,
      redirect: "follow"
    });
    const data = await response.json();
    return data;
  } catch (error: any) {
    throw error;
  }
}

// Create server instance
const server = new McpServer({
  name: "crossmint-checkout",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Tool: Search Amazon
server.tool(
  "search",
  "Search for products on Amazon",
  {
    query: z.string().describe("Search query for Amazon products")
  },
  async ({ query }) => {
    try {
      const results = await searchAmazonProducts(query);
      if (!results.organic_results || results.organic_results.length === 0) {
        return { content: [{ type: "text", text: "No results found." }] };
      }
      const formattedResults = results.organic_results
        .filter((product: any) => {
          // Exclude Amazon Fresh items
          if (product.is_amazon_fresh === true) return false;
          // Exclude Whole Foods Market items
          if (product.is_whole_foods_market === true) return false;
          // Exclude items with price per unit measurements
          if (product.price_per && (
            product.price_per.ounce ||
            product.price_per.lb ||
            product.price_per.gram
          )) return false;
          return true;
        })
        .map((product: any) => ({
          title: product.title,
          price: product.price,
          asin: product.asin,
          rating: product.rating,
          reviews: product.reviews,
          url: product.url
        }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formattedResults, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to search Amazon: ${
              typeof error === 'object' && error && 'message' in error
                ? (error as any).message
                : String(error)
            }`
          }
        ]
      };
    }
  }
);

// Tool: Create Order (with credit check)
server.tool(
  "create-order",
  "Create an order for an Amazon product",
  {
    asin: z.string().describe("Amazon ASIN of the product to order"),
    token: z.string().describe("Token to use for payment (usdc or credit)"),
    chain: z.string().describe("Chain to use for payment (ethereum-sepolia or base-sepolia)")
  },
  async ({ asin, token, chain }) => {
    try {
      const walletAddress = process.env.AGENT_WALLET_ADDRESS || "";
      logger.info('Order Creation Flow Start', {
        step: 'Initialization',
        asin,
        paymentMethod: `${token.toUpperCase()} on ${chain}`,
        walletAddress,
        recipientEmail: process.env.RECIPIENT_EMAIL
      });

      // First get a quote to check the total amount with fees
      logger.info('Order Creation Flow', { step: 'Getting Quote' });
      const quoteRequest = {
        lineItems: [
          {
            productLocator: `amazon:${asin}`
          }
        ],
        payment: {
          method: chain,
          currency: token,
          payerAddress: walletAddress
        }
      };
      logger.info('Quote Request', quoteRequest);
      
      const quoteResponse = await makeCrossmintRequest('/api/2022-06-09/orders', 'POST', quoteRequest);
      logger.info('Quote Response', quoteResponse);

      // Get user's balance
      logger.info('Order Creation Flow', { 
        step: 'Checking Balance',
        token: token.toUpperCase(),
        chain
      });
      const balanceUrl = `${CROSSMINT_API_BASE}/api/v1-alpha2/wallets/${walletAddress}/balances?tokens=${token}`;
      const balanceResponse = await fetch(balanceUrl, { 
        headers: { "X-API-KEY": process.env.CROSSMINT_API_KEY || "" } 
      });
      const balanceData = await balanceResponse.json();
      logger.info('Balance Response', balanceData);
      
      // Find balance for the selected chain
      const tokenInfo = balanceData.find((t: any) => t.token.toLowerCase() === token.toLowerCase());
      const userBalance = tokenInfo?.balances?.[chain] ? 
        parseFloat(tokenInfo.balances[chain]) / Math.pow(10, tokenInfo.decimals || 2) : 0;
      
      const totalAmount = parseFloat(quoteResponse.totalAmount);
      logger.info('Balance Analysis', {
        userBalance,
        requiredAmount: totalAmount,
        currency: quoteResponse.currency,
        difference: (userBalance - totalAmount).toFixed(2)
      });
      
      // Check if user has enough balance including fees
      if (userBalance < totalAmount) {
        logger.info('Insufficient Balance', {
          currentBalance: userBalance,
          requiredAmount: totalAmount,
          currency: quoteResponse.currency,
          shortage: (totalAmount - userBalance).toFixed(2)
        });
        return {
          content: [
            {
              type: "text",
              text: `Insufficient balance: The total amount including fees is ${totalAmount} ${quoteResponse.currency}.\n` +
                    `Your current balance is ${userBalance} ${token.toUpperCase()} on ${chain}.\n\n` +
                    `Would you like to try again with a different payment method?`
            }
          ]
        };
      }

      logger.info('Balance Check', { status: 'passed', message: 'Sufficient funds available' });

      // Create the order
      logger.info('Order Creation Flow', { step: 'Creating Order' });
      const orderRequest = {
        recipient: {
          email: process.env.RECIPIENT_EMAIL,
          physicalAddress: {
            name: process.env.RECIPIENT_NAME,
            line1: process.env.RECIPIENT_ADDRESS_LINE1,
            line2: process.env.RECIPIENT_ADDRESS_LINE2 || '',
            city: process.env.RECIPIENT_CITY,
            state: process.env.RECIPIENT_STATE,
            postalCode: process.env.RECIPIENT_POSTAL_CODE,
            country: process.env.RECIPIENT_COUNTRY
          }
        },
        payment: {
          method: chain,
          currency: token,
          payerAddress: walletAddress
        },
        lineItems: [
          {
            productLocator: `amazon:${asin}`
          }
        ]
      };
      logger.info('Order Request', orderRequest);
      
      const orderResponse = await makeCrossmintRequest('/api/2022-06-09/orders', 'POST', orderRequest);
      logger.info('Order Response', orderResponse);

      // Check if there are insufficient funds
      if (orderResponse.payment?.status === "crypto-payer-insufficient-funds") {
        logger.info('Order Status Check', { 
          status: 'failed',
          reason: 'Insufficient funds detected in order response'
        });
        const totalAmount = orderResponse.quote?.totalPrice;
        const currency = orderResponse.quote?.currency;
        
        return {
          content: [
            {
              type: "text",
              text: `Insufficient funds: The total amount including fees is ${totalAmount} ${currency}.\n` +
                    `Please choose a different payment method or top up your wallet.`
            }
          ]
        };
      }

      const orderId = orderResponse.order?.orderId;
      const price = orderResponse.quote?.totalPrice;
      const currency = orderResponse.quote?.currency;
      const serializedTransaction = orderResponse.order?.payment?.preparation?.serializedTransaction;

      logger.info('Order Creation Complete', {
        orderId,
        price,
        currency,
        hasTransaction: !!serializedTransaction,
        orderPhase: orderResponse.order?.phase,
        paymentStatus: orderResponse.order?.payment?.status
      });

      return {
        content: [
          {
            type: "text",
            text: `Order created! Order ID: ${orderId}, Price: ${price} ${currency}\nDetails: ${JSON.stringify({ orderId, price, currency, serializedTransaction }, null, 2)}`
          }
        ]
      };

    } catch (error) {
      // Try to parse the error response as JSON first
      let errorMessage = 'Unknown error occurred';
      if (typeof error === 'object' && error && 'message' in error) {
        try {
          const errorJson = JSON.parse((error as any).message);
          errorMessage = errorJson.message || errorJson.error || (error as any).message;
        } catch {
          errorMessage = (error as any).message;
        }
      }
      logger.error('Order Creation Failed', { error: errorMessage });
      return {
        content: [
          {
            type: "text",
            text: `Failed to create order: ${errorMessage}`
          }
        ]
      };
    }
  }
);

// Tool: Send Transaction
server.tool(
  "send-transaction",
  "Send a transaction to complete the order",
  {
    serializedTransaction: z.string().describe("Serialized transaction data from create-order"),
    token: z.string().describe("Token to use for payment (usdc or credit)"),
    chain: z.string().describe("Chain to use for payment (ethereum, ethereum-sepolia, base, or base-sepolia)")
  },
  async ({ serializedTransaction, token, chain }) => {
    try {
      const walletAddress = process.env.AGENT_WALLET_ADDRESS || '';
      const { token: resolvedToken, chain: resolvedChain } = resolvePaymentConfig(token, chain);
      const response = await makeCrossmintRequest(`/api/2022-06-09/wallets/${walletAddress}`, 'GET');
      if (!response.config?.adminSigner?.locator) {
        throw new Error('Admin signer not found');
      }
      const adminSigner = response.config.adminSigner.locator;
      // Send transaction
      const txResponse = await makeCrossmintRequest(`/api/2022-06-09/wallets/${walletAddress}/transactions`, 'POST', {
        params: {
          calls: [
            {
              transaction: serializedTransaction
            }
          ],
          chain: resolvedChain,
          signer: adminSigner
        }
      });
      if (!txResponse.id) {
        throw new Error('Failed to send transaction: No transaction ID returned');
      }
      return {
        content: [
          { type: "text", text: `Transaction sent! Transaction ID: ${txResponse.id}, Status: ${txResponse.status}` }
        ]
      };
    } catch (error) {
      // Format error message to be more descriptive
      const errorMessage = typeof error === 'object' && error && 'message' in error
        ? (error as any).message
        : String(error);
      
      return {
        content: [
          { 
            type: "text", 
            text: `Transaction failed. The purchase process cannot continue. Error: ${errorMessage}` 
          }
        ]
      };
    }
  }
);

// Helper: Check order status
async function checkOrderStatus(orderId: string, chain: string): Promise<string> {
  const url = `${CROSSMINT_API_BASE}/api/2022-06-09/orders/${orderId}`;
  const headers = { 
    "X-API-KEY": process.env.CROSSMINT_API_KEY || "",
    "X-Chain": chain
  };
  const response = await fetch(url, { headers });
  const order = await response.json();

  if (order.payment?.status === "crypto-payer-insufficient-funds") {
    return "Insufficient funds: Please add credits to your wallet and try again.";
  }

  if (order.phase === "completed") {
    return "Order completed! Your item(s) are on the way.";
  }
  if (order.phase === "failed") {
    return "Order failed. All items could not be delivered. Refunds are automatic.";
  }
  if (order.phase === "awaiting-payment") {
    return "Order is awaiting payment. Please complete payment to proceed.";
  }
  return `Order is in phase: ${order.phase}`;
}

// Helper: Check transaction status
async function checkTransactionStatus(walletLocator: string, transactionId: string, chain: string): Promise<string> {
  const url = `${CROSSMINT_API_BASE}/api/2022-06-09/wallets/${walletLocator}/transactions/${transactionId}`;
  const headers = { 
    "X-API-KEY": process.env.CROSSMINT_API_KEY || "",
    "X-Chain": chain
  };
  const response = await fetch(url, { headers });
  const tx = await response.json();

  switch (tx.status) {
    case "completed":
      return "Transaction completed!";
    case "in_progress":
      return "Transaction is still in progress.";
    case "expired":
      return "Transaction expired.";
    case "failed":
      return "Transaction failed.";
    case "refund":
      return "Transaction refunded.";
    default:
      return `Transaction status: ${tx.status}`;
  }
}

// Helper: Poll order status until complete or failed
async function pollOrderUntilComplete(orderId: string, chain: string, maxAttempts = 90, interval = 2000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await checkOrderStatus(orderId, chain);
    if (status.includes("completed") || status.includes("failed") || status.includes("Insufficient funds")) {
      return status;
    }
    await new Promise(res => setTimeout(res, interval));
  }
  return "Timed out waiting for order completion.";
}

// Tool: Check Order Status (single check)
server.tool(
  "check-order-status",
  "Check the current status of an order",
  {
    orderId: z.string().describe("Order ID to check status for"),
    chain: z.string().describe("Chain the order was created on (ethereum, ethereum-sepolia, base, or base-sepolia)")
  },
  async ({ orderId, chain }) => {
    try {
      const status = await checkOrderStatus(orderId, chain);
      return {
        content: [
          { type: "text", text: `Status for order ${orderId}: ${status}` }
        ]
      };
    } catch (error) {
      return {
        content: [
          { type: "text", text: `Failed to check order status: ${
            typeof error === 'object' && error && 'message' in error
              ? (error as any).message
              : String(error)
          }` }
        ]
      };
    }
  }
);

// Tool: Poll Order Status (only used in purchase flow)
server.tool(
  "poll-order-status",
  "Poll an order until it is completed, failed, or times out (max ~100 seconds). Only use this during the purchase flow.",
  {
    orderId: z.string().describe("Order ID to poll for status"),
    chain: z.string().describe("Chain the order was created on (ethereum, ethereum-sepolia, base, or base-sepolia)")
  },
  async ({ orderId, chain }) => {
    try {
      const result = await pollOrderUntilComplete(orderId, chain, 50, 2000); // 50 attempts, 2s interval
      return {
        content: [
          { type: "text", text: `Polling result for order ${orderId}: ${result}` }
        ]
      };
    } catch (error) {
      return {
        content: [
          { type: "text", text: `Failed to poll order: ${
            typeof error === 'object' && error && 'message' in error
              ? (error as any).message
              : String(error)
          }` }
        ]
      };
    }
  }
);

// Tool: Get Token Balance (uses agent wallet by default)
server.tool(
  "get-token-balance",
  "Get the balance for a specific token (usdc, or credit) on all supported chains",
  {
    walletAddress: z.string().optional().describe("Wallet address to check balance for (defaults to agent wallet)"),
    token: z.string().describe("Token to check balance for (must be one of: usdc, credit)")
  },
  async ({ walletAddress, token: userToken }) => {
    try {
      const address = walletAddress || process.env.AGENT_WALLET_ADDRESS || "";
      const token = userToken.toLowerCase();

      // Validate token
      if (!SUPPORTED_PAYMENT_METHODS.includes(token)) {
        return {
          content: [
            { type: "text", text: `Unsupported token: ${token}. Must be one of: ${SUPPORTED_PAYMENT_METHODS.join(', ')}` }
          ]
        };
      }

      // Get all balances for the token
      const url = `${CROSSMINT_API_BASE}/api/v1-alpha2/wallets/${address}/balances?tokens=${token}`;
      const headers = { "X-API-KEY": process.env.CROSSMINT_API_KEY || "" };
      const response = await fetch(url, { headers });
      const data = await response.json();
      logger.error('DEBUG: url', url);
      logger.error('DEBUG: Raw balance API response:', JSON.stringify(data, null, 2));

      if (!Array.isArray(data) || data.length === 0) {
        return {
          content: [
            { type: "text", text: `Could not find balance information for token '${token}'` }
          ]
        };
      }

      const tokenInfo = data.find((t: any) => t.token.toLowerCase() === token.toLowerCase());
      if (!tokenInfo || !tokenInfo.balances) {
        return {
          content: [
            { type: "text", text: `No balance information found for token '${token}'` }
          ]
        };
      }

      // Filter balances for supported chains and format the output
      const balances = Object.entries(tokenInfo.balances)
        .filter(([chain]) => chain in SUPPORTED_CHAINS && SUPPORTED_CHAINS[chain as SupportedChain].includes(token as SupportedToken))
        .map(([chain, rawBalance]) => {
          const decimals = tokenInfo.decimals || 2;
          const balance = parseFloat(rawBalance as string) / Math.pow(10, decimals);
          return {
            chain,
            balance: balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: decimals })
          };
        });

      if (balances.length === 0) {
        return {
          content: [
            { type: "text", text: `No supported chains found for token '${token}'` }
          ]
        };
      }

      // Format the response
      const balanceText = balances
        .map(({ chain, balance }) => `${token.toUpperCase()} balance on ${chain}: ${balance}`)
        .join('\n');

      return {
        content: [
          { type: "text", text: `${token.toUpperCase()} balances for ${address}:\n${balanceText}` }
        ]
      };
    } catch (error) {
      return {
        content: [
          { type: "text", text: `Failed to get balance: ${
            typeof error === 'object' && error && 'message' in error
              ? (error as any).message
              : String(error)
          }` }
        ]
      };
    }
  }
);

async function main() {
  if (!process.env.CROSSMINT_API_KEY) {
    process.exit(1);
  }
  if (!process.env.AGENT_WALLET_ADDRESS) {
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});