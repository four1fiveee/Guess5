# Advanced Git Repository Cleanup Script
# This script will help remove large files from git history and clean up the repository

Write-Host "🧹 Advanced Git Repository Cleanup..." -ForegroundColor Green

# Check if we're in a git repository
if (-not (Test-Path ".git")) {
    Write-Host "❌ Not in a git repository. Please run this from the root of your git repo." -ForegroundColor Red
    exit 1
}

Write-Host "`n📊 Analyzing repository size..." -ForegroundColor Cyan
$repoSize = (Get-ChildItem -Path . -Recurse -File | Measure-Object -Property Length -Sum).Sum
$repoSizeMB = [math]::Round($repoSize / 1MB, 2)
Write-Host "📏 Current repository size: $repoSizeMB MB" -ForegroundColor Yellow

Write-Host "`n🔍 Finding large files in git history..." -ForegroundColor Cyan
try {
    $largeFiles = git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | Where-Object { $_ -match '^blob' -and [int]($_.Split(' ')[2]) -gt 1048576 } | Sort-Object { [int]($_.Split(' ')[2]) } -Descending
    if ($largeFiles) {
        Write-Host "📁 Large files found in git history:" -ForegroundColor Yellow
        $largeFiles | ForEach-Object { Write-Host "  $($_.Split(' ')[1]): $([math]::Round([int]($_.Split(' ')[2])/1MB, 2)) MB" -ForegroundColor Red }
    } else {
        Write-Host "✅ No large files found in git history" -ForegroundColor Green
    }
} catch {
    Write-Host "⚠️  Could not analyze git history. Continuing with cleanup..." -ForegroundColor Yellow
}

Write-Host "`n🧹 Step 1: Remove files from working directory..." -ForegroundColor Cyan

# Remove node_modules
Write-Host "🗑️  Removing node_modules..." -ForegroundColor Yellow
Get-ChildItem -Path . -Recurse -Directory -Name "node_modules" | ForEach-Object { 
    Write-Host "  Removing: $_" -ForegroundColor Gray
    Remove-Item -Path $_ -Recurse -Force -ErrorAction SilentlyContinue
}

# Remove build artifacts
Write-Host "🗑️  Removing build artifacts..." -ForegroundColor Yellow
@("dist", "build", "target", ".next", "out") | ForEach-Object {
    Get-ChildItem -Path . -Recurse -Directory -Name $_ | ForEach-Object {
        Write-Host "  Removing: $_" -ForegroundColor Gray
        Remove-Item -Path $_ -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Remove large binaries
Write-Host "🗑️  Removing large binaries..." -ForegroundColor Yellow
@("*.exe", "*.msi", "*.dmg", "*.pkg", "*.deb", "*.rpm") | ForEach-Object {
    Get-ChildItem -Path . -Recurse -File -Name $_ | ForEach-Object {
        Write-Host "  Removing: $_" -ForegroundColor Gray
        Remove-Item -Path $_ -Force -ErrorAction SilentlyContinue
    }
}

# Remove specific large directories
Write-Host "🗑️  Removing large directories..." -ForegroundColor Yellow
@("solana-1.18.26", "mcp-redis-cloud", "solana-web3js-mcp-server", "backend/guess5-escrow", "backend/guess5-escrow-new") | ForEach-Object {
    if (Test-Path $_) {
        Write-Host "  Removing: $_" -ForegroundColor Gray
        Remove-Item -Path $_ -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "`n🧹 Step 2: Update .gitignore and stage changes..." -ForegroundColor Cyan

# Add all changes to git
Write-Host "📝 Adding changes to git..." -ForegroundColor Yellow
git add .

# Check what will be committed
Write-Host "`n📋 Files to be committed:" -ForegroundColor Cyan
git status --porcelain

Write-Host "`n📊 Checking new repository size..." -ForegroundColor Cyan
$newRepoSize = (Get-ChildItem -Path . -Recurse -File | Measure-Object -Property Length -Sum).Sum
$newRepoSizeMB = [math]::Round($newRepoSize / 1MB, 2)
$savedMB = [math]::Round(($repoSize - $newRepoSize) / 1MB, 2)

Write-Host "📏 New repository size: $newRepoSizeMB MB" -ForegroundColor Green
Write-Host "💾 Space saved: $savedMB MB" -ForegroundColor Green

Write-Host "`n✅ Cleanup completed!" -ForegroundColor Green
Write-Host "`n📝 Next steps:" -ForegroundColor Cyan
Write-Host "1. Review the changes: git status" -ForegroundColor White
Write-Host "2. Commit the cleanup: git commit -m 'Clean up repository - remove large files and build artifacts'" -ForegroundColor White
Write-Host "3. Push changes: git push" -ForegroundColor White
Write-Host "`n⚠️  Important notes:" -ForegroundColor Yellow
Write-Host "- You may need to reinstall dependencies after this cleanup" -ForegroundColor White
Write-Host "- If you need the MCP servers, you can reinstall them separately" -ForegroundColor White
Write-Host "- The Solana toolchain can be reinstalled when needed" -ForegroundColor White
