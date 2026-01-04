# PowerShell completion script for hedera-multisig CLI
#
# Installation:
#   Add to your PowerShell profile ($PROFILE):
#   . /path/to/hedera-multisig.ps1
#

$script:commands = @('server', 'participant', 'sign', 'keys', 'audit', 'account', 'offline', 'help')
$script:globalOpts = @('-V', '--version', '-v', '--verbose', '-q', '--quiet', '-j', '--json', '--trace', '--log-file', '--export-logs', '-h', '--help')

$script:serverOpts = @('-t', '--threshold', '-k', '--keys', '-p', '--participants', '--port', '--host', '--timeout', '--no-tunnel', '--pin', '-n', '--network', '--tls-cert', '--tls-key', '--tls-ca', '--tls-passphrase', '--redis', '--redis-host', '--redis-port', '--redis-password')
$script:participantOpts = @('-u', '--url', '-s', '--session', '-p', '--pin', '-f', '--keyfile', '-k', '--key', '-l', '--label', '-y', '--yes')
$script:signOpts = @('--quick')
$script:keysSubcmds = @('create', 'test')
$script:keysCreateOpts = @('-o', '--output')
$script:auditOpts = @('--verbose')
$script:networks = @('testnet', 'mainnet', 'previewnet', 'local')
$script:offlineSubcmds = @('freeze', 'decode', 'execute')
$script:offlineFreezeOpts = @('-t', '--type', '-f', '--from', '-T', '--to', '-a', '--amount', '-c', '--contract', '-g', '--gas', '-d', '--data', '-o', '--output', '--raw', '-j', '--json')
$script:offlineDecodeOpts = @('-b', '--base64', '-f', '--file', '-c', '--checksum', '--verbose', '--raw', '-j', '--json')
$script:offlineExecuteOpts = @('-b', '--base64', '-f', '--file', '-s', '--signatures', '--sig-file', '-t', '--threshold', '--dry-run', '-j', '--json')
$script:transactionTypes = @('transfer', 'contract-execute')

function Get-HederaMultisigCompletion {
    param(
        [string]$wordToComplete,
        [string]$commandAst,
        [int]$cursorPosition
    )

    $tokens = $commandAst.Split(' ', [StringSplitOptions]::RemoveEmptyEntries)
    $command = $null
    $subcmd = $null

    # Find the command
    for ($i = 1; $i -lt $tokens.Count; $i++) {
        if ($tokens[$i] -in $script:commands -and -not $tokens[$i].StartsWith('-')) {
            $command = $tokens[$i]
            break
        }
    }

    # Find subcommand for keys or offline
    if ($command -eq 'keys') {
        for ($i = 1; $i -lt $tokens.Count; $i++) {
            if ($tokens[$i] -in $script:keysSubcmds) {
                $subcmd = $tokens[$i]
                break
            }
        }
    } elseif ($command -eq 'offline') {
        for ($i = 1; $i -lt $tokens.Count; $i++) {
            if ($tokens[$i] -in $script:offlineSubcmds) {
                $subcmd = $tokens[$i]
                break
            }
        }
    }

    $completions = @()

    # Previous token for context
    $prevToken = if ($tokens.Count -gt 1) { $tokens[-2] } else { '' }

    switch ($command) {
        'server' {
            switch ($prevToken) {
                { $_ -in @('-n', '--network') } {
                    $completions = $script:networks
                }
                { $_ -in @('--tls-cert', '--tls-key', '--tls-ca', '--log-file') } {
                    # Return nothing to allow file completion
                    return
                }
                default {
                    $completions = $script:serverOpts + $script:globalOpts
                }
            }
        }
        'participant' {
            switch ($prevToken) {
                { $_ -in @('-f', '--keyfile', '--log-file') } {
                    return
                }
                default {
                    $completions = $script:participantOpts + $script:globalOpts
                }
            }
        }
        'sign' {
            $completions = $script:signOpts + $script:globalOpts
        }
        'keys' {
            if ($subcmd -eq 'create') {
                if ($prevToken -in @('-o', '--output')) {
                    return
                }
                $completions = $script:keysCreateOpts + $script:globalOpts
            } elseif ($subcmd -eq 'test') {
                return
            } else {
                $completions = $script:keysSubcmds
            }
        }
        'audit' {
            $completions = $script:auditOpts + $script:globalOpts
        }
        'offline' {
            switch ($subcmd) {
                'freeze' {
                    switch ($prevToken) {
                        { $_ -in @('-t', '--type') } {
                            $completions = $script:transactionTypes
                        }
                        { $_ -in @('-o', '--output') } {
                            return
                        }
                        default {
                            $completions = $script:offlineFreezeOpts + $script:globalOpts
                        }
                    }
                }
                'decode' {
                    switch ($prevToken) {
                        { $_ -in @('-f', '--file') } {
                            return
                        }
                        default {
                            $completions = $script:offlineDecodeOpts + $script:globalOpts
                        }
                    }
                }
                'execute' {
                    switch ($prevToken) {
                        { $_ -in @('-f', '--file', '--sig-file') } {
                            return
                        }
                        default {
                            $completions = $script:offlineExecuteOpts + $script:globalOpts
                        }
                    }
                }
                default {
                    $completions = $script:offlineSubcmds
                }
            }
        }
        'help' {
            $completions = $script:commands
        }
        default {
            $completions = $script:commands + $script:globalOpts
        }
    }

    $completions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
}

# Register argument completer
Register-ArgumentCompleter -Native -CommandName 'hedera-multisig' -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    Get-HederaMultisigCompletion $wordToComplete $commandAst.ToString() $cursorPosition
}

Register-ArgumentCompleter -Native -CommandName 'multisig' -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    Get-HederaMultisigCompletion $wordToComplete $commandAst.ToString() $cursorPosition
}
