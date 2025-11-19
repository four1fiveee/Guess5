/**
 * Shared utility functions for referral system
 */

/**
 * Get next Sunday at 1:00 PM EST (13:00 EST)
 * This is the payout time for referral batches
 */
export function getNextSunday1300EST(): Date {
  const now = new Date();
  const nextSunday = new Date(now);
  
  // Calculate days until next Sunday (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
  const daysUntilSunday = (7 - now.getDay()) % 7;
  
  // If today is Sunday and it's before 1 PM, use today; otherwise use next Sunday
  if (daysUntilSunday === 0 && now.getHours() < 13) {
    // Today is Sunday and it's before 1 PM
    nextSunday.setHours(13, 0, 0, 0);
  } else {
    // Move to next Sunday
    const daysToAdd = daysUntilSunday === 0 ? 7 : daysUntilSunday;
    nextSunday.setDate(now.getDate() + daysToAdd);
    nextSunday.setHours(13, 0, 0, 0);
  }
  
  return nextSunday;
}

/**
 * Get next Sunday at 11:00 AM EST (start of review window)
 * Review window is 11 AM - 1 PM EST on Sunday
 */
export function getNextSunday1100EST(): Date {
  const now = new Date();
  const nextSunday = new Date(now);
  
  // Calculate days until next Sunday
  const daysUntilSunday = (7 - now.getDay()) % 7;
  
  // If today is Sunday and it's before 11 AM, use today; otherwise use next Sunday
  if (daysUntilSunday === 0 && now.getHours() < 11) {
    // Today is Sunday and it's before 11 AM
    nextSunday.setHours(11, 0, 0, 0);
  } else {
    // Move to next Sunday
    const daysToAdd = daysUntilSunday === 0 ? 7 : daysUntilSunday;
    nextSunday.setDate(now.getDate() + daysToAdd);
    nextSunday.setHours(11, 0, 0, 0);
  }
  
  return nextSunday;
}

/**
 * Check if current time is within review window (11 AM - 1 PM EST on Sunday)
 */
export function isWithinReviewWindow(): boolean {
  const now = new Date();
  const estOffset = -5 * 60; // EST is UTC-5
  const estTime = new Date(now.getTime() + estOffset * 60 * 1000);
  
  // Check if it's Sunday
  if (estTime.getDay() !== 0) {
    return false;
  }
  
  // Check if it's between 11 AM and 1 PM EST
  const hour = estTime.getHours();
  return hour >= 11 && hour < 13;
}

/**
 * Format date for display in referral UI
 */
export function formatPayoutDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/New_York',
    timeZoneName: 'short'
  });
}

