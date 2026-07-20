const express = require('express');
const router = express.Router();
const LeadModel = require('../Models/createLeads');
const UserModel = require('../Models/User');
const { sendActionDateNotification } = require('../Models/emailNotification');

router.post('/trigger', async (req, res) => {
  try {
    const { leadNumber, userId } = req.body;
    
    // Find the lead
    const lead = await LeadModel.findOne({ leadNumber });
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Find the user
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Send notification
    await sendActionDateNotification(user, lead);

    res.status(200).json({ message: 'Notification triggered successfully' });
  } catch (error) {
    console.error('Notification trigger error:', error);
    res.status(500).json({ message: 'Error triggering notification' });
  }
});

module.exports = router;