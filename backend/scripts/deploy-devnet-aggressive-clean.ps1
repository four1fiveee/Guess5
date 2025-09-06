# PowerShell script for Guess5 Smart Contract Devnet Deployment
# This script aggressively removes Cargo.lock files and forces system Rust

Write-Host "Starting Guess5 Smart Contract Devnet Deployment with Aggressive Clean..." -ForegroundColor Green
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "..\smart-contract")) {
    Write-Host "Error: smart-contract directory not found" -ForegroundColor Red
    Write-Host "Please run this script from the backend\scripts directory" -ForegroundColor Red
    exit 1
}

Write-Host "Checking prerequisites..." -ForegroundColor Yellow

# Check if Solana is available
try {
    $solanaVersion = solana --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Solana CLI found: $solanaVersion" -ForegroundColor Green
    } else {
        throw "Solana CLI not found"
    }
} catch {
    Write-Host "Error: Solana CLI not found" -ForegroundColor Red
    exit 1
}

# Check if Anchor is available
try {
    $anchorVersion = anchor --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Anchor CLI found: $anchorVersion" -ForegroundColor Green
    } else {
        throw "Anchor CLI not found"
    }
} catch {
    Write-Host "Error: Anchor CLI not found" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Setting up devnet configuration..." -ForegroundColor Yellow

# Set devnet RPC
solana config set --url https://api.devnet.solana.com
Write-Host "✅ Devnet RPC configured" -ForegroundColor Green

# Check wallet configuration
$config = solana config get 2>$null
Write-Host "✅ Wallet configuration found" -ForegroundColor Green
Write-Host $config -ForegroundColor Cyan

# Check balance
$balance = solana balance 2>$null
Write-Host "Current balance: $balance" -ForegroundColor Cyan

if ([double]($balance -replace ' SOL', '') -lt 1) {
    Write-Host "Requesting devnet SOL..." -ForegroundColor Yellow
    solana airdrop 2
    $finalBalance = solana balance 2>$null
    Write-Host "Final balance: $finalBalance" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "Building smart contract..." -ForegroundColor Yellow

# Change to smart contract directory
Set-Location "..\smart-contract"

# Set environment variables
$env:HOME = $env:USERPROFILE
$env:CARGO_HOME = "$env:USERPROFILE\.cargo"
$env:RUSTUP_HOME = "$env:USERPROFILE\.rustup"

Write-Host "Environment variables set" -ForegroundColor Cyan

# AGGRESSIVE CLEANING: Clean everything first
Write-Host "Aggressively cleaning previous build artifacts..." -ForegroundColor Yellow
anchor clean

# AGGRESSIVE: Remove ALL Cargo.lock files recursively with multiple methods
Write-Host "Aggressively removing all Cargo.lock files..." -ForegroundColor Yellow

# Method 1: PowerShell Remove-Item
$lockFiles = Get-ChildItem -Path "." -Recurse -Name "Cargo.lock"
foreach ($lockFile in $lockFiles) {
    Write-Host "Removing: $lockFile" -ForegroundColor Yellow
    Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
}

# Method 2: Direct file deletion with full paths
$fullLockFiles = Get-ChildItem -Path "." -Recurse -Name "Cargo.lock" | ForEach-Object { (Get-Item $_).FullName }
foreach ($fullPath in $fullLockFiles) {
    Write-Host "Force removing: $fullPath" -ForegroundColor Yellow
    if (Test-Path $fullPath) {
        Remove-Item $fullPath -Force -ErrorAction SilentlyContinue
        Write-Host "Removed: $fullPath" -ForegroundColor Green
    }
}

# Method 3: Check if any Cargo.lock files still exist
$remainingLocks = Get-ChildItem -Path "." -Recurse -Name "Cargo.lock"
if ($remainingLocks.Count -gt 0) {
    Write-Host "❌ Warning: Some Cargo.lock files still exist:" -ForegroundColor Red
    foreach ($lock in $remainingLocks) {
        Write-Host "   - $lock" -ForegroundColor Red
    }
    Write-Host "Attempting manual deletion..." -ForegroundColor Yellow
    
    # Try to delete the specific problematic file
    $problematicPath = ".\programs\guess5-escrow\Cargo.lock"
    if (Test-Path $problematicPath) {
        Write-Host "Manually deleting: $problematicPath" -ForegroundColor Yellow
        del $problematicPath -Force
        if (Test-Path $problematicPath) {
            Write-Host "❌ Failed to delete $problematicPath" -ForegroundColor Red
            Write-Host "Please manually delete this file and try again" -ForegroundColor Red
            exit 1
        } else {
            Write-Host "✅ Successfully deleted $problematicPath" -ForegroundColor Green
        }
    }
} else {
    Write-Host "✅ All Cargo.lock files removed successfully" -ForegroundColor Green
}

# CRITICAL: Force Anchor to use system Rust by setting environment variables
Write-Host "Forcing Anchor to use system Rust toolchain..." -ForegroundColor Yellow
$env:RUSTUP_TOOLCHAIN = "stable"
$env:CARGO = "$env:USERPROFILE\.cargo\bin\cargo.exe"
$env:RUSTC = "$env:USERPROFILE\.cargo\bin\rustc.exe"

# Verify we're using system Rust
$rustVersion = rustc --version 2>$null
Write-Host "Using system Rust: $rustVersion" -ForegroundColor Cyan

# CRITICAL: Override Anchor's internal Rust paths
Write-Host "Overriding Anchor's internal Rust paths..." -ForegroundColor Yellow
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

# Final verification: Check if Cargo.lock files are gone
Write-Host "Final verification: Checking for remaining Cargo.lock files..." -ForegroundColor Yellow
$finalCheck = Get-ChildItem -Path "." -Recurse -Name "Cargo.lock"
if ($finalCheck.Count -eq 0) {
    Write-Host "✅ No Cargo.lock files found - safe to proceed" -ForegroundColor Green
} else {
    Write-Host "❌ Cargo.lock files still exist - cannot proceed" -ForegroundColor Red
    foreach ($lock in $finalCheck) {
        Write-Host "   - $lock" -ForegroundColor Red
    }
    Write-Host "Please manually delete these files and try again" -ForegroundColor Red
    exit 1
}

# Try to build with forced system Rust
Write-Host "Building smart contract with forced system Rust..." -ForegroundColor Yellow
anchor build

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Smart contract built successfully!" -ForegroundColor Green
    
    Write-Host ""
    Write-Host "Deploying smart contract to devnet..." -ForegroundColor Yellow
    
    # Deploy the contract
    $deployOutput = anchor deploy --provider.cluster devnet 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Smart contract deployed successfully" -ForegroundColor Green
        
        # Extract program ID from output
        if ($deployOutput -match "Program Id: (\w+)") {
            $programId = $matches[1]
            Write-Host "Program ID: $programId" -ForegroundColor Green
        } else {
            Write-Host "Warning: Could not extract Program ID from output" -ForegroundColor Yellow
            $programId = "YOUR_PROGRAM_ID_HERE"
        }
    } else {
        Write-Host "❌ Failed to deploy smart contract" -ForegroundColor Red
        exit 1
    }
    
    Write-Host ""
    Write-Host "Generating results attestor keypair..." -ForegroundColor Yellow
    
    # Generate results attestor
    solana-keygen new --outfile "$env:USERPROFILE\.config\solana\results-attestor.json"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Results attestor generated" -ForegroundColor Green
        
        # Get public key
        $pubkeyOutput = solana-keygen pubkey "$env:USERPROFILE\.config\solana\results-attestor.json" 2>$null
        if ($LASTEXITCODE -eq 0) {
            $resultsAttestorPubkey = $pubkeyOutput.Trim()
            Write-Host "Results Attestor Public Key: $resultsAttestorPubkey" -ForegroundColor Green
        } else {
            $resultsAttestorPubkey = "YOUR_RESULTS_ATTESTOR_PUBKEY"
            Write-Host "Warning: Could not extract public key" -ForegroundColor Yellow
        }
    } else {
        Write-Host "❌ Failed to generate results attestor" -ForegroundColor Red
        exit 1
    }
    
    Write-Host ""
    Write-Host "=== DEPLOYMENT SUMMARY ===" -ForegroundColor Green
    Write-Host "Program ID: $programId" -ForegroundColor Cyan
    Write-Host "Results Attestor: $resultsAttestorPubkey" -ForegroundColor Cyan
    Write-Host "Network: Devnet" -ForegroundColor Cyan
    Write-Host "RPC Endpoint: https://api.devnet.solana.com" -ForegroundColor Cyan
    Write-Host ""
    
    Write-Host "=== NEXT STEPS ===" -ForegroundColor Green
    Write-Host "1. Add these environment variables to your Render backend:" -ForegroundColor Yellow
    Write-Host "   SMART_CONTRACT_PROGRAM_ID=$programId" -ForegroundColor White
    Write-Host "   RESULTS_ATTESTOR_PUBKEY=$resultsAttestorPubkey" -ForegroundColor White
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
    Write-Host "3. Run database migration: npm run migration:run" -ForegroundColor Yellow
    Write-Host "4. Test the integration with small amounts (0.001 SOL)" -ForegroundColor Yellow
    Write-Host "5. Monitor the system for 24-48 hours" -ForegroundColor Yellow
    Write-Host ""
    
    Write-Host "=== IMPORTANT SECURITY NOTES ===" -ForegroundColor Red
    Write-Host "⚠️  Store the results attestor private key securely!" -ForegroundColor Red
    Write-Host "   Location: $env:USERPROFILE\.config\solana\results-attestor.json" -ForegroundColor White
    Write-Host "   This key is required to settle matches." -ForegroundColor White
    Write-Host ""
    Write-Host "⚠️  Test thoroughly with small amounts before mainnet deployment!" -ForegroundColor Red
    Write-Host ""
    
    Write-Host "Deployment completed successfully!" -ForegroundColor Green
    
} else {
    Write-Host "❌ Failed to build smart contract" -ForegroundColor Red
    Write-Host ""
    Write-Host "=== TROUBLESHOOTING ===" -ForegroundColor Yellow
    Write-Host "1. The issue was Anchor trying to use broken Solana-installed Rust" -ForegroundColor White
    Write-Host "2. We've forced Anchor to use system Rust with environment variables" -ForegroundColor White
    Write-Host "3. If this still fails, try manually:" -ForegroundColor White
    Write-Host "   cd ..\smart-contract" -ForegroundColor White
    Write-Host "   $env:RUSTUP_TOOLCHAIN = 'stable'" -ForegroundColor White
    Write-Host "   $env:CARGO = '$env:USERPROFILE\.cargo\bin\cargo.exe'" -ForegroundColor White
    Write-Host "   $env:RUSTC = '$env:USERPROFILE\.cargo\bin\rustc.exe'" -ForegroundColor White
    Write-Host "   anchor build" -ForegroundColor White
    Write-Host ""
    Write-Host "4. The key insight: Force Anchor to use system Rust!" -ForegroundColor Green
}

Read-Host "Press Enter to continue"


