import mongoose from 'mongoose';

/**
 * ============================================================================
 * WEBHOOK EVENT DEDUPLICATION MODEL
 * ============================================================================
 *
 * Implements persistent, concurrency-safe deduplication for payment provider
 * webhook events.
 *
 * Invariants:
 * 1. Unique index on { provider: 1, eventId: 1 } ensures that identical event
 *    deliveries race on database-level constraints (E11000 duplicate key error).
 * 2. Processing state machine:
 *    - 'processing': Event claimed atomically by worker.
 *    - 'processed': Business operations completed durably.
 *    - 'failed': Processing failed with diagnostic error category; safe for bounded retry.
 * 3. Safe Reference Metadata:
 *    Stores only safe operational metadata (orderId, paymentId, resourceType, etc.).
 *    Strictly NO stored secrets, card numbers, or full payment credentials.
 * 4. Durability & Retention:
 *    Retains records for 90 days via TTL index to prevent replay attacks during
 *    extended gateway retry cycles and financial audit reconciliation windows.
 * ============================================================================
 */
const webhookEventSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: [true, 'Provider is required'],
      enum: ['razorpay', 'mock'],
      default: 'razorpay',
      index: true,
    },
    eventId: {
      type: String,
      required: [true, 'Event ID is required'],
      trim: true,
    },
    eventType: {
      type: String,
      required: [true, 'Event type is required'],
      trim: true,
      index: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['processing', 'processed', 'failed', 'quarantined'],
      default: 'processing',
      index: true,
    },
    orderId: {
      type: String,
      trim: true,
      index: true,
      default: '',
    },
    paymentId: {
      type: String,
      trim: true,
      index: true,
      default: '',
    },
    resourceType: {
      type: String,
      enum: ['wallet_deposit', 'plan_purchase', 'unknown'],
      default: 'unknown',
    },
    resourceReference: {
      type: String,
      trim: true,
      default: '',
    },
    attempts: {
      type: Number,
      default: 1,
      min: 1,
    },
    firstReceivedAt: {
      type: Date,
      default: Date.now,
    },
    lastReceivedAt: {
      type: Date,
      default: Date.now,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    lastErrorCategory: {
      type: String,
      trim: true,
      default: '',
    },
    lastErrorMessage: {
      type: String,
      trim: true,
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Enforce compound uniqueness on provider + eventId
webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

// Efficient candidate discovery for stale event background reconciliation
webhookEventSchema.index({ status: 1, lastReceivedAt: 1 });

// 90-day retention to prevent replays across provider retry windows and audit cycles
webhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

webhookEventSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

export const WebhookEvent = mongoose.model('WebhookEvent', webhookEventSchema);
export default WebhookEvent;
