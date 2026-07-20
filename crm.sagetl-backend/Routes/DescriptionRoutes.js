const express = require("express");
const router = express.Router();
const multer = require("multer");
const Description = require("../Models/description");

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

router.post("/", upload.single("file"), async (req, res) => {
  try {
    const { description, selectedOption, radioValue } = req.body;
    const file = req.file;

    const newDescription = new Description({
      description,
      file: {
        data: file.buffer,
        contentType: file.mimetype,
        filename: file.originalname,
      },
      selectedOption,
      radioValue,
    });

    await newDescription.save();

    // Clear buffer after saving to database
    file.buffer = undefined;

    res.status(201).json({ message: "Description saved successfully" });
  } catch (error) {
    console.error("Error saving description:", error);
    res.status(500).json({ error: "Error saving description" });
  }
});

module.exports = router;
