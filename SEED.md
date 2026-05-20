# Purpose

> See [[README#Purpose]].

## Normative Language

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY, and OPTIONAL in this document are to be interpreted as described in RFC 2119.

## Dependencies

This SEED performs a **one-time install** of the family-dashboard calendar kiosk onto a single Raspberry Pi. The install runs in one of two modes, chosen by the user (`tier-2`):

- **local** — the Pi is *this* machine; every deploy command runs in a local shell.
- **remote** — the Pi is reached over the network; every deploy command runs on it over SSH from this machine.

Every deploy command therefore runs *on the target Pi*. A helper, [[#^obj-seed-sh]] (`seed_sh`), hides the local/remote split: it reads a script on stdin and runs it on the target. The steps below are written once, against the target, and work in both modes.

Secret hygiene: the `.ics` URL and the Pi password are secrets. No step places either on a process command line (`argv`); the password is never read into the agent's context at all (see [[#^act-link]]).

The Bash tool does not persist shell state between calls — so every step that uses `seed_sh` first `source`s the config file written in Step 1.

All shell blocks below are `tier-2`: each MUST be displayed in full and confirmed before it runs. Entries are ordered hardware → calendar → software, then the five install steps.

### Hardware

- A **Raspberry Pi** running Raspberry Pi OS (Debian-based, `systemd`), reachable as the install target.
- For the kiosk unit: an **attached display** and a graphical session on `:0` (`graphical.target`).
- **remote** mode only: a second machine — the one running this install — on the same network as the Pi.

### Calendar access

- A private **`.ics` calendar URL** — the dashboard's only data source. Treated as a secret. Collected in [[#^act-collect]] and written to [[#^obj-env]].

### Software

On the **target Pi**: `git`, Node.js ≥ 20.6 with `npm`, `chromium` (at `/usr/bin/chromium`), `systemd`, `curl`, and `sudo` usable **without a password** by the target user (the default on Raspberry Pi OS). Step 3 checks for these and offers to install the missing ones.

On the **local machine** (remote mode only): an SSH client (`ssh`, `ssh-keygen`, `ssh-copy-id`) and `sshpass`. Install `sshpass` with the platform package manager if missing (e.g. `brew install sshpass`, `sudo apt-get install -y sshpass`).

### Step 1 — Collect install parameters ^dep-collect

Collect, per [[#^act-collect]]:

| Parameter | Tier | Notes |
|---|---|---|
| Install mode | `tier-2` | `local` or `remote`. |
| `.ics` URL | `tier-3` | The private calendar URL. Secret. |
| Pi IP address | `tier-3` | remote mode only. IPv4 of the Pi. |
| Pi username | `tier-3` | remote mode only. The Pi login user. |
| Target user | `tier-1` | local mode: the output of `id -un` (report it). remote mode: equals the Pi username. |

Write the collected values into a config file. Fill the four marked values; leave `PI_*` blank for a local install:

```sh
mkdir -p ~/.config/seed-airbnb
cat > ~/.config/seed-airbnb/install.env <<'CONF'
# Filled by Step 1. Sourced by every later step.
INSTALL_MODE=local                 # 'local' or 'remote'
TARGET_USER=pi                     # local: output of `id -un`; remote: the Pi username
PI_USER=                           # remote only — the Pi login user
PI_IP=                             # remote only — the Pi IPv4 address
DASH_DIR="/home/$TARGET_USER/services/family-dashboard"

# Run a script (read from stdin) on the target machine.
seed_sh() {
  if [ "$INSTALL_MODE" = remote ]; then
    ssh -o StrictHostKeyChecking=accept-new "$PI_USER@$PI_IP" \
        "TARGET_USER=$(printf %q "$TARGET_USER") DASH_DIR=$(printf %q "$DASH_DIR") bash -s"
  else
    TARGET_USER="$TARGET_USER" DASH_DIR="$DASH_DIR" bash -s
  fi
}
CONF
```

Confirm the file holds the right values before continuing:

```sh
grep -E '^(INSTALL_MODE|TARGET_USER|PI_USER|PI_IP)=' ~/.config/seed-airbnb/install.env
```

### Step 2 — Establish remote access ^dep-link

**remote mode only — skip this step entirely for a local install.** See [[#^act-link]]. The goal is key-based SSH so later steps run non-interactively, without the Pi password ever entering the agent's context.

If key auth already works, skip to Step 3:

```sh
source ~/.config/seed-airbnb/install.env
ssh -o BatchMode=yes -o ConnectTimeout=5 "$PI_USER@$PI_IP" true && echo "key auth already works — skip Step 2"
```

Otherwise, ensure a local SSH keypair exists:

```sh
ls ~/.ssh/id_ed25519.pub >/dev/null 2>&1 || ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519
```

Next, **the user** (not the agent) writes the Pi password into a temp file, so the password never enters the agent's context. Ask the user to run this themselves — in Claude Code, by typing it after a `!` prompt prefix:

```sh
umask 077 && printf 'Pi password: ' && read -rs P && printf '%s' "$P" > /tmp/seed-pi-pw && unset P && echo && echo 'saved /tmp/seed-pi-pw'
```

Copy this machine's public key to the Pi — `sshpass` reads the password from the file, never from `argv`:

```sh
source ~/.config/seed-airbnb/install.env
sshpass -f /tmp/seed-pi-pw ssh-copy-id -o StrictHostKeyChecking=accept-new "$PI_USER@$PI_IP"
```

Delete the password file, then confirm key auth works:

```sh
source ~/.config/seed-airbnb/install.env
shred -u /tmp/seed-pi-pw 2>/dev/null || rm -f /tmp/seed-pi-pw
ssh -o BatchMode=yes "$PI_USER@$PI_IP" true && echo "key auth OK"
```

### Step 3 — Ensure target software ^dep-software

See [[#^act-software]]. Check what the Pi already has:

```sh
source ~/.config/seed-airbnb/install.env
seed_sh <<'EOF'
for c in git curl node npm chromium; do
  if command -v "$c" >/dev/null 2>&1; then printf '%-9s %s\n' "$c" "$("$c" --version 2>/dev/null | head -n1)"
  else printf '%-9s MISSING\n' "$c"; fi
done
sudo -n true 2>/dev/null && echo 'sudo: passwordless OK' || echo 'sudo: NOT passwordless — install will fail'
EOF
```

Run the install block **only for what is missing or for Node below 20.6**. It adds the NodeSource Node 20 LTS repo and installs packages via `apt`:

```sh
source ~/.config/seed-airbnb/install.env
seed_sh <<'EOF'
set -eu
sudo apt-get update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git curl chromium
EOF
```

### Step 4 — Deploy the dashboard ^dep-dashboard

See [[#^act-deploy-dashboard]].

Clone (or update) the public repository on the target:

```sh
source ~/.config/seed-airbnb/install.env
seed_sh <<'EOF'
set -eu
mkdir -p "$(dirname "$DASH_DIR")"
if [ -d "$DASH_DIR/.git" ]; then
  git -C "$DASH_DIR" pull --ff-only
else
  git clone https://github.com/plow-pbc/seed-airbnb-dashboard.git "$DASH_DIR"
fi
EOF
```

Install dependencies and build:

```sh
source ~/.config/seed-airbnb/install.env
seed_sh <<'EOF'
set -eu
cd "$DASH_DIR"
npm ci
npm run build
EOF
```

Create `.env` from `.env.example`, lock it to mode `600`, and fill in `ICAL_URL`. Set the `ICAL_URL` variable to the `.ics` URL from Step 1 first. This block uses an **unquoted** heredoc so `$ICAL_URL` expands locally and the secret travels via stdin, never `argv` (`\$DASH_DIR` is escaped so it expands on the target):

```sh
source ~/.config/seed-airbnb/install.env
ICAL_URL='PASTE_ICS_URL_HERE'
seed_sh <<EOF
set -eu
cd "\$DASH_DIR"
{ grep -v '^ICAL_URL=' .env.example; printf 'ICAL_URL=%s\n' '$ICAL_URL'; } > .env
chmod 600 .env
EOF
```

Replace the placeholder `odio` username throughout `family-dashboard.service` with the target user:

```sh
source ~/.config/seed-airbnb/install.env
seed_sh <<'EOF'
set -eu
cd "$DASH_DIR"
sed -i "s/odio/$TARGET_USER/g" family-dashboard.service
grep -nE 'User|WorkingDirectory|ExecStart' family-dashboard.service
EOF
```

Install, enable, and start the service, then report its state and the health check:

```sh
source ~/.config/seed-airbnb/install.env
seed_sh <<'EOF'
set -eu
cd "$DASH_DIR"
sudo cp family-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now family-dashboard.service || true
sleep 2
sudo systemctl --no-pager status family-dashboard.service || true
echo "is-active: $(systemctl is-active family-dashboard.service || true)"
echo "healthz:   $(curl -s http://localhost:5174/healthz || echo FAILED)"
EOF
```

`is-active` MUST print `active` and `healthz` MUST print `ok`. If either does not, stop — the install has failed.

### Step 5 — Deploy the kiosk ^dep-kiosk

See [[#^act-deploy-kiosk]].

Replace the placeholder `odio` username throughout `family-kiosk.service`:

```sh
source ~/.config/seed-airbnb/install.env
seed_sh <<'EOF'
set -eu
cd "$DASH_DIR"
sed -i "s/odio/$TARGET_USER/g" family-kiosk.service
grep -nE 'User|Environment|ExecStart' family-kiosk.service
EOF
```

Install, enable, and start the kiosk unit, then report its state:

```sh
source ~/.config/seed-airbnb/install.env
seed_sh <<'EOF'
set -eu
cd "$DASH_DIR"
sudo cp family-kiosk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now family-kiosk.service || true
sleep 2
sudo systemctl --no-pager status family-kiosk.service || true
echo "is-active: $(systemctl is-active family-kiosk.service || true)"
EOF
```

`is-active` MUST print `active`. If it does not, stop — the install has failed.

## Objects

The named entities that exist once [[#^act-deploy-kiosk]] completes.

### Target machine ^obj-target

- The Raspberry Pi receiving the install — *this* machine in local mode, the remote Pi in remote mode. Every deploy command runs here.

### `seed_sh` helper ^obj-seed-sh

- A shell function defined in `~/.config/seed-airbnb/install.env` on the local machine. It reads a script on stdin and runs it on [[#^obj-target]] — directly in local mode, over SSH in remote mode. Steps 3–5 and `## Verify` route every target command through it.

### Deploy directory ^obj-dash-dir

- `/home/<target-user>/services/family-dashboard` on [[#^obj-target]] — the clone of `https://github.com/plow-pbc/seed-airbnb-dashboard.git`, built (`npm run build`) and configured.

### Environment file ^obj-env

- `.env` inside [[#^obj-dash-dir]], mode `600`, derived from `.env.example`. Holds `ICAL_URL` — the private `.ics` URL the dashboard proxies.

### Dashboard service ^obj-dashboard-service

- `family-dashboard.service`, a `systemd` unit at `/etc/systemd/system/`. Runs the Node proxy plus the built SPA as the target user, listening on `http://localhost:5174`, and exposes `/healthz`.

### Kiosk service ^obj-kiosk-service

- `family-kiosk.service`, a `systemd` unit at `/etc/systemd/system/`. Launches Chromium in kiosk mode against `http://localhost:5174`, ordered `After=family-dashboard.service`.

## Actions

The verbs performed during the install. Each maps to a checklist the agent tracks. All shell lives in `## Dependencies`; the steps below are descriptive.

### Install parameters are collected ^act-collect

The agent gathers the install mode and credentials, then writes `~/.config/seed-airbnb/install.env`.

1. Ask the user for the install mode — `local` or `remote` (`tier-2`).
2. Ask for the private `.ics` calendar URL (`tier-3`).
3. In remote mode, ask for the Pi's IP address and login username (`tier-3`).
4. Resolve the target user: in local mode run `id -un` and report it (`tier-1`); in remote mode it is the Pi username.
5. Write [[#^dep-collect]]'s `install.env` with those values and confirm it.

### Remote access is established ^act-link

In remote mode, the agent sets up key-based SSH so later steps run non-interactively, without the password entering its context.

1. Skip this Action entirely in local mode.
2. If `ssh -o BatchMode=yes` already succeeds against the Pi, skip ahead to [[#^act-software]].
3. Ensure a local SSH keypair exists.
4. Have the **user** write the Pi password into `/tmp/seed-pi-pw` themselves (`tier-3`); the agent MUST NOT read or echo it.
5. Run `ssh-copy-id` via `sshpass -f` to install the public key on the Pi.
6. Delete the password file and confirm key auth works. Per [[#^dep-link]].

### Target software is ensured ^act-software

The agent confirms the Pi has the required software and passwordless `sudo`, installing what is missing.

1. Run the [[#^dep-software]] check block.
2. For anything missing — or Node below 20.6 — run the install block (`tier-2` confirmation).
3. If `sudo` is not passwordless, surface this to the user; the service steps cannot proceed without it.

### The dashboard is deployed ^act-deploy-dashboard

The agent installs and starts [[#^obj-dashboard-service]].

1. Clone or update [[#^obj-dash-dir]] on the target.
2. Run `npm ci` and `npm run build`.
3. Create [[#^obj-env]] from `.env.example`, `chmod 600` it, and set `ICAL_URL`.
4. Replace `odio` with the target user throughout `family-dashboard.service`.
5. Copy the unit to `/etc/systemd/system/`, `daemon-reload`, `enable --now`.
6. Confirm `systemctl is-active` is `active` and `/healthz` returns `ok`. Per [[#^dep-dashboard]].

### The kiosk is deployed ^act-deploy-kiosk

The agent installs and starts [[#^obj-kiosk-service]].

1. Replace `odio` with the target user throughout `family-kiosk.service`.
2. Copy the unit to `/etc/systemd/system/`, `daemon-reload`, `enable --now`.
3. Confirm `systemctl is-active` is `active`. Per [[#^dep-kiosk]].

## Verify

Read-only checks confirming the install succeeded. Each runs on [[#^obj-target]] via [[#^obj-seed-sh]]; the shell is `tier-2` — display and confirm before running. None mutate installed state.

1. **Dashboard service is running.** ^v-dashboard-active

   ```sh
   source ~/.config/seed-airbnb/install.env
   seed_sh <<'EOF'
   systemctl is-active family-dashboard.service
   EOF
   ```

   Expected: `active`.

2. **Health endpoint responds.** ^v-healthz

   ```sh
   source ~/.config/seed-airbnb/install.env
   seed_sh <<'EOF'
   curl -s http://localhost:5174/healthz
   EOF
   ```

   Expected: `ok`.

3. **Environment file is present and locked down.** ^v-env

   ```sh
   source ~/.config/seed-airbnb/install.env
   seed_sh <<'EOF'
   stat -c '%a' "$DASH_DIR/.env" && grep -q '^ICAL_URL=.' "$DASH_DIR/.env" && echo ICAL_URL-set
   EOF
   ```

   Expected: `600` followed by `ICAL_URL-set`.

4. **Service units carry the real username, not `odio`.** ^v-username

   ```sh
   source ~/.config/seed-airbnb/install.env
   seed_sh <<'EOF'
   grep -l odio /etc/systemd/system/family-dashboard.service /etc/systemd/system/family-kiosk.service 2>/dev/null && echo FOUND-odio || echo clean
   EOF
   ```

   Expected: `clean`.

5. **Kiosk service is running.** ^v-kiosk-active

   ```sh
   source ~/.config/seed-airbnb/install.env
   seed_sh <<'EOF'
   systemctl is-active family-kiosk.service
   EOF
   ```

   Expected: `active`.

## Feedback

(none)

## Open

- Passwordless `sudo` for the target user is assumed (the Raspberry Pi OS default). A Pi configured otherwise will fail the service steps — `sudo` over a non-interactive SSH session cannot answer a password prompt. ^o-sudo
- The repo also ships `yodeck-kiosk.service`, which competes with `family-kiosk.service` for the display. This SEED does not disable it; if both are enabled, disable Yodeck manually (`sudo systemctl disable --now yodeck-kiosk.service`). ^o-yodeck
- The kiosk unit expects Chromium at `/usr/bin/chromium` and a graphical session on `:0`. Some Raspberry Pi OS images ship `chromium-browser` instead, or run headless — adjust the unit if so. ^o-chromium
- No uninstall path. Removing the install is manual: `systemctl disable --now` both units, delete them from `/etc/systemd/system/`, and delete the deploy directory. ^o-uninstall

## Non-Goals

- No uninstall, rollback, or upgrade orchestration — this is a one-time install.
- One target Pi per run; no multi-Pi fan-out.
- Not a CI/CD pipeline; the install is interactive and human-gated.
- No management of the dashboard's optional message API (`MESSAGE_API_URL`, `DASHBOARD_TOKEN`) — see the README.
