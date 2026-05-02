# VaronEnglish Production Deployment Guide

## 🚀 Pre-Deployment Checklist

### Critical Items (Must Complete)
- [ ] **Secrets Management**: Generate and securely store all API keys, JWT secrets, database credentials
- [ ] **Database Setup**: Configure production PostgreSQL or MongoDB with backups enabled  
- [ ] **Redis Setup**: Configure Redis for caching and session management (optional but recommended)
- [ ] **AWS/S3 Configuration**: Set up S3 buckets for video storage with CloudFront CDN
- [ ] **LiveKit Setup**: Deploy and configure LiveKit server for live class functionality
- [ ] **SSL Certificates**: Configure HTTPS with valid SSL certificates (required)
- [ ] **Admin Account**: Create admin user in database (do NOT use defaults)
- [ ] **Domain Setup**: Point domain to production server
- [ ] **Email Service**: Configure email provider for notifications
- [ ] **Monitoring**: Set up logging, error tracking, and performance monitoring

### Environment-Specific Checks
- [ ] Verify `NODE_ENV=production`
- [ ] Verify `EXPOSE_SAMPLE_CREDENTIALS=false`
- [ ] Verify `ALLOW_MEMORY_FALLBACK=false`
- [ ] Verify no `.local` domains in configuration
- [ ] Verify all external service URLs use HTTPS

---

## 🔐 Security Hardening

### Secrets Management
1. **NEVER commit secrets** to version control
2. **Use environment variables** for all sensitive data
3. **Rotate secrets regularly** (especially API keys)
4. **Use AWS Secrets Manager** or similar for production
5. **Audit access logs** regularly

### Database Security
```sql
-- Create strong database user with limited permissions
CREATE USER varonenglish_app WITH PASSWORD 'strong-random-password';
GRANT CONNECT ON DATABASE varonenglish_prod TO varonenglish_app;
GRANT USAGE ON SCHEMA public TO varonenglish_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO varonenglish_app;
```

### API Security
- Enable rate limiting (default: 300 requests/minute)
- Configure CORS to allow only your domain
- Use HTTPS for all communications
- Implement JWT token expiration (default: ~1 hour)
- Monitor for suspicious activity patterns

### Video Security
- Enable DRM (Digital Rights Management) for premium content
- Set up private video delivery with signed URLs
- Configure video access tokens with TTL
- Monitor unauthorized access attempts

---

## 📦 Deployment Steps

### 1. Environment Setup
```bash
# Copy production environment template
cp .env.production .env.local

# Edit with production values
nano .env.local

# Verify no demo/local values
grep "\.local\|example.com\|edumaster\|SSC\|RRB" .env.local
```

### 2. Build for Production
```bash
# Clean previous builds
npm run clean

# Build frontend with optimizations
npm run build

# Verify build output
ls -lh dist/assets/

# Check bundle size (should optimize as needed)
```

### 3. Database Migration
```bash
# Backup existing database
pg_dump varonenglish_prod > backup_$(date +%Y%m%d).sql

# Run any pending migrations (if applicable)
npm run migrate:latest

# Verify database connectivity
node -e "require('./backend/lib/database.js').then(() => console.log('✓ Connected'))"
```

### 4. Start Production Server
```bash
# Use process manager (PM2, systemd, Docker, etc.)
pm2 start "npm run start" --name varonenglish --env production

# Or with systemd:
sudo systemctl start varonenglish

# Or with Docker:
docker-compose -f docker-compose.prod.yml up -d
```

### 5. Verify Production Deployment
```bash
# Check server health
curl -s http://localhost:5000/health | jq

# Verify API endpoints
curl -s http://localhost:5000/backend/api/health

# Check logs
pm2 logs varonenglish

# Monitor resource usage
pm2 moitor
```

---

## 🎯 Production Configuration Highlights

### Database Configuration
- Multiple read replicas for high availability
- Automated backups (daily minimum)
- Connection pooling (max 20 connections)
- Query timeouts (30 seconds)

### Caching Strategy
- Redis for session management
- Video stream caching via CloudFront CDN
- Course metadata caching (1-hour TTL)
- User enrollment caching (30-minute TTL)

### Video Streaming
- HLS format with 480p and 720p renditions
- CloudFront distribution for CDN delivery
- Adaptive bitrate streaming
- DRM protection for premium content

### Live Classes
- LiveKit deployment with 1000+ concurrent participants
- Recording and replay functionality
- Stream health monitoring
- Automatic failover to backup streams

---

## 📊 Production Monitoring

### Essential Metrics
- API response time (target: <500ms p95)
- Database query time (target: <100ms p95)
- Server CPU/Memory usage
- Video stream health
- Live class participant count
- Error rate (target: <0.1%)

### Alerting
```bash
# Configure alerts for:
- High error rate (>1%)
- High latency (>1s response time)
- Database connection pool exhausted
- Disk space <10%
- Memory usage >85%
- Video processing failures
```

### Logging
- Aggregate logs to centralized service (e.g., ELK, Datadog)
- Keep logs for minimum 30 days
- Monitor for security incidents
- Track user session issues

---

## 🔄 Maintenance & Updates

### Regular Tasks
- **Daily**: Monitor error logs, check system health
- **Weekly**: Review performance metrics, update security patches
- **Monthly**: Database optimization, content review
- **Quarterly**: Security audit, dependency updates
- **Annually**: Third-party penetration test

### Backup & Recovery
```bash
# Automated daily backups
0 2 * * * pg_dump varonenglish_prod > /backups/db_$(date +\%Y\%m\%d).sql

# Test recovery monthly
pg_restore -d recovery_test /backups/db_latest.sql

# Verify backup integrity
sql "SELECT COUNT(*) FROM users" recovery_test
```

### Zero-Downtime Deployments
1. Deploy new code to staging
2. Run migrations on staging
3. Run smoke tests
4. Blue-green deploy to production
5. Gradual traffic shifting
6. Monitor error rates
7. Rollback if needed

---

## 🚨 Troubleshooting Production Issues

### Video Upload Failures
```bash
# Check disk space
df -h /videos

# Verify FFmpeg installation
which ffmpeg

# Check video processing logs
tail -f logs/video-processing.log
```

### Live Class Issues
```bash
# Verify LiveKit connectivity
curl -s $LIVEKIT_URL/health

# Check WebRTC connectivity
# Use browser DevTools > Network > WebRTC
```

### High Latency
```bash
# Check database slow query log
tail -f logs/slow-queries.log

# Verify Redis performance
redis-benchmark -c 50 -n 10000

# Check network latency
ping -c 5 database-host
```

### Memory Leaks
```bash
# Monitor Node process memory
watch -n 1 'ps aux | grep node'

# Generate heap snapshot
kill -USR2 $NODE_PID
# Check heap dump file

# Restart process if needed
pm2 restart varonenglish
```

---

## 📞 Production Support

### Emergency Contacts
- Database Team: [contact]
- DevOps Team: [contact]  
- On-Call Engineer: [pagerduty-link]

### Escalation Path
1. Check recent deployments / changes
2. Review error logs and metrics
3. Contact DBA for database issues
4. Contact DevOps for infrastructure issues
5. Page on-call engineer if critical

---

## 🎓 Production Best Practices

1. **Always test in staging** before production deployment
2. **Never use production data** for testing
3. **Monitor continuously** for anomalies
4. **Document all changes** in change log
5. **Keep dependencies updated** for security patches
6. **Rotate secrets regularly** (minimum quarterly)
7. **Practice disaster recovery** quarterly
8. **Maintain detailed runbooks** for common issues
9. **Use infrastructure-as-code** for consistency
10. **Automate deployments** to reduce human error

---

**Last Updated**: April 2026  
**Maintained By**: VaronEnglish DevOps Team
