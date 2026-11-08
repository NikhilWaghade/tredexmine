import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../src/models/User.js';
import { ReferralReward } from '../src/models/ReferralReward.js';

dotenv.config();

/**
 * Migration & Backfill Script:
 * 1. Ensures every existing user document has a unique referralCode.
 * 2. Ensures database indexes for Referral & Earn system are properly built.
 */
export async function backfillReferralCodes() {
  console.log('[Migration] Starting Referral System Backfill & Index Verification...');

  // 1. Build indexes on ReferralReward and User
  try {
    await User.init();
    await ReferralReward.init();
    console.log('[Migration] Database indexes initialized successfully.');
  } catch (idxErr) {
    console.warn('[Migration] Note on index initialization:', idxErr.message);
  }

  // 2. Locate users lacking referral codes
  const usersMissingCode = await User.find({
    $or: [
      { referralCode: { $exists: false } },
      { referralCode: null },
      { referralCode: '' },
    ],
  });

  console.log(`[Migration] Found ${usersMissingCode.length} users requiring referral code generation.`);

  let updatedCount = 0;
  for (const user of usersMissingCode) {
    let generatedCode = User.generateReferralCode();
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      attempts++;
      const existing = await User.findOne({ referralCode: generatedCode });
      if (!existing) {
        isUnique = true;
      } else {
        generatedCode = User.generateReferralCode();
      }
    }

    // Direct update to populate missing code
    await User.collection.updateOne(
      { _id: user._id },
      {
        $set: {
          referralCode: generatedCode,
          referralRewardStatus: user.referredBy ? 'PENDING' : 'NOT_ELIGIBLE',
        },
      }
    );
    updatedCount++;
  }

  console.log(`[Migration] Successfully backfilled referral codes for ${updatedCount} users.`);
  return { updatedCount };
}

// Allow standalone execution via `node scripts/backfillReferralCodes.js`
if (process.argv[1] && process.argv[1].endsWith('backfillReferralCodes.js')) {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/treadexmine';
  console.log(`[Migration] Connecting to MongoDB: ${mongoUri.replace(/:([^:@]{4})[^:@]*@/, ':****@')}`);

  mongoose
    .connect(mongoUri)
    .then(async () => {
      await backfillReferralCodes();
      await mongoose.disconnect();
      console.log('[Migration] Done. Disconnected from MongoDB.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Migration] Failed:', err);
      process.exit(1);
    });
}

