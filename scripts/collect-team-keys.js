#!/usr/bin/env node

/**
 * Team Key Collection Tool
 *
 * Interactive tool to collect public keys from team members for multi-sig setup.
 * Can run as coordinator (collecting keys) or participant (sharing keys).
 *
 * Usage:
 *   # As coordinator (collect keys)
 *   node scripts/collect-team-keys.js --mode coordinator
 *
 *   # As participant (share your key)
 *   node scripts/collect-team-keys.js --mode participant
 *
 *   # Interactive mode
 *   node scripts/collect-team-keys.js
 */

const { PrivateKey } = require('@hashgraph/sdk');
const readlineSync = require('readline-sync');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function generateParticipantId() {
  return crypto.randomBytes(4).toString('hex');
}

async function runAsCoordinator() {
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║          TEAM KEY COLLECTION - COORDINATOR            ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════╝\n'));

  const teamName = readlineSync.question(chalk.cyan('Team/Project name: '));
  const numParticipants = parseInt(readlineSync.question(chalk.cyan('Number of participants: ')));

  console.log('');

  const participants = [];

  console.log(chalk.yellow(`Collecting keys for ${numParticipants} participants...\n`));

  // Collect keys
  for (let i = 0; i < numParticipants; i++) {
    console.log(chalk.cyan(`\n--- Participant ${i + 1} ---`));

    const name = readlineSync.question(chalk.white('Name/Label: '));
    const email = readlineSync.question(chalk.white('Email (optional): '));

    console.log(chalk.white('\nOptions:'));
    console.log(chalk.gray('  1. Paste public key'));
    console.log(chalk.gray('  2. Generate new key pair for participant'));
    console.log(chalk.gray('  3. Load from file\n'));

    const method = readlineSync.question(chalk.cyan('Method (1/2/3) [1]: ')) || '1';

    let publicKey, privateKey = null;

    if (method === '1') {
      // Paste key
      publicKey = readlineSync.question(chalk.white('Public Key (DER): '));
    } else if (method === '2') {
      // Generate new key
      privateKey = PrivateKey.generateED25519();
      publicKey = privateKey.publicKey.toString();

      console.log(chalk.green('\n✅ Key pair generated!'));
      console.log(chalk.yellow('\n⚠️  SHARE THESE WITH PARTICIPANT:\n'));
      console.log(chalk.white('Private Key:'));
      console.log(chalk.bold.yellow(privateKey.toString()));
      console.log('');
      console.log(chalk.white('Public Key:'));
      console.log(chalk.gray(publicKey));
      console.log('');
    } else {
      // Load from file
      const filePath = readlineSync.question(chalk.white('File path: '));

      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        try {
          const keyData = JSON.parse(content);
          publicKey = keyData.publicKey;
        } catch {
          // Try as plain text
          publicKey = content.trim();
        }

        console.log(chalk.green('\n✅ Key loaded from file\n'));
      } else {
        console.log(chalk.red(`\n❌ File not found: ${filePath}\n`));
        i--; // Retry this participant
        continue;
      }
    }

    participants.push({
      id: generateParticipantId(),
      name,
      email: email || null,
      publicKey,
      privateKey: privateKey ? privateKey.toString() : null,
      addedAt: new Date().toISOString()
    });

    console.log(chalk.green(`\n✅ Participant ${i + 1} added: ${name}\n`));
  }

  // Summary
  console.log(chalk.cyan('\n═'.repeat(60)));
  console.log(chalk.bold.white('TEAM KEY COLLECTION SUMMARY'));
  console.log(chalk.cyan('═'.repeat(60)));
  console.log(chalk.white(`Team: ${teamName}`));
  console.log(chalk.white(`Participants: ${participants.length}\n`));

  participants.forEach((p, idx) => {
    console.log(chalk.gray(`  ${idx + 1}. ${p.name} (${p.id})`));
    console.log(chalk.gray(`     ${p.publicKey.substring(0, 30)}...`));
  });

  console.log(chalk.cyan('\n═'.repeat(60)) + '\n');

  // Recommend threshold
  const recommendedThreshold = Math.ceil(participants.length / 2);
  console.log(chalk.yellow(`Recommended threshold: ${recommendedThreshold} of ${participants.length}\n`));

  // Save to file
  const config = {
    team: teamName,
    createdAt: new Date().toISOString(),
    participants: participants.map(p => ({
      id: p.id,
      name: p.name,
      email: p.email,
      publicKey: p.publicKey,
      addedAt: p.addedAt
    })),
    publicKeys: participants.map(p => p.publicKey),
    recommendedThreshold,
    stats: {
      totalParticipants: participants.length,
      keysGenerated: participants.filter(p => p.privateKey).length
    }
  };

  const configFilename = `team-keys-${teamName.toLowerCase().replace(/\s+/g, '-')}.json`;
  fs.writeFileSync(configFilename, JSON.stringify(config, null, 2), 'utf8');

  console.log(chalk.green(`✅ Team configuration saved to: ${configFilename}\n`));

  // Save private keys separately if any were generated
  const generatedKeys = participants.filter(p => p.privateKey);
  if (generatedKeys.length > 0) {
    const privateKeysData = {
      team: teamName,
      warning: 'KEEP THIS FILE SECURE - Contains private keys',
      keys: generatedKeys.map(p => ({
        id: p.id,
        name: p.name,
        email: p.email,
        publicKey: p.publicKey,
        privateKey: p.privateKey
      }))
    };

    const privateKeysFilename = `team-private-keys-${teamName.toLowerCase().replace(/\s+/g, '-')}.json`;
    fs.writeFileSync(privateKeysFilename, JSON.stringify(privateKeysData, null, 2), 'utf8');

    console.log(chalk.red(`⚠️  Private keys saved to: ${privateKeysFilename}`));
    console.log(chalk.yellow('    DISTRIBUTE THESE SECURELY TO PARTICIPANTS!\n'));
  }

  // Export public keys list
  const publicKeysFile = `public-keys.txt`;
  fs.writeFileSync(publicKeysFile, participants.map(p => p.publicKey).join('\n'), 'utf8');

  console.log(chalk.green(`✅ Public keys list saved to: ${publicKeysFile}\n`));

  console.log(chalk.cyan('═'.repeat(60)));
  console.log(chalk.bold.white('NEXT STEPS'));
  console.log(chalk.cyan('═'.repeat(60)));
  console.log(chalk.white('1. Review the team configuration file'));
  console.log(chalk.white('2. Distribute private keys to participants (if generated)'));
  console.log(chalk.white('3. Use setup-multisig-account.js to create the multi-sig account:'));
  console.log(chalk.cyan(`   node scripts/setup-multisig-account.js`));
  console.log(chalk.white('4. Choose "Load from file" and select:'));
  console.log(chalk.cyan(`   ${publicKeysFile}\n`));
}

async function runAsParticipant() {
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║          TEAM KEY COLLECTION - PARTICIPANT            ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════╝\n'));

  console.log(chalk.white('This tool will help you generate or export your public key\n'));
  console.log(chalk.white('for inclusion in a multi-sig setup.\n'));

  const name = readlineSync.question(chalk.cyan('Your name: '));
  const email = readlineSync.question(chalk.cyan('Your email (optional): '));

  console.log('');
  console.log(chalk.white('Do you have an existing Hedera key?'));
  console.log(chalk.gray('  1. Yes - I have a private key'));
  console.log(chalk.gray('  2. No - Generate new key for me\n'));

  const hasKey = readlineSync.question(chalk.cyan('Choice (1 or 2) [2]: ')) || '2';

  let privateKey, publicKey;

  if (hasKey === '1') {
    // Use existing key
    const privateKeyStr = readlineSync.question(chalk.white('Enter your private key: '), {
      hideEchoBack: true
    });

    privateKey = PrivateKey.fromString(privateKeyStr);
    publicKey = privateKey.publicKey;

    console.log(chalk.green('\n✅ Key loaded successfully\n'));
  } else {
    // Generate new key
    privateKey = PrivateKey.generateED25519();
    publicKey = privateKey.publicKey;

    console.log(chalk.green('\n✅ New key pair generated!\n'));
    console.log(chalk.yellow('⚠️  SAVE YOUR PRIVATE KEY SECURELY:\n'));
    console.log(chalk.white('Private Key (DER):'));
    console.log(chalk.bold.yellow(privateKey.toString()));
    console.log('');
  }

  console.log(chalk.white('Public Key (DER):'));
  console.log(chalk.cyan(publicKey.toString()));
  console.log('');

  // Save to file
  const participantData = {
    name,
    email: email || null,
    publicKey: publicKey.toString(),
    privateKey: privateKey.toString(),
    generatedAt: new Date().toISOString(),
    warning: 'KEEP THIS FILE SECURE - Contains your private key'
  };

  const filename = `participant-${name.toLowerCase().replace(/\s+/g, '-')}.json`;
  fs.writeFileSync(filename, JSON.stringify(participantData, null, 2), 'utf8');

  console.log(chalk.green(`✅ Your key information saved to: ${filename}\n`));

  // Also save public key only
  const publicOnlyFile = `${name.toLowerCase().replace(/\s+/g, '-')}-public.txt`;
  fs.writeFileSync(publicOnlyFile, publicKey.toString(), 'utf8');

  console.log(chalk.green(`✅ Public key saved to: ${publicOnlyFile}\n`));

  console.log(chalk.cyan('═'.repeat(60)));
  console.log(chalk.bold.white('NEXT STEPS'));
  console.log(chalk.cyan('═'.repeat(60)));
  console.log(chalk.white('1. Share your PUBLIC KEY with the coordinator:'));
  console.log(chalk.cyan(`   ${publicOnlyFile}`));
  console.log(chalk.white('   OR send this text:'));
  console.log(chalk.gray(`   ${publicKey.toString()}`));
  console.log('');
  console.log(chalk.yellow('2. KEEP YOUR PRIVATE KEY SECURE:'));
  console.log(chalk.red(`   ${filename}`));
  console.log(chalk.white('   Never share this file or the private key itself!'));
  console.log('');
  console.log(chalk.white('3. Wait for the coordinator to set up the multi-sig account'));
  console.log(chalk.white('4. You will be able to sign transactions using your private key\n'));
}

async function main() {
  const args = process.argv.slice(2);

  let mode;

  if (args.includes('--mode')) {
    const modeIndex = args.indexOf('--mode');
    mode = args[modeIndex + 1];
  } else {
    console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.cyan('║              TEAM KEY COLLECTION TOOL                 ║'));
    console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════╝\n'));

    console.log(chalk.white('Select mode:\n'));
    console.log(chalk.gray('  1. Coordinator - Collect keys from team members'));
    console.log(chalk.gray('  2. Participant - Generate/export your key\n'));

    const choice = readlineSync.question(chalk.cyan('Mode (1 or 2): '));
    mode = choice === '1' ? 'coordinator' : 'participant';
  }

  if (mode === 'coordinator') {
    await runAsCoordinator();
  } else {
    await runAsParticipant();
  }
}

// Run
main().catch(error => {
  console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
  process.exit(1);
});
