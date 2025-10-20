# Git Repository Cleanup Script
# This script will help clean up your repository to reduce size and speed up git operations

Write-Host "🧹 Starting Git Repository Cleanup..." -ForegroundColor Green

# Function to safely remove directories
function Remove-DirectorySafely {
    param($Path)
    if (Test-Path $Path) {
        Write-Host "🗑️  Removing: $Path" -ForegroundColor Yellow
        Remove-Item -Path $Path -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "✅ Removed: $Path" -ForegroundColor Green
    }
}

# Function to safely remove files
function Remove-FileSafely {
    param($Path)
    if (Test-Path $Path) {
        Write-Host "🗑️  Removing: $Path" -ForegroundColor Yellow
        Remove-Item -Path $Path -Force -ErrorAction SilentlyContinue
        Write-Host "✅ Removed: $Path" -ForegroundColor Green
    }
}

Write-Host "`n📦 Removing node_modules directories..." -ForegroundColor Cyan
Remove-DirectorySafely "node_modules"
Remove-DirectorySafely "backend/node_modules"
Remove-DirectorySafely "frontend/node_modules"
Remove-DirectorySafely "backend/smart-contract/node_modules"
Remove-DirectorySafely "mcp-redis-cloud/node_modules"
Remove-DirectorySafely "solana-web3js-mcp-server/node_modules"

Write-Host "`n🏗️  Removing build artifacts..." -ForegroundColor Cyan
Remove-DirectorySafely "dist"
Remove-DirectorySafely "build"
Remove-DirectorySafely "backend/dist"
Remove-DirectorySafely "frontend/dist"
Remove-DirectorySafely "backend/smart-contract/target"
Remove-DirectorySafely "mcp-redis-cloud/dist"
Remove-DirectorySafely "solana-web3js-mcp-server/dist"

Write-Host "`n🔧 Removing development tools and large binaries..." -ForegroundColor Cyan
Remove-FileSafely "rustup-init.exe"
Remove-DirectorySafely "solana-1.18.26"

Write-Host "`n📁 Removing MCP servers (if not needed in production)..." -ForegroundColor Cyan
Remove-DirectorySafely "mcp-redis-cloud"
Remove-DirectorySafely "solana-web3js-mcp-server"

Write-Host "`n📁 Removing old smart contract directories..." -ForegroundColor Cyan
Remove-DirectorySafely "backend/guess5-escrow"
Remove-DirectorySafely "backend/guess5-escrow-new"

Write-Host "`n📄 Removing TypeScript build info..." -ForegroundColor Cyan
Remove-FileSafely "frontend/tsconfig.tsbuildinfo"

Write-Host "`n🧹 Removing temporary files..." -ForegroundColor Cyan
Get-ChildItem -Path . -Recurse -Name "*.tmp", "*.temp" | ForEach-Object { Remove-FileSafely $_ }

Write-Host "`n📊 Checking repository size..." -ForegroundColor Cyan
$repoSize = (Get-ChildItem -Path . -Recurse -File | Measure-Object -Property Length -Sum).Sum
$repoSizeMB = [math]::Round($repoSize / 1MB, 2)
Write-Host "📏 Current repository size: $repoSizeMB MB" -ForegroundColor Yellow

Write-Host "`n✅ Cleanup completed!" -ForegroundColor Green
Write-Host "`n📝 Next steps:" -ForegroundColor Cyan
Write-Host "1. Run: git add ." -ForegroundColor White
Write-Host "2. Run: git commit -m 'Clean up repository - remove large files and build artifacts'" -ForegroundColor White
Write-Host "3. Run: git push" -ForegroundColor White
Write-Host "`n⚠️  Note: You may need to reinstall dependencies after this cleanup:" -ForegroundColor Yellow
Write-Host "   - Backend: cd backend && npm install" -ForegroundColor White
Write-Host "   - Frontend: cd frontend && npm install" -ForegroundColor White
