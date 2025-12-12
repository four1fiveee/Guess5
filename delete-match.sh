#!/bin/bash
# Script to delete a match via admin API
# Usage: ./delete-match.sh <matchId>

MATCH_ID=${1:-"15dcfba1-b4a5-4896-b563-937fa04d45f5"}
API_URL="https://guess5.onrender.com"

echo "🔐 Please log in to admin dashboard first to get your auth token"
echo "📝 Then run this command with your token:"
echo ""
echo "curl -X DELETE \"${API_URL}/api/admin/delete-match/${MATCH_ID}\" \\"
echo "  -H \"Authorization: Bearer YOUR_ADMIN_TOKEN\" \\"
echo "  -H \"Content-Type: application/json\""
echo ""
echo "Or visit: ${API_URL}/admin and delete via the dashboard"

