export interface KmsConfig {
  region: string;
  keyId: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export const kmsConfig: KmsConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
  keyId: process.env.KMS_KEY_ID || '',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
};

// DEPRECATED: The multisig configuration below was fake and never used
// The system used deterministic keypairs instead of real multisig
// This will be replaced by Squads Protocol integration

