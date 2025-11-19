/**
 * Notification service for admin alerts
 * Supports multiple notification channels (console, email, Discord, Slack)
 */

interface NotificationPayload {
  type: string;
  title: string;
  message: string;
  batchId?: string;
  totalAmountUSD?: number;
  totalAmountSOL?: number;
  scheduledSendAt?: Date;
  [key: string]: any;
}

/**
 * Send notification to admin
 * Currently logs to console, but can be extended to support:
 * - Email (via SendGrid, AWS SES, etc.)
 * - Discord webhook
 * - Slack webhook
 * - SMS (via Twilio)
 */
export async function notifyAdmin(payload: NotificationPayload): Promise<void> {
  try {
    const { type, title, message, ...metadata } = payload;
    
    // Console logging (always enabled)
    console.log('\n🔔 ADMIN NOTIFICATION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📋 Type: ${type}`);
    console.log(`📌 Title: ${title}`);
    console.log(`💬 Message: ${message}`);
    
    if (Object.keys(metadata).length > 0) {
      console.log('📊 Metadata:');
      Object.entries(metadata).forEach(([key, value]) => {
        console.log(`   ${key}: ${value}`);
      });
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Discord webhook (if configured)
    const discordWebhook = process.env.DISCORD_WEBHOOK_URL;
    if (discordWebhook) {
      try {
        await fetch(discordWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: title,
              description: message,
              color: type === 'payout_batch_prepared' ? 0x00ff00 : 0xffaa00,
              fields: Object.entries(metadata).map(([key, value]) => ({
                name: key,
                value: String(value),
                inline: true
              })),
              timestamp: new Date().toISOString()
            }]
          })
        });
        console.log('✅ Discord notification sent');
      } catch (error) {
        console.warn('⚠️ Failed to send Discord notification:', error);
      }
    }

    // Slack webhook (if configured)
    const slackWebhook = process.env.SLACK_WEBHOOK_URL;
    if (slackWebhook) {
      try {
        await fetch(slackWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: title,
            blocks: [
              {
                type: 'header',
                text: {
                  type: 'plain_text',
                  text: title
                }
              },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: message
                }
              },
              ...(Object.keys(metadata).length > 0 ? [{
                type: 'section',
                fields: Object.entries(metadata).map(([key, value]) => ({
                  type: 'mrkdwn',
                  text: `*${key}:*\n${value}`
                }))
              }] : [])
            ]
          })
        });
        console.log('✅ Slack notification sent');
      } catch (error) {
        console.warn('⚠️ Failed to send Slack notification:', error);
      }
    }

    // Email notification (if configured)
    // TODO: Implement email notification via SendGrid/AWS SES/etc.
    // if (process.env.ADMIN_EMAIL) {
    //   // Send email notification
    // }

  } catch (error) {
    console.error('❌ Error sending admin notification:', error);
    // Don't throw - notifications are non-critical
  }
}

