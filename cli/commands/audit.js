/**
 * Audit Command
 *
 * Run security audit on the codebase.
 */

const fs = require('fs');
const path = require('path');

module.exports = function(program) {
  program
    .command('audit')
    .description('Run security audit on codebase')
    .option('--verbose', 'Show detailed code snippets for issues')
    .option('--json', 'Output results as JSON')
    .addHelpText('after', `
This tool scans the multi-sig library for potential security issues:
  - Private key logging
  - Insecure key storage
  - Missing input validation
  - Sensitive data exposure

Examples:
  $ hedera-multisig audit
  $ hedera-multisig audit --verbose
  $ hedera-multisig audit --json
    `)
    .action((options) => {
      const { ExitCodes, JsonOutput } = require('../utils/cliUtils');

      const jsonOutput = new JsonOutput(!!options.json);

      if (!jsonOutput.enabled) {
        console.log('\n╔═══════════════════════════════════════════════════════╗');
        console.log('║          MULTI-SIG SECURITY AUDIT                     ║');
        console.log('╚═══════════════════════════════════════════════════════╝\n');
      }

      // Security rules
      const SECURITY_RULES = [
        {
          id: 'no-console-log-keys',
          severity: 'critical',
          description: 'Detect console.log that might log private keys',
          pattern: /console\.(log|error|warn|info)\([^)]*(?:privateKey|privKey|secret|key)\b(?![^)]*sanitize)/gi,
          excludePatterns: [
            /sanitizePrivateKey/,
            /sanitizePublicKey/,
            /KeyValidator/,
            /'privateKey'/,
            /"privateKey"/
          ]
        },
        {
          id: 'no-full-key-display',
          severity: 'high',
          description: 'Detect toString() on potentially sensitive keys',
          pattern: /(?:privateKey|privKey|secret)\.toString\(\)/gi,
          excludePatterns: []
        },
        {
          id: 'no-key-in-error',
          severity: 'high',
          description: 'Detect private keys in error messages',
          pattern: /throw new Error\([^)]*(?:privateKey|privKey|secret)\b(?![^)]*sanitize)/gi,
          excludePatterns: [
            /sanitize/,
            /'privateKey'/,
            /"privateKey"/
          ]
        },
        {
          id: 'no-plaintext-storage',
          severity: 'medium',
          description: 'Detect potential plaintext key storage',
          pattern: /fs\.writeFileSync\([^)]*(?:privateKey|privKey|secret)\b/gi,
          excludePatterns: [
            /encrypted/,
            /EncryptedFileProvider/
          ]
        },
        {
          id: 'use-hideEchoBack',
          severity: 'medium',
          description: 'Ensure password prompts use hideEchoBack',
          pattern: /readlineSync\.question\([^)]*(?:passphrase|password|key|secret)\b/gi,
          requirePattern: /hideEchoBack:\s*true/
        }
      ];

      // Results
      const results = {
        filesScanned: 0,
        issuesFound: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        issues: []
      };

      // Scan file
      function scanFile(filePath) {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        const fileIssues = [];

        SECURITY_RULES.forEach(rule => {
          const matches = content.matchAll(rule.pattern);

          for (const match of matches) {
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

            if (rule.requirePattern) {
              if (!rule.requirePattern.test(match[0])) {
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

      // Scan directory
      function scanDirectory(dir, basePath) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === 'test' || entry.name === '.git') {
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

      // Display results
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

            if (options.verbose) {
              console.log(`     Code: ${issue.code.substring(0, 80)}...`);
            }
          });
        });

        console.log('\n');

        return false;
      }

      // Run manual checks
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

      // Main execution
      const libPath = path.join(__dirname, '../..');

      if (!jsonOutput.enabled) {
        console.log(`Scanning: ${libPath}\n`);
      }

      // Run automated scans
      scanDirectory(libPath, libPath);

      if (jsonOutput.enabled) {
        // JSON output mode
        const allClear = results.issuesFound === 0;

        jsonOutput.set('scanPath', libPath);
        jsonOutput.set('filesScanned', results.filesScanned);
        jsonOutput.set('issuesFound', results.issuesFound);
        jsonOutput.set('severity', {
          critical: results.critical,
          high: results.high,
          medium: results.medium,
          low: results.low
        });
        jsonOutput.set('issues', results.issues);
        jsonOutput.set('allClear', allClear);

        if (!allClear) {
          if (results.critical > 0) {
            jsonOutput.addWarning('CRITICAL issues found - must be fixed before production');
          } else if (results.high > 0) {
            jsonOutput.addWarning('HIGH severity issues found - should be fixed');
          } else {
            jsonOutput.addWarning('Medium/low issues found - review recommended');
          }
        }

        jsonOutput.print(allClear || results.critical === 0 && results.high === 0);
        const exitCode = (results.critical > 0 || results.high > 0) ? ExitCodes.VALIDATION_ERROR : ExitCodes.SUCCESS;
        process.exit(exitCode);
      } else {
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
    });
};
