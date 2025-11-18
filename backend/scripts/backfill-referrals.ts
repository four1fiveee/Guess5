#!/usr/bin/env ts-node
/**
 * Backfill script to import existing referral data from CSV/Excel
 * Usage: ts-node backfill-referrals.ts <path-to-csv-file>
 */

import * as fs from 'fs';
import * as csv from 'csv-parse/sync';
import * as path from 'path';
import { AppDataSource } from '../src/db';
import { Referral } from '../src/models/Referral';
import { ReferralService } from '../src/services/referralService';
import { UserService } from '../src/services/userService';
import { AntiAbuseService } from '../src/services/antiAbuseService';

interface ReferralRecord {
  referred_wallet?: string;
  referredWallet?: string;
  referrer_wallet?: string;
  referrerWallet?: string;
  created_at?: string;
  createdAt?: string;
}

async function backfillReferrals(csvFilePath: string) {
  try {
    console.log('🔄 Initializing database...');
    await AppDataSource.initialize();
    console.log('✅ Database initialized');

    // Read CSV file
    console.log(`📖 Reading CSV file: ${csvFilePath}`);
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`File not found: ${csvFilePath}`);
    }

    const fileContent = fs.readFileSync(csvFilePath, 'utf-8');
    const records: ReferralRecord[] = csv.parse(fileContent, {
      columns: true,
      skip_empty_lines: true
    });

    console.log(`📊 Found ${records.length} records in CSV`);

    const referralRepository = AppDataSource.getRepository(Referral);
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Process each record
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      try {
        const referredWallet = record.referred_wallet || record.referredWallet;
        const referrerWallet = record.referrer_wallet || record.referrerWallet;
        const createdAt = record.created_at || record.createdAt;

        if (!referredWallet || !referrerWallet) {
          console.warn(`⚠️ Skipping record ${i + 1}: missing wallet addresses`);
          skipped++;
          continue;
        }

        // Check for self-referral
        if (AntiAbuseService.detectSelfReferral(referredWallet, referrerWallet)) {
          console.warn(`⚠️ Skipping self-referral: ${referredWallet}`);
          errors.push(`Self-referral: ${referredWallet}`);
          skipped++;
          continue;
        }

        // Check if already exists
        const existing = await referralRepository.findOne({
          where: { referredWallet }
        });

        if (existing) {
          console.log(`ℹ️ Referral already exists: ${referredWallet}`);
          skipped++;
          continue;
        }

        // Create referral
        const referral = referralRepository.create({
          referredWallet,
          referrerWallet,
          referredAt: createdAt ? new Date(createdAt) : new Date(),
          eligible: false,
          active: true
        });

        await referralRepository.save(referral);
        imported++;

        if (imported % 100 === 0) {
          console.log(`✅ Imported ${imported} referrals...`);
        }
      } catch (error) {
        const errorMsg = `Error importing record ${i + 1}: ${error}`;
        console.error(`❌ ${errorMsg}`);
        errors.push(errorMsg);
        skipped++;
      }
    }

    console.log(`\n📊 Import Summary:`);
    console.log(`  ✅ Imported: ${imported}`);
    console.log(`  ⏭️  Skipped: ${skipped}`);
    console.log(`  ❌ Errors: ${errors.length}`);

    if (errors.length > 0 && errors.length <= 10) {
      console.log(`\n❌ Errors:`);
      errors.forEach(e => console.log(`  - ${e}`));
    } else if (errors.length > 10) {
      console.log(`\n❌ First 10 errors:`);
      errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
    }

    // Rebuild upline mapping
    console.log('\n🔄 Rebuilding upline mapping...');
    await ReferralService.buildUplineMapping();
    console.log('✅ Upline mapping rebuilt');

    // Recompute total entry fees for all users
    console.log('\n🔄 Recomputing user entry fees...');
    const userRepository = AppDataSource.getRepository('User');
    const users = await userRepository.find();
    
    for (const user of users) {
      await UserService.recomputeTotalEntryFees(user.walletAddress);
    }
    console.log(`✅ Recomputed entry fees for ${users.length} users`);

    // Update referral eligibility
    console.log('\n🔄 Updating referral eligibility...');
    const referrals = await referralRepository.find({
      where: { eligible: false, active: true }
    });

    let eligibleUpdated = 0;
    for (const referral of referrals) {
      const isEligible = await UserService.checkReferralEligibility(referral.referrerWallet);
      if (isEligible) {
        referral.eligible = true;
        await referralRepository.save(referral);
        eligibleUpdated++;
      }
    }
    console.log(`✅ Updated eligibility for ${eligibleUpdated} referrals`);

    console.log('\n✅ Backfill completed successfully!');

  } catch (error) {
    console.error('❌ Backfill failed:', error);
    process.exit(1);
  } finally {
    await AppDataSource.destroy();
  }
}

// Main execution
const csvFilePath = process.argv[2];

if (!csvFilePath) {
  console.error('Usage: ts-node backfill-referrals.ts <path-to-csv-file>');
  console.error('Example: ts-node backfill-referrals.ts /mnt/data/referrals.csv');
  process.exit(1);
}

backfillReferrals(csvFilePath).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

