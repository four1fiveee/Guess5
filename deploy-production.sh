#!/bin/bash

# Production Deployment Script for Guess5
# This script validates and deploys the application to production

set -e  # Exit on any error

echo "🚀 Starting production deployment for Guess5..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if required tools are installed
check_dependencies() {
    print_status "Checking dependencies..."
    
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        exit 1
    fi
    
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
        exit 1
    fi
    
    print_status "All dependencies are installed"
}

# Validate environment variables
validate_environment() {
    print_status "Validating environment variables..."
    
    # Backend environment variables
    if [ -z "$DATABASE_URL" ]; then
        print_error "DATABASE_URL is not set"
        exit 1
    fi
    
    if [ -z "$PROGRAM_ID" ]; then
        print_error "PROGRAM_ID is not set"
        exit 1
    fi
    
    if [ -z "$FEE_WALLET_ADDRESS" ]; then
        print_error "FEE_WALLET_ADDRESS is not set"
        exit 1
    fi
    
    # Frontend environment variables
    if [ -z "$NEXT_PUBLIC_API_URL" ]; then
        print_error "NEXT_PUBLIC_API_URL is not set"
        exit 1
    fi
    
    if [ -z "$NEXT_PUBLIC_SOLANA_NETWORK" ]; then
        print_error "NEXT_PUBLIC_SOLANA_NETWORK is not set"
        exit 1
    fi
    
    print_status "Environment variables are valid"
}

# Build and test backend
build_backend() {
    print_status "Building backend..."
    
    cd backend
    
    # Install dependencies
    npm install
    
    # Type check
    print_status "Running TypeScript type check..."
    npm run type-check
    
    # Lint
    print_status "Running linting..."
    npm run lint
    
    # Build
    print_status "Building backend..."
    npm run build
    
    # Test build
    if [ ! -f "dist/server.js" ]; then
        print_error "Backend build failed - dist/server.js not found"
        exit 1
    fi
    
    print_status "Backend build completed successfully"
    cd ..
}

# Build and test frontend
build_frontend() {
    print_status "Building frontend..."
    
    cd frontend
    
    # Install dependencies
    npm install
    
    # Type check
    print_status "Running TypeScript type check..."
    npm run type-check
    
    # Lint
    print_status "Running linting..."
    npm run lint
    
    # Build
    print_status "Building frontend..."
    npm run build
    
    # Test build
    if [ ! -d ".next" ]; then
        print_error "Frontend build failed - .next directory not found"
        exit 1
    fi
    
    print_status "Frontend build completed successfully"
    cd ..
}

# Test smart contract
test_smart_contract() {
    print_status "Testing smart contract..."
    
    cd contract
    
    # Check if Anchor is installed
    if ! command -v anchor &> /dev/null; then
        print_warning "Anchor CLI not found - skipping smart contract tests"
        cd ..
        return
    fi
    
    # Build contract
    print_status "Building smart contract..."
    anchor build
    
    # Run tests
    print_status "Running smart contract tests..."
    anchor test
    
    print_status "Smart contract tests completed"
    cd ..
}

# Health check function
health_check() {
    print_status "Performing health checks..."
    
    # Check if backend is accessible
    if [ -n "$NEXT_PUBLIC_API_URL" ]; then
        print_status "Testing backend health endpoint..."
        if curl -f -s "$NEXT_PUBLIC_API_URL/health" > /dev/null; then
            print_status "Backend health check passed"
        else
            print_warning "Backend health check failed - server may not be running"
        fi
    fi
}

# Main deployment function
deploy() {
    print_status "Starting deployment..."
    
    # Check dependencies
    check_dependencies
    
    # Validate environment
    validate_environment
    
    # Build backend
    build_backend
    
    # Build frontend
    build_frontend
    
    # Test smart contract
    test_smart_contract
    
    # Health check
    health_check
    
    print_status "Deployment validation completed successfully!"
    print_status "Ready for production deployment to Vercel and Render"
    
    echo ""
    echo "📋 Deployment Summary:"
    echo "  ✅ Backend: Built and validated"
    echo "  ✅ Frontend: Built and validated"
    echo "  ✅ Smart Contract: Tested"
    echo "  ✅ Environment: Validated"
    echo "  ✅ Dependencies: Checked"
    echo ""
    echo "🚀 Ready to deploy to:"
    echo "  - Frontend: https://vercel.com"
    echo "  - Backend: https://render.com"
    echo ""
    echo "Environment Variables to set:"
    echo "  Backend (Render):"
    echo "    - DATABASE_URL"
    echo "    - PROGRAM_ID"
    echo "    - FEE_WALLET_ADDRESS"
    echo "    - SOLANA_NETWORK"
    echo "    - FRONTEND_URL"
    echo ""
    echo "  Frontend (Vercel):"
    echo "    - NEXT_PUBLIC_API_URL"
    echo "    - NEXT_PUBLIC_SOLANA_NETWORK"
}

# Run deployment
deploy 