const cron = require('node-cron');
const UserModel = require('./User');
const LeadModel = require('./createLeads');
const transporter = require('./emailService');

// Function to check if a date is today
const isToday = (date) => {
  const today = new Date();
  const actionDate = new Date(date);
  return (
    today.getFullYear() === actionDate.getFullYear() &&
    today.getMonth() === actionDate.getMonth() &&
    today.getDate() === actionDate.getDate()
  );
};

// Function to send notification email
const sendActionDateNotification = async (user, lead) => {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: user.email,
    subject: `Action Required: Lead ${lead.leadNumber}`,
    html: `
      <h2>Lead Action Reminder</h2>
      <p>Hello ${user.firstName},</p>
      <p>This is a reminder about an action required today for your lead:</p>
      <ul>
        <li><strong>Lead Number:</strong> ${lead.leadNumber}</li>
        <li><strong>Company:</strong> ${lead.companyInfo?.companyName || 'N/A'}</li>
        <li><strong>Action Date:</strong> ${new Date(lead.actionDate).toLocaleDateString()}</li>
        <li><strong>Next Action:</strong> ${lead.companyInfo?.nextAction || 'No specific action noted'}</li>
      </ul>
      <p>Please take necessary action as required.</p>
      <p>Best regards,<br>CRM System</p>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Notification email sent to ${user.email} for lead ${lead.leadNumber}`);
    
    // Optional: Update lead with notification status
    await LeadModel.findByIdAndUpdate(lead._id, {
      $set: { notificationSent: true }
    });

    return true;
  } catch (error) {
    console.error('Error sending notification email:', error);
    return false;
  }
};

// Function to check leads and send notifications
const checkLeadsAndNotify = async () => {
  try {
    console.log('Checking leads for action date notifications...');
    
    // Find leads with action dates for today
    const leads = await LeadModel.find({
      'actionDate': { 
        $exists: true, 
        $ne: null 
      },
      'status': { $ne: 'closed' }, // Exclude closed leads
      'notificationSent': { $ne: true } // Ensure notification hasn't been sent
    }).populate('companyInfo.leadAssignedTo');

    for (const lead of leads) {
      // Check if the action date is today
      if (isToday(lead.actionDate)) {
        // Find the assigned user
        const user = lead.companyInfo?.leadAssignedTo;
        
        if (user && user.email) {
          await sendActionDateNotification(user, lead);
        }
      }
    }
  } catch (error) {
    console.error('Error in checkLeadsAndNotify:', error);
  }
};

// Schedule the notification check to run daily
const scheduleNotifications = () => {
  // Run every day at 9:00 AM
  cron.schedule('44 15 * * *', () => {
    checkLeadsAndNotify();
  });
};

module.exports = {
  scheduleNotifications,
  checkLeadsAndNotify // Export for manual triggering or testing
};