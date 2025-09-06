# Simple script to deploy the already-built smart contract
# Run this after the build is successful

Write-Host "Deploying already-built smart contract to devnet..." -ForegroundColor Green
Write-Host ""

# Change to smart contract directory
Set-Location "..\smart-contract"

# Check if the binary exists
if (-not (Test-Path "target\release\guess5_escrow.so")) {
    Write-Host "❌ Error: Smart contract binary not found" -ForegroundColor Red
    Write-Host "Please build the contract first with: .\deploy-devnet-direct-cargo.ps1" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Smart contract binary found: target\release\guess5_escrow.so" -ForegroundColor Green
Write-Host ""

# Deploy the contract
Write-Host "Deploying to devnet..." -ForegroundColor Yellow
$deployOutput = anchor deploy --provider.cluster devnet 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Smart contract deployed successfully!" -ForegroundColor Green
    
    # Extract program ID from output
    if ($deployOutput -match "Program Id: (\w+)") {
        $programId = $matches[1]
        Write-Host "Program ID: $programId" -ForegroundColor Green
    } else {
        Write-Host "Warning: Could not extract Program ID from output" -ForegroundColor Yellow
        Write-Host "Deployment output:" -ForegroundColor Cyan
        Write-Host $deployOutput -ForegroundColor White
        $programId = "YOUR_PROGRAM_ID_HERE"
    }
    
    Write-Host ""
    Write-Host "=== DEPLOYMENT SUMMARY ===" -ForegroundColor Green
    Write-Host "Program ID: $programId" -ForegroundColor Cyan
    Write-Host "Network: Devnet" -ForegroundColor Cyan
    Write-Host "RPC Endpoint: https://api.devnet.solana.com" -ForegroundColor Cyan
    Write-Host ""
    
    Write-Host "=== NEXT STEPS ===" -ForegroundColor Green
    Write-Host "1. Add these environment variables to your Render backend:" -ForegroundColor Yellow
    Write-Host "   SMART_CONTRACT_PROGRAM_ID=$programId" -ForegroundColor White
    Write-Host "   RESULTS_ATTESTOR_PUBKEY=YOUR_RESULTS_ATTESTOR_PUBKEY" -ForegroundColor White
    Write-Host "   DEFAULT_FEE_BPS=500" -ForegroundColor White
    Write-Host "   DEFAULT_DEADLINE_BUFFER_SLOTS=1000" -ForegroundColor White
    Write-Host "   MIN_STAKE_LAMPORTS=1000000" -ForegroundColor White
    Write-Host "   MAX_FEE_BPS=1000" -ForegroundColor White
    Write-Host "   SOLANA_NETWORK=https://api.devnet.solana.com" -ForegroundColor White
    Write-Host "   SOLANA_CLUSTER=devnet" -ForegroundColor White
    Write-Host ""
    Write-Host "2. Add these environment variables to your Vercel frontend:" -ForegroundColor Yellow
    Write-Host "   NEXT_PUBLIC_SMART_CONTRACT_PROGRAM_ID=$programId" -ForegroundColor White
    Write-Host "   NEXT_PUBLIC_SOLANA_NETWORK=https://api.devnet.solana.com" -ForegroundColor White
    Write-Host ""
    Write-Host "3. Generate results attestor: solana-keygen new --outfile ~/.config/solana/results-attestor.json" -ForegroundColor Yellow
    Write-Host "4. Run database migration: npm run migration:run" -ForegroundColor Yellow
    Write-Host "5. Test the integration with small amounts (0.001 SOL)" -ForegroundColor Yellow
    
} else {
    Write-Host "❌ Failed to deploy smart contract" -ForegroundColor Red
    Write-Host ""
    Write-Host "Deployment output:" -ForegroundColor Cyan
    Write-Host $deployOutput -ForegroundColor White
    Write-Host ""
    Write-Host "=== TROUBLESHOOTING ===" -ForegroundColor Yellow
    Write-Host "1. Check your devnet SOL balance: solana balance" -ForegroundColor White
    Write-Host "2. Request airdrop if needed: solana airdrop 2" -ForegroundColor White
    Write-Host "3. Verify devnet connection: solana config get" -ForegroundColor White
    Write-Host "4. Check wallet configuration: solana config get" -ForegroundColor White
}

Read-Host "Press Enter to continue"


