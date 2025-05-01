const mongoose = require("mongoose");

const ChainSchema = new mongoose.Schema({
  chainId: {
    type: String,
    required: true,
    unique: true,
  },
  name: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ["evm", "solana"],
    required: true,
  },
  rpcUrl: {
    type: String,
    required: true,
  },
  moralisChainName: {
    type: String,
    required: true,
  },
  explorerUrl: {
    type: String,
    required: true,
  },
  explorerTxUrl: {
    type: String,
    required: true,
  },
  explorerAddressUrl: {
    type: String,
    required: true,
  },
  swapAggregator: {
    type: String,
    enum: ["1inch", "jupiter"],
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  nativeToken: {
    symbol: {
      type: String,
      required: true,
    },
    decimals: {
      type: Number,
      required: true,
    },
    address: {
      type: String,
      required: true,
    },
  },
});

module.exports = mongoose.model("Chain", ChainSchema);
