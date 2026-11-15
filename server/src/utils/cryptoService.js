import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for AES-GCM
const TAG_LENGTH = 16; // Standard 128-bit auth tag

/**
 * Derive a 32-byte encryption key from environment secret
 * Defaults to JWT_SECRET or fallback key if ENCRYPTION_KEY is not explicitly set
 */
const getEncryptionKey = () => {
  const secret =
    process.env.ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    'minetrades_default_secure_vault_key_2026';
  return crypto.createHash('sha256').update(secret).digest();
};

/**
 * Encrypt sensitive payout information at rest using AES-256-GCM
 * @param {Object} data - Plain text object to encrypt (e.g. { upiId, accountNumber, ifscCode, bankName })
 * @returns {{ encryptedData: string, iv: string, tag: string }}
 */
export const encryptPayoutData = (data) => {
  if (!data || typeof data !== 'object') {
    return { encryptedData: '', iv: '', tag: '' };
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const jsonStr = JSON.stringify(data);
  let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return {
    encryptedData: encrypted,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
};

/**
 * Decrypt sensitive payout information at rest using AES-256-GCM
 * @param {{ encryptedData: string, iv: string, tag: string }} encryptedPayload
 * @returns {Object|null} Decrypted payout object
 */
export const decryptPayoutData = ({ encryptedData, iv, tag }) => {
  if (!encryptedData || !iv || !tag) {
    return null;
  }

  try {
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tag, 'hex'));

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  } catch (err) {
    console.error('[CryptoService] Failed to decrypt payout details:', err.message);
    return null;
  }
};

export default {
  encryptPayoutData,
  decryptPayoutData,
};

