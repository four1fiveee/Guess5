# PowerShell script for Guess5 Smart Contract Devnet Deployment
# Run this script from PowerShell as Administrator if needed

Write-Host "Starting Guess5 Smart Contract Devnet Deployment on Windows..." -ForegroundColor Green
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "..\smart-contract")) {
    Write-Host "Error: smart-contract directory not found" -ForegroundColor Red
    Write-Host "Please run this script from the backend\scripts directory" -ForegroundColor Red
    Write-Host "Current directory: $(Get-Location)" -ForegroundColor Yellow
    Write-Host "Expected smart-contract directory should be at: $(Join-Path (Get-Location) '..\smart-contract')" -ForegroundColor Yellow
    Read-Host "Press Enter to continue"
    exit 1
}

Write-Host "Checking prerequisites..." -ForegroundColor Yellow
Write-Host ""

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
    Write-Host "Please install Solana CLI first" -ForegroundColor Red
    Read-Host "Press Enter to continue"
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
    Write-Host "Please install Anchor CLI first" -ForegroundColor Red
    Read-Host "Press Enter to continue"
    exit 1
}

# Check if Rust is available
try {
    $rustVersion = rustc --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Rust compiler found: $rustVersion" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Rust compiler not found in PATH" -ForegroundColor Yellow
        Write-Host "   This might cause build issues" -ForegroundColor Yellow
    }
} catch {
    Write-Host "⚠️  Rust compiler not found in PATH" -ForegroundColor Yellow
    Write-Host "   This might cause build issues" -ForegroundColor Yellow
}

# Check if Cargo is available
try {
    $cargoVersion = cargo --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Cargo found: $cargoVersion" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Cargo not found in PATH" -ForegroundColor Yellow
        Write-Host "   This might cause build issues" -ForegroundColor Yellow
    }
} catch {
    Write-Host "⚠️  Cargo not found in PATH" -ForegroundColor Yellow
    Write-Host "   This might cause build issues" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Setting up devnet configuration..." -ForegroundColor Yellow

# Set devnet RPC
try {
    solana config set --url https://api.devnet.solana.com
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Devnet RPC configured" -ForegroundColor Green
    } else {
        throw "Failed to set devnet RPC"
    }
} catch {
    Write-Host "Error: Failed to set devnet RPC" -ForegroundColor Red
    Read-Host "Press Enter to continue"
    exit 1
}

# Check wallet configuration
try {
    $config = solana config get 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Wallet configuration found" -ForegroundColor Green
        Write-Host $config -ForegroundColor Cyan
    } else {
        Write-Host "Warning: No wallet found. Creating new wallet..." -ForegroundColor Yellow
        solana-keygen new --outfile "$env:USERPROFILE\.config\solana\id.json"
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ New wallet created" -ForegroundColor Green
        } else {
            throw "Failed to create wallet"
        }
    }
} catch {
    Write-Host "Error: Failed to create wallet" -ForegroundColor Red
    Read-Host "Press Enter to continue"
    exit 1
}

# Check balance and request airdrop if needed
try {
    $balance = solana balance 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Current balance: $balance" -ForegroundColor Cyan
        
        # Extract numeric balance for comparison
        $balanceNum = [double]($balance -replace ' SOL', '')
        
        if ($balanceNum -lt 1) {
            Write-Host "Requesting devnet SOL..." -ForegroundColor Yellow
            solana airdrop 2
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✅ Devnet SOL received" -ForegroundColor Green
            } else {
                Write-Host "Warning: Failed to get devnet SOL, but continuing..." -ForegroundColor Yellow
            }
        }
        
        # Check final balance
        $finalBalance = solana balance 2>$null
        Write-Host "Final balance: $finalBalance" -ForegroundColor Cyan
    }
} catch {
    Write-Host "Warning: Could not check balance, but continuing..." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Building smart contract..." -ForegroundColor Yellow

# Change to smart contract directory
Set-Location "..\smart-contract"

# Set environment variables needed for Rust/Anchor on Windows
Write-Host "Setting environment variables for Rust/Anchor..." -ForegroundColor Yellow
$env:HOME = $env:USERPROFILE
$env:CARGO_HOME = "$env:USERPROFILE\.cargo"
$env:RUSTUP_HOME = "$env:USERPROFILE\.rustup"

Write-Host "Environment variables set:" -ForegroundColor Cyan
Write-Host "  HOME: $env:HOME" -ForegroundColor White
Write-Host "  CARGO_HOME: $env:CARGO_HOME" -ForegroundColor White
Write-Host "  RUSTUP_HOME: $env:RUSTUP_HOME" -ForegroundColor White

# Build the contract
try {
    Write-Host "Building smart contract..." -ForegroundColor Yellow
    
    # First, try to clean any existing build artifacts
    Write-Host "Cleaning previous build artifacts..." -ForegroundColor Yellow
    anchor clean
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Warning: anchor clean failed, but continuing..." -ForegroundColor Yellow
    }
    
    # Remove any existing Cargo.lock files that might cause version issues
    Write-Host "Removing any existing Cargo.lock files..." -ForegroundColor Yellow
    $lockFiles = Get-ChildItem -Path "." -Recurse -Name "Cargo.lock"
    foreach ($lockFile in $lockFiles) {
        Write-Host "Removing: $lockFile" -ForegroundColor Yellow
        Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
    }
    
    # Also clean cargo cache for this project
    Write-Host "Cleaning cargo cache..." -ForegroundColor Yellow
    cargo clean
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Warning: cargo clean failed, but continuing..." -ForegroundColor Yellow
    }
    
    # Verify Rust version before building
    Write-Host "Verifying Rust version..." -ForegroundColor Yellow
    $currentRustVersion = rustc --version 2>$null
    Write-Host "Current Rust version: $currentRustVersion" -ForegroundColor Cyan
    
    # Try to build
    Write-Host "Building smart contract..." -ForegroundColor Yellow
    anchor build
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Smart contract built successfully" -ForegroundColor Green
    } else {
        throw "Failed to build smart contract"
    }
} catch {
    Write-Host "Error: Failed to build smart contract" -ForegroundColor Red
    Write-Host ""
    
    # Check if it's a lock file version issue
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Attempting to fix lock file version issue..." -ForegroundColor Yellow
        
        # Try updating the Rust toolchain
        Write-Host "Updating Rust toolchain..." -ForegroundColor Yellow
        rustup update
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Rust toolchain updated" -ForegroundColor Green
        } else {
            Write-Host "Warning: Failed to update Rust toolchain" -ForegroundColor Yellow
        }
        
        # Try installing a compatible Rust version for Solana
        Write-Host "Installing compatible Rust version for Solana..." -ForegroundColor Yellow
        rustup install 1.79.0
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Rust 1.79.0 installed" -ForegroundColor Green
            Write-Host "Setting Rust 1.79.0 as default..." -ForegroundColor Yellow
            rustup default 1.79.0
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✅ Rust 1.79.0 set as default" -ForegroundColor Green
            }
        } else {
            Write-Host "Warning: Failed to install Rust 1.79.0" -ForegroundColor Yellow
        }
        
        # Force refresh environment and verify Rust version
        Write-Host "Refreshing environment and verifying Rust version..." -ForegroundColor Yellow
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
        $refreshedRustVersion = rustc --version 2>$null
        Write-Host "Refreshed Rust version: $refreshedRustVersion" -ForegroundColor Cyan
        
        # Remove any problematic Solana toolchain that might be interfering
        Write-Host "Removing problematic Solana toolchain..." -ForegroundColor Yellow
        rustup toolchain uninstall solana
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Solana toolchain removed" -ForegroundColor Green
        } else {
            Write-Host "Warning: Failed to remove Solana toolchain" -ForegroundColor Yellow
        }
        
        # Force remove any remaining Solana toolchain references
        Write-Host "Cleaning up any remaining Solana toolchain references..." -ForegroundColor Yellow
        $solanaToolchainPath = "$env:USERPROFILE\.rustup\toolchains\solana"
        if (Test-Path $solanaToolchainPath) {
            Remove-Item $solanaToolchainPath -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "✅ Removed Solana toolchain directory" -ForegroundColor Yellow
        }
        
        # Remove the problematic Rust 1.75.0 toolchain
        Write-Host "Removing problematic Rust 1.75.0 toolchain..." -ForegroundColor Yellow
        rustup toolchain uninstall 1.75.0
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Rust 1.75.0 toolchain removed" -ForegroundColor Green
        } else {
            Write-Host "Warning: Failed to remove Rust 1.75.0 toolchain" -ForegroundColor Yellow
        }
        
        # Diagnostic: Check where Rust 1.75.0-dev is coming from
        Write-Host "Diagnostic: Checking for Rust 1.75.0-dev installations..." -ForegroundColor Yellow
        
        # Check all rustup toolchains
        Write-Host "Available rustup toolchains:" -ForegroundColor Cyan
        rustup toolchain list
        Write-Host ""
        
        # Check if there are any other Rust installations
        Write-Host "Checking for other Rust installations..." -ForegroundColor Cyan
        $rustInstallations = @(
            "$env:USERPROFILE\.cargo\bin\rustc.exe",
            "$env:USERPROFILE\.rustup\toolchains\*\bin\rustc.exe",
            "C:\Program Files\Rust\*\bin\rustc.exe",
            "C:\Program Files (x86)\Rust\*\bin\rustc.exe"
        )
        
        foreach ($rustPath in $rustInstallations) {
            $expandedPaths = Get-ChildItem -Path $rustPath -ErrorAction SilentlyContinue
            foreach ($path in $expandedPaths) {
                if (Test-Path $path) {
                    $version = & $path --version 2>$null
                    Write-Host "Found Rust at: $path" -ForegroundColor White
                    Write-Host "Version: $version" -ForegroundColor White
                    Write-Host ""
                }
            }
        }
        
        # Check PATH for Rust installations
        Write-Host "Checking PATH for Rust installations..." -ForegroundColor Cyan
        $pathEntries = $env:PATH -split ';'
        foreach ($pathEntry in $pathEntries) {
            if ($pathEntry -like "*rust*" -or $pathEntry -like "*cargo*") {
                $rustcPath = Join-Path $pathEntry "rustc.exe"
                if (Test-Path $rustcPath) {
                    $version = & $rustcPath --version 2>$null
                    Write-Host "PATH Rust at: $rustcPath" -ForegroundColor White
                    Write-Host "Version: $version" -ForegroundColor White
                    Write-Host ""
                }
            }
        }
        
        # Remove the problematic Cargo.lock file from the programs directory
        $lockFilePath = "programs\guess5-escrow\Cargo.toml"
        if (Test-Path $lockFilePath) {
            Write-Host "Found Cargo.toml in programs\guess5-escrow" -ForegroundColor Green
            
            # Try building this specific program directly with cargo
            try {
                Write-Host "Attempting direct cargo build..." -ForegroundColor Yellow
                Set-Location "programs\guess5-escrow"
                
                # Set explicit environment variables to force use of system Rust
                $env:RUSTUP_TOOLCHAIN = "1.79.0"
                $env:RUST_BACKTRACE = "1"
                $env:CARGO = "$env:USERPROFILE\.cargo\bin\cargo.exe"
                $env:RUSTC = "$env:USERPROFILE\.cargo\bin\rustc.exe"
                
                Write-Host "Direct build environment variables:" -ForegroundColor Cyan
                Write-Host "  RUSTUP_TOOLCHAIN: $env:RUSTUP_TOOLCHAIN" -ForegroundColor White
                Write-Host "  RUST_BACKTRACE: $env:RUST_BACKTRACE" -ForegroundColor White
                Write-Host "  CARGO: $env:CARGO" -ForegroundColor White
                Write-Host "  RUSTC: $env:RUSTC" -ForegroundColor White
                
                # First, install Solana targets for Rust 1.79.0
                Write-Host "Installing Solana targets for Rust 1.79.0..." -ForegroundColor Yellow
                rustup target add --toolchain 1.79.0 bpfel-unknown-unknown
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "✅ Solana targets installed for Rust 1.79.0" -ForegroundColor Green
                } else {
                    Write-Host "Warning: Failed to install Solana targets" -ForegroundColor Yellow
                }
                
                # Try building with explicit cargo and rustc paths
                Write-Host "Building with explicit cargo and rustc paths..." -ForegroundColor Yellow
                & $env:CARGO build --target bpfel-unknown-unknown --release
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "✅ Program built successfully with direct cargo!" -ForegroundColor Green
                    # Go back to smart-contract directory
                    Set-Location "..\.."
                } else {
                    throw "Direct cargo build failed"
                }
            } catch {
                Write-Host "Direct cargo build failed. Trying alternative approach..." -ForegroundColor Red
                # Go back to smart-contract directory
                Set-Location "..\.."
                
                # Try completely bypassing Anchor by building the program directly
                try {
                    Write-Host "Attempting to completely bypass Anchor..." -ForegroundColor Yellow
                    
                    # Check if we have a built program
                    $programPath = "target\bpfel-unknown-unknown\release\guess5_escrow.so"
                    if (Test-Path $programPath) {
                        Write-Host "✅ Found built program at: $programPath" -ForegroundColor Green
                        Write-Host "Program size: $((Get-Item $programPath).Length) bytes" -ForegroundColor Cyan
                    } else {
                        Write-Host "No built program found. Trying manual build..." -ForegroundColor Yellow
                        
                        # Try building with system Rust completely bypassing Anchor
                        Write-Host "Building with system Rust (bypassing Anchor)..." -ForegroundColor Yellow
                        
                        # Set environment to force system Rust
                        $env:RUSTUP_TOOLCHAIN = "1.79.0"
                        $env:RUST_BACKTRACE = "1"
                        $env:CARGO = "$env:USERPROFILE\.cargo\bin\cargo.exe"
                        $env:RUSTC = "$env:USERPROFILE\.cargo\bin\rustc.exe"
                        $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
                        
                        Write-Host "System Rust environment variables:" -ForegroundColor Cyan
                        Write-Host "  RUSTUP_TOOLCHAIN: $env:RUSTUP_TOOLCHAIN" -ForegroundColor White
                        Write-Host "  RUST_BACKTRACE: $env:RUST_BACKTRACE" -ForegroundColor White
                        Write-Host "  CARGO: $env:CARGO" -ForegroundColor White
                        Write-Host "  RUSTC: $env:RUSTC" -ForegroundColor White
                        Write-Host "  PATH updated to prioritize system Rust" -ForegroundColor White
                        
                        # Try building with explicit Rust version and clean environment
                        Write-Host "Building with explicit Rust 1.79.0 and clean environment..." -ForegroundColor Yellow
                        
                        # Try building with the explicit toolchain
                        rustup run 1.79.0 anchor build
                        if ($LASTEXITCODE -eq 0) {
                            Write-Host "✅ Smart contract built successfully after fixing lock file!" -ForegroundColor Green
                        } else {
                            throw "Build still failed after lock file fix"
                        }
                    }
                } catch {
                    Write-Host "All build approaches failed. Trying Rust stable approach..." -ForegroundColor Red
                    
                    # Try using Rust stable (1.89.0) which has better Solana target support
                    try {
                        Write-Host "Attempting build with Rust stable (1.89.0)..." -ForegroundColor Yellow
                        
                        # Switch to Rust stable
                        Write-Host "Switching to Rust stable..." -ForegroundColor Yellow
                        rustup default stable
                        if ($LASTEXITCODE -eq 0) {
                            Write-Host "✅ Rust stable set as default" -ForegroundColor Green
                            
                            # Install Solana targets for Rust stable
                            Write-Host "Installing Solana targets for Rust stable..." -ForegroundColor Yellow
                            rustup target add bpfel-unknown-unknown
                            if ($LASTEXITCODE -eq 0) {
                                Write-Host "✅ Solana targets installed for Rust stable" -ForegroundColor Green
                                
                                # Try building with Rust stable
                                Write-Host "Building with Rust stable..." -ForegroundColor Yellow
                                anchor build
                                if ($LASTEXITCODE -eq 0) {
                                    Write-Host "✅ Smart contract built successfully with Rust stable!" -ForegroundColor Green
                                } else {
                                    throw "Build failed with Rust stable"
                                }
                            } else {
                                Write-Host "Warning: Failed to install Solana targets for Rust stable" -ForegroundColor Yellow
                                throw "Failed to install Solana targets"
                            }
                        } else {
                            Write-Host "Warning: Failed to switch to Rust stable" -ForegroundColor Yellow
                            throw "Failed to switch to Rust stable"
                        }
                    } catch {
                        Write-Host "Rust stable approach also failed. Trying Solana toolchain approach..." -ForegroundColor Red
                        
                        # Try installing the official Solana toolchain which has the required targets
                        try {
                            Write-Host "Attempting to install official Solana toolchain..." -ForegroundColor Yellow
                            
                            # Install Solana toolchain
                            Write-Host "Installing Solana toolchain..." -ForegroundColor Yellow
                            rustup toolchain install solana
                            if ($LASTEXITCODE -eq 0) {
                                Write-Host "✅ Solana toolchain installed" -ForegroundColor Green
                                
                                # Set Solana toolchain as default
                                Write-Host "Setting Solana toolchain as default..." -ForegroundColor Yellow
                                rustup default solana
                                if ($LASTEXITCODE -eq 0) {
                                    Write-Host "✅ Solana toolchain set as default" -ForegroundColor Green
                                    
                                    # Verify Solana toolchain has the required targets
                                    Write-Host "Verifying Solana toolchain targets..." -ForegroundColor Yellow
                                    $targetList = rustup target list --installed
                                    if ($targetList -like "*bpfel-unknown-unknown*") {
                                        Write-Host "✅ Solana targets found in Solana toolchain" -ForegroundColor Green
                                        
                                        # Try building with Solana toolchain
                                        Write-Host "Building with Solana toolchain..." -ForegroundColor Yellow
                                        anchor build
                                        if ($LASTEXITCODE -eq 0) {
                                            Write-Host "✅ Smart contract built successfully with Solana toolchain!" -ForegroundColor Green
                                        } else {
                                            throw "Build failed with Solana toolchain"
                                        }
                                    } else {
                                        Write-Host "Warning: Solana targets not found in Solana toolchain" -ForegroundColor Yellow
                                        throw "Solana targets not found"
                                    }
                                } else {
                                    Write-Host "Warning: Failed to set Solana toolchain as default" -ForegroundColor Yellow
                                    throw "Failed to set Solana toolchain as default"
                                }
                            } else {
                                Write-Host "Warning: Failed to install Solana toolchain" -ForegroundColor Yellow
                                throw "Failed to install Solana toolchain"
                            }
                        } catch {
                            Write-Host "Solana toolchain approach also failed. Trying manual target installation..." -ForegroundColor Red
                            
                            # Try manually downloading and installing Solana targets
                            try {
                                Write-Host "Attempting manual Solana target installation..." -ForegroundColor Yellow
                                
                                # Go back to smart-contract directory
                                Set-Location "..\.."
                                
                                # Try building with explicit Solana toolchain
                                Write-Host "Building with explicit Solana toolchain..." -ForegroundColor Yellow
                                rustup run solana anchor build
                                if ($LASTEXITCODE -eq 0) {
                                    Write-Host "✅ Smart contract built successfully with explicit Solana toolchain!" -ForegroundColor Green
                                } else {
                                    throw "Build failed with explicit Solana toolchain"
                                }
                            } catch {
                                Write-Host "All approaches failed. Showing troubleshooting tips..." -ForegroundColor Red
                            }
                        }
                    }
                }
            }
        } else {
            Write-Host "Cargo.toml not found at expected location: $lockFilePath" -ForegroundColor Yellow
        }
    }
    
    Write-Host "Troubleshooting tips:" -ForegroundColor Yellow
    Write-Host "1. Make sure Rust is installed: https://rustup.rs/" -ForegroundColor Yellow
    Write-Host "2. Make sure Solana toolchain is installed" -ForegroundColor Yellow
    Write-Host "3. Try running: anchor clean && anchor build" -ForegroundColor Yellow
    Write-Host "4. Check if HOME environment variable is set" -ForegroundColor Yellow
    Write-Host "5. Try restarting PowerShell after installing Rust" -ForegroundColor Yellow
    Write-Host "6. If lock file version error persists, manually remove: programs\guess5-escrow\Cargo.lock" -ForegroundColor Yellow
    Write-Host "7. Try updating Rust toolchain: rustup update" -ForegroundColor Yellow
    Write-Host "8. Check Rust version compatibility with Anchor" -ForegroundColor Yellow
    Write-Host "9. Try using Rust 1.79.0: rustup default 1.79.0" -ForegroundColor Yellow
    Write-Host "10. Try building with explicit version: rustup run 1.79.0 anchor build" -ForegroundColor Yellow
    Write-Host "11. Remove Solana toolchain: rustup toolchain uninstall solana" -ForegroundColor Yellow
    Write-Host "12. Remove Rust 1.75.0 toolchain: rustup toolchain uninstall 1.75.0" -ForegroundColor Yellow
    Write-Host "13. Install Solana targets: rustup target add --toolchain 1.79.0 bpfel-unknown-unknown" -ForegroundColor Yellow
    Write-Host "14. Try building directly with cargo: cd programs\guess5-escrow && cargo build --target bpfel-unknown-unknown --release" -ForegroundColor Yellow
    Write-Host "15. Try Rust stable: rustup default stable && rustup target add bpfel-unknown-unknown" -ForegroundColor Yellow
    Write-Host "16. Install Solana toolchain: rustup toolchain install solana" -ForegroundColor Yellow
    Write-Host "17. Try building with Solana toolchain: rustup run solana anchor build" -ForegroundColor Yellow
    Write-Host "18. Check for multiple Rust installations on your system" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to continue"
    exit 1
}

Write-Host ""
Write-Host "Deploying smart contract to devnet..." -ForegroundColor Yellow

# Deploy the contract
try {
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
        throw "Failed to deploy smart contract"
    }
} catch {
    Write-Host "Error: Failed to deploy smart contract" -ForegroundColor Red
    Read-Host "Press Enter to continue"
    exit 1
}

Write-Host ""
Write-Host "Generating results attestor keypair..." -ForegroundColor Yellow

# Generate results attestor
try {
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
        throw "Failed to generate results attestor"
    }
} catch {
    Write-Host "Error: Failed to generate results attestor" -ForegroundColor Red
    Read-Host "Press Enter to continue"
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

Write-Host "=== MONITORING ===" -ForegroundColor Green
Write-Host "Once deployed, monitor your contract on Solana Explorer:" -ForegroundColor Yellow
Write-Host "https://explorer.solana.com/?cluster=devnet" -ForegroundColor Cyan
Write-Host ""
Write-Host "Key metrics to monitor:" -ForegroundColor Yellow
Write-Host "- Match creation success rate" -ForegroundColor White
Write-Host "- Deposit success rate" -ForegroundColor White
Write-Host "- Settlement success rate" -ForegroundColor White
Write-Host "- Error rates and types" -ForegroundColor White
Write-Host ""

Write-Host "Deployment completed successfully!" -ForegroundColor Green
Read-Host "Press Enter to continue"
