# WSL Smart Contract Deployment Guide

## Current Status

✅ **Cleanup Complete**: All unnecessary files removed  
✅ **Configuration Updated**: All services use Program ID: `F2Bvxq5bucMFdxAXrwRQd2vGoXdJuddgdPkHwmU3wVx4`  
✅ **IDL Updated**: IDL file updated with correct Program ID  
✅ **Rust Installed**: Rust toolchain installed in WSL  
✅ **Solana CLI Installed**: Solana CLI v1.18.26 installed  
✅ **Anchor CLI Installed**: Anchor CLI v0.29.0 installed  
⚠️ **BPF Tools Missing**: Need to install Solana BPF platform tools  

## Issue

The `anchor build` command is failing because it needs the Solana BPF platform tools (specifically `cargo build-bpf` command).

## Solution: Install Solana Platform Tools in WSL

Run these commands in your WSL terminal:

```bash
cd /mnt/c/Users/henry/OneDrive/Desktop/Guess5/backend/guess5-escrow

# Install Solana platform tools
sh -c "$(curl -sSfL https://release.solana.com/v1.18.26/install)"

# Add Solana to PATH
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Verify installation
solana --version
cargo build-bpf --version

# Now build the smart contract
anchor build
```

If the curl command fails due to SSL issues, try this alternative:

```bash
# Download Solana installer
wget https://github.com/solana-labs/solana/releases/download/v1.18.26/solana-release-x86_64-unknown-linux-gnu.tar.bz2

# Extract
tar jxf solana-release-x86_64-unknown-linux-gnu.tar.bz2

# Move to local directory
mkdir -p ~/.local/share/solana/install
mv solana-release ~/.local/share/solana/install/active_release

# Add to PATH
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Verify
solana --version
```

## After Successful Build

Once `anchor build` completes successfully:

1. **Deploy to devnet**:
   ```bash
   anchor deploy --provider.cluster devnet
   ```

2. **Verify deployment**:
   ```bash
   solana program show F2Bvxq5bucMFdxAXrwRQd2vGoXdJuddgdPkHwmU3wVx4 --url devnet
   ```

3. **Test integration**:
   ```bash
   cd /mnt/c/Users/henry/OneDrive/Desktop/Guess5/backend
   node test-smart-contract.js
   ```

## What's Already Done

1. ✅ Smart contract source code updated with new Program ID
2. ✅ Anchor.toml configured correctly
3. ✅ IDL file updated with correct Program ID
4. ✅ All backend services updated
5. ✅ Deployment configurations updated (render.yaml, vercel.json)
6. ✅ Test script created

## What Needs to Be Done

1. ⚠️ Install Solana platform tools in WSL (see commands above)
2. ⚠️ Build smart contract with `anchor build`
3. ⚠️ Deploy to devnet with `anchor deploy`
4. ⚠️ Test the deployment

## Alternative: Use Windows PowerShell

If WSL continues to have issues, you can try building and deploying from Windows PowerShell:

1. Open PowerShell as Administrator
2. Navigate to the project:
   ```powershell
   cd C:\Users\henry\OneDrive\Desktop\Guess5\backend\guess5-escrow
   ```
3. Build:
   ```powershell
   anchor build
   ```
4. Deploy:
   ```powershell
   anchor deploy --provider.cluster devnet
   ```

## Troubleshooting

### If anchor build fails with "build-bpf not found"

The Solana platform tools need to be installed. This includes the BPF compiler toolchain.

### If SSL errors occur

Try using `wget` instead of `curl`, or download the Solana release manually from:
https://github.com/solana-labs/solana/releases/tag/v1.18.26

### If deployment fails

1. Check you have enough SOL in your wallet:
   ```bash
   solana balance
   ```

2. Request airdrop if needed:
   ```bash
   solana airdrop 2
   ```

## Next Steps After Deployment

1. Update environment variables in Render dashboard
2. Update environment variables in Vercel dashboard
3. Deploy backend to Render
4. Deploy frontend to Vercel
5. Test the full application

---

**Program ID**: `F2Bvxq5bucMFdxAXrwRQd2vGoXdJuddgdPkHwmU3wVx4`  
**Network**: Devnet  
**Anchor Version**: 0.29.0  
**Solana Version**: 1.18.26  
