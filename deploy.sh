#!/bin/bash
set -e

echo "Adding all files to git..."
git add -A

echo "Committing changes..."
git commit -m "Deploy: Update project $(date +%Y-%m-%d\ %H:%M:%S)"

echo "Pushing to GitHub..."
git push origin main

echo "Deployment triggered! Render and Vercel should automatically redeploy."











