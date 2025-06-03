import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";
import fetch from 'node-fetch';

dotenv.config();

const isProduction = process.env.ENVIRONMENT === 'prod';
const CROSSMINT_API_BASE = isProduction 
  ? "https://www.crossmint.com/api"
  : "https://staging.crossmint.com/api";
const CHAIN = process.env.ENVIRONMENT
const TOKEN = 'credit';
const USER_AGENT = "crossmint-checkout/1.0";

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
    const response = await fetch(`${CROSSMINT_API_BASE}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      try {
        const json = await response.json();
        throw new Error(`HTTP error! status: ${json.message}, message: ${json.message}`);
      } catch (error) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    }
    return await response.json();
  } catch (error) {
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
  "Search for products on Amazon (shows your CREDIT balance)",
  {
    query: z.string().describe("Search query for Amazon products")
  },
  async ({ query }) => {
    try {
      const results = await searchAmazonProducts(query);
      let balanceText = "";
      // Show balance with search results
      try {
        const walletAddress = process.env.AGENT_WALLET_ADDRESS || "";
        const token = process.env.CHECKOUT_PAYMENT_METHOD || "credit";
        const chain = process.env.CHECKOUT_CHAIN || CHAIN;
        const url = `${CROSSMINT_API_BASE}/v1-alpha2/wallets/${walletAddress}/balances?tokens=${token}&chains=${chain}`;
        const headers = { "X-API-KEY": process.env.CROSSMINT_API_KEY || "" };
        const balanceResponse = await fetch(url, { headers });
        const balanceData = await balanceResponse.json();
        console.error('DEBUG: url', url);
        console.error('DEBUG: Raw balance API response:', JSON.stringify(balanceData, null, 2));
        let balance: number | null = null;
        let decimals = 2;
        const isCreditToken = token.toLowerCase() === 'credit';
        if (Array.isArray(balanceData)) {
          const tokenInfo = balanceData.find((t: any) =>
            (isCreditToken && t.token.toLowerCase() === 'credit') ||
            (!isCreditToken && t.token.toLowerCase() === token.toLowerCase())
          );
          console.error('DEBUG: tokenInfo', tokenInfo);
          if (tokenInfo && tokenInfo.balances && tokenInfo.balances[chain]) {
            const raw = tokenInfo.balances[chain];
            decimals = tokenInfo.decimals || 2;
            balance = parseFloat(raw) / Math.pow(10, decimals);
            console.error('DEBUG: raw', raw, 'decimals', decimals, 'balance', balance);
          }
        }
        balanceText = `\nYour CREDIT balance: ${typeof balance === 'number' && !isNaN(balance) ? balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: decimals }) : "(Could not fetch balance)"}`;
      } catch (e) {
        balanceText = "\n(Could not fetch balance)";
      }
      if (!results.organic_results || results.organic_results.length === 0) {
        return { content: [{ type: "text", text: "No results found." + balanceText }] };
      }
      const formattedResults = results.organic_results.map((product: any) => ({
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
            text: JSON.stringify(formattedResults, null, 2) + balanceText
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
  "Create an order for an Amazon product (checks your CREDIT balance first)",
  {
    asin: z.string().describe("Amazon ASIN of the product to order")
  },
  async ({ asin }) => {
    try {
      // 1. Get user's CREDIT balance
      const walletAddress = process.env.AGENT_WALLET_ADDRESS || "";
      const token = process.env.CHECKOUT_PAYMENT_METHOD || "credit";
      const chain = process.env.CHECKOUT_CHAIN || CHAIN;
      const url = `${CROSSMINT_API_BASE}/v1-alpha2/wallets/${walletAddress}/balances?tokens=${token}&chains=${chain}`;
      const headers = { "X-API-KEY": process.env.CROSSMINT_API_KEY || "" };
      const balanceResponse = await fetch(url, { headers });
      const balanceData = await balanceResponse.json();
      console.error('DEBUG: url', url);
      console.error('DEBUG: Raw balance API response:', JSON.stringify(balanceData, null, 2));
      let balance: number | null = null;
      let decimals = 2;
      const isCreditToken = token.toLowerCase() === 'credit';
      if (Array.isArray(balanceData)) {
        const tokenInfo = balanceData.find((t: any) =>
          (isCreditToken && t.token.toLowerCase() === 'credit') ||
          (!isCreditToken && t.token.toLowerCase() === token.toLowerCase())
        );
        console.error('DEBUG: tokenInfo', tokenInfo);
        if (tokenInfo && tokenInfo.balances && tokenInfo.balances[chain]) {
          const raw = tokenInfo.balances[chain];
          decimals = tokenInfo.decimals || 2;
          balance = parseFloat(raw) / Math.pow(10, decimals);
          console.error('DEBUG: raw', raw, 'decimals', decimals, 'balance', balance);
        }
      }
      let balanceText;
      if (typeof balance === 'number' && !isNaN(balance)) {
        balanceText = balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: decimals });
      } else {
        balanceText = `Could not find balance for token '${token}' on chain '${chain}'.`;
      }

      // 2. Get item price (from Crossmint order quote)
      const shippingInfo = {
        email: process.env.RECIPIENT_EMAIL,
        shippingAddress: {
          name: process.env.RECIPIENT_NAME,
          line1: process.env.RECIPIENT_ADDRESS_LINE1,
          line2: process.env.RECIPIENT_ADDRESS_LINE2 || '',
          city: process.env.RECIPIENT_CITY,
          state: process.env.RECIPIENT_STATE,
          postalCode: process.env.RECIPIENT_POSTAL_CODE,
          country: process.env.RECIPIENT_COUNTRY,
        }
      };
      // Search for the product in Crossmint's marketplace
      const searchResponse = await makeCrossmintRequest('/v1-alpha1/ws/search', 'POST', {
        searchParameters: {
          "standard.marketplace.amazon.asin": asin
        },
        categories: ["*"],
        keywords: [""]
      }, true);
      if (!searchResponse || !Array.isArray(searchResponse) || searchResponse.length === 0) {
        throw new Error('Item is not available for sale');
      }
      const firstResult = searchResponse[0];
      if (!firstResult.sellerId || !firstResult.listing?.id) {
        throw new Error('Invalid search result: missing seller ID or listing ID');
      }
      // Create order quote (but do not finalize yet)
      const orderResponse = await makeCrossmintRequest('/v1-alpha1/ws/orders', 'POST', {
        sellerId: firstResult.sellerId,
        items: [
          {
            listingId: firstResult.listing.id,
            listingParameters: {}
          }
        ],
        orderParameters: {
          shippingAddress: {
            name: shippingInfo.shippingAddress.name,
            address1: shippingInfo.shippingAddress.line1,
            address2: shippingInfo.shippingAddress.line2 || "",
            city: shippingInfo.shippingAddress.city,
            province: shippingInfo.shippingAddress.state,
            postalCode: shippingInfo.shippingAddress.postalCode,
            country: shippingInfo.shippingAddress.country
          }
        }
      }, true);
      // Get price from order quote
      const itemPrice = parseFloat(orderResponse?.quote?.totalPrice?.amount || "0");
      if (parseFloat(typeof balance === 'number' && !isNaN(balance) ? balance.toString() : "0") < itemPrice) {
        return {
          content: [
            { type: "text", text: `You have ${typeof balance === 'number' && !isNaN(balance) ? balance.toString() : "0"} credits, but this item costs ${itemPrice} credits. Please top up your wallet to proceed.` }
          ]
        };
      }
      // Proceed with checkout
      const checkoutResponse = await makeCrossmintRequest('/2022-06-09/orders', 'POST', {
        recipient: {
          email: shippingInfo.email,
          physicalAddress: {
            name: shippingInfo.shippingAddress.name,
            line1: shippingInfo.shippingAddress.line1,
            line2: shippingInfo.shippingAddress.line2 || "",
            city: shippingInfo.shippingAddress.city,
            postalCode: shippingInfo.shippingAddress.postalCode,
            country: shippingInfo.shippingAddress.country,
            state: shippingInfo.shippingAddress.state
          }
        },
        locale: "en-US",
        payment: {
          receiptEmail: shippingInfo.email,
          method: CHAIN,
          currency: TOKEN,
          payerAddress: walletAddress
        },
        externalOrder: orderResponse
      });
      const orderId = checkoutResponse.order?.orderId;
      const price = checkoutResponse.order?.quote?.totalPrice?.amount;
      const currency = checkoutResponse.order?.quote?.totalPrice?.currency;
      const serializedTransaction = checkoutResponse.order?.payment?.preparation?.serializedTransaction;
      return {
        content: [
          {
            type: "text",
            text: `Order created! Order ID: ${orderId}, Price: ${price} ${currency}\nDetails: ${JSON.stringify({ orderId, price, currency, serializedTransaction }, null, 2)}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to create order: ${
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

// Tool: Send Transaction
server.tool(
  "send-transaction",
  "Send a transaction to complete the order",
  {
    serializedTransaction: z.string().describe("Serialized transaction data from create-order")
  },
  async ({ serializedTransaction }) => {
    try {
      const walletAddress = process.env.AGENT_WALLET_ADDRESS || '';
      const response = await makeCrossmintRequest(`/2022-06-09/wallets/${walletAddress}`, 'GET');
      if (!response.config?.adminSigner?.locator) {
        throw new Error('Admin signer not found');
      }
      const adminSigner = response.config.adminSigner.locator;
      // Send transaction
      const txResponse = await makeCrossmintRequest(`/2022-06-09/wallets/${walletAddress}/transactions`, 'POST', {
        params: {
          calls: [
            {
              transaction: serializedTransaction
            }
          ],
          chain: CHAIN,
          signer: adminSigner
        }
      });
      if (!txResponse.id) {
        throw new Error('Failed to send transaction');
      }
      return {
        content: [
          { type: "text", text: `Transaction sent! Transaction ID: ${txResponse.id}, Status: ${txResponse.status}` }
        ]
      };
    } catch (error) {
      return {
        content: [
          { type: "text", text: `Failed to send transaction: ${JSON.stringify(error, null, 2)}` }
        ]
      };
    }
  }
);

// Helper: Check order status
async function checkOrderStatus(orderId: string): Promise<string> {
  const url = `${CROSSMINT_API_BASE}/2022-06-09/orders/${orderId}`;
  const headers = { "X-API-KEY": process.env.CROSSMINT_API_KEY || "" };
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
async function checkTransactionStatus(walletLocator: string, transactionId: string): Promise<string> {
  const url = `${CROSSMINT_API_BASE}/2022-06-09/wallets/${walletLocator}/transactions/${transactionId}`;
  const headers = { "X-API-KEY": process.env.CROSSMINT_API_KEY || "" };
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
async function pollOrderUntilComplete(orderId: string, maxAttempts = 90, interval = 2000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await checkOrderStatus(orderId);
    if (status.includes("completed") || status.includes("failed") || status.includes("Insufficient funds")) {
      return status;
    }
    await new Promise(res => setTimeout(res, interval));
  }
  return "Timed out waiting for order completion.";
}

// Tool: Poll Order Status
server.tool(
  "poll-order-status",
  "Poll an order until it is completed, failed, or times out (max ~100 seconds)",
  {
    orderId: z.string().describe("Order ID to poll for status")
  },
  async ({ orderId }) => {
    try {
      const result = await pollOrderUntilComplete(orderId, 50, 2000); // 50 attempts, 2s interval
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

// Tool: Get CREDIT Token Balance (uses agent wallet by default)
server.tool(
  "get-credit-balance",
  "Get the CREDIT token balance for a wallet (defaults to your agent wallet if not provided)",
  {
    walletAddress: z.string().optional().describe("Wallet address to check balance for (defaults to agent wallet)")
  },
  async ({ walletAddress }) => {
    try {
      const address = walletAddress || process.env.AGENT_WALLET_ADDRESS || "";
      const token = process.env.CHECKOUT_PAYMENT_METHOD || "credit";
      const chain = process.env.CHECKOUT_CHAIN || CHAIN;
      const url = `${CROSSMINT_API_BASE}/v1-alpha2/wallets/${address}/balances?tokens=${token}&chains=${chain}`;
      const headers = { "X-API-KEY": process.env.CROSSMINT_API_KEY || "" };
      const response = await fetch(url, { headers });
      const data = await response.json();
      console.error('DEBUG: url', url);
      console.error('DEBUG: Raw balance API response:', JSON.stringify(data, null, 2));
      let balance: number | null = null;
      let decimals = 2;
      const isCreditToken = token.toLowerCase() === 'credit';
      if (Array.isArray(data)) {
        const tokenInfo = data.find((t: any) =>
          (isCreditToken && t.token.toLowerCase() === 'credit') ||
          (!isCreditToken && t.token.toLowerCase() === token.toLowerCase())
        );
        console.error('DEBUG: tokenInfo', tokenInfo);
        if (tokenInfo && tokenInfo.balances && tokenInfo.balances[chain]) {
          const raw = tokenInfo.balances[chain];
          decimals = tokenInfo.decimals || 2;
          balance = parseFloat(raw) / Math.pow(10, decimals);
          console.error('DEBUG: raw', raw, 'decimals', decimals, 'balance', balance);
        }
      }
      let balanceText;
      if (typeof balance === 'number' && !isNaN(balance)) {
        balanceText = balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: decimals });
      } else {
        balanceText = `Could not find balance for token '${token}' on chain '${chain}'.`;
      }
      return {
        content: [
          { type: "text", text: `CREDIT balance for ${address}: ${balanceText}` }
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