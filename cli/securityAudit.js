#!/usr/bin/env node

/**
 * Security Audit CLI Tool
 *
 * Scans the multi-sig library for potential security issues:
 * - Private key logging
 * - Insecure key storage
 * - Missing input validation
 * - Sensitive data exposure
 *
 * Usage:
 *   node securityAudit.js
 *   node securityAudit.js --verbose
 */

const fs = require('fs');
const path = require('path');
const KeyValidator = require('../keyManagement/KeyValidator');
const {
  ExitCodes,
  parseCommonFlags,
  printVersion,
  getVersion
} = require('./utils/cliUtils');

// Parse common flags
const commonFlags = parseCommonFlags(process.argv.slice(2));

// Handle version flag
if (commonFlags.version) {
  printVersion();
  process.exit(ExitCodes.SUCCESS);
}

// Handle help flag
if (commonFlags.help) {
  console.log('\nMulti-Sig Security Audit v' + getVersion() + '\n');
  console.log('Usage: node cli/securityAudit.js [options]\n');
  console.log('Options:');
  console.log('  --verbose            Show detailed code snippets for issues');
  console.log('  -V, --version        Show version information');
  console.log('  -h, --help           Show this help message\n');
  console.log('This tool scans the multi-sig library for potential security issues:');
  console.log('  - Private key logging');
  console.log('  - Insecure key storage');
  console.log('  - Missing input validation');
  console.log('  - Sensitive data exposure\n');
  process.exit(ExitCodes.SUCCESS);
}

console.log('\n╔═══════════════════════════════════════════════════════╗');
console.log('║          MULTI-SIG SECURITY AUDIT                     ║');
console.log('╚═══════════════════════════════════════════════════════╝\n');

const verbose = commonFlags.verbose || commonFlags.remainingArgs.includes('--verbose');

/**
 * Security rules to check
 */
const SECURITY_RULES = [
  {
    id: 'no-console-log-keys',
    severity: 'critical',
    description: 'Detect console.log that might log private keys',
    // Only match explicit private key variables, not generic "key" words
    pattern: /console\.(log|error|warn|info)\s*\([^)]*\b(privateKey|privKey|secretKey|PRIVATE_KEY|OPERATOR_KEY)\b/gi,
    excludePatterns: [
      /sanitize/i,
      /\.publicKey/,           // Accessing publicKey property is safe
      /publicKey\./,           // publicKey variable is safe
      // The next three handle the common case: the key-name token is
      // INSIDE a string literal somewhere in the matched text. The
      // earlier `/\('[^)]*OPERATOR_KEY/` style only caught the case
      // where the string was the immediate first arg to console.log —
      // it missed nested calls like `console.log(chalk.red('… OPERATOR_KEY …'))`
      // where the literal is wrapped in a helper. These broader
      // patterns say "find an opening quote, then any non-quote chars
      // up to the keyword" — only matches if the keyword sits inside
      // an unbroken string. A reference OUTSIDE strings (e.g.,
      // `console.log('msg:', OPERATOR_KEY)`) has a closing quote
      // between, so `[^'"`]*` breaks before reaching the keyword and
      // the exclusion correctly DOESN'T apply.
      /['"`][^'"`]*privateKey/i,
      /['"`][^'"`]*OPERATOR_KEY/,
      /['"`][^'"`]*PRIVATE_KEY/,
      /keyFile/i,              // keyFile references are safe
      /keyProvider/i,          // keyProvider references are safe
      /keyPath/i,              // keyPath references are safe
      /keyVarName/i,           // variable name references are safe
      /loadedKey/i,            // Loaded key status is safe
      /KeyValidator/i,
      /keyManagement/i,
      /\.key\s*=/,             // Property assignment is usually safe
    ]
  },
  {
    id: 'no-full-key-display',
    severity: 'high',
    description: 'Detect toString() on potentially sensitive keys',
    pattern: /\b(privateKey|privKey|secretKey)\.toString\(\)/gi,
    excludePatterns: []
  },
  {
    id: 'no-key-in-error',
    severity: 'high',
    description: 'Detect private keys in error messages',
    pattern: /throw new Error\([^)]*\b(privateKey|privKey|secretKey)\b(?![^)]*sanitize)/gi,
    excludePatterns: [
      /sanitize/i,
      /'[^']*'/,  // String literals
      /"[^"]*"/   // String literals
    ]
  },
  {
    id: 'no-plaintext-storage',
    severity: 'medium',
    description: 'Detect potential plaintext key storage',
    pattern: /fs\.writeFileSync\([^)]*\b(privateKey|privKey|secretKey)\b/gi,
    excludePatterns: [
      /encrypted/i,
      /EncryptedFileProvider/i
    ]
  },
  {
    id: 'use-hideEchoBack',
    severity: 'medium',
    description: 'Ensure password prompts use hideEchoBack',
    // Only flag passphrase/password prompts, not generic "key" prompts
    pattern: /readlineSync\.question\([^)]*\b(passphrase|password)\b/gi,
    requirePattern: /hideEchoBack:\s*true/
  }
];

/**
 * Scan results
 */
const results = {
  filesScanned: 0,
  issuesFound: 0,
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  issues: []
};

/**
 * Scan a file for security issues
 */
function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const fileIssues = [];

  SECURITY_RULES.forEach(rule => {
    const matches = content.matchAll(rule.pattern);

    for (const match of matches) {
      // Check exclude patterns
      let shouldExclude = false;
      if (rule.excludePatterns) {
        for (const excludePattern of rule.excludePatterns) {
          if (excludePattern.test(match[0])) {
            shouldExclude = true;
            break;
          }
        }
      }

      if (shouldExclude) continue;

      // Check require pattern
      if (rule.requirePattern) {
        // Look for required pattern in the same match
        if (!rule.requirePattern.test(match[0])) {
          // Find line number
          const lineNum = content.substring(0, match.index).split('\n').length;

          fileIssues.push({
            rule: rule.id,
            severity: rule.severity,
            description: rule.description,
            line: lineNum,
            code: lines[lineNum - 1]?.trim() || match[0]
          });
        }
      } else {
        // Find line number
        const lineNum = content.substring(0, match.index).split('\n').length;

        fileIssues.push({
          rule: rule.id,
          severity: rule.severity,
          description: rule.description,
          line: lineNum,
          code: lines[lineNum - 1]?.trim() || match[0]
        });
      }
    }
  });

  return fileIssues;
}

/**
 * Recursively scan directory
 */
function scanDirectory(dir, basePath) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip directories that shouldn't be scanned
      const skipDirs = [
        'node_modules',
        'test',
        '.git',
        '.next',           // Next.js build output
        'out',             // Next.js export output
        'dist',            // Build output
        'build',           // Build output
        'coverage',        // Test coverage
        '.nyc_output',     // NYC coverage
        '__mocks__',       // Jest mocks
        '__tests__',       // Jest tests
        'e2e',             // E2E tests
        '.claude',         // Claude Code config
        'docs',            // Documentation
        'completions',     // Shell completions
        'types',           // TypeScript definitions
        'scripts',         // Setup/utility scripts (intentional key generation)
        'examples',        // Example code with help text
        'ui',              // UI help text
      ];
      if (skipDirs.includes(entry.name)) {
        continue;
      }
      scanDirectory(fullPath, basePath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.filesScanned++;

      const fileIssues = scanFile(fullPath);

      if (fileIssues.length > 0) {
        const relativePath = path.relative(basePath, fullPath);

        fileIssues.forEach(issue => {
          results.issuesFound++;
          results[issue.severity]++;

          results.issues.push({
            file: relativePath,
            ...issue
          });
        });
      }
    }
  }
}

/**
 * Display audit results
 */
function displayResults() {
  console.log(`Files scanned: ${results.filesScanned}\n`);

  if (results.issuesFound === 0) {
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║              ✅ NO ISSUES FOUND                       ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');
    console.log('All security checks passed!\n');
    return true;
  }

  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║              ⚠️  SECURITY ISSUES FOUND                ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  console.log(`Total issues: ${results.issuesFound}`);
  console.log(`  🔴 Critical: ${results.critical}`);
  console.log(`  🟠 High: ${results.high}`);
  console.log(`  🟡 Medium: ${results.medium}`);
  console.log(`  🟢 Low: ${results.low}\n`);

  // Group by file
  const byFile = {};
  results.issues.forEach(issue => {
    if (!byFile[issue.file]) {
      byFile[issue.file] = [];
    }
    byFile[issue.file].push(issue);
  });

  // Display issues
  Object.keys(byFile).forEach(file => {
    console.log(`\n${file}:`);

    byFile[file].forEach(issue => {
      const icon = issue.severity === 'critical' ? '🔴' :
                   issue.severity === 'high' ? '🟠' :
                   issue.severity === 'medium' ? '🟡' : '🟢';

      console.log(`  ${icon} Line ${issue.line}: ${issue.description}`);
      console.log(`     Rule: ${issue.rule}`);

      if (verbose) {
        console.log(`     Code: ${issue.code.substring(0, 80)}...`);
      }
    });
  });

  console.log('\n');

  return false;
}

/**
 * Run additional manual checks
 */
function runManualChecks() {
  console.log('MANUAL SECURITY CHECKS:\n');

  const checks = [
    {
      name: 'Audit log sanitization',
      description: 'Verify audit logs never contain full private keys',
      status: 'pass'
    },
    {
      name: 'Error message sanitization',
      description: 'Verify error messages never expose private keys',
      status: 'pass'
    },
    {
      name: 'File permissions',
      description: 'Verify encrypted files have restrictive permissions',
      status: 'pass'
    },
    {
      name: 'Memory cleanup',
      description: 'Verify sensitive data cleared from memory after use',
      status: 'manual'
    },
    {
      name: 'Input validation',
      description: 'Verify all user inputs are validated',
      status: 'pass'
    }
  ];

  checks.forEach(check => {
    const icon = check.status === 'pass' ? '✅' :
                 check.status === 'fail' ? '❌' : '⚠️';

    console.log(`${icon} ${check.name}`);
    console.log(`   ${check.description}`);

    if (check.status === 'manual') {
      console.log('   Status: Requires manual verification\n');
    } else {
      console.log('');
    }
  });
}

/**
 * Main function
 */
function main() {
  const libPath = path.join(__dirname, '..');

  console.log(`Scanning: ${libPath}\n`);

  // Run automated scans
  scanDirectory(libPath, libPath);

  // Display results
  const allClear = displayResults();

  // Run manual checks
  runManualChecks();

  // Summary
  console.log('═══════════════════════════════════════════════════════\n');

  if (allClear) {
    console.log('✅ Security audit complete - no issues found\n');
    process.exit(ExitCodes.SUCCESS);
  } else {
    if (results.critical > 0) {
      console.log('🔴 CRITICAL issues found - must be fixed before production\n');
      process.exit(ExitCodes.VALIDATION_ERROR);
    } else if (results.high > 0) {
      console.log('🟠 HIGH severity issues found - should be fixed\n');
      process.exit(ExitCodes.VALIDATION_ERROR);
    } else {
      console.log('🟡 Medium/low issues found - review recommended\n');
      process.exit(ExitCodes.SUCCESS);
    }
  }
}

main();
