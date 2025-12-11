# Secure Admin Dashboard Implementation

## Overview

This document outlines the secure web-based admin dashboard solution for Guess5.io. The dashboard is integrated into the main backend with JWT-based authentication and optional IP whitelisting.

## Security Features

### 1. **JWT Token Authentication**
- Password-based login generates a JWT token
- Tokens expire after 24 hours
- All admin routes require valid JWT token in `Authorization: Bearer <token>` header
- Tokens are stateless and cannot be revoked (logout is client-side)

### 2. **IP Whitelisting (Optional)**
- Configure `ADMIN_IP_WHITELIST` environment variable
- Comma-separated list of allowed IP addresses
- If not set, allows all authenticated users
- Logs all access attempts for audit

### 3. **Environment Variables**

Add these to your `.env` file:

```bash
# Admin Dashboard Security
ADMIN_SECRET=your-super-secret-jwt-key-change-this-in-production
ADMIN_PASSWORD=your-strong-admin-password-change-this
ADMIN_IP_WHITELIST=1.2.3.4,5.6.7.8  # Optional: comma-separated IPs, leave empty to allow all
```

### 4. **Route Protection**

All admin routes are protected:
- `/api/admin/auth/login` - Public (login endpoint)
- `/api/admin/auth/logout` - Public (logout endpoint)
- `/api/admin/auth/status` - Public (check auth status)
- `/api/admin/*` - **Protected** (requires JWT token)

## API Endpoints

### Login
```bash
POST /api/admin/auth/login
Content-Type: application/json

{
  "password": "your-admin-password"
}

Response:
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "24h",
  "message": "Admin authentication successful"
}
```

### Check Auth Status
```bash
GET /api/admin/auth/status
Authorization: Bearer <token>

Response:
{
  "authenticated": true,
  "ip": "1.2.3.4",
  "ipWhitelisted": true
}
```

### Protected Admin Routes
All existing admin routes now require authentication:
- `POST /api/admin/delete-match/:matchId`
- `POST /api/admin/delete-all-matches`
- `GET /api/admin/referrals/owed`
- `POST /api/admin/payouts/prepare`
- etc.

## Frontend Integration

### Option 1: Add Admin Page to Main Frontend (Recommended)

Create `/frontend/src/pages/admin.tsx` with login form and dashboard.

**Pros:**
- Single codebase
- Easy to access from anywhere
- Consistent UI/UX

**Cons:**
- Admin code in public repo (but protected by auth)
- Need to ensure admin routes aren't exposed in client bundle

### Option 2: Separate Admin Dashboard (Current Setup)

Keep the existing `dashboard/` folder but add authentication.

**Pros:
- Completely separate codebase
- Can keep out of Git entirely
- More isolation

Cons:
- Harder to maintain
- Need to run locally or deploy separately

## Recommended Approach

**Hybrid Solution:**

1. **Keep local dashboard** (`dashboard/` folder) for:
   - Development/debugging
   - Heavy operations
   - Scripts and utilities

2. **Add web-based admin page** (`/frontend/src/pages/admin.tsx`) for:
   - Quick access from anywhere
   - Monitoring metrics
   - Reviewing referral payouts
   - Light admin tasks

3. **Both use same backend** with authentication

## Security Best Practices

1. **Change Default Password**: Never use default `admin123`
2. **Use Strong ADMIN_SECRET**: Generate a random 32+ character string
3. **Enable IP Whitelisting**: Set `ADMIN_IP_WHITELIST` in production
4. **Use HTTPS**: Always access admin dashboard over HTTPS
5. **Monitor Logs**: Check backend logs for failed login attempts
6. **Rotate Secrets**: Change `ADMIN_SECRET` periodically
7. **Limit Access**: Only give admin password to trusted team members

## Implementation Status

✅ Backend authentication middleware created
✅ JWT token generation/verification
✅ IP whitelisting support
✅ Admin routes protected
✅ Login/logout endpoints
✅ Auth status endpoint

🔄 Next Steps:
- Create admin login page in frontend
- Add admin dashboard UI
- Test authentication flow
- Set up environment variables

## Testing

```bash
# Test login
curl -X POST https://your-backend.com/api/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"your-password"}'

# Test protected route (with token)
curl -X GET https://your-backend.com/api/admin/referrals/owed \
  -H "Authorization: Bearer <token>"
```

