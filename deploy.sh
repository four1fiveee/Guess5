#!/bin/bash

echo "🚀 Guess5 Deployment Script"
echo "=========================="

# Check if we're in the right directory
if [ ! -f "README.md" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

echo "📦 Building Backend..."
cd backend
npm install
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Backend build failed"
    exit 1
fi
echo "✅ Backend built successfully"

echo "📦 Building Frontend..."
cd ../frontend
npm install
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Frontend build failed"
    exit 1
fi
echo "✅ Frontend built successfully"

echo ""
echo "🎉 Build completed successfully!"
echo ""
echo "📋 Next Steps:"
echo "1. Deploy backend to Render/Railway with DATABASE_URL"
echo "2. Deploy frontend to Vercel with NEXT_PUBLIC_API_URL"
echo "3. Set environment variables in deployment platforms"
echo "4. Test the deployment using DEPLOYMENT.md guide" 