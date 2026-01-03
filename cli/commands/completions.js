/**
 * Completions Command
 *
 * Generate shell completion scripts for various shells.
 */

const fs = require('fs');
const path = require('path');

module.exports = function(program) {
  program
    .command('completions')
    .description('Generate shell completion scripts')
    .argument('[shell]', 'Shell type (bash, zsh, fish, powershell)')
    .option('--install', 'Print installation instructions')
    .addHelpText('after', `
Supported shells:
  bash       - Bash shell completions
  zsh        - Zsh shell completions
  fish       - Fish shell completions
  powershell - PowerShell completions

Examples:
  # Output bash completions
  $ hedera-multisig completions bash

  # Save to file
  $ hedera-multisig completions bash > ~/.bash_completion.d/hedera-multisig

  # Show installation instructions
  $ hedera-multisig completions bash --install
    `)
    .action((shell, options) => {
      const completionsDir = path.join(__dirname, '../../completions');

      const shells = {
        bash: {
          file: 'hedera-multisig.bash',
          install: `
Bash Installation:

Option 1: System-wide (requires root)
  sudo cp ${path.join(completionsDir, 'hedera-multisig.bash')} /etc/bash_completion.d/hedera-multisig

Option 2: User-only
  mkdir -p ~/.bash_completion.d
  hedera-multisig completions bash > ~/.bash_completion.d/hedera-multisig
  echo 'source ~/.bash_completion.d/hedera-multisig' >> ~/.bashrc

Then restart your shell or run:
  source ~/.bashrc
`
        },
        zsh: {
          file: 'hedera-multisig.zsh',
          install: `
Zsh Installation:

Option 1: Add to fpath
  mkdir -p ~/.zsh/completions
  hedera-multisig completions zsh > ~/.zsh/completions/_hedera-multisig

  Add to ~/.zshrc:
    fpath=(~/.zsh/completions $fpath)
    autoload -Uz compinit && compinit

Option 2: Oh-My-Zsh
  hedera-multisig completions zsh > ~/.oh-my-zsh/completions/_hedera-multisig

Then restart your shell or run:
  source ~/.zshrc
`
        },
        fish: {
          file: 'hedera-multisig.fish',
          install: `
Fish Installation:

  mkdir -p ~/.config/fish/completions
  hedera-multisig completions fish > ~/.config/fish/completions/hedera-multisig.fish

Completions will be loaded automatically on next fish session.
`
        },
        powershell: {
          file: 'hedera-multisig.ps1',
          install: `
PowerShell Installation:

  # Get your profile path
  echo $PROFILE

  # Add to your PowerShell profile
  hedera-multisig completions powershell >> $PROFILE

Or save to a file and dot-source it in your profile:
  hedera-multisig completions powershell > ~/hedera-multisig-completion.ps1
  # Add to $PROFILE:
  . ~/hedera-multisig-completion.ps1

Then restart PowerShell.
`
        }
      };

      if (!shell) {
        console.log('\nAvailable shells: bash, zsh, fish, powershell');
        console.log('\nUsage:');
        console.log('  hedera-multisig completions <shell>');
        console.log('  hedera-multisig completions <shell> --install');
        console.log('\nExamples:');
        console.log('  hedera-multisig completions bash');
        console.log('  hedera-multisig completions bash > /etc/bash_completion.d/hedera-multisig');
        console.log('  hedera-multisig completions bash --install\n');
        return;
      }

      const normalizedShell = shell.toLowerCase();
      const config = shells[normalizedShell];

      if (!config) {
        console.error(`Unknown shell: ${shell}`);
        console.error('Supported shells: bash, zsh, fish, powershell');
        process.exit(1);
      }

      if (options.install) {
        console.log(config.install);
        return;
      }

      // Output the completion script
      const scriptPath = path.join(completionsDir, config.file);

      if (fs.existsSync(scriptPath)) {
        const script = fs.readFileSync(scriptPath, 'utf8');
        console.log(script);
      } else {
        console.error(`Completion script not found: ${scriptPath}`);
        process.exit(1);
      }
    });
};
