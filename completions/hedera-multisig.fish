# Fish completion script for hedera-multisig CLI
#
# Installation:
#   Copy to ~/.config/fish/completions/hedera-multisig.fish
#

# Disable file completions by default
complete -c hedera-multisig -f
complete -c multisig -f

# Global options
set -l global_opts "-V --version -v --verbose -q --quiet -j --json --trace --log-file --export-logs -h --help"

# Commands
complete -c hedera-multisig -n "__fish_use_subcommand" -a "server" -d "Start a multi-sig session server"
complete -c hedera-multisig -n "__fish_use_subcommand" -a "participant" -d "Join a session as a participant"
complete -c hedera-multisig -n "__fish_use_subcommand" -a "sign" -d "Sign transactions offline (air-gapped)"
complete -c hedera-multisig -n "__fish_use_subcommand" -a "keys" -d "Key management commands"
complete -c hedera-multisig -n "__fish_use_subcommand" -a "audit" -d "Run security audit on codebase"
complete -c hedera-multisig -n "__fish_use_subcommand" -a "account" -d "Account management (interactive menu)"
complete -c hedera-multisig -n "__fish_use_subcommand" -a "offline" -d "Offline workflow commands (freeze, decode, execute)"
complete -c hedera-multisig -n "__fish_use_subcommand" -a "help" -d "Display help for a command"

# Global options for main command
complete -c hedera-multisig -n "__fish_use_subcommand" -s V -l version -d "Show version number"
complete -c hedera-multisig -n "__fish_use_subcommand" -s v -l verbose -d "Enable verbose output"
complete -c hedera-multisig -n "__fish_use_subcommand" -s q -l quiet -d "Suppress non-essential output"
complete -c hedera-multisig -n "__fish_use_subcommand" -s j -l json -d "Output as JSON"
complete -c hedera-multisig -n "__fish_use_subcommand" -l trace -d "Enable trace-level debug logging"
complete -c hedera-multisig -n "__fish_use_subcommand" -l log-file -d "Write logs to file" -r
complete -c hedera-multisig -n "__fish_use_subcommand" -l export-logs -d "Export logs on exit"
complete -c hedera-multisig -n "__fish_use_subcommand" -s h -l help -d "Show help"

# Server command options
complete -c hedera-multisig -n "__fish_seen_subcommand_from server" -s t -l threshold -d "Number of signatures required" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from server" -s k -l keys -d "Comma-separated eligible public keys" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from server" -s p -l participants -d "Expected number of participants" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from server" -l port -d "Server port" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from server" -l host -d "Server host" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from server" -l timeout -d "Session timeout in minutes" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from server" -l no-tunnel -d "Disable automatic tunnel"
complete -c hedera-multisig -n "__fish_seen_subcommand_from server" -l pin -d "Custom session token" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from server" -s n -l network -d "Hedera network" -xa "testnet mainnet previewnet local"
complete -c hedera-multisig -n "__fish_seen_subcommand_from server" -l tls-cert -d "Path to TLS certificate" -r -F
complete -c hedera-multisig -n "__fish_seen_subcommand_from server" -l tls-key -d "Path to TLS private key" -r -F
complete -c hedera-multisig -n "__fish_seen_subcommand_from server" -l tls-ca -d "Path to CA certificate" -r -F
complete -c hedera-multisig -n "__fish_seen_subcommand_from server" -l tls-passphrase -d "Passphrase for private key" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from server" -l redis -d "Enable Redis session persistence"
complete -c hedera-multisig -n "__fish_seen_subcommand_from server" -l redis-host -d "Redis host" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from server" -l redis-port -d "Redis port" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from server" -l redis-password -d "Redis password" -r

# Participant command options
complete -c hedera-multisig -n "__fish_seen_subcommand_from participant" -s u -l url -d "WebSocket server URL" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from participant" -s s -l session -d "Session ID" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from participant" -s p -l pin -d "Session token" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from participant" -s f -l keyfile -d "Load encrypted key file" -r -F
complete -c hedera-multisig -n "__fish_seen_subcommand_from participant" -s k -l key -d "Private key hex string" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from participant" -s l -l label -d "Participant label" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from participant" -s y -l yes -d "Non-interactive mode"

# Sign command options
complete -c hedera-multisig -n "__fish_seen_subcommand_from sign" -l quick -d "Skip detailed display"

# Keys command and subcommands
complete -c hedera-multisig -n "__fish_seen_subcommand_from keys; and not __fish_seen_subcommand_from create test" -a "create" -d "Create an encrypted key file"
complete -c hedera-multisig -n "__fish_seen_subcommand_from keys; and not __fish_seen_subcommand_from create test" -a "test" -d "Test decryption of an encrypted key file"
complete -c hedera-multisig -n "__fish_seen_subcommand_from keys; and __fish_seen_subcommand_from create" -s o -l output -d "Output file path" -r -F
complete -c hedera-multisig -n "__fish_seen_subcommand_from keys; and __fish_seen_subcommand_from test" -F

# Audit command options
complete -c hedera-multisig -n "__fish_seen_subcommand_from audit" -l verbose -d "Show detailed code snippets"

# Offline command and subcommands
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and not __fish_seen_subcommand_from freeze decode execute" -a "freeze" -d "Freeze a transaction and output base64"
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and not __fish_seen_subcommand_from freeze decode execute" -a "decode" -d "Decode base64 transaction and display details"
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and not __fish_seen_subcommand_from freeze decode execute" -a "execute" -d "Collect signatures and execute transaction"

# Offline freeze options
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from freeze" -s t -l type -d "Transaction type" -xa "transfer contract-execute"
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from freeze" -s f -l from -d "Source account ID" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from freeze" -s T -l to -d "Destination account ID" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from freeze" -s a -l amount -d "Amount in HBAR" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from freeze" -s c -l contract -d "Contract ID" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from freeze" -s g -l gas -d "Gas limit" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from freeze" -s d -l data -d "Function call data in hex" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from freeze" -s o -l output -d "Output to file" -r -F
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from freeze" -l raw -d "Output raw base64 only"
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from freeze" -s j -l json -d "Output as JSON"

# Offline decode options
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from decode" -s b -l base64 -d "Base64-encoded transaction bytes" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from decode" -s f -l file -d "Read base64 from file" -r -F
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from decode" -s c -l checksum -d "Expected checksum" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from decode" -l verbose -d "Show raw bytes breakdown"
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from decode" -l raw -d "Output raw decoded JSON"
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from decode" -s j -l json -d "Output as JSON"

# Offline execute options
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from execute" -s b -l base64 -d "Base64-encoded frozen transaction" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from execute" -s f -l file -d "Read frozen transaction from file" -r -F
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from execute" -s s -l signatures -d "Signature tuples" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from execute" -l sig-file -d "Read signatures from file" -r -F
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from execute" -s t -l threshold -d "Required signature threshold" -r
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from execute" -l dry-run -d "Validate signatures without executing"
complete -c hedera-multisig -n "__fish_seen_subcommand_from offline; and __fish_seen_subcommand_from execute" -s j -l json -d "Output as JSON"

# Help command
complete -c hedera-multisig -n "__fish_seen_subcommand_from help" -a "server participant sign keys audit account offline"

# Copy completions for 'multisig' alias
complete -c multisig -w hedera-multisig
