@echo off
echo 🧹 Starting Git Repository Cleanup...
echo.

echo 📦 Removing node_modules directories...
if exist "node_modules" rmdir /s /q "node_modules"
if exist "backend\node_modules" rmdir /s /q "backend\node_modules"
if exist "frontend\node_modules" rmdir /s /q "frontend\node_modules"
if exist "backend\smart-contract\node_modules" rmdir /s /q "backend\smart-contract\node_modules"
if exist "mcp-redis-cloud\node_modules" rmdir /s /q "mcp-redis-cloud\node_modules"
if exist "solana-web3js-mcp-server\node_modules" rmdir /s /q "solana-web3js-mcp-server\node_modules"

echo.
echo 🏗️  Removing build artifacts...
if exist "dist" rmdir /s /q "dist"
if exist "build" rmdir /s /q "build"
if exist "backend\dist" rmdir /s /q "backend\dist"
if exist "frontend\dist" rmdir /s /q "frontend\dist"
if exist "backend\smart-contract\target" rmdir /s /q "backend\smart-contract\target"
if exist "mcp-redis-cloud\dist" rmdir /s /q "mcp-redis-cloud\dist"
if exist "solana-web3js-mcp-server\dist" rmdir /s /q "solana-web3js-mcp-server\dist"

echo.
echo 🔧 Removing large binaries...
if exist "rustup-init.exe" del /q "rustup-init.exe"
if exist "solana-1.18.26" rmdir /s /q "solana-1.18.26"

echo.
echo 📁 Removing MCP servers...
if exist "mcp-redis-cloud" rmdir /s /q "mcp-redis-cloud"
if exist "solana-web3js-mcp-server" rmdir /s /q "solana-web3js-mcp-server"

echo.
echo 📁 Removing old smart contract directories...
if exist "backend\guess5-escrow" rmdir /s /q "backend\guess5-escrow"
if exist "backend\guess5-escrow-new" rmdir /s /q "backend\guess5-escrow-new"

echo.
echo 📄 Removing TypeScript build info...
if exist "frontend\tsconfig.tsbuildinfo" del /q "frontend\tsconfig.tsbuildinfo"

echo.
echo ✅ Cleanup completed!
echo.
echo 📝 Next steps:
echo 1. Run: git add .
echo 2. Run: git commit -m "Clean up repository - remove large files and build artifacts"
echo 3. Run: git push
echo.
echo ⚠️  Note: You may need to reinstall dependencies after this cleanup:
echo    - Backend: cd backend && npm install
echo    - Frontend: cd frontend && npm install
echo.
pause
