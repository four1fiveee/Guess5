# Secure Admin Dashboard Implementation

## Overview

This document outlines the secure web-based admin dashboard solution for Guess5.io. The dashboard is integrated into the main backend with JWT-based authentication and optional IP whitelisting.

## Security Features

### 1. **JWT Token Authentication**
- Password-based login generates a JWT token
- Tokens expire after 24 hours
- All admin routes require valid JWT token in `Authorization: Bearer <token>` header
- Tokens are stateless and cannot be revoked (logout is client-side)

### 2. **Username + Password Authentication**
- Requires both username and password to login
- Username configured via `ADMIN_USERNAME` environment variable
- Password configured via `ADMIN_PASSWORD` environment variable
- Both must match to generate JWT token

### 3. **Environment Variables**

Add these to your Render dashboard environment variables:

```bash
# Admin Dashboard Security
ADMIN_SECRET=your-super-secret-jwt-key-change-this-in-production
ADMIN_USERNAME=your-admin-username
ADMIN_PASSWORD=your-strong-admin-password-change-this
```

**Explanation:**
- **ADMIN_SECRET**: Used to sign and verify JWT tokens. This is like a master key that ensures tokens haven't been tampered with. Keep this secret and never expose it.
- **ADMIN_USERNAME**: The username required to login to the admin dashboard
- **ADMIN_PASSWORD**: The password required to login to the admin dashboard

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
  "username": "your-admin-username",
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
  "ip": "1.2.3.4"
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

1. **Change Default Credentials**: Never use default `admin` username or `admin123` password
2. **Use Strong ADMIN_SECRET**: Generate a random 32+ character string (this signs your JWT tokens)
3. **Use Strong Password**: Use a long, complex password for `ADMIN_PASSWORD`
4. **Use HTTPS**: Always access admin dashboard over HTTPS (https://guess5.io/admin)
5. **Monitor Logs**: Check backend logs for failed login attempts
6. **Rotate Secrets**: Change `ADMIN_SECRET` periodically (will require re-login)
7. **Limit Access**: Only give admin credentials to trusted team members
8. **Keep Secret Secure**: Never commit `ADMIN_SECRET` or `ADMIN_PASSWORD` to Git

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

## Access URL

**Admin Dashboard**: https://guess5.io/admin

(Or https://guess5.vercel.app/admin if using Vercel preview)

## Testing

```bash
# Test login
curl -X POST https://guess5-backend.onrender.com/api/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"your-username","password":"your-password"}'

# Test protected route (with token)
curl -X GET https://your-backend.com/api/admin/referrals/owed \
  -H "Authorization: Bearer <token>"
```

