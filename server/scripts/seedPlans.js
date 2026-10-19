import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { Plan } from '../src/models/Plan.js';

const REQUIRED_PLANS = [
  {
    name: 'Starter',
    tag: 'Starter Node',
    description: 'Entry-level cloud compute cluster for essential hashrate and transparent daily yields.',
    price: 300,
    durationDays: 30,
    dailyRoiRate: 0.01,
    hashRate: '15 MH/s',
    features: [
      'Dedicated Tier-4 Compute Slot',
      'Daily Automated Yield Settlement',
      'Basic Performance Telemetry',
      '24/7 Node Uptime Guarantee',
    ],
    isActive: true,
    sortOrder: 1,
  },
  {
    name: 'Basic Plus',
    tag: 'Most Popular',
    description: 'Optimized mining power with enhanced hash density for steady portfolio growth.',
    price: 500,
    durationDays: 30,
    dailyRoiRate: 0.012,
    hashRate: '30 MH/s',
    features: [
      'High-Density Compute Cluster',
      'Daily Automated Yield Settlement',
      'Standard Network Routing Priority',
      'Dedicated Telegram Support',
    ],
    isActive: true,
    sortOrder: 2,
  },
  {
    name: 'Professional',
    tag: 'Advanced Yield',
    description: 'High-throughput computational node engineered for serious crypto mining operations.',
    price: 1000,
    durationDays: 30,
    dailyRoiRate: 0.015,
    hashRate: '70 MH/s',
    features: [
      'Isolated Compute Core Allocation',
      'Priority Hashrate Redistribution',
      'Daily Automated Yield Settlement',
      'Priority 24/7 Technical Support',
    ],
    isActive: true,
    sortOrder: 3,
  },
  {
    name: 'Advanced',
    tag: 'High Velocity',
    description: 'Enterprise-grade compute power with accelerated block submission latency.',
    price: 2000,
    durationDays: 30,
    dailyRoiRate: 0.018,
    hashRate: '150 MH/s',
    features: [
      'Multi-ASIC Hardware Partitioning',
      'Sub-millisecond Pool Latency',
      'Daily Automated Yield Settlement',
      'Dedicated Account Engineer',
    ],
    isActive: true,
    sortOrder: 4,
  },
  {
    name: 'Premium',
    tag: 'Institutional VIP',
    description: 'Institutional-grade mining farm capacity with maximum yields and bespoke allocation.',
    price: 5000,
    durationDays: 30,
    dailyRoiRate: 0.02,
    hashRate: '400 MH/s',
    features: [
      'Full ASIC Rack Compute Allocation',
      'Maximum Algorithmic Efficiency',
      'Daily Automated Yield Settlement',
      'Direct VIP Line & Custom SLA',
    ],
    isActive: true,
    sortOrder: 5,
  },
];

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not defined in environment');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('[Seed] Connected to MongoDB');

  // Check existing plans
  const existingPlans = await Plan.find({});
  console.log(`[Seed] Found ${existingPlans.length} existing plan(s) in DB:`);
  for (const p of existingPlans) {
    console.log(`  - ${p.name} (₹${p.price}) [Active: ${p.isActive}] ID: ${p._id}`);
  }

  // Deactivate old test plan if present so it doesn't clutter catalog
  for (const p of existingPlans) {
    if (p.name === 'Starter Test Plan') {
      p.isActive = false;
      await p.save();
      console.log(`[Seed] Deactivated legacy test plan: "${p.name}"`);
    }
  }

  let createdCount = 0;
  for (const planDef of REQUIRED_PLANS) {
    const existing = existingPlans.find(
      (p) => p.name.toLowerCase() === planDef.name.toLowerCase()
    );

    if (existing) {
      console.log(`[Seed] Plan "${planDef.name}" already exists (ID: ${existing._id}). Ensuring price=₹${planDef.price} and active.`);
      existing.price = planDef.price;
      existing.isActive = true;
      existing.sortOrder = planDef.sortOrder;
      existing.tag = planDef.tag;
      existing.hashRate = planDef.hashRate;
      existing.features = planDef.features;
      existing.description = planDef.description;
      await existing.save();
    } else {
      const created = await Plan.create(planDef);
      console.log(`[Seed] Created plan: "${created.name}" (₹${created.price}) ID: ${created._id}`);
      createdCount++;
    }
  }

  console.log(`[Seed] Completed. Created ${createdCount} new plan(s).`);

  const allActivePlans = await Plan.find({ isActive: true }).sort({ sortOrder: 1 });
  console.log('[Seed] All active plans in DB:');
  for (const p of allActivePlans) {
    console.log(`  ${p.sortOrder}. ${p.name}: ₹${p.price} (${p.durationDays} days, ${p.hashRate})`);
  }

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('[Seed] Error seeding plans:', err);
  process.exit(1);
});
