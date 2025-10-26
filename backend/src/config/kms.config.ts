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

export interface MultisigConfig {
  automatedSigner: string;
  coSigner: string;
  recoveryKey: string;
  threshold: number;
}

export const multisigConfig: MultisigConfig = {
  automatedSigner: process.env.AUTOMATED_SIGNER_PUBKEY || '',
  coSigner: process.env.CO_SIGNER_PUBKEY || '',
  recoveryKey: process.env.RECOVERY_KEY_PUBKEY || '',
  threshold: 2, // 2-of-3 multisig
};
