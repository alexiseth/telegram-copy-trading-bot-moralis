// src/services/sniping/tokenMonitor.js
const { Connection, PublicKey } = require("@solana/web3.js");
const { TOKEN_PROGRAM_ID } = require("@solana/spl-token");
const { getSolanaConnection } = require("../wallets/solana");
const SnipeTarget = require("../../db/models/snipeTargets");
const SnipeExecution = require("../../db/models/snipeExecutions");
const { executeSnipe } = require("./snipeExecutor");
const axios = require("axios");
require("dotenv").config();

class TokenMonitor {
  constructor() {
    this.connection = null;
    this.wsConnection = null;
    this.isRunning = false;
    this.subscriptions = new Map();
    this.processedTransactions = new Set();
    this.raydiumProgramId = new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");
    this.orcaProgramId = new PublicKey("9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP");
    
    // Keep track of processed transactions to avoid duplicates
    this.processedTxCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  async initialize() {
    try {
      console.log("🔍 Initializing Token Monitor...");
      
      this.connection = getSolanaConnection();
      
      // Test connection
      const version = await this.connection.getVersion();
      console.log(`✅ Connected to Solana RPC: ${version['solana-core']}`);
      
      // Initialize WebSocket connection if available
      if (process.env.SOLANA_WSS_URL) {
        try {
          const wsUrl = process.env.SOLANA_WSS_URL;
          this.wsConnection = new Connection(wsUrl, 'confirmed');
          console.log("✅ WebSocket connection initialized");
        } catch (wsError) {
          console.warn("⚠️  WebSocket connection failed, using polling mode:", wsError.message);
        }
      }
      
      // Start monitoring
      this.isRunning = true;
      this.startMonitoring();
      
      console.log("🚀 Token Monitor initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize Token Monitor:", error);
      throw error;
    }
  }

  async startMonitoring() {
    if (!this.isRunning) return;
    
    console.log("🔄 Starting token monitoring...");
    
    // Monitor Raydium pool creation
    this.monitorRaydiumPools();
    
    // Monitor Orca pool creation  
    this.monitorOrcaPools();
    
    // Start processing active snipe targets
    this.processSnipeTargets();
    
    // Clean up old processed transactions periodically
    setInterval(() => this.cleanupProcessedTxCache(), 60000); // Every minute
  }

  async monitorRaydiumPools() {
    try {
      if (this.wsConnection) {
        // WebSocket monitoring for real-time updates
        console.log("📡 Setting up WebSocket monitoring for Raydium pools...");
        
        const subscriptionId = this.wsConnection.onLogs(
          this.raydiumProgramId,
          (logs, context) => {
            this.handleRaydiumLogs(logs, context);
          },
          'confirmed'
        );
        
        this.subscriptions.set('raydium', subscriptionId);
      } else {
        // Fallback to polling mode
        console.log("🔄 Using polling mode for Raydium pool monitoring...");
        this.pollRaydiumPools();
      }
    } catch (error) {
      console.error("❌ Error setting up Raydium monitoring:", error);
      // Fallback to polling
      this.pollRaydiumPools();
    }
  }

  async monitorOrcaPools() {
    try {
      if (this.wsConnection) {
        console.log("📡 Setting up WebSocket monitoring for Orca pools...");
        
        const subscriptionId = this.wsConnection.onLogs(
          this.orcaProgramId,
          (logs, context) => {
            this.handleOrcaLogs(logs, context);
          },
          'confirmed'
        );
        
        this.subscriptions.set('orca', subscriptionId);
      } else {
        console.log("🔄 Using polling mode for Orca pool monitoring...");
        this.pollOrcaPools();
      }
    } catch (error) {
      console.error("❌ Error setting up Orca monitoring:", error);
      this.pollOrcaPools();
    }
  }

  async handleRaydiumLogs(logs, context) {
    try {
      const signature = logs.signature;
      
      // Check if already processed
      if (this.isTransactionProcessed(signature)) {
        return;
      }
      
      // Mark as processed
      this.markTransactionProcessed(signature);
      
      // Look for pool creation events
      const poolCreationLogs = logs.logs.filter(log => 
        log.includes("initialize") || log.includes("InitializeInstruction")
      );
      
      if (poolCreationLogs.length > 0) {
        console.log(`🆕 Potential Raydium pool creation detected: ${signature}`);
        await this.processNewPool(signature, 'raydium', context);
      }
    } catch (error) {
      console.error("❌ Error handling Raydium logs:", error);
    }
  }

  async handleOrcaLogs(logs, context) {
    try {
      const signature = logs.signature;
      
      if (this.isTransactionProcessed(signature)) {
        return;
      }
      
      this.markTransactionProcessed(signature);
      
      const poolCreationLogs = logs.logs.filter(log => 
        log.includes("initialize") || log.includes("InitializePool")
      );
      
      if (poolCreationLogs.length > 0) {
        console.log(`🆕 Potential Orca pool creation detected: ${signature}`);
        await this.processNewPool(signature, 'orca', context);
      }
    } catch (error) {
      console.error("❌ Error handling Orca logs:", error);
    }
  }

  async processNewPool(signature, dexType, context) {
    try {
      console.log(`🔍 Processing new ${dexType} pool: ${signature}`);
      
      // Get transaction details
      const transaction = await this.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0
      });
      
      if (!transaction) {
        console.log(`⚠️  Transaction not found: ${signature}`);
        return;
      }
      
      // Parse transaction to extract token information
      const tokenInfo = await this.parsePoolTransaction(transaction, dexType);
      
      if (!tokenInfo) {
        console.log(`⚠️  Could not parse token info from transaction: ${signature}`);
        return;
      }
      
      console.log(`🎯 New token detected: ${tokenInfo.symbol} (${tokenInfo.address})`);
      
      // Check if any active snipe targets match this token
      await this.checkSnipeTargets(tokenInfo, signature);
      
    } catch (error) {
      console.error(`❌ Error processing new pool ${signature}:`, error);
    }
  }

  async parsePoolTransaction(transaction, dexType) {
    try {
      // Handle different transaction formats
      let accountKeys = [];
      
      if (transaction.transaction && transaction.transaction.message) {
        if (transaction.transaction.message.accountKeys) {
          accountKeys = transaction.transaction.message.accountKeys;
        } else if (transaction.transaction.message.staticAccountKeys) {
          accountKeys = transaction.transaction.message.staticAccountKeys;
        }
      }
      
      if (!Array.isArray(accountKeys) || accountKeys.length === 0) {
        console.log("⚠️  No account keys found in transaction");
        return null;
      }
      
      // Look for token mint accounts (simplified approach)
      const tokenMints = [];
      
      // Take first few account keys as potential token mints
      const keysToCheck = accountKeys.slice(0, Math.min(10, accountKeys.length));
      
      for (const accountKey of keysToCheck) {
        try {
          if (typeof accountKey === 'string' && accountKey.length > 40) {
            // This looks like a potential token mint
            tokenMints.push(accountKey);
          }
        } catch (error) {
          continue;
        }
      }
      
      if (tokenMints.length === 0) {
        return null;
      }
      
      // Return the first potential token (simplified)
      const firstToken = tokenMints[0];
      return {
        address: firstToken,
        symbol: 'UNKNOWN',
        name: '',
        decimals: 9,
        dexType: dexType,
        poolAddress: firstToken // Simplified
      };
      
    } catch (error) {
      console.error("❌ Error parsing pool transaction:", error);
      return null;
    }
  }

  async getTokenMetadata(mintAddress) {
    try {
      // Try to get token metadata from Jupiter API
      const response = await axios.get(`https://price.jup.ag/v6/price?ids=${mintAddress}`, {
        timeout: 5000
      });
      
      if (response.data && response.data.data && response.data.data[mintAddress]) {
        const priceData = response.data.data[mintAddress];
        return {
          symbol: priceData.symbol || 'UNKNOWN',
          name: priceData.name || '',
          decimals: priceData.decimals || 9
        };
      }
      
      // Fallback to on-chain metadata parsing
      const mintInfo = await this.connection.getParsedAccountInfo(new PublicKey(mintAddress));
      if (mintInfo.value && mintInfo.value.data.parsed) {
        return {
          symbol: 'UNKNOWN',
          name: '',
          decimals: mintInfo.value.data.parsed.info.decimals
        };
      }
      
      return null;
    } catch (error) {
      console.error(`❌ Error getting token metadata for ${mintAddress}:`, error);
      return null;
    }
  }

  extractPoolAddress(transaction, dexType) {
    // Simplified pool address extraction
    // In production, you'd implement proper instruction parsing
    const accountKeys = transaction.transaction.message.accountKeys;
    return accountKeys[0]; // Placeholder
  }

  async checkSnipeTargets(tokenInfo, signature) {
    try {
      // Get all active snipe targets for this token
      const targets = await SnipeTarget.find({
        tokenAddress: tokenInfo.address,
        isActive: true,
        snipeStatus: 'pending'
      });
      
      if (targets.length === 0) {
        console.log(`📋 No active snipe targets for ${tokenInfo.symbol}`);
        return;
      }
      
      console.log(`🎯 Found ${targets.length} snipe target(s) for ${tokenInfo.symbol}`);
      
      // Process each target
      for (const target of targets) {
        try {
          await this.processSnipeTarget(target, tokenInfo, signature);
        } catch (error) {
          console.error(`❌ Error processing snipe target ${target._id}:`, error);
        }
      }
    } catch (error) {
      console.error("❌ Error checking snipe targets:", error);
    }
  }

  async processSnipeTarget(target, tokenInfo, triggerSignature) {
    try {
      console.log(`🚀 Processing snipe target: ${target.tokenSymbol} for user ${target.userId}`);
      
      // Create snipe execution record
      const execution = new SnipeExecution({
        userId: target.userId,
        targetId: target._id,
        tokenAddress: target.tokenAddress,
        tokenSymbol: tokenInfo.symbol,
        status: 'pending',
        amountIn: target.targetAmount,
        slippageTarget: target.maxSlippage,
        priorityFee: target.priorityFee,
        detectionTime: new Date(),
        executionStartTime: new Date(),
        marketData: {
          poolAddress: tokenInfo.poolAddress
        }
      });
      
      await execution.save();
      
      // Execute the snipe
      const result = await executeSnipe(target, execution, tokenInfo);
      
      if (result.success) {
        console.log(`✅ Snipe executed successfully for ${tokenInfo.symbol}`);
        
        // Update target as executed
        await target.markAsExecuted({
          price: result.executionPrice,
          amountReceived: result.amountOut,
          transactionHash: result.txHash
        });
        
        // Update execution record
        await execution.markAsSuccess({
          amountOut: result.amountOut,
          executionPrice: result.executionPrice,
          slippageActual: result.slippageActual,
          transactionHash: result.txHash,
          blockNumber: result.blockNumber,
          marketData: result.marketData
        });
        
      } else {
        console.log(`❌ Snipe failed for ${tokenInfo.symbol}: ${result.error}`);
        
        // Update target as failed
        await target.markAsFailed(result.error);
        
        // Update execution record
        await execution.markAsFailed({
          code: result.errorCategory,
          message: result.error
        });
      }
      
    } catch (error) {
      console.error(`❌ Error processing snipe target:`, error);
    }
  }

  async processSnipeTargets() {
    // Process existing snipe targets that might have been triggered
    setInterval(async () => {
      try {
        const activeTargets = await SnipeTarget.getActiveTargets();
        
        for (const target of activeTargets) {
          // Check if target conditions are met
          await this.checkTargetConditions(target);
        }
      } catch (error) {
        console.error("❌ Error processing snipe targets:", error);
      }
    }, 10000); // Check every 10 seconds
  }

  async checkTargetConditions(target) {
    try {
      // Check if liquidity threshold is met
      if (target.triggerCondition === 'liquidity_added') {
        const liquidityInfo = await this.getTokenLiquidity(target.tokenAddress);
        
        if (liquidityInfo && liquidityInfo.totalLiquidity >= target.minLiquidity) {
          console.log(`💰 Liquidity threshold met for ${target.tokenSymbol}: ${liquidityInfo.totalLiquidity} SOL`);
          
          const tokenInfo = {
            address: target.tokenAddress,
            symbol: target.tokenSymbol,
            name: target.tokenName,
            decimals: 9, // Default for most tokens
            poolAddress: liquidityInfo.poolAddress
          };
          
          await this.processSnipeTarget(target, tokenInfo, 'liquidity_check');
        }
      }
    } catch (error) {
      console.error(`❌ Error checking target conditions:`, error);
    }
  }

  async getTokenLiquidity(tokenAddress) {
    try {
      // Get liquidity info from Jupiter API
      const response = await axios.get(`https://price.jup.ag/v6/price?ids=${tokenAddress}`, {
        timeout: 5000
      });
      
      if (response.data && response.data.data && response.data.data[tokenAddress]) {
        const priceData = response.data.data[tokenAddress];
        return {
          totalLiquidity: priceData.liquidity || 0,
          poolAddress: null // Would need to be extracted from pool data
        };
      }
      
      return null;
    } catch (error) {
      console.error(`❌ Error getting token liquidity:`, error);
      return null;
    }
  }

  // Polling fallback methods
  async pollRaydiumPools() {
    setInterval(async () => {
      try {
        // Get recent transactions for Raydium program
        const signatures = await this.connection.getSignaturesForAddress(
          this.raydiumProgramId,
          { limit: 10 }
        );
        
        for (const sig of signatures) {
          if (!this.isTransactionProcessed(sig.signature)) {
            await this.processNewPool(sig.signature, 'raydium', null);
          }
        }
      } catch (error) {
        console.error("❌ Error polling Raydium pools:", error);
      }
    }, 30000); // Poll every 30 seconds
  }

  async pollOrcaPools() {
    setInterval(async () => {
      try {
        const signatures = await this.connection.getSignaturesForAddress(
          this.orcaProgramId,
          { limit: 10 }
        );
        
        for (const sig of signatures) {
          if (!this.isTransactionProcessed(sig.signature)) {
            await this.processNewPool(sig.signature, 'orca', null);
          }
        }
      } catch (error) {
        console.error("❌ Error polling Orca pools:", error);
      }
    }, 30000);
  }

  // Utility methods
  isTransactionProcessed(signature) {
    return this.processedTxCache.has(signature);
  }

  markTransactionProcessed(signature) {
    this.processedTxCache.set(signature, Date.now());
  }

  cleanupProcessedTxCache() {
    const now = Date.now();
    for (const [signature, timestamp] of this.processedTxCache) {
      if (now - timestamp > this.cacheExpiry) {
        this.processedTxCache.delete(signature);
      }
    }
  }

  async stop() {
    console.log("🛑 Stopping Token Monitor...");
    this.isRunning = false;
    
    // Close WebSocket subscriptions
    if (this.wsConnection) {
      for (const [name, subscriptionId] of this.subscriptions) {
        try {
          await this.wsConnection.removeOnLogsListener(subscriptionId);
          console.log(`✅ Closed ${name} subscription`);
        } catch (error) {
          console.error(`❌ Error closing ${name} subscription:`, error);
        }
      }
    }
    
    this.subscriptions.clear();
    console.log("✅ Token Monitor stopped");
  }
}

module.exports = TokenMonitor;