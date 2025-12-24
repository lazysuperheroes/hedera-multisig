# Deployment Guide - WalletConnect dApp

This guide covers deploying the Hedera MultiSig WalletConnect dApp to production using Vercel.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Vercel Deployment](#vercel-deployment)
3. [Environment Variables](#environment-variables)
4. [Custom Domain Setup](#custom-domain-setup)
5. [Post-Deployment Verification](#post-deployment-verification)
6. [Monitoring & Maintenance](#monitoring--maintenance)

---

## Prerequisites

### Required Accounts

1. **GitHub Account**
   - Repository must be pushed to GitHub
   - Vercel will deploy from GitHub

2. **Vercel Account**
   - Sign up at https://vercel.com/signup
   - Free tier is sufficient for testing
   - Pro tier recommended for production

3. **WalletConnect Project**
   - Project ID from https://cloud.walletconnect.com/
   - Configure allowed domains in WalletConnect dashboard

### Pre-Deployment Checklist

- [ ] Code pushed to GitHub repository
- [ ] All tests passing locally
- [ ] Build successful (`npm run build`)
- [ ] Environment variables documented
- [ ] `.env.local.example` up to date
- [ ] No sensitive data in code

---

## Vercel Deployment

### Option 1: Deploy via Vercel Dashboard (Recommended)

1. **Login to Vercel**
   ```
   https://vercel.com/login
   ```

2. **Import Project**
   - Click "Add New..." → "Project"
   - Select "Import Git Repository"
   - Authorize Vercel to access your GitHub account
   - Select your `hedera-multisig` repository

3. **Configure Project**
   - **Framework Preset**: Next.js (auto-detected)
   - **Root Directory**: `dapp` ⚠️ **IMPORTANT**
   - **Build Command**: `npm run build` (auto-filled)
   - **Output Directory**: `.next` (auto-filled)
   - **Install Command**: `npm install` (auto-filled)

4. **Set Environment Variables**

   Click "Environment Variables" and add:

   | Name | Value | Environment |
   |------|-------|-------------|
   | `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | `your_project_id` | Production, Preview, Development |
   | `NEXT_PUBLIC_DEFAULT_NETWORK` | `testnet` or `mainnet` | Production, Preview, Development |

   **Important**: These variables must be prefixed with `NEXT_PUBLIC_` to be accessible in the browser.

5. **Deploy**
   - Click "Deploy"
   - Wait for build to complete (~2-3 minutes)
   - Deployment URL will be shown (e.g., `https://your-project.vercel.app`)

---

### Option 2: Deploy via Vercel CLI

1. **Install Vercel CLI**
   ```bash
   npm install -g vercel
   ```

2. **Login**
   ```bash
   vercel login
   ```

3. **Navigate to dApp Directory**
   ```bash
   cd dapp
   ```

4. **Deploy to Production**
   ```bash
   vercel --prod
   ```

5. **Set Environment Variables** (if not already set)
   ```bash
   vercel env add NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID production
   # Enter your WalletConnect Project ID when prompted

   vercel env add NEXT_PUBLIC_DEFAULT_NETWORK production
   # Enter "testnet" or "mainnet" when prompted
   ```

6. **Redeploy** (if you added variables after first deployment)
   ```bash
   vercel --prod
   ```

---

## Environment Variables

### Required Variables

#### `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- **Description**: WalletConnect Cloud project ID
- **How to Get**:
  1. Go to https://cloud.walletconnect.com/
  2. Sign in or create account
  3. Create new project or select existing
  4. Copy Project ID
- **Example**: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`
- **Environment**: Production, Preview, Development

#### `NEXT_PUBLIC_DEFAULT_NETWORK`
- **Description**: Default Hedera network
- **Allowed Values**: `testnet`, `mainnet`
- **Default**: `testnet`
- **Recommendation**: Use `testnet` for staging, `mainnet` for production
- **Environment**: Production, Preview, Development

### Optional Variables

#### `NEXT_PUBLIC_APP_URL`
- **Description**: Public URL of deployed app (for metadata)
- **Example**: `https://hedera-multisig.vercel.app`
- **Auto-detected**: Vercel sets this automatically

---

## Custom Domain Setup

### Add Custom Domain to Vercel

1. **Go to Project Settings**
   - Navigate to your project in Vercel dashboard
   - Click "Settings" → "Domains"

2. **Add Domain**
   - Enter your domain (e.g., `multisig.hedera.app`)
   - Click "Add"

3. **Configure DNS**

   **Option A: Use Vercel Nameservers** (Recommended)
   - Point your domain's nameservers to Vercel
   - Vercel manages all DNS records

   **Option B: Add CNAME Record**
   - In your DNS provider, add:
     ```
     Type: CNAME
     Name: multisig (or @ for root)
     Value: cname.vercel-dns.com
     ```

4. **Wait for DNS Propagation**
   - Usually 5-30 minutes
   - Check status in Vercel dashboard

5. **SSL Certificate**
   - Vercel automatically provisions SSL certificate
   - HTTPS enabled by default

---

## WalletConnect Configuration

### Update WalletConnect Project Settings

After deployment, update your WalletConnect project:

1. **Go to WalletConnect Cloud**
   - https://cloud.walletconnect.com/
   - Select your project

2. **Add Allowed Domains**
   - Navigate to "Settings" → "Allowed Domains"
   - Add your production URL:
     ```
     https://your-project.vercel.app
     ```
   - If using custom domain, add that too:
     ```
     https://multisig.hedera.app
     ```

3. **Save Changes**

**Important**: WalletConnect may cache domain settings. If connection fails immediately after adding domain, wait a few minutes and try again.

---

## Post-Deployment Verification

### Deployment Checklist

After deployment, verify the following:

- [ ] **Site loads**: Visit deployment URL
- [ ] **Landing page displays** correctly
- [ ] **Join form accessible** (/join route)
- [ ] **No console errors** (open browser DevTools)
- [ ] **Environment variables set**: Check in Vercel dashboard
- [ ] **WalletConnect modal opens**: Test wallet connection
- [ ] **Can connect wallet**: Test with HashPack/Blade
- [ ] **WebSocket connection works**: Join test session
- [ ] **Transaction review displays**: Inject test transaction
- [ ] **Can sign transaction**: Complete full signing flow
- [ ] **Mobile responsive**: Test on mobile device
- [ ] **HTTPS enabled**: Check padlock icon in browser
- [ ] **Custom domain works** (if configured)

### Test Signing Flow End-to-End

1. **Start Test Server** (on your local machine or separate server):
   ```bash
   node scripts/start-test-server.js
   ```

2. **Configure with Tunnel**:
   - Server should auto-start tunnel (ngrok or localtunnel)
   - Get public WebSocket URL (wss://...)

3. **Join from Production dApp**:
   - Go to your deployed URL
   - Click "Join Signing Session"
   - Enter tunnel WebSocket URL, Session ID, PIN
   - Connect wallet and complete signing flow

4. **Verify**:
   - All steps complete successfully
   - Transaction executes on Hedera network
   - Success message displays with transaction ID

---

## Monitoring & Maintenance

### Vercel Analytics

1. **Enable Analytics**
   - Go to Project Settings → Analytics
   - Enable Web Analytics (free tier available)

2. **Monitor Metrics**:
   - Page views
   - Unique visitors
   - Performance (Core Web Vitals)
   - Top pages

### Vercel Logs

1. **Access Logs**:
   - Go to Deployments → Select deployment → Logs
   - View build logs and runtime logs

2. **Monitor for Errors**:
   - Check for console errors
   - Monitor failed builds
   - Review runtime errors

### Performance Monitoring

- **Lighthouse Score**: Run in Chrome DevTools
  - Target: 90+ for Performance, Accessibility, Best Practices, SEO

- **Core Web Vitals**:
  - LCP (Largest Contentful Paint): < 2.5s
  - FID (First Input Delay): < 100ms
  - CLS (Cumulative Layout Shift): < 0.1

### Automatic Deployments

Vercel automatically deploys:
- **Production**: Pushes to `main` branch → Production deployment
- **Preview**: Pull requests → Preview deployment (unique URL)
- **Development**: Pushes to other branches → Preview deployment

**Configuration**:
- Settings → Git → Configure branch for production
- Settings → Git → Enable/disable automatic deployments

---

## Rollback & Recovery

### Rollback to Previous Deployment

1. **Go to Deployments**
   - Select previous successful deployment
   - Click "⋮" menu → "Promote to Production"

2. **Instant Rollback**
   - Traffic switches to previous deployment
   - No rebuild required

### Environment Variable Changes

1. **Update Variables**:
   - Settings → Environment Variables
   - Edit or add variables

2. **Trigger Redeploy**:
   - Deployments → Latest → "Redeploy"
   - Or push new commit to trigger auto-deploy

---

## Troubleshooting

### Build Fails

**Error**: `Module not found`
- **Cause**: Missing dependency
- **Solution**: Ensure all dependencies in `package.json`, run `npm install` locally to verify

**Error**: `TypeScript compilation failed`
- **Cause**: Type errors in code
- **Solution**: Run `npm run build` locally, fix all type errors

**Error**: `NEXT_PUBLIC_* variable not found`
- **Cause**: Environment variable not set in Vercel
- **Solution**: Add variable in Vercel dashboard → Redeploy

### Runtime Errors

**Error**: "WalletConnect modal doesn't open"
- **Cause**: Invalid or missing `WALLETCONNECT_PROJECT_ID`
- **Solution**: Verify variable is set correctly in Vercel
- **Verify**: Check browser console for specific error

**Error**: "Cannot connect to WebSocket server"
- **Cause**: Server URL incorrect or server not running
- **Solution**: Verify server URL format (wss:// for production)
- **CORS**: Ensure server allows connections from deployment domain

**Error**: "This domain is not allowed"
- **Cause**: WalletConnect domain restriction
- **Solution**: Add deployment URL to WalletConnect project settings

### Performance Issues

**Slow Page Load**:
- Check image optimization (use Next.js Image component)
- Review bundle size (use `npm run analyze` if configured)
- Enable Vercel Speed Insights

**High Latency**:
- Verify Vercel region matches user location
- Consider Edge Functions for global distribution
- Use CDN for static assets

---

## Security Best Practices

### Production Security

- [x] **HTTPS Only**: Enforced by Vercel automatically
- [x] **Environment Variables**: Never commit to repository
- [x] **CSP Headers**: Consider adding Content Security Policy
- [x] **Rate Limiting**: Monitor for abuse, add rate limiting if needed
- [x] **Dependencies**: Keep dependencies updated (`npm audit`)

### WalletConnect Security

- [x] **Domain Whitelist**: Only add trusted domains to WalletConnect
- [x] **Project Security**: Use separate projects for dev/staging/prod
- [x] **API Keys**: Rotate WalletConnect Project ID if compromised

### User Security

- [x] **VERIFIED UI**: Ensure VERIFIED vs UNVERIFIED sections are prominent
- [x] **Metadata Validation**: Display validation warnings clearly
- [x] **Session Security**: Use strong PINs, short session timeouts

---

## Cost Considerations

### Vercel Pricing

**Hobby (Free) Tier**:
- ✅ Unlimited personal projects
- ✅ 100 GB bandwidth/month
- ✅ Automatic HTTPS
- ✅ Preview deployments
- ❌ No commercial use
- ❌ No team collaboration

**Pro Tier ($20/month per user)**:
- ✅ Commercial use allowed
- ✅ 1 TB bandwidth/month
- ✅ Team collaboration
- ✅ Advanced analytics
- ✅ Password protection
- ✅ Priority support

**Recommendation**:
- Hobby tier for testing/personal use
- Pro tier for production/commercial deployment

---

## Deployment Checklist

### Pre-Deployment
- [ ] All code pushed to GitHub
- [ ] Build successful locally
- [ ] Environment variables documented
- [ ] Tests passing
- [ ] README updated
- [ ] CHANGELOG updated (if applicable)

### Deployment
- [ ] Vercel project created
- [ ] Root directory set to `dapp`
- [ ] Environment variables configured
- [ ] Production deployment successful
- [ ] Deployment URL accessible

### Post-Deployment
- [ ] Site loads without errors
- [ ] WalletConnect connection tested
- [ ] End-to-end signing flow tested
- [ ] Mobile responsive verified
- [ ] Analytics enabled
- [ ] Custom domain configured (if applicable)
- [ ] SSL certificate active
- [ ] WalletConnect domains updated

### Ongoing
- [ ] Monitor Vercel analytics
- [ ] Review deployment logs
- [ ] Keep dependencies updated
- [ ] Monitor user feedback
- [ ] Plan feature updates

---

## Support & Resources

### Vercel Documentation
- **Docs**: https://vercel.com/docs
- **Next.js on Vercel**: https://vercel.com/docs/frameworks/nextjs
- **Environment Variables**: https://vercel.com/docs/environment-variables

### WalletConnect Documentation
- **Docs**: https://docs.walletconnect.com/
- **Cloud Dashboard**: https://cloud.walletconnect.com/
- **Hedera Integration**: https://docs.hedera.com/hedera/tutorials/more-tutorials/walletconnect

### Hedera Resources
- **Docs**: https://docs.hedera.com/
- **Portal**: https://portal.hedera.com/
- **Discord**: https://hedera.com/discord

---

**Deployment Guide Complete!** 🚀

For questions or issues, check:
- Main [README.md](./README.md)
- [INTEGRATION_TESTING.md](./INTEGRATION_TESTING.md)
- [QUICKSTART.md](./QUICKSTART.md)
