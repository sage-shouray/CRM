const mongoose = require("mongoose");
const OptionsModel = require("../Models/optionModel"); // Adjust the path as needed
const optionsData = require("../../frontend/public/Options.json"); // Adjust the path to your JSON file
require("dotenv").config(); // Load environment variables from .env file

// Ensure process.env.MONGO_CONN is accessible and contains the correct MongoDB URI
const mongo_url =
  process.env.MONGO_CONN ||
  "mongodb+srv://Nishtha:Nishtha1@cluster0.eol8ani.mongodb.net/CRM"
  // "mongodb+srv://bhardwajvaidehi12:uiDQ27NAyamc6dpD@cluster0.rssvri8.mongodb.net/auth-db?retryWrites=true&w=majority&appName=Cluster0";

mongoose
  .connect(mongo_url)
  .then(() => {
    console.log("MongoDB connected...");
    importOptions(); // Start importing options once MongoDB is connected
  })
  .catch((err) => console.error("MongoDB connection error:", err));
async function importOptions() {
  try {
    await OptionsModel.deleteMany({}); // Clear existing options
    const result = await OptionsModel.create(optionsData);
    console.log("Options imported successfully:", result);
  } catch (error) {
    console.error("Error importing options:", error);
  } finally {
    mongoose.disconnect();
  }
}
