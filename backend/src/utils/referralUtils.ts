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

/**
 * Get current time in EST/EDT (America/New_York timezone)
 * Returns a Date object representing the current EST time
 */
export function getCurrentEST(): Date {
  const now = new Date();
  // Get EST time string components
  const estString = now.toLocaleString('en-US', { 
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // Parse the EST string (format: MM/DD/YYYY, HH:MM:SS)
  const [datePart, timePart] = estString.split(', ');
  const [month, day, year] = datePart.split('/');
  const [hour, minute, second] = timePart.split(':');
  
  // Create Date object in UTC (JavaScript Date always stores UTC internally)
  // We create it as if EST were UTC, then adjust
  const estDate = new Date(Date.UTC(
    parseInt(year),
    parseInt(month) - 1, // month is 0-indexed
    parseInt(day),
    parseInt(hour),
    parseInt(minute),
    parseInt(second)
  ));
  
  // Get UTC offset for EST/EDT
  const estOffset = now.toLocaleString('en-US', { 
    timeZone: 'America/New_York',
    timeZoneName: 'short'
  }).includes('EDT') ? -4 : -5; // EDT is UTC-4, EST is UTC-5
  
  // Adjust to get actual EST time
  const adjustedDate = new Date(estDate.getTime() - (estOffset * 60 * 60 * 1000));
  
  return adjustedDate;
}

/**
 * Check if current time is within lock window (Sunday 9am-9pm EST)
 */
export function isWithinLockWindow(): boolean {
  const estNow = getCurrentEST();
  const day = estNow.getDay(); // 0 = Sunday
  const hour = estNow.getHours();
  
  return day === 0 && hour >= 9 && hour < 21; // Sunday, 9am-9pm EST
}

/**
 * Check if current time is within execute window (Sunday 9am-9pm EST)
 */
export function isWithinExecuteWindow(): boolean {
  const estNow = getCurrentEST();
  const day = estNow.getDay(); // 0 = Sunday
  const hour = estNow.getHours();
  
  return day === 0 && hour >= 9 && hour < 21; // Sunday, 9am-9pm EST
}

/**
 * Get next Sunday at 12:00 AM EST (midnight)
 * This is when auto-lock happens
 */
export function getNextSundayMidnightEST(): Date {
  const now = new Date();
  const estNow = getCurrentEST();
  const nextSunday = new Date(estNow);
  
  // Calculate days until next Sunday
  const daysUntilSunday = (7 - estNow.getDay()) % 7;
  
  // If today is Sunday and it's before midnight, use today; otherwise use next Sunday
  if (daysUntilSunday === 0 && estNow.getHours() < 0) {
    // Today is Sunday and it's before midnight (shouldn't happen, but handle it)
    nextSunday.setHours(0, 0, 0, 0);
  } else {
    const daysToAdd = daysUntilSunday === 0 ? 7 : daysUntilSunday;
    nextSunday.setDate(estNow.getDate() + daysToAdd);
    nextSunday.setHours(0, 0, 0, 0);
  }
  
  return nextSunday;
}

/**
 * Check if current time is exactly 12:00am Sunday EST (within 1 minute window for cron)
 */
export function isSundayMidnightEST(): boolean {
  const estNow = getCurrentEST();
  const day = estNow.getDay(); // 0 = Sunday
  const hour = estNow.getHours();
  const minute = estNow.getMinutes();
  
  return day === 0 && hour === 0 && minute < 2; // Sunday, 12:00am-12:02am EST (2 minute window for cron)
}

/**
 * Get time until next lock window opens
 */
export function getTimeUntilLockWindow(): { days: number; hours: number; minutes: number; seconds: number } {
  const estNow = getCurrentEST();
  const now = new Date();
  
  // Calculate next Sunday 9am EST
  const daysUntilSunday = (7 - estNow.getDay()) % 7;
  const nextSunday = new Date(estNow);
  
  if (daysUntilSunday === 0 && estNow.getHours() < 9) {
    // Today is Sunday and it's before 9am
    nextSunday.setHours(9, 0, 0, 0);
  } else {
    const daysToAdd = daysUntilSunday === 0 ? 7 : daysUntilSunday;
    nextSunday.setDate(estNow.getDate() + daysToAdd);
    nextSunday.setHours(9, 0, 0, 0);
  }
  
  const diffMs = nextSunday.getTime() - now.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
  
  return { days, hours, minutes, seconds };
}

