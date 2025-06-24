const mongoose = require("mongoose");
require("dotenv").config();

const connectDB = async () => {
  try {
    // Optimized MongoDB connection settings for speed
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,          // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000,   // Close sockets after 45 seconds of inactivity
    });
    
    // Set default query options for speed
    mongoose.set('bufferCommands', false);
    
    console.log("MongoDB connected with optimizations...");
    return true;
  } catch (err) {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
