# Admin Dashboard Setup Guide

## Quick Answers

### 1. Domain Name
**Admin Dashboard URL**: https://guess5.io/admin

(If using Vercel preview: https://guess5.vercel.app/admin)

### 2. ADMIN_SECRET vs ADMIN_PASSWORD

**ADMIN_SECRET**:
- **Purpose**: Used to sign and verify JWT tokens
- **Think of it as**: A master key that ensures tokens haven't been tampered with
- **Security**: If someone gets this, they could create fake tokens (but still need username/password to login)
- **Example**: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0` (32+ random characters)

**ADMIN_USERNAME**:
- **Purpose**: The username you enter to login
- **Example**: `admin` or `henry` or `guess5_admin`

**ADMIN_PASSWORD**:
- **Purpose**: The password you enter to login
- **Example**: `MySecurePassword123!`

**How they work together**:
1. You enter username + password → Backend checks against `ADMIN_USERNAME` and `ADMIN_PASSWORD`
2. If correct → Backend uses `ADMIN_SECRET` to create a JWT token
3. Token is sent to you → You use token to access admin routes
4. Each request → Backend uses `ADMIN_SECRET` to verify token is valid

## Setting Up on Render Dashboard

### Step 1: Go to Your Render Backend Service

1. Log into https://dashboard.render.com
2. Navigate to your backend service (likely named "guess5-backend" or similar)

### Step 2: Add Environment Variables

Go to **Environment** tab and add these three variables:

```
ADMIN_SECRET = [Generate a random 32+ character string]
ADMIN_USERNAME = [Your chosen username]
ADMIN_PASSWORD = [Your chosen strong password]
```

**Example values**:
```
ADMIN_SECRET = a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6
ADMIN_USERNAME = admin
ADMIN_PASSWORD = MySecurePassword123!
```

**How to generate ADMIN_SECRET**:
- Use a password generator: https://www.random.org/strings/
- Or run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Make it at least 32 characters long

### Step 3: Save and Redeploy

1. Click **Save Changes**
2. Render will automatically redeploy your service
3. Wait for deployment to complete (usually 2-5 minutes)

### Step 4: Access Admin Dashboard

1. Go to https://guess5.io/admin
2. Enter your `ADMIN_USERNAME` and `ADMIN_PASSWORD`
3. Click Login
4. You'll be authenticated and can access admin features

## Security Notes

✅ **DO**:
- Use strong, unique passwords
- Generate a random ADMIN_SECRET (32+ characters)
- Keep credentials secret
- Use HTTPS (always)
- Monitor backend logs for failed login attempts

❌ **DON'T**:
- Use default values (`admin`/`admin123`)
- Commit secrets to Git
- Share credentials publicly
- Use weak passwords
- Access admin dashboard over HTTP

## Monitoring Deployments

### Check Deployment Status

1. Go to Render Dashboard → Your Backend Service
2. Click **Events** tab to see deployment progress
3. Look for "Deploy succeeded" message

### Verify Admin Auth is Working

After deployment, test the login:

```bash
curl -X POST https://guess5-backend.onrender.com/api/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"your-username","password":"your-password"}'
```

Should return:
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "24h",
  "message": "Admin authentication successful"
}
```

### Check Logs

1. Go to Render Dashboard → Your Backend Service
2. Click **Logs** tab
3. Look for:
   - `✅ Admin login successful from IP: ...` (successful logins)
   - `⚠️ Failed admin login attempt from IP: ...` (failed attempts)

## Troubleshooting

### "Invalid username or password"
- Check that `ADMIN_USERNAME` and `ADMIN_PASSWORD` are set correctly in Render
- Make sure there are no extra spaces
- Redeploy after changing environment variables

### "Unauthorized" when accessing admin routes
- Make sure you're logged in (token in localStorage)
- Token might have expired (24h limit) - login again
- Check that token is being sent in `Authorization: Bearer <token>` header

### Can't access /admin page
- Make sure frontend is deployed
- Check that the route exists in your Next.js app
- Try clearing browser cache

## Next Steps

After setup:
1. ✅ Test login at https://guess5.io/admin
2. ✅ Verify you can access admin routes
3. ✅ Monitor logs for any unauthorized access attempts
4. ✅ Build out admin dashboard features as needed

