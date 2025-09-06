@echo off
echo Starting Guess5 Smart Contract Devnet Deployment on Windows...
echo.

REM Check if we're in the right directory
if not exist "..\smart-contract" (
    echo Error: smart-contract directory not found
    echo Please run this script from the backend\scripts directory
    pause
    exit /b 1
)

echo Checking prerequisites...
echo.

REM Check if Solana is available
solana --version >nul 2>&1
if errorlevel 1 (
    echo Error: Solana CLI not found
    echo Please install Solana CLI first
    pause
    exit /b 1
)
echo ✅ Solana CLI found

REM Check if Anchor is available
anchor --version >nul 2>&1
if errorlevel 1 (
    echo Error: Anchor CLI not found
    echo Please install Anchor CLI first
    pause
    exit /b 1
)
echo ✅ Anchor CLI found

echo.
echo Setting up devnet configuration...

REM Set devnet RPC
solana config set --url https://api.devnet.solana.com
if errorlevel 1 (
    echo Error: Failed to set devnet RPC
    pause
    exit /b 1
)
echo ✅ Devnet RPC configured

REM Check wallet configuration
solana config get >nul 2>&1
if errorlevel 1 (
    echo Warning: No wallet found. Creating new wallet...
    solana-keygen new --outfile %USERPROFILE%\.config\solana\id.json
    if errorlevel 1 (
        echo Error: Failed to create wallet
        pause
        exit /b 1
    )
    echo ✅ New wallet created
) else (
    echo ✅ Wallet configuration found
)

REM Check balance and request airdrop if needed
for /f "tokens=1" %%i in ('solana balance') do set balance=%%i
echo Current balance: %balance% SOL

REM Convert balance to number for comparison (remove SOL suffix)
set balance_num=%balance%
set balance_num=%balance_num: SOL=%

REM Check if balance is less than 1 SOL
if %balance_num% LSS 1 (
    echo Requesting devnet SOL...
    solana airdrop 2
    if errorlevel 1 (
        echo Error: Failed to get devnet SOL
        pause
        exit /b 1
    )
    echo ✅ Devnet SOL received
)

REM Check final balance
for /f "tokens=1" %%i in ('solana balance') do set final_balance=%%i
echo Final balance: %final_balance% SOL

echo.
echo Building smart contract...
cd ..\smart-contract

REM Build the contract
anchor clean
if errorlevel 1 (
    echo Warning: anchor clean failed, but continuing...
)

anchor build
if errorlevel 1 (
    echo Error: Failed to build smart contract
    echo.
    echo Troubleshooting tips:
    echo 1. Make sure Rust is installed: https://rustup.rs/
    echo 2. Make sure Solana toolchain is installed
    echo 3. Try running: anchor clean && anchor build
    echo 4. If lock file version error persists, manually remove: programs\guess5-escrow\Cargo.lock
    echo.
    pause
    exit /b 1
)
echo ✅ Smart contract built successfully

echo.
echo Deploying smart contract to devnet...
anchor deploy --provider.cluster devnet
if errorlevel 1 (
    echo Error: Failed to deploy smart contract
    pause
    exit /b 1
)
echo ✅ Smart contract deployed successfully

echo.
echo Generating results attestor keypair...
solana-keygen new --outfile %USERPROFILE%\.config\solana\results-attestor.json
if errorlevel 1 (
    echo Error: Failed to generate results attestor
    pause
    exit /b 1
)

REM Extract public key from the generated file
for /f "tokens=2" %%i in ('solana-keygen pubkey %USERPROFILE%\.config\solana\results-attestor.json') do set results_attestor_pubkey=%%i
echo ✅ Results attestor generated: %results_attestor_pubkey%

echo.
echo === DEPLOYMENT SUMMARY ===
echo Results Attestor: %results_attestor_pubkey%
echo Network: Devnet
echo RPC Endpoint: https://api.devnet.solana.com
echo.

echo === NEXT STEPS ===
echo 1. Add these environment variables to your Render backend:
echo    SMART_CONTRACT_PROGRAM_ID=YOUR_PROGRAM_ID_HERE
echo    RESULTS_ATTESTOR_PUBKEY=%results_attestor_pubkey%
echo    DEFAULT_FEE_BPS=500
echo    DEFAULT_DEADLINE_BUFFER_SLOTS=1000
echo    MIN_STAKE_LAMPORTS=1000000
echo    MAX_FEE_BPS=1000
echo    SOLANA_NETWORK=https://api.devnet.solana.com
echo    SOLANA_CLUSTER=devnet
echo.
echo 2. Add these environment variables to your Vercel frontend:
echo    NEXT_PUBLIC_SMART_CONTRACT_PROGRAM_ID=YOUR_PROGRAM_ID_HERE
echo    NEXT_PUBLIC_SOLANA_NETWORK=https://api.devnet.solana.com
echo.
echo 3. Run database migration: npm run migration:run
echo 4. Test the integration with small amounts (0.001 SOL)
echo 5. Monitor the system for 24-48 hours
echo.

echo === IMPORTANT SECURITY NOTES ===
echo ⚠️  Store the results attestor private key securely!
echo    Location: %USERPROFILE%\.config\solana\results-attestor.json
echo    This key is required to settle matches.
echo.
echo ⚠️  Test thoroughly with small amounts before mainnet deployment!
echo.

echo === MONITORING ===
echo Once deployed, monitor your contract on Solana Explorer:
echo https://explorer.solana.com/?cluster=devnet
echo.
echo Key metrics to monitor:
echo - Match creation success rate
echo - Deposit success rate
echo - Settlement success rate
echo - Error rates and types
echo.

echo Deployment completed successfully!
pause
