# Repository Cleanup Guide

## 🚨 Problem
Your git repository is large and slow because it contains:
- Multiple `node_modules` directories (hundreds of MB each)
- Build artifacts (`dist/`, `target/`, `build/`)
- Large binary files (`rustup-init.exe`, Solana toolchain)
- Duplicate smart contract directories
- MCP server directories that may not be needed in production

## 🧹 Solution

### Option 1: Quick Cleanup (Recommended)
Run the cleanup script:
```bash
# For PowerShell
.\cleanup-repo.ps1

# For Command Prompt
cleanup-repo.bat
```

### Option 2: Manual Cleanup
Follow these steps manually:

#### 1. Remove Large Directories
```bash
# Remove node_modules (will be reinstalled)
rm -rf node_modules
rm -rf backend/node_modules
rm -rf frontend/node_modules
rm -rf backend/smart-contract/node_modules
rm -rf mcp-redis-cloud/node_modules
rm -rf solana-web3js-mcp-server/node_modules

# Remove build artifacts
rm -rf dist
rm -rf build
rm -rf backend/dist
rm -rf frontend/dist
rm -rf backend/smart-contract/target
rm -rf mcp-redis-cloud/dist
rm -rf solana-web3js-mcp-server/dist

# Remove large binaries
rm -f rustup-init.exe
rm -rf solana-1.18.26

# Remove MCP servers (if not needed in production)
rm -rf mcp-redis-cloud
rm -rf solana-web3js-mcp-server

# Remove old smart contract directories
rm -rf backend/guess5-escrow
rm -rf backend/guess5-escrow-new
```

#### 2. Update .gitignore
The `.gitignore` file has been updated to prevent these files from being tracked in the future.

#### 3. Commit Changes
```bash
git add .
git commit -m "Clean up repository - remove large files and build artifacts"
git push
```

## 📊 Expected Results

### Before Cleanup
- Repository size: ~500MB - 2GB
- Git operations: Slow (30+ seconds)
- Push time: 5+ minutes

### After Cleanup
- Repository size: ~50-100MB
- Git operations: Fast (<5 seconds)
- Push time: <1 minute

## 🔄 Reinstalling Dependencies

After cleanup, you'll need to reinstall dependencies:

### Backend
```bash
cd backend
npm install
```

### Frontend
```bash
cd frontend
npm install
```

### Smart Contract (if needed)
```bash
cd backend/smart-contract
npm install
```

## 🚫 What's Being Removed

### Safe to Remove
- ✅ `node_modules/` - Can be reinstalled with `npm install`
- ✅ `dist/`, `build/`, `target/` - Build artifacts, regenerated on build
- ✅ `*.exe` files - Large binaries not needed in git
- ✅ `solana-1.18.26/` - Solana toolchain, can be reinstalled
- ✅ `mcp-redis-cloud/`, `solana-web3js-mcp-server/` - MCP servers, can be reinstalled if needed

### Keep These
- ✅ Source code (`src/` directories)
- ✅ Configuration files (`package.json`, `tsconfig.json`, etc.)
- ✅ Documentation (`.md` files)
- ✅ Smart contract source code

## 🛡️ Prevention

The updated `.gitignore` file will prevent these files from being tracked in the future:

```gitignore
# Dependencies
node_modules/
**/node_modules/

# Build outputs
dist/
build/
target/
*.exe

# Large binaries
solana-*/
rustup-init*

# MCP servers
mcp-redis-cloud/
solana-web3js-mcp-server/

# Old directories
guess5-escrow/
guess5-escrow-new/
```

## 🔍 Verification

After cleanup, verify your repository:

```bash
# Check repository size
du -sh .git

# Check what's tracked
git ls-files | wc -l

# Check for large files
git ls-files | xargs ls -la | sort -k5 -rn | head -10
```

## 🚀 Benefits

1. **Faster Git Operations**: `git add`, `git commit`, `git push` will be much faster
2. **Smaller Repository**: Reduced clone time and storage requirements
3. **Better CI/CD**: Faster deployment pipelines
4. **Cleaner History**: No more large files in git history
5. **Easier Collaboration**: Team members can clone and work faster

## ⚠️ Important Notes

- **Backup First**: Make sure you have a backup of important files
- **Dependencies**: You'll need to reinstall `node_modules` after cleanup
- **MCP Servers**: If you need the MCP servers, you can reinstall them separately
- **Solana Toolchain**: Can be reinstalled when needed for development

## 🆘 Troubleshooting

### If Git Push Still Fails
```bash
# Check for large files in git history
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | awk '/^blob/ {print $3, $4}' | sort -nr | head -10

# Remove large files from git history (use with caution)
git filter-branch --tree-filter 'rm -f large-file-name' HEAD
```

### If Dependencies Are Missing
```bash
# Reinstall all dependencies
npm install
cd backend && npm install
cd ../frontend && npm install
```

## 📈 Monitoring

After cleanup, monitor your repository:
- Check git operations speed
- Monitor push/pull times
- Verify all functionality still works
- Ensure CI/CD pipelines are faster

This cleanup should significantly improve your git performance and make development much more efficient!
