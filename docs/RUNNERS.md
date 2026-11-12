# Runners: execution modes and isolation (2026-11-05)

Agents and people need to run things (tests, builds, scripts). A **runner** is any machine that can run a command for a workspace.
The agent never executes anything itself: it asks the workspace's current runner, after the permission policy has said yes.

## Targets
| Target | What it is | Status |
|---|---|---|
| **Built-in agent runner (legacy)** | A throwaway directory inside the agent's own container. Environment scrubbing is not OS isolation: commands share the agent UID, network, and mounted credentials (see `docs/SECURITY.md`). | `agents/src/runner.js` is separate from the native external runner; this change does not secure it. |
| **Native Linux external runner** | Bubblewrap namespaces plus a systemd user service with verified cgroups v2 limits, private size-limited tmpfs workspace, read-only inputs/runtime, no network or host-writable mounts. | Implemented in `runner/`; real Linux checks run on the Pi. Not automatically deployed. |
| **Nebius cloud** | The same runner as a container or VM on Nebius AI Cloud (or a Token Factory sandbox if the credits include one). This is what the submitted product uses. | Runner container and compose service written (`deploy/nebius/`), not yet run on Nebius |
| **A teammate's machine** | The desktop app embeds its own legacy runner (`desktop/runner/lib.js`), asks the owner before each workspace, and executes owner-trusted host commands. | Not an OS sandbox; separate desktop code is unchanged by the native external-runner patch. |
| **Any server** | `node runner/index.js --server wss://... --token T --allow-room demo`. Linux defaults to native isolation and refuses missing prerequisites. | GPU devices are not passed through by this initial native policy. |

## Native Linux requirements and limits

Run under a dedicated unprivileged account with a working systemd user manager, cgroups v2 CPU/memory/PID controllers, unprivileged user namespaces, Python 3, and bubblewrap supporting `--size`, `--disable-userns`, and `--as-pid-1`. The launcher requires `/usr/bin/bwrap`, `/usr/bin/systemd-run`, `/usr/bin/systemctl`, and `/usr/bin/python3`. The runner root must be owned by its account, with no group/other write permission. Review the public runtime files exposed read-only under `/usr`, `/bin`, `/sbin`, and `/lib*`; use a dedicated host with no secrets stored there.

Before executing bubblewrap, the trusted host guard reads the actual service cgroup's `memory.max`, `memory.swap.max`, `cpu.max`, and `pids.max`; absent, unlimited, or weaker limits refuse the job. An accepted systemd property alone is not treated as proof of enforcement. The service has a private session keyring and blocks keyring syscalls; the guard verifies the filter is active and all three keyring syscall probes return EPERM. Verification currently supports aarch64 and x86_64; other architectures refuse. This closes same-UID host-key access which environment and namespace isolation alone do not prevent. Default caps: 256 MiB RAM, no swap, 50% of one CPU, 64 tasks, 64 MiB workspace tmpfs. The tmpfs holds the actual writable files, rather than a host bind mount outside the disk budget. Temporary files use the same workspace. Other private namespace memory also remains subject to the RAM cap.

One job runs at a time; additional jobs receive a busy result. Default command time is 60 seconds (maximum 10 minutes). A guest deadline, host watchdog, and service `RuntimeMaxSec` bound execution including lost runner clients. Stopping/disconnecting cancels the entire service. The PID-namespace supervisor kills descendants before collecting artifacts, including processes which changed sessions. Each job has a random private staging directory independent of remote room/job IDs and is removed after completion or failure.

Inputs: at most 256 files / 2 MiB text; unsafe or conflicting paths reject the whole job. Output: 40 KiB. Returned text: at most 128 files / 4 MiB total / 200 KiB each, bounded traversal, no symlinks or special files. Artifact frames are validated again on the host and remain untrusted execution output, not independent test attestation. Deleted files are not returned by this protocol. Network is disabled; dependency download and GPU access need a separately reviewed policy.

There is **no automatic host execution fallback**. Missing bubblewrap, user manager, namespaces, or enforced controllers produces a terminal error result. The basic Dockerfile does not provide a systemd user manager or delegated controllers; native mode deliberately refuses there. Do not add privileged containers, host mounts, or a Docker socket to work around this.

For commands the machine owner already trusts, the operator may explicitly choose `--isolation trusted-local` (or `MURMIO_ISOLATION=trusted-local`). macOS and Windows default to this owner-consented mode. A remote job cannot change the mode or raise resource limits. Trusted-local process execution can access the owner's host files and network; environment scrubbing, process-group cleanup, and a temporary working directory do not provide security isolation. The old desktop copy and built-in agent runner remain separate migration work.

Verification: `node --test runner/test/sandbox.test.js runner/test/wire.test.js` covers validation and real local wire behavior. `node --test runner/test/native-linux.test.js` performs real Linux namespace/resource/cleanup checks and fails when Linux prerequisites are missing; it explicitly skips on other operating systems. `VESPR_TEST_BWRAP` can point only the test harness at a user-local extracted official package. This does not install or configure a production dependency.

## One protocol for all of them
A runner dials **out** to the VESPR server (like a CI self-hosted runner), so it works behind home routers with no open ports.
1. Connect to `wss://<server>/runner?token=...&label=...&os=...&arch=...`; the server assigns a stable runner ID.
2. The server sends `{type: 'job', id, room, files, command, timeoutMs}`. The runner returns `{type: 'chunk', id, data}` and exactly one terminal `{type: 'result', id, code, changed}` or `{type: 'result', id, code: -1, error}` while connected.
3. Changed files go back into the room as ordinary edits, with the agent's name and provenance.

Pick a target per workspace in the chat panel (`settings.runner`). Later, label scheduling: a job that `needs: macos` goes to a Mac runner.

## Safety rules (apply to every non-sandbox runner)
- Outbound connection only; one token per runner; revoke any time.
- The machine's owner must allow each workspace once: "Allow workspace 'demo' to run commands on your Mac? Once / Always / Deny".
- Every command still goes through the permission policy. **Bypass mode never applies to a remote runner**: it falls back to Auto (already in `agents/src/policy.js`, tested).
- Native external Linux jobs use the isolation policy above. Trusted-local and legacy runners use a temporary working directory and scrubbed environment, but may still access host files and network. The chat names the selected runner.
- Audit log: every command, who approved it, and its exit code land in the chat and provenance log everyone already sees.

## Permission modes (built)
The same idea as common coding assistants:
- **Manual**: ask before every edit and every command.
- **Accept edits**: edits go through, commands ask.
- **Auto**: edits and safe commands go through, risky commands ask, dangerous ones are refused (rule-based classifier today; a Nemotron-based one later).
- **Plan**: read-only until a person approves the plan ("Approve plan" button switches to Accept edits and tells the agents to proceed).
- **Bypass**: no prompts; sandbox only.

The mode lives in the shared document, so everyone sees it and anyone can change it. The first person to answer an Approve / Deny card decides, and everyone sees who. The default is Manual.
Limitations: no per-person permissions yet (anyone in the room can approve or change the mode); the sandbox shares the agent container's network, so a command could reach the internet, which is why only safe commands skip approval in Auto.
