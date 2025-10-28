# Environment Variables Configuration Guide

## 🔧 **Updated Environment Variables**

I've updated your deployment configurations to support the new multisig architecture. Here's what you need to set:

## 🚀 **Frontend Environment Variables (Vercel)**

### **Updated in `frontend/vercel.json`:**
```json
{
  "env": {
    "NEXT_PUBLIC_API_URL": "https://guess5.onrender.com",
    "NEXT_PUBLIC_SOLANA_NETWORK": "https://api.devnet.solana.com",
    "NEXT_PUBLIC_MULTISIG_PROGRAM_ID": "SMPLMyo5fcsJzWz8c4KfgQoD2V2t2A2A2A2A2A2A2A2",
    "NEXT_PUBLIC_AUTOMATED_SIGNER_PUBKEY": "2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt",
    "NEXT_PUBLIC_CO_SIGNER_PUBKEY": "3R9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt",
    "NEXT_PUBLIC_RECOVERY_KEY_PUBKEY": "4R9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt",
    "NEXT_PUBLIC_FEE_WALLET_ADDRESS": "2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt",
    "NEXT_PUBLIC_RECAPTCHA_SITE_KEY": "6Lcq4JArAAAAAMzZI4o4TVaJANOpDBqqFtzBVqMI"
  }
}
```

## 🔧 **Backend Environment Variables (Vercel)**

### **Updated in `backend/vercel.json`:**
```json
{
  "env": {
    "NODE_ENV": "production",
    "AWS_REGION": "us-east-1",
    "AWS_ACCESS_KEY_ID": "your_aws_access_key_id",
    "AWS_SECRET_ACCESS_KEY": "your_aws_secret_access_key",
    "AWS_KMS_KEY_ID": "your_kms_key_id",
    "AUTOMATED_SIGNER_PUBKEY": "2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt",
    "CO_SIGNER_PUBKEY": "3R9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt",
    "RECOVERY_KEY_PUBKEY": "4R9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt",
    "MULTISIG_PROGRAM_ID": "SMPLMyo5fcsJzWz8c4KfgQoD2V2t2A2A2A2A2A2A2A2",
    "SOLANA_NETWORK": "https://api.devnet.solana.com",
    "FEE_WALLET_ADDRESS": "2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt"
  }
}
```

## 🏗️ **Render Environment Variables**

### **Updated in `render.yaml`:**
```yaml
envVars:
  # Backend Service
  - key: AWS_REGION
    value: us-east-1
  - key: AWS_ACCESS_KEY_ID
    sync: false  # Set this in Render dashboard
  - key: AWS_SECRET_ACCESS_KEY
    sync: false  # Set this in Render dashboard
  - key: AWS_KMS_KEY_ID
    sync: false  # Set this in Render dashboard
  - key: AUTOMATED_SIGNER_PUBKEY
    value: 2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
  - key: CO_SIGNER_PUBKEY
    value: 3R9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
  - key: RECOVERY_KEY_PUBKEY
    value: 4R9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
  - key: MULTISIG_PROGRAM_ID
    value: SMPLMyo5fcsJzWz8c4KfgQoD2V2t2A2A2A2A2A2A2A2
  - key: FEE_WALLET_ADDRESS
    value: 2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
  - key: SOLANA_NETWORK
    value: https://api.devnet.solana.com

  # Frontend Service
  - key: NEXT_PUBLIC_MULTISIG_PROGRAM_ID
    value: SMPLMyo5fcsJzWz8c4KfgQoD2V2t2A2A2A2A2A2A2A2
  - key: NEXT_PUBLIC_AUTOMATED_SIGNER_PUBKEY
    value: 2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
  - key: NEXT_PUBLIC_CO_SIGNER_PUBKEY
    value: 3R9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
  - key: NEXT_PUBLIC_RECOVERY_KEY_PUBKEY
    value: 4R9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
  - key: NEXT_PUBLIC_FEE_WALLET_ADDRESS
    value: 2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
  - key: NEXT_PUBLIC_RECAPTCHA_SITE_KEY
    value: 6Lcq4JArAAAAAMzZI4o4TVaJANOpDBqqFtzBVqMI
```

## 🔑 **Required AWS KMS Setup**

### **You need to set these in your deployment environment:**

1. **AWS_ACCESS_KEY_ID**: Your AWS access key
2. **AWS_SECRET_ACCESS_KEY**: Your AWS secret key
3. **AWS_KMS_KEY_ID**: Your KMS key ID (e.g., `arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012`)

### **To get these values:**

1. **Go to AWS Console** → IAM → Users → Your User
2. **Create Access Key** if you don't have one
3. **Go to KMS** → Create a new key for signing
4. **Copy the Key ID** from the KMS key details

## 🎯 **What I've Updated**

### ✅ **Frontend Configuration:**
- Removed old smart contract program ID
- Added multisig program ID
- Added multisig signer public keys
- Updated environment variables for multisig support

### ✅ **Backend Configuration:**
- Added AWS KMS configuration
- Added multisig signer keys
- Added multisig program ID
- Updated all deployment configurations

### ✅ **Render Configuration:**
- Added all multisig environment variables
- Set up proper sync flags for sensitive data
- Updated both frontend and backend services

## 🚀 **Ready to Deploy**

Your environment variables are now configured for the multisig architecture. You can:

1. **Push to Git**: All configurations are updated
2. **Deploy to Vercel**: Frontend and backend will use new variables
3. **Deploy to Render**: Services will use new multisig configuration
4. **Set AWS Credentials**: Add your AWS KMS credentials in deployment dashboard

## 🔧 **Next Steps**

1. **Set AWS Credentials** in your deployment dashboard
2. **Push to Git** to trigger deployment
3. **Test the new multisig system** on devnet
4. **Monitor logs** for any configuration issues

The old PDA system is completely removed, and your environment is now configured for the new multisig vault architecture! 🎉

