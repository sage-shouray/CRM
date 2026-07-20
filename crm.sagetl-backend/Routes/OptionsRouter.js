const express = require("express");
const router = express.Router();
const OptionsModel = require("../Models/optionModel");

router.get("/", async (req, res) => {
  try {
    const options = await OptionsModel.findOne({});
    if (!options) {
      return res.status(404).json({ error: "Options not found" });
    }
   
    res.json(options);
  } catch (error) {
    console.error("Error fetching options:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
