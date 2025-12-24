# Vercel Deployment Guide - Testnet & Production

This guide shows how to deploy **two separate versions** of the dApp:
1. **Testnet** - For testing with Hedera testnet
2. **Production** - For production use with Hedera mainnet

---

## Overview

You'll create **two Vercel projects** from the same GitHub repository:
- `hedera-multisig-testnet` → Points to testnet
- `hedera-multisig-production` → Points to mainnet

Both deploy from the same `dapp/` directory but with different environment variables.

---

## Prerequisites

- ✅ GitHub repository with your code
- ✅ Vercel account (free tier works)
- ✅ Two WalletConnect Project IDs (one for testnet, one for production)
  - Get them at https://cloud.walletconnect.com/
  - **Recommended**: Use separate projects for security isolation

---

## Step 1: Deploy Testnet Version

### 1.1 Import Project in Vercel

1. **Login to Vercel**: https://vercel.com/login

2. **Import Repository**:
   - Click "Add New..." → "Project"
   - Select your GitHub repository
   - Click "Import"

3. **Configure Project**:
   - **Project Name**: `hedera-multisig-testnet`
   - **Framework Preset**: Next.js (auto-detected)
   - **Root Directory**: `dapp` ⚠️ **CRITICAL**
   - **Build Command**: `npm run build` (auto-filled)
   - **Output Directory**: `.next` (auto-filled)
   - **Install Command**: `npm install` (auto-filled)

### 1.2 Set Environment Variables (Testnet)

Click "Environment Variables" and add:

| Variable Name | Value | Environments |
|--------------|-------|--------------|
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | `your_testnet_walletconnect_project_id` | Production, Preview, Development |
| `NEXT_PUBLIC_DEFAULT_NETWORK` | `testnet` | Production, Preview, Development |

**Important**:
- Use your **testnet WalletConnect Project ID**
- Set `NEXT_PUBLIC_DEFAULT_NETWORK` to `testnet`

### 1.3 Deploy

1. Click "Deploy"
2. Wait for build to complete (~2-3 minutes)
3. You'll get a URL like: `https://hedera-multisig-testnet.vercel.app`

### 1.4 Configure WalletConnect Domain

1. Go to https://cloud.walletconnect.com/
2. Select your **testnet** project
3. Navigate to "Settings" → "Allowed Domains"
4. Add your testnet deployment URL:
   ```
   https://hedera-multisig-testnet.vercel.app
   ```
5. Save changes

### 1.5 Test Testnet Deployment

1. Open: `https://hedera-multisig-testnet.vercel.app`
2. Verify landing page loads
3. Click "Join Signing Session"
4. Try connecting wallet (ensure wallet is on **testnet**)
5. Verify no console errors

---

## Step 2: Deploy Production Version

### 2.1 Create Second Vercel Project

1. **Go back to Vercel Dashboard**

2. **Import Same Repository Again**:
   - Click "Add New..." → "Project"
   - Select the **same GitHub repository**
   - Click "Import"

3. **Configure Project**:
   - **Project Name**: `hedera-multisig-production` or `hedera-multisig`
   - **Framework Preset**: Next.js (auto-detected)
   - **Root Directory**: `dapp` ⚠️ **CRITICAL**
   - **Build Command**: `npm run build` (auto-filled)
   - **Output Directory**: `.next` (auto-filled)
   - **Install Command**: `npm install` (auto-filled)

### 2.2 Set Environment Variables (Production)

Click "Environment Variables" and add:

| Variable Name | Value | Environments |
|--------------|-------|--------------|
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | `your_production_walletconnect_project_id` | Production, Preview, Development |
| `NEXT_PUBLIC_DEFAULT_NETWORK` | `mainnet` | Production, Preview, Development |

**Important**:
- Use your **production WalletConnect Project ID** (different from testnet!)
- Set `NEXT_PUBLIC_DEFAULT_NETWORK` to `mainnet`

### 2.3 Deploy

1. Click "Deploy"
2. Wait for build to complete (~2-3 minutes)
3. You'll get a URL like: `https://hedera-multisig.vercel.app`

### 2.4 Configure WalletConnect Domain

1. Go to https://cloud.walletconnect.com/
2. Select your **production** project
3. Navigate to "Settings" → "Allowed Domains"
4. Add your production deployment URL:
   ```
   https://hedera-multisig.vercel.app
   ```
5. Save changes

### 2.5 Test Production Deployment

1. Open: `https://hedera-multisig.vercel.app`
2. Verify landing page loads
3. Click "Join Signing Session"
4. Try connecting wallet (ensure wallet is on **mainnet**)
5. Verify no console errors

⚠️ **WARNING**: Production uses real HBAR. Test thoroughly on testnet first!

---

## Step 3: Custom Domains (Optional)

### For Testnet

1. **Go to testnet project** in Vercel
2. Click "Settings" → "Domains"
3. Add custom domain:
   ```
   testnet.multisig.yourcompany.com
   ```
4. Follow DNS setup instructions (add CNAME record)
5. Update WalletConnect allowed domains to include custom domain

### For Production

1. **Go to production project** in Vercel
2. Click "Settings" → "Domains"
3. Add custom domain:
   ```
   multisig.yourcompany.com
   ```
4. Follow DNS setup instructions (add CNAME record)
5. Update WalletConnect allowed domains to include custom domain

**Result**:
- Testnet: `https://testnet.multisig.yourcompany.com`
- Production: `https://multisig.yourcompany.com`

---

## Step 4: Configure Git Deployments

### Recommended Branch Strategy

**Option A: Single Branch, Two Projects**
- Both projects deploy from `main` branch
- Environment variables differentiate testnet vs production
- **Pros**: Simple, one branch to manage
- **Cons**: Same code everywhere, harder to test production-specific changes

**Option B: Two Branches**
- Testnet project deploys from `develop` branch
- Production project deploys from `main` branch
- **Pros**: Can test changes on testnet before merging to production
- **Cons**: Need to maintain two branches

**Recommended**: Option B for production use

### Configure Option B

**For Testnet Project:**
1. Go to testnet project in Vercel
2. Click "Settings" → "Git"
3. Set "Production Branch" to `develop`

**For Production Project:**
1. Go to production project in Vercel
2. Click "Settings" → "Git"
3. Set "Production Branch" to `main`

**Workflow**:
```bash
# 1. Develop and test locally
git checkout develop
# ... make changes ...
git add .
git commit -m "Add new feature"
git push origin develop

# 2. Vercel auto-deploys to testnet
# 3. Test on https://hedera-multisig-testnet.vercel.app

# 4. When ready for production, merge to main
git checkout main
git merge develop
git push origin main

# 5. Vercel auto-deploys to production
# 6. Live on https://hedera-multisig.vercel.app
```

---

## Environment Variable Summary

### Testnet Project

```env
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=testnet_project_id_here
NEXT_PUBLIC_DEFAULT_NETWORK=testnet
```

### Production Project

```env
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=production_project_id_here
NEXT_PUBLIC_DEFAULT_NETWORK=mainnet
```

---

## Deployment Checklist

### Testnet Deployment
- [ ] Vercel project created (`hedera-multisig-testnet`)
- [ ] Root directory set to `dapp`
- [ ] Environment variables configured (testnet values)
- [ ] Build successful
- [ ] WalletConnect domain added (testnet project)
- [ ] Tested wallet connection on testnet
- [ ] End-to-end signing tested on testnet
- [ ] Custom domain configured (optional)

### Production Deployment
- [ ] Vercel project created (`hedera-multisig-production`)
- [ ] Root directory set to `dapp`
- [ ] Environment variables configured (mainnet values)
- [ ] Build successful
- [ ] WalletConnect domain added (production project)
- [ ] Tested wallet connection on mainnet (small amount)
- [ ] End-to-end signing tested on mainnet (small amount)
- [ ] Custom domain configured (optional)
- [ ] Branch strategy configured (if using Option B)

---

## Managing Updates

### Deploy to Testnet First

1. **Make changes** and push to `develop` branch
2. **Testnet auto-deploys** from `develop`
3. **Test thoroughly** on testnet
4. **Merge to main** when stable
5. **Production auto-deploys** from `main`

### Emergency Rollback

**If production deployment has issues:**

1. Go to production project in Vercel
2. Click "Deployments"
3. Find previous working deployment
4. Click "⋮" → "Promote to Production"
5. Instant rollback (no rebuild needed)

---

## Monitoring Both Deployments

### Vercel Analytics

Enable for both projects:
1. Project Settings → Analytics
2. Enable Web Analytics

Monitor separately:
- Testnet: Lower traffic, testing activity
- Production: Real user traffic

### Logs

Access logs for each deployment:
1. Go to project in Vercel
2. Click "Deployments" → Select deployment → "Logs"

---

## Cost Considerations

### Vercel Pricing

**Hobby (Free) Tier**:
- ✅ Can deploy both testnet and production
- ✅ 100 GB bandwidth/month **per project**
- ❌ No commercial use

**Pro Tier ($20/month per user)**:
- ✅ Commercial use allowed
- ✅ 1 TB bandwidth/month **per project**
- ✅ Both projects covered under same user account

**Recommendation**:
- Free tier for testing/personal use
- Pro tier for commercial/production use

---

## Security Best Practices

### Separate WalletConnect Projects

✅ **DO**:
- Use separate WalletConnect Project IDs for testnet vs production
- Add only necessary domains to each project
- Monitor WalletConnect analytics separately

❌ **DON'T**:
- Reuse same WalletConnect Project ID (security isolation)
- Add testnet domains to production WalletConnect project

### Environment Variables

✅ **DO**:
- Double-check network value matches deployment (`testnet` vs `mainnet`)
- Use production secrets only in production project
- Rotate WalletConnect Project IDs if compromised

❌ **DON'T**:
- Mix testnet and mainnet credentials
- Commit environment variables to Git
- Share production WalletConnect Project ID publicly

### Access Control

✅ **DO**:
- Limit Vercel project access to authorized team members
- Use Vercel teams for production project
- Enable Vercel password protection during staging

❌ **DON'T**:
- Share Vercel login credentials
- Give production access to untrusted users

---

## Troubleshooting

### Wrong Network in Wallet

**Symptom**: User connects wallet but it's on wrong network

**Solution**:
- Testnet deployment should show warning if wallet is on mainnet
- Production deployment should show warning if wallet is on testnet
- Instruct user to switch wallet network:
  - HashPack: Click network dropdown → Select correct network
  - Blade: Settings → Network → Select correct network

### WalletConnect Modal Doesn't Open

**Symptom**: "Connect Wallet" button doesn't work

**Possible Causes**:
1. Domain not added to WalletConnect project
2. Wrong WalletConnect Project ID
3. Browser popup blocker

**Solution**:
1. Verify domain is in WalletConnect "Allowed Domains"
2. Check environment variable is correct
3. Disable popup blocker for the domain

### Build Fails After Push

**Symptom**: Vercel build fails with errors

**Solution**:
1. Check build logs in Vercel
2. Verify `dapp/` is set as root directory
3. Run `npm run build` locally to reproduce
4. Fix TypeScript errors
5. Push fix to trigger new build

---

## Quick Reference

### URLs

| Environment | Default URL | Custom Domain Example |
|------------|-------------|----------------------|
| **Testnet** | `https://hedera-multisig-testnet.vercel.app` | `https://testnet.multisig.company.com` |
| **Production** | `https://hedera-multisig.vercel.app` | `https://multisig.company.com` |

### WalletConnect Projects

| Environment | Project Name | Allowed Domains |
|------------|--------------|-----------------|
| **Testnet** | Hedera MultiSig Testnet | Testnet deployment URLs |
| **Production** | Hedera MultiSig Production | Production deployment URLs |

### Git Branches (Option B)

| Environment | Branch | Auto-Deploy |
|------------|--------|-------------|
| **Testnet** | `develop` | ✅ Yes |
| **Production** | `main` | ✅ Yes |

---

## Summary

You now have:
- ✅ Two separate Vercel deployments
- ✅ Testnet for safe testing
- ✅ Production for real transactions
- ✅ Separate WalletConnect projects (security isolation)
- ✅ Automatic deployments from Git
- ✅ Easy rollback capability
- ✅ Independent monitoring and analytics

**Next Steps**:
1. Test thoroughly on testnet
2. Run end-to-end signing sessions
3. Validate with real wallets and hardware wallets
4. Only after thorough testing, use production deployment

---

**Happy Deploying! 🚀**
