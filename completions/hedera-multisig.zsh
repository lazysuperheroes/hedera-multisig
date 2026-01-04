#compdef hedera-multisig multisig
#
# Zsh completion script for hedera-multisig CLI
#
# Installation:
#   1. Add to your fpath and call compinit:
#      fpath=(/path/to/completions $fpath)
#      autoload -Uz compinit && compinit
#   OR
#   2. Copy to ~/.zsh/completions/ (or any dir in fpath)
#

_hedera_multisig() {
    local context state state_descr line
    typeset -A opt_args

    local -a global_opts
    global_opts=(
        '(-V --version)'{-V,--version}'[Show version number]'
        '(-v --verbose)'{-v,--verbose}'[Enable verbose output]'
        '(-q --quiet)'{-q,--quiet}'[Suppress non-essential output]'
        '(-j --json)'{-j,--json}'[Output as JSON]'
        '--trace[Enable trace-level debug logging]'
        '--log-file[Write logs to file]:log file:_files'
        '--export-logs[Export logs on exit]::export path:_files'
        '(-h --help)'{-h,--help}'[Show help]'
    )

    _arguments -C \
        $global_opts \
        '1:command:->commands' \
        '*::arg:->args'

    case "$state" in
        commands)
            local -a commands
            commands=(
                'server:Start a multi-sig session server'
                'participant:Join a session as a participant'
                'sign:Sign transactions offline (air-gapped)'
                'keys:Key management commands'
                'audit:Run security audit on codebase'
                'account:Account management (interactive menu)'
                'offline:Offline workflow commands (freeze, decode, execute)'
                'help:Display help for a command'
            )
            _describe -t commands 'command' commands
            ;;
        args)
            case "$words[1]" in
                server)
                    _arguments \
                        $global_opts \
                        '(-t --threshold)'{-t,--threshold}'[Number of signatures required]:threshold:' \
                        '(-k --keys)'{-k,--keys}'[Comma-separated eligible public keys]:keys:' \
                        '(-p --participants)'{-p,--participants}'[Expected number of participants]:participants:' \
                        '--port[Server port]:port:' \
                        '--host[Server host]:host:' \
                        '--timeout[Session timeout in minutes]:minutes:' \
                        '--no-tunnel[Disable automatic tunnel]' \
                        '--pin[Custom session token]:token:' \
                        '(-n --network)'{-n,--network}'[Hedera network]:network:(testnet mainnet previewnet local)' \
                        '--tls-cert[Path to TLS certificate]:cert:_files' \
                        '--tls-key[Path to TLS private key]:key:_files' \
                        '--tls-ca[Path to CA certificate]:ca:_files' \
                        '--tls-passphrase[Passphrase for private key]:passphrase:' \
                        '--redis[Enable Redis session persistence]' \
                        '--redis-host[Redis host]:host:' \
                        '--redis-port[Redis port]:port:' \
                        '--redis-password[Redis password]:password:'
                    ;;
                participant)
                    _arguments \
                        $global_opts \
                        '(-u --url)'{-u,--url}'[WebSocket server URL]:url:' \
                        '(-s --session)'{-s,--session}'[Session ID]:session:' \
                        '(-p --pin)'{-p,--pin}'[Session token]:pin:' \
                        '(-f --keyfile)'{-f,--keyfile}'[Load encrypted key file]:keyfile:_files' \
                        '(-k --key)'{-k,--key}'[Private key hex string]:key:' \
                        '(-l --label)'{-l,--label}'[Participant label]:label:' \
                        '(-y --yes)'{-y,--yes}'[Non-interactive mode]'
                    ;;
                sign)
                    _arguments \
                        $global_opts \
                        '--quick[Skip detailed display]'
                    ;;
                keys)
                    local -a keys_cmds
                    keys_cmds=(
                        'create:Create an encrypted key file'
                        'test:Test decryption of an encrypted key file'
                    )
                    _arguments -C \
                        '1:subcommand:->keys_cmd' \
                        '*::arg:->keys_args'
                    case "$state" in
                        keys_cmd)
                            _describe -t commands 'keys command' keys_cmds
                            ;;
                        keys_args)
                            case "$words[1]" in
                                create)
                                    _arguments \
                                        $global_opts \
                                        '(-o --output)'{-o,--output}'[Output file path]:output:_files'
                                    ;;
                                test)
                                    _arguments \
                                        '1:encrypted file:_files'
                                    ;;
                            esac
                            ;;
                    esac
                    ;;
                audit)
                    _arguments \
                        $global_opts \
                        '--verbose[Show detailed code snippets]'
                    ;;
                offline)
                    local -a offline_cmds
                    offline_cmds=(
                        'freeze:Freeze a transaction and output base64 for offline signing'
                        'decode:Decode base64 transaction and display human-readable details'
                        'execute:Collect signature tuples and execute a frozen transaction'
                    )
                    _arguments -C \
                        '1:subcommand:->offline_cmd' \
                        '*::arg:->offline_args'
                    case "$state" in
                        offline_cmd)
                            _describe -t commands 'offline command' offline_cmds
                            ;;
                        offline_args)
                            case "$words[1]" in
                                freeze)
                                    _arguments \
                                        $global_opts \
                                        '(-t --type)'{-t,--type}'[Transaction type]:type:(transfer contract-execute)' \
                                        '(-f --from)'{-f,--from}'[Source account ID]:account:' \
                                        '(-T --to)'{-T,--to}'[Destination account ID]:account:' \
                                        '(-a --amount)'{-a,--amount}'[Amount in HBAR]:amount:' \
                                        '(-c --contract)'{-c,--contract}'[Contract ID]:contract:' \
                                        '(-g --gas)'{-g,--gas}'[Gas limit]:gas:' \
                                        '(-d --data)'{-d,--data}'[Function call data in hex]:data:' \
                                        '(-o --output)'{-o,--output}'[Output to file]:file:_files' \
                                        '--raw[Output raw base64 only]' \
                                        '(-j --json)'{-j,--json}'[Output as JSON]'
                                    ;;
                                decode)
                                    _arguments \
                                        $global_opts \
                                        '(-b --base64)'{-b,--base64}'[Base64-encoded transaction bytes]:base64:' \
                                        '(-f --file)'{-f,--file}'[Read base64 from file]:file:_files' \
                                        '(-c --checksum)'{-c,--checksum}'[Expected checksum]:checksum:' \
                                        '--verbose[Show raw bytes breakdown]' \
                                        '--raw[Output raw decoded JSON]' \
                                        '(-j --json)'{-j,--json}'[Output as JSON]'
                                    ;;
                                execute)
                                    _arguments \
                                        $global_opts \
                                        '(-b --base64)'{-b,--base64}'[Base64-encoded frozen transaction]:base64:' \
                                        '(-f --file)'{-f,--file}'[Read frozen transaction from file]:file:_files' \
                                        '(-s --signatures)'{-s,--signatures}'[Signature tuples]:signatures:' \
                                        '--sig-file[Read signatures from file]:file:_files' \
                                        '(-t --threshold)'{-t,--threshold}'[Required signature threshold]:threshold:' \
                                        '--dry-run[Validate signatures without executing]' \
                                        '(-j --json)'{-j,--json}'[Output as JSON]'
                                    ;;
                            esac
                            ;;
                    esac
                    ;;
                help)
                    local -a commands
                    commands=(server participant sign keys audit account offline)
                    _describe -t commands 'command' commands
                    ;;
            esac
            ;;
    esac
}

_hedera_multisig "$@"
