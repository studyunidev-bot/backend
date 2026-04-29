# 📦 Missing Dependencies & Quick Start Guide

## Required Additional npm Packages

Run this command to install all missing production dependencies:

```bash
npm install @nestjs/terminus nest-winston winston uuid
```

Or install individually:

```bash
npm install @nestjs/terminus          # Health checks
npm install nest-winston winston      # Structured logging
npm install uuid                      # UUID generation
npm install class-transformer         # Data transformation (already in package.json)
```

For Swagger documentation:

```bash
npm install @nestjs/swagger swagger-ui-express
```

**All packages are already in package.json:**
- ✅ @nestjs/throttler (Rate limiting)
- ✅ @nestjs/jwt (JWT tokens)
- ✅ @nestjs/passport (Authentication)
- ✅ @nestjs/config (Environment config)
- ✅ helmet (Security headers)
- ✅ class-validator (Input validation)
- ✅ bcrypt (Password hashing)
- ✅ @prisma/client (Database ORM)
- ✅ passport-jwt (JWT strategy)

---

## 🚀 Quick Start - Step by Step

### Phase 1: Install & Verify Dependencies
```bash
npm install
npm run build  # Should compile without errors
```

### Phase 2: Fix Remaining npm Issues (if any)

If you still get permission errors:
```bash
rm -rf node_modules package-lock.json
npm cache clean --force
npm install --prefer-offline
```

### Phase 3: Apply Security Fixes (Priority Order)

**Day 1: CRITICAL (Must do before any testing)**

1. **Rate Limiting** (15 min)
   - Create `src/throttler.config.ts`
   - Update `src/app.module.ts` to import ThrottlerModule
   - Protects all routes from DDoS

2. **Environment Validation** (15 min)
   - Create `src/config/validate-env.ts`
   - Update `app.module.ts` to add validate function
   - Catches config errors at startup

3. **JWT Authentication** (45 min)
   - Create `src/auth/` folder with all auth files
   - Create `src/auth/auth.service.ts`
   - Create `src/auth/jwt.strategy.ts`
   - Create `src/auth/jwt.guard.ts`
   - Create `src/auth/auth.controller.ts`
   - Create `src/auth/auth.module.ts`

4. **Prisma Error Handler** (15 min)
   - Create `src/filters/prisma-exception.filter.ts`
   - Update `main.ts` to use new filter
   - Prevents database schema exposure

5. **Structured Logging** (20 min)
   - Install: `npm install nest-winston winston`
   - Create `src/common/logger/winston.config.ts`
   - Update `main.ts` to use Winston
   - Create `logs/` directory

---

## File Structure After All Changes

```
src/
├── auth/
│   ├── auth.controller.ts
│   ├── auth.module.ts
│   ├── auth.service.ts
│   ├── jwt.strategy.ts
│   ├── jwt.guard.ts
│   ├── roles.guard.ts
│   ├── decorators/
│   │   ├── roles.decorator.ts
│   │   └── require-role.decorator.ts
│   └── dto/
│       ├── login.dto.ts
│       └── register.dto.ts
├── common/
│   ├── filters/
│   │   ├── prisma-exception.filter.ts
│   │   └── all-exceptions.filter.ts
│   ├── interceptors/
│   │   ├── audit.interceptor.ts
│   │   └── request-id.interceptor.ts
│   ├── middleware/
│   │   └── request-id.middleware.ts
│   ├── decorators/
│   │   ├── sanitize.decorator.ts
│   │   └── public.decorator.ts
│   ├── sanitizer/
│   │   └── html-sanitizer.ts
│   └── logger/
│       └── winston.config.ts
├── health/
│   ├── health.controller.ts
│   └── health.module.ts
├── config/
│   └── validate-env.ts
├── prisma/
│   ├── prisma.module.ts
│   └── prisma.service.ts
├── dto/
│   └── create-user.dto.ts
├── app.controller.ts
├── app.module.ts
├── app.service.ts
├── users.service.ts
├── main.ts
├── throttler.config.ts
└── (other existing files)

logs/
├── app.log
└── error.log
```

---

## Updated .env.example

```env
# Core
NODE_ENV=development
PORT=3000

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/demo_app_db
DB_POOL_MAX=20
DB_IDLE_TIMEOUT=30000

# Authentication
JWT_SECRET=change-me-to-random-secret-in-production-min-32-chars
JWT_REFRESH_SECRET=change-me-to-random-secret-in-production-min-32-chars
JWT_EXPIRATION=24h

# Security
CORS_ORIGIN=http://localhost:3000,http://localhost:3001

# Logging
LOG_LEVEL=info

# Features
ENABLE_AUDIT_LOGS=true
ENABLE_REQUEST_LOGGING=true
```

---

## Updated package.json Scripts

Add these scripts for development:

```json
{
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main",
    "lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:studio": "prisma studio",
    "db:reset": "prisma migrate reset",
    "health": "curl http://localhost:3000/health"
  }
}
```

---

## Database Migration Commands

After updating schema.prisma:

```bash
# Create migration
npx prisma migrate dev --name add_auth_and_audit

# Apply migration to database
npx prisma migrate deploy

# View migrations
npx prisma migrate status

# Reset database (DEV ONLY)
npx prisma migrate reset

# Studio - visual database inspector
npx prisma studio
```

---

## Testing Your Fixes

### Test Rate Limiting
```bash
# Send >100 requests in 60 seconds
for i in {1..105}; do
  curl -X GET http://localhost:3000/health &
done
wait
# After 100, should get 429 Too Many Requests
```

### Test JWT Authentication
```bash
# Register
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@x.com","password":"MyPassword123"}'

# Should return: { user: {...}, accessToken: "...", refreshToken: "..." }

# Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@x.com","password":"MyPassword123"}'

# Access protected endpoint
curl -X GET http://localhost:3000/admin/users \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Test Prisma Error Handling
```bash
# Try duplicate email (should return 409 Conflict)
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@x.com","password":"Password123"}'

# Should NOT expose: "Unique constraint failed"
```

### Test Health Checks
```bash
# Liveness check (always passes if app is running)
curl http://localhost:3000/health/live

# Readiness check (checks database)
curl http://localhost:3000/health/ready

# Full health check
curl http://localhost:3000/health
```

### Test Structured Logging
```bash
# Check logs were created
ls -la logs/

# View latest logs
tail -f logs/app.log

# View errors only
grep "ERROR" logs/error.log
```

---

## Deployment Checklist

Before deploying to production:

- [ ] All npm packages installed
- [ ] Build passes without errors: `npm run build`
- [ ] All tests pass: `npm test`
- [ ] Environment variables configured (not in code)
- [ ] Database migrations applied: `npx prisma migrate deploy`
- [ ] Logs directory writable: `mkdir -p logs && chmod 755 logs`
- [ ] Rate limiting works (tested)
- [ ] JWT tokens generated and validated (tested)
- [ ] Health checks respond correctly (tested)
- [ ] Prisma errors don't leak schema (tested)
- [ ] CORS properly configured (no * in production)
- [ ] Helmet security headers enabled
- [ ] Database has appropriate indexes
- [ ] Backups configured
- [ ] Monitoring/logging system ready
- [ ] SSL/TLS certificates ready
- [ ] Admin panel for audit logs (future)

---

## Common Issues & Fixes

### Issue: "Cannot find module '@prisma/client'"
**Fix:** `npm install` or ensure node_modules exists

### Issue: "Port 3000 already in use"
**Fix:** Change PORT in .env or kill process: `lsof -ti:3000 | xargs kill -9`

### Issue: "Database connection timeout"
**Fix:** Check DATABASE_URL in .env and verify PostgreSQL is running

### Issue: "JWT token invalid"
**Fix:** Ensure JWT_SECRET matches in .env and not changing between requests

### Issue: "Logs not being created"
**Fix:** Ensure logs directory exists: `mkdir -p logs`

### Issue: "Rate limiting not working"
**Fix:** ThrottlerGuard must be registered as global provider in app.module.ts

### Issue: "Health check returns 500"
**Fix:** Database might be down, verify connection string and PostgreSQL status

---

## Production Deployment Template (Docker)

```dockerfile
# Dockerfile
FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install --prod

COPY . .
RUN npm run build

FROM node:22-alpine

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Create logs directory
RUN mkdir -p logs

EXPOSE 3000

# Run migrations and start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
```

Build & run:
```bash
docker build -t demo-app .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@db:5432/app" \
  -e JWT_SECRET="your-secret-key" \
  -e NODE_ENV=production \
  demo-app
```

---

## Production Security Checklist (Before Go-Live)

- [ ] All secrets in environment variables (not in code)
- [ ] Database backups automated daily
- [ ] SSL/TLS enabled
- [ ] Rate limiting configured appropriately
- [ ] Logging sent to centralized system (ELK, DataDog, etc.)
- [ ] Monitoring/alerting configured
- [ ] Error tracking (Sentry, etc.) configured
- [ ] Database indexes created and verified
- [ ] Audit logs being captured
- [ ] Admin dashboard for monitoring
- [ ] Incident response plan documented
- [ ] Version control protecting main branch
- [ ] Code review process established
- [ ] Penetration testing completed
- [ ] SOC 2 / HIPAA / GDPR compliance verified

---

## Next Steps

1. **Review AUDIT_REPORT.md** - Understand what's missing
2. **Follow IMPLEMENTATION_GUIDE.md** - Implement critical fixes
3. **Follow IMPLEMENTATION_GUIDE_PART2.md** - Implement medium priority items
4. **Test everything** using curl commands above
5. **Deploy with confidence** using deployment template

**Expected Timeline:**
- Phase 1 (Critical): 2-3 hours
- Phase 2 (High): 4-5 hours
- Phase 3 (Medium): 6-8 hours
- Total: ~15 hours to production-ready

---

## Support Resources

- NestJS Docs: https://docs.nestjs.com
- Prisma Docs: https://www.prisma.io/docs
- OWASP Top 10: https://owasp.org/www-project-top-ten
- NestJS Security: https://docs.nestjs.com/techniques/security
- Prisma Security: https://www.prisma.io/docs/guides/security

**Good luck with the implementation! 🚀**
