# Hedera MultiSig - WalletConnect dApp

Web-based participant portal for signing multi-signature transactions on Hedera using WalletConnect.

## Features

- 🔐 **Secure**: Private keys never leave your wallet (hardware wallet support)
- ✅ **Verified**: Review cryptographically verified transaction data
- ⚡ **Real-Time**: WebSocket coordination for fast multi-party signing
- 🌐 **Browser-Based**: No installation required, works in any modern browser
- 📱 **Mobile-Friendly**: Responsive design for desktop and mobile

## Prerequisites

- Node.js 18+ and npm
- A WalletConnect Project ID (get one at [cloud.walletconnect.com](https://cloud.walletconnect.com/))
- A Hedera wallet with WalletConnect support (HashPack, Blade, etc.)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and add your WalletConnect Project ID:

```env
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id_here
NEXT_PUBLIC_DEFAULT_NETWORK=testnet
```

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

### As a Participant

1. **Receive Session Details**: Your coordinator will provide:
   - WebSocket Server URL (e.g., `wss://example.com` or `ws://localhost:3001`)
   - Session ID
   - Session PIN

2. **Visit the dApp**: Go to the hosted dApp URL or run locally

3. **Join Session**: Click "Join Signing Session" and enter your credentials

4. **Connect Wallet**: Connect your Hedera wallet via WalletConnect

5. **Review Transaction**: Carefully review the transaction details:
   - ✅ **VERIFIED DATA**: Cryptographically verified from transaction bytes
   - ⚠️ **UNVERIFIED METADATA**: Advisory information from coordinator

6. **Sign**: Approve and sign the transaction in your wallet

7. **Wait for Threshold**: Other participants must sign to meet the signature threshold

8. **Complete**: Transaction executes when threshold is met

## Project Structure

```
dapp/
├── app/
│   ├── page.tsx                    # Landing page ✅
│   ├── join/page.tsx               # Join session form ✅
│   ├── session/[id]/page.tsx       # Active session page ✅
│   └── layout.tsx                  # Root layout ✅
├── components/                     # React components (TODO Phase 2+)
├── lib/                            # Core logic (TODO Phase 2+)
├── hooks/                          # React hooks (TODO Phase 2+)
├── types/                          # TypeScript types (TODO Phase 2+)
├── .env.local.example              # Environment template ✅
├── next.config.ts                  # Next.js config ✅
├── package.json                    # Dependencies ✅
└── README.md                       # This file ✅
```

## Development

### Build for Production

```bash
npm run build
npm start
```

### Linting

```bash
npm run lint
```

## Testing

### Integration Testing

For comprehensive end-to-end testing, see [INTEGRATION_TESTING.md](./INTEGRATION_TESTING.md).

**Quick Start Test:**

1. **Setup environment variables** (in root directory):
   ```bash
   # Windows (PowerShell)
   $env:OPERATOR_ID="0.0.YOUR_ACCOUNT_ID"
   $env:OPERATOR_KEY="302e020100300506032b657004220420..."

   # Windows (CMD)
   set OPERATOR_ID=0.0.YOUR_ACCOUNT_ID
   set OPERATOR_KEY=302e020100300506032b657004220420...
   ```

2. **Get your wallet public key** from HashPack or Blade wallet

3. **Start test server** (in root directory):
   ```bash
   node scripts/start-test-server.js
   ```

4. **Enter your wallet public key** when prompted

5. **In a new terminal, start the dApp:**
   ```bash
   cd dapp
   npm run dev
   ```

6. **Open http://localhost:3000** and test the signing flow

See [INTEGRATION_TESTING.md](./INTEGRATION_TESTING.md) for detailed test scenarios including:
- Basic WalletConnect signing
- Mixed sessions (CLI + Web participants)
- Hardware wallet testing (Ledger)
- Error handling and edge cases

## Deployment

### Vercel (Recommended)

**Complete deployment guide**: See [DEPLOYMENT.md](./DEPLOYMENT.md)

**Quick Deploy:**

1. Install Vercel CLI: `npm install -g vercel`
2. Login: `vercel login`
3. Navigate to dApp: `cd dapp`
4. Deploy: `vercel --prod`

**Environment Variables** (set in Vercel dashboard):
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` - Get from https://cloud.walletconnect.com/
- `NEXT_PUBLIC_DEFAULT_NETWORK` - `testnet` or `mainnet`

**Important**: Set root directory to `dapp` in Vercel project settings.

### Other Platforms

The dApp is a standard Next.js application and can be deployed to:
- **Netlify**: See Next.js deployment docs
- **AWS Amplify**: Supports Next.js SSR
- **Self-hosted**: `npm run build && npm start`

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions.

## Implementation Status

### Phase 1: Setup ✅ **Complete**
- [x] Next.js initialized with TypeScript + Tailwind
- [x] Basic routing (/, /join, /session/[id])
- [x] Environment configuration
- [x] Dependencies installed
- [x] Project structure created
- [x] Next.js configured for browser compatibility

### Phase 2: Browser WebSocket Client ✅ **Complete**
- [x] Protocol type definitions (types/protocol.ts)
- [x] Browser-compatible WebSocket client (lib/websocket-client.ts)
- [x] React hook wrapper (hooks/useSigningSession.ts)
- [x] 100% protocol compatibility with server

### Phase 3: WalletConnect Integration ✅ **Complete**
- [x] WalletConnect configuration (lib/walletconnect-config.ts)
- [x] WalletConnect SDK wrapper with signing (lib/walletconnect.ts)
- [x] Signature extraction from signed transactions
- [x] React hook wrapper (hooks/useWallet.ts)
- [x] Hardware wallet support via WalletConnect

### Phase 4: Transaction Review ✅ **Complete**
- [x] Transaction decoder utilities (lib/transaction-decoder.ts)
- [x] Browser-compatible checksum generation (Web Crypto API)
- [x] Metadata validation logic
- [x] TransactionReview component with VERIFIED/UNVERIFIED UI
- [x] WalletStatus component
- [x] Transaction review hook (hooks/useTransactionReview.ts)
- [x] Build verification successful

### Phase 5: Session Page Integration ✅ **Complete**
- [x] SignatureProgress component with threshold tracking
- [x] Complete session page with state machine (10 states)
- [x] Integrated all hooks (useSigningSession, useWallet)
- [x] Automatic flow: wallet → session → review → sign → complete
- [x] Step indicator with visual progress
- [x] Error handling and display
- [x] Session status and participant stats
- [x] All signing states: waiting, reviewing, signing, signed, completed
- [x] Build verification successful
- [x] Zero TypeScript errors

### Phase 6: UI/UX Polish ✅ **Complete**
- [x] Toast notification system (success, error, info, warning)
- [x] useToast hook for easy toast management
- [x] Toast notifications for all key events (wallet connect, session join, signing, completion)
- [x] Custom CSS animations (fade-in, slide-up, slide-down, pulse)
- [x] Loading skeleton styles
- [x] Smooth transitions (cubic-bezier easing)
- [x] Improved focus styles for accessibility
- [x] Smooth scroll behavior
- [x] Mobile-responsive by default (Tailwind)
- [x] Build verification successful

### Phase 7: Integration Testing ✅ **Infrastructure Complete**
- [x] Test server script created (scripts/start-test-server.js)
- [x] Integration testing guide written (INTEGRATION_TESTING.md)
- [x] Quick start guide created (QUICKSTART.md)
- [x] dApp dev server verified working
- [x] All testing documentation ready
- [ ] Manual end-to-end test with WalletConnect wallet (requires user testing)
- [ ] Manual mixed session test (CLI + Web) (requires user testing)
- [ ] Manual hardware wallet test (Ledger) (requires user testing)
- [ ] Error handling validation (requires user testing)
- [ ] Mobile responsiveness testing (requires user testing)

**Note**: Remaining items require manual testing with real wallets and hardware. All automated infrastructure is complete.

### Phase 8: Deployment & Documentation ✅ **Complete**
- [x] Vercel deployment configuration (vercel.json)
- [x] Deployment guide created (DEPLOYMENT.md)
- [x] WalletConnect user guide (docs/WALLETCONNECT.md)
- [x] Main README updated with WalletConnect section
- [x] SETUP_GUIDE.md updated with web participant workflow
- [x] dApp README updated with deployment instructions
- [x] All documentation cross-referenced
- [x] Production deployment ready

**Status**: ✅ **All phases complete!** dApp is production-ready pending manual testing validation.

## License

Same as parent project (Hedera MultiSig).
