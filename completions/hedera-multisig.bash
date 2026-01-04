#!/bin/bash
#
# Bash completion script for hedera-multisig CLI
#
# Installation:
#   1. Copy to /etc/bash_completion.d/hedera-multisig
#   OR
#   2. Add to ~/.bashrc:
#      source /path/to/hedera-multisig.bash
#

_hedera_multisig_completions() {
    local cur prev words cword
    _init_completion || return

    local commands="server participant sign keys audit account help"
    local global_opts="-V --version -v --verbose -q --quiet -j --json --trace --log-file --export-logs -h --help"

    # Server command options
    local server_opts="-t --threshold -k --keys -p --participants --port --host --timeout --no-tunnel --pin -n --network --tls-cert --tls-key --tls-ca --tls-passphrase --redis --redis-host --redis-port --redis-password"

    # Participant command options
    local participant_opts="-u --url -s --session -p --pin -f --keyfile -k --key -l --label -y --yes"

    # Sign command options
    local sign_opts="--quick"

    # Keys subcommands and options
    local keys_cmds="create test"
    local keys_create_opts="-o --output"

    # Audit command options
    local audit_opts="--verbose"

    # Get the command (first non-option argument)
    local cmd=""
    local subcmd=""
    for ((i=1; i < cword; i++)); do
        case "${words[i]}" in
            server|participant|sign|keys|audit|account|help)
                cmd="${words[i]}"
                ;;
            create|test)
                if [[ "$cmd" == "keys" ]]; then
                    subcmd="${words[i]}"
                fi
                ;;
        esac
    done

    case "$cmd" in
        server)
            case "$prev" in
                -t|--threshold|-p|--participants|--port|--timeout|--redis-port)
                    # Expects a number
                    return 0
                    ;;
                -k|--keys|--host|--pin|--redis-host|--redis-password)
                    # Expects a string value
                    return 0
                    ;;
                -n|--network)
                    COMPREPLY=($(compgen -W "testnet mainnet previewnet local" -- "$cur"))
                    return 0
                    ;;
                --tls-cert|--tls-key|--tls-ca|--log-file)
                    # File completion
                    _filedir
                    return 0
                    ;;
            esac
            COMPREPLY=($(compgen -W "$server_opts $global_opts" -- "$cur"))
            ;;
        participant)
            case "$prev" in
                -u|--url|-s|--session|-p|--pin|-k|--key|-l|--label)
                    # Expects a value
                    return 0
                    ;;
                -f|--keyfile|--log-file)
                    _filedir
                    return 0
                    ;;
            esac
            COMPREPLY=($(compgen -W "$participant_opts $global_opts" -- "$cur"))
            ;;
        sign)
            COMPREPLY=($(compgen -W "$sign_opts $global_opts" -- "$cur"))
            ;;
        keys)
            case "$subcmd" in
                create)
                    case "$prev" in
                        -o|--output)
                            _filedir
                            return 0
                            ;;
                    esac
                    COMPREPLY=($(compgen -W "$keys_create_opts $global_opts" -- "$cur"))
                    ;;
                test)
                    _filedir
                    ;;
                *)
                    COMPREPLY=($(compgen -W "$keys_cmds" -- "$cur"))
                    ;;
            esac
            ;;
        audit)
            COMPREPLY=($(compgen -W "$audit_opts $global_opts" -- "$cur"))
            ;;
        help)
            COMPREPLY=($(compgen -W "$commands" -- "$cur"))
            ;;
        *)
            COMPREPLY=($(compgen -W "$commands $global_opts" -- "$cur"))
            ;;
    esac
}

complete -F _hedera_multisig_completions hedera-multisig
complete -F _hedera_multisig_completions multisig
