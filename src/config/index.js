// src/config/index.js
require("dotenv").config();

const config = {
  mongodb: {
    uri:
      process.env.MONGODB_URI ||
      "mongodb://localhost:27017/telegramCopyTradingBot",
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
  },
  apiKeys: {
    moralis: process.env.MORALIS_API_KEY,
    inch: process.env.INCH_API_KEY,
  },
  wallets: {
    evm: process.env.EVM_PRIVATE_KEY,
    solana: process.env.SOLANA_PRIVATE_KEY,
  },
  polling: {
    newSwapFreq: parseInt(process.env.NEW_SWAP_POLLING_FREQ) || 60000,
    swapProcessingFreq: parseInt(process.env.SWAP_PROCESSING_FREQ) || 30000,
  },
  cleanup: {
    frequency: parseInt(process.env.CLEANUP_FREQ) || 3600000,
    hoursThreshold: parseInt(process.env.CLEANUP_HOURS_THRESHOLD) || 24,
  },
};

// Validate required configuration
const validateConfig = () => {
  const required = [
    {
      key: "telegram.token",
      value: config.telegram.token,
      name: "Telegram Bot Token",
    },
    {
      key: "apiKeys.moralis",
      value: config.apiKeys.moralis,
      name: "Moralis API Key",
    },
    { key: "apiKeys.inch", value: config.apiKeys.inch, name: "1inch API Key" },
    { key: "wallets.evm", value: config.wallets.evm, name: "EVM Private Key" },
    {
      key: "wallets.solana",
      value: config.wallets.solana,
      name: "Solana Private Key",
    },
  ];

  const missing = required.filter((item) => !item.value);

  if (missing.length > 0) {
    console.error("Missing required configuration:");
    missing.forEach((item) => {
      console.error(`- ${item.name} (${item.key})`);
    });
    return false;
  }

  return true;
};

config.isValid = validateConfig();

module.exports = config;
