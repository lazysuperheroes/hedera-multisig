# WalletConnect Project IDs - Setup Guide

Quick guide to configure your two WalletConnect Project IDs for testnet and production deployments.

---

## Why Two Project IDs?

Using separate WalletConnect Project IDs for testnet and production provides:

✅ **Security Isolation**
- Testnet Project ID only works with testnet deployments
- Production Project ID only works with production deployments
- Prevents accidental cross-network usage

✅ **Separate Analytics**
- Track testnet usage separately from production
- Monitor quota usage independently
- Better debugging and monitoring

✅ **Domain Restrictions**
- Configure allowed domains separately for each environment
- More granular access control

---

## Step 1: Create Two WalletConnect Projects

### 1.1 Go to WalletConnect Cloud

Visit: https://cloud.walletconnect.com/

### 1.2 Create Testnet Project

1. Click "Create New Project"
2. **Project Name**: `Hedera MultiSig - Testnet`
3. **Description**: `Multi-signature transaction signing for Hedera testnet`
4. Click "Create"
5. **Copy the Project ID** (looks like: `abc123def456...`)
6. Save it somewhere safe

### 1.3 Create Production Project

1. Click "Create New Project" again
2. **Project Name**: `Hedera MultiSig - Production`
3. **Description**: `Multi-signature transaction signing for Hedera mainnet`
4. Click "Create"
5. **Copy the Project ID** (looks like: `xyz789ghi012...`)
6. Save it somewhere safe

---

## Step 2: Configure Allowed Domains

### 2.1 Testnet Project Configuration

1. Open your **Testnet** project in WalletConnect dashboard
2. Go to "Settings" → "Allowed Domains"
3. Add allowed domains (click "+ Add Domain"):
   ```
   http://localhost:3000
   https://your-testnet-deployment.vercel.app
   https://testnet.multisig.yourcompany.com
   ```
4. Click "Save"

### 2.2 Production Project Configuration

1. Open your **Production** project in WalletConnect dashboard
2. Go to "Settings" → "Allowed Domains"
3. Add allowed domains:
   ```
   https://your-production-deployment.vercel.app
   https://multisig.yourcompany.com
   ```
4. Click "Save"

⚠️ **Important**: Do NOT add `localhost` to production project for security!

---

## Step 3: Local Development Setup

### 3.1 Create `.env.local` File

In the `dapp/` directory:

```bash
cd dapp
cp .env.local.example .env.local
```

### 3.2 Add Your Testnet Project ID

Edit `dapp/.env.local`:

```env
# Use your TESTNET Project ID for local development
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=abc123def456...   # Your testnet Project ID
NEXT_PUBLIC_DEFAULT_NETWORK=testnet
```

### 3.3 Test Locally

```bash
npm run dev
```

Open http://localhost:3000 and test wallet connection.

---

## Step 4: Vercel Deployment

### 4.1 Testnet Deployment

**In Vercel Dashboard** (Testnet project):

1. Go to Project Settings → Environment Variables
2. Add variables:
   ```
   NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = abc123def456...   (your testnet Project ID)
   NEXT_PUBLIC_DEFAULT_NETWORK = testnet
   ```
3. Select environments: Production, Preview, Development
4. Click "Save"
5. Redeploy the project

### 4.2 Production Deployment

**In Vercel Dashboard** (Production project):

1. Go to Project Settings → Environment Variables
2. Add variables:
   ```
   NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = xyz789ghi012...   (your production Project ID)
   NEXT_PUBLIC_DEFAULT_NETWORK = mainnet
   ```
3. Select environments: Production, Preview, Development
4. Click "Save"
5. Redeploy the project

---

## Quick Reference Table

| Environment | Project ID | Network | Allowed Domains |
|------------|-----------|---------|----------------|
| **Local Dev** | Testnet ID | testnet | localhost:3000 |
| **Testnet Vercel** | Testnet ID | testnet | testnet.vercel.app |
| **Production Vercel** | Production ID | mainnet | production.vercel.app |

---

## Security Best Practices

### ✅ DO

- Use different Project IDs for testnet and production
- Configure domain restrictions in WalletConnect dashboard
- Add only necessary domains to allowed list
- Use environment variables (not hardcoded values)
- Monitor usage in WalletConnect dashboard
- Rotate Project IDs if compromised

### ❌ DON'T

- Reuse same Project ID for testnet and production
- Add `localhost` to production Project ID
- Hardcode Project IDs in source code (use env vars)
- Share Project IDs publicly (they're not secret, but good practice)
- Add wildcard domains (*.vercel.app) - be specific

---

## Troubleshooting

### "WalletConnect modal doesn't open"

**Cause**: Invalid or missing Project ID

**Solution**:
1. Check environment variable is set: `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
2. Verify Project ID is correct (check WalletConnect dashboard)
3. Rebuild application: `npm run build`
4. Check browser console for error messages

---

### "This domain is not allowed"

**Cause**: Current domain not in WalletConnect allowed domains list

**Solution**:
1. Go to WalletConnect dashboard
2. Select the correct project (testnet or production)
3. Settings → Allowed Domains
4. Add your deployment domain
5. Wait a few minutes for changes to propagate

---

### "Wrong network in wallet"

**Cause**: Wallet is on mainnet but app is configured for testnet (or vice versa)

**Solution**:
1. Check `NEXT_PUBLIC_DEFAULT_NETWORK` value
2. Switch wallet to matching network:
   - HashPack: Click network dropdown → Select network
   - Blade: Settings → Network → Select network

---

### "Project ID not configured" error on startup

**Cause**: Environment variable not set

**Solution**:

**Local Development**:
```bash
# Create .env.local if it doesn't exist
cp .env.local.example .env.local

# Edit .env.local and add your Project ID
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_actual_project_id
```

**Vercel Deployment**:
1. Vercel Dashboard → Project Settings → Environment Variables
2. Add `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
3. Redeploy

---

## Verification Checklist

### Local Development
- [ ] Created `.env.local` with testnet Project ID
- [ ] `npm run dev` starts without errors
- [ ] Can connect HashPack wallet on testnet
- [ ] No console errors about WalletConnect

### Testnet Deployment
- [ ] Vercel testnet project has testnet Project ID in env vars
- [ ] `NEXT_PUBLIC_DEFAULT_NETWORK=testnet`
- [ ] Testnet deployment URL added to WalletConnect allowed domains
- [ ] Can connect wallet and join test session
- [ ] Network indicator shows "testnet"

### Production Deployment
- [ ] Vercel production project has production Project ID in env vars
- [ ] `NEXT_PUBLIC_DEFAULT_NETWORK=mainnet`
- [ ] Production deployment URL added to WalletConnect allowed domains
- [ ] Can connect wallet on mainnet
- [ ] Network indicator shows "mainnet"
- [ ] Tested with small transaction amount first

---

## Summary

**You now have**:
- ✅ Two WalletConnect Project IDs (testnet + production)
- ✅ Domain restrictions configured for security
- ✅ Local development environment ready
- ✅ Deployment configuration documented
- ✅ Environment variables properly set

**Next steps**:
1. Test locally with testnet
2. Deploy to Vercel testnet environment
3. Test end-to-end with real wallet
4. Deploy to production (after thorough testnet testing)

---

For more details, see:
- [VERCEL_TWO_DEPLOYMENTS.md](./VERCEL_TWO_DEPLOYMENTS.md) - Complete deployment guide
- [DEPLOYMENT.md](./DEPLOYMENT.md) - General deployment documentation
- [QUICKSTART.md](./QUICKSTART.md) - Quick testing guide
