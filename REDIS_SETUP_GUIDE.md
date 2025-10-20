# 🚀 Redis Cloud Setup Guide for Guess5

This guide will walk you through setting up Redis Cloud for production-ready matchmaking and job queues.

## 📋 Prerequisites

- Redis Cloud account (free tier available)
- Your Render app deployed and running
- Your Vercel frontend deployed

## 🎯 Step 1: Create Redis Cloud Subscription

1. **Go to Redis Cloud**: Visit [redis.com/try-free/](https://redis.com/try-free/)
2. **Sign Up/Login**: Create an account or log in
3. **Create Subscription**:
   - Click "Create Subscription"
   - **Cloud Provider**: AWS
   - **Region**: `us-east-1` (same as your Render app)
   - **Plan**: Start with 250 MB (you can scale up later)
   - **Name**: `guess5-redis`

## 🗄️ Step 2: Create Two Databases

### Database A: `redis-mm` (Matchmaking + Rate Limits)

1. **Create Database**:
   - Click "Create Database"
   - **Name**: `redis-mm`
   - **Database Type**: Redis
   - **Memory**: 100 MB
   - **Persistence**: Off (or RDB daily)
   - **Eviction Policy**: `allkeys-lfu`
   - **TLS**: On
   - **Replication/HA**: On
   - **Max Connections**: Default

### Database B: `redis-ops` (Queues/Jobs)

1. **Create Database**:
   - **Name**: `redis-ops`
   - **Database Type**: Redis
   - **Memory**: 150 MB
   - **Persistence**: AOF every second
   - **Eviction Policy**: `noeviction`
   - **TLS**: On
   - **Replication/HA**: On
   - **Clustering**: Off

## 👤 Step 3: Create Database Users

### For `redis-mm`:
1. Go to "Access Control & Security"
2. Click "Create User"
3. **Username**: `app-mm`
4. **Password**: Generate a strong password (save it!)
5. **Role**: Database User
6. **Permissions**: Read/Write

### For `redis-ops`:
1. Create another user
2. **Username**: `app-ops`
3. **Password**: Generate a strong password (save it!)
4. **Role**: Database User
5. **Permissions**: Read/Write

## 🔗 Step 4: Get Connection Information

### For `redis-mm`:
You'll get connection details like:
```
Endpoint: redis-12345.us-east-1-1.ec2.cloud.redislabs.com:12345
User: app-mm
Password: your-strong-password-mm
URI: rediss://app-mm:password@redis-12345.us-east-1-1.ec2.cloud.redislabs.com:12345
```

### For `redis-ops`:
```
Endpoint: redis-67890.us-east-1-1.ec2.cloud.redislabs.com:67890
User: app-ops
Password: your-strong-password-ops
URI: rediss://app-ops:password@redis-67890.us-east-1-1.ec2.cloud.redislabs.com:67890
```

## 🔧 Step 5: Update Environment Variables

### Render Environment Variables

Add these to your Render app's environment variables:

```bash
# Redis MM (Matchmaking)
REDIS_MM_HOST=redis-12345.us-east-1-1.ec2.cloud.redislabs.com
REDIS_MM_PORT=12345
REDIS_MM_USER=app-mm
REDIS_MM_PASSWORD=your-strong-password-mm
REDIS_MM_DB=0
REDIS_MM_TLS=true

# Redis Ops (Queues/Jobs)
REDIS_OPS_HOST=redis-67890.us-east-1-1.ec2.cloud.redislabs.com
REDIS_OPS_PORT=67890
REDIS_OPS_USER=app-ops
REDIS_OPS_PASSWORD=your-strong-password-ops
REDIS_OPS_DB=0
REDIS_OPS_TLS=true
```

### Complete Render Environment Variables

```bash
DATABASE_URL=postgresql://guess5_user:nxf1TsMfS4XwW5Ix59zMDxm8kJC7CBpD@dpg-d21t6nqdbo4c73ek2in0-a.ohio-postgres.render.com/guess5?sslmode=require

FEE_WALLET_ADDRESS=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt

FEE_WALLET_PRIVATE_KEY=27vPYFSiF9KFDMDszPsLRVGT3jk5E1UWr9yLCw7hawEAs5pMnmv1zEVptmXJSTy56LTQSChP9ENiKK6kiRaajxWe

FRONTEND_URL=https://guess5.vercel.app

NODE_ENV=production

PORT=40000

RECAPTCHA_SECRET=6Lcq4JArAAAAAFuEZdJCOEtLaF8ZD5wCaABVhRnt

# Redis MM (Matchmaking)
REDIS_MM_HOST=redis-12345.us-east-1-1.ec2.cloud.redislabs.com
REDIS_MM_PORT=12345
REDIS_MM_USER=app-mm
REDIS_MM_PASSWORD=your-strong-password-mm
REDIS_MM_DB=0
REDIS_MM_TLS=true

# Redis Ops (Queues/Jobs)
REDIS_OPS_HOST=redis-67890.us-east-1-1.ec2.cloud.redislabs.com
REDIS_OPS_PORT=67890
REDIS_OPS_USER=app-ops
REDIS_OPS_PASSWORD=your-strong-password-ops
REDIS_OPS_DB=0
REDIS_OPS_TLS=true
```

## 🧪 Step 6: Test Redis Connection

### Install Redis CLI (Optional)

```bash
# On WSL/Ubuntu
sudo apt-get update && sudo apt-get install -y redis-tools

# Test TLS connection
redis-cli -h redis-12345.us-east-1-1.ec2.cloud.redislabs.com -p 12345 -a app-mm:your-strong-password-mm --tls
```

### Test Commands

```bash
# Test basic connection
PING

# Test matchmaking keys
KEYS mm:*

# Test queue keys
KEYS ops:*

# Exit
EXIT
```

## 📊 Step 7: Monitor Redis Performance

### Set Up Alerts in Redis Cloud

1. **Memory Usage**: Alert when > 70%
2. **Evictions**: Should be zero on `redis-ops`
3. **Replication Lag**: Monitor for delays
4. **Connection Spikes**: Watch for unusual activity

### Monitor Queue Performance

The application will provide queue statistics at:
```
GET /health
```

This will show:
- Queue job counts (waiting, active, completed, failed)
- Redis connection health
- Database health

## 🔄 Step 8: Deploy and Test

1. **Update Render**: Add the new environment variables
2. **Redeploy**: Trigger a new deployment
3. **Test Matchmaking**: Try creating a match between two players
4. **Monitor Logs**: Check for Redis connection success
5. **Test Queues**: Verify payment processing works

## 🚨 Troubleshooting

### Common Issues

1. **Connection Refused**:
   - Check firewall settings
   - Verify TLS is enabled
   - Confirm credentials

2. **Authentication Failed**:
   - Double-check username/password
   - Ensure user has correct permissions

3. **Memory Issues**:
   - Monitor memory usage in Redis Cloud
   - Scale up if needed

4. **Queue Jobs Not Processing**:
   - Check Redis Ops connection
   - Verify BullMQ configuration
   - Check application logs

### Health Check Endpoint

Monitor your application health at:
```
https://guess5.onrender.com/health
```

This will show Redis connection status and queue statistics.

## 📈 Scaling Considerations

### When to Scale Up

1. **Memory Usage > 70%**: Increase memory allocation
2. **High Eviction Rate**: Scale up `redis-mm`
3. **Queue Backlog**: Scale up `redis-ops`
4. **Connection Limits**: Increase max connections

### Performance Optimization

1. **Key Expiration**: All keys have TTL for automatic cleanup
2. **Connection Pooling**: Optimized connection management
3. **Job Retries**: Exponential backoff for failed jobs
4. **Memory Management**: Automatic cleanup of completed jobs

## 🔒 Security Best Practices

1. **Strong Passwords**: Use generated passwords
2. **TLS Enabled**: Always use encrypted connections
3. **User Permissions**: Minimal required permissions
4. **IP Restrictions**: Consider IP allowlisting for production
5. **Regular Rotation**: Rotate passwords periodically

## 📞 Support

If you encounter issues:

1. Check Redis Cloud documentation
2. Review application logs
3. Test connections manually
4. Monitor health endpoint
5. Scale resources if needed

---

**🎉 Congratulations!** Your Guess5 application now has production-ready Redis infrastructure for scalable matchmaking and job processing.
