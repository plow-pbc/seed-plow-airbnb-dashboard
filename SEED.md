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

On the **target Pi**: `git`, Node.js ≥ 20.6 with `npm`, `chromium` (at `/usr/bin/chromium`), `systemd`, `curl`, and — **required** — `sudo` usable **without a password** by the target user (the default on Raspberry Pi OS). Step 3 hard-gates on passwordless `sudo` and installs any missing packages.

On the **local machine** (remote mode only): a standard OpenSSH client — `ssh`, `ssh-keygen`, and `ssh-copy-id` — all included with OpenSSH on macOS and Linux. No other tooling is needed.

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

### Step 2 — Set up passwordless SSH ^dep-link

**remote mode only — skip this step entirely for a local install.** See [[#^act-link]].

A remote install runs every later step over SSH non-interactively, so the Pi must accept this machine's SSH **key** — no password prompts. The standard tool is `ssh-copy-id`: it asks for the Pi password **once**, installs your public key, and from then on SSH logs in with no password. You run that one command yourself, so the password goes straight into `ssh-copy-id` and never passes through the agent.

**Step 2.1 — Is it already set up?** The agent runs this. If it prints `already passwordless`, skip straight to Step 3:

```sh
source ~/.config/seed-airbnb/install.env
ssh -o BatchMode=yes -o ConnectTimeout=5 "$PI_USER@$PI_IP" true \
  && echo "already passwordless — skip to Step 3" \
  || echo "not set up yet — continue with Steps 2.2-2.4"
```

**Step 2.2 — Make sure this machine has an SSH key.** The agent runs this; it creates an `ed25519` keypair only if you do not already have one:

```sh
ls ~/.ssh/id_ed25519.pub >/dev/null 2>&1 \
  && echo "SSH key already present" \
  || ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519
```

**Step 2.3 — Copy your key to the Pi (you run this one).** `ssh-copy-id` must prompt *you* for the Pi password, so run it yourself in an interactive terminal — in Claude Code, type it after a `!` prefix. Substitute the Pi username and IP from Step 1:

```sh
ssh-copy-id <PI_USER>@<PI_IP>
```

On the first connection it asks `Are you sure you want to continue connecting?` — type `yes`. Then at `<PI_USER>@<PI_IP>'s password:` type the Pi password. Success prints `Number of key(s) added: 1`.

If `ssh-copy-id` is not installed, the same thing by hand (run it yourself, enter the password when prompted):

```sh
cat ~/.ssh/id_ed25519.pub | ssh <PI_USER>@<PI_IP> 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
```

**Step 2.4 — Confirm passwordless login works.** The agent runs this; it MUST print `passwordless SSH OK` with no password prompt:

```sh
source ~/.config/seed-airbnb/install.env
ssh -o BatchMode=yes "$PI_USER@$PI_IP" true && echo "passwordless SSH OK"
```

If this still asks for a password or fails, repeat Step 2.3.

### Step 3 — Ensure target software ^dep-software

See [[#^act-software]].

**Passwordless `sudo` for the target user is REQUIRED** — the package, service-file, and `systemctl` steps all call `sudo`, and `sudo` over a non-interactive `seed_sh` session cannot answer a password prompt. This gate checks it first and **exits non-zero (the install stops here) if it is missing**:

```sh
source ~/.config/seed-airbnb/install.env
seed_sh <<'EOF'
if sudo -n true 2>/dev/null; then
  echo "passwordless sudo: OK"
else
  me=$(id -un)
  echo "passwordless sudo: MISSING for user '$me' — this is REQUIRED; the install cannot continue." >&2
  echo "Grant it on the target (you will be prompted for a password once), then re-run this step:" >&2
  echo "  echo '$me ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/$me >/dev/null && sudo chmod 440 /etc/sudoers.d/$me" >&2
  exit 1
fi
EOF
```

If that block fails, stop — passwordless `sudo` MUST be in place before continuing. Once it passes, check what the Pi already has:

```sh
source ~/.config/seed-airbnb/install.env
seed_sh <<'EOF'
for c in git curl node npm chromium xset; do
  if command -v "$c" >/dev/null 2>&1; then printf '%-9s %s\n' "$c" "$("$c" --version 2>/dev/null | head -n1)"
  else printf '%-9s MISSING\n' "$c"; fi
done
EOF
```

Run the install block **only for what is missing or for Node below 20.6**. It adds the NodeSource Node 20 LTS repo and installs packages via `apt` — including `x11-xserver-utils`, whose `xset` lets Step 5 validate the kiosk display:

```sh
source ~/.config/seed-airbnb/install.env
seed_sh <<'EOF'
set -eu
sudo apt-get update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git curl chromium x11-xserver-utils
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

The shipped `family-kiosk.service` hardcodes `Environment=DISPLAY=:0` and `Environment=XAUTHORITY=/home/odio/.Xauthority`. Those defaults suit a Raspberry Pi's console session but are wrong for many setups — an xrdp/XVNC session runs on `:10` or higher, a Wayland greeter parks XWayland elsewhere, and the X authority file is rarely at `~/.Xauthority`. This step **detects** the values from the target user's live graphical session and **rewrites** the unit, rather than trusting the defaults.

First, detect the session. This block inspects the environment of the target user's running session / window-manager process, validates the pair against the X server with `xset`, and records the result in `~/.config/seed-airbnb/kiosk.env` on the target:

```sh
source ~/.config/seed-airbnb/install.env
seed_sh <<'EOF'
set -u
u="$TARGET_USER"
mkdir -p ~/.config/seed-airbnb
disp= ; xauth= ; wl= ; via=
for pat in xfce4-session gnome-session cinnamon-session mate-session lxqt-session \
           lxsession plasmashell xfwm4 mutter marco kwin_x11 openbox; do
  for pid in $(pgrep -u "$u" -f "$pat" 2>/dev/null); do
    e=$( { cat "/proc/$pid/environ" 2>/dev/null || sudo cat "/proc/$pid/environ" 2>/dev/null; } | tr '\0' '\n')
    [ -z "$e" ] && continue
    d=$(printf '%s\n' "$e" | sed -n 's/^DISPLAY=//p'         | head -n1)
    x=$(printf '%s\n' "$e" | sed -n 's/^XAUTHORITY=//p'      | head -n1)
    w=$(printf '%s\n' "$e" | sed -n 's/^WAYLAND_DISPLAY=//p' | head -n1)
    if [ -n "$d" ]; then disp=$d; xauth=$x; wl=$w; via="$pat (pid $pid)"; break 2; fi
  done
done
if [ -n "$disp" ] && [ -z "$xauth" ]; then
  for cand in "/home/$u/.Xauthority" "/run/user/$(id -u "$u" 2>/dev/null)/gdm/Xauthority"; do
    [ -f "$cand" ] && { xauth=$cand; break; }
  done
fi
verdict=UNVERIFIED
if [ -n "$disp" ] && command -v xset >/dev/null 2>&1; then
  if sudo -u "$u" env DISPLAY="$disp" XAUTHORITY="$xauth" xset q >/dev/null 2>&1
  then verdict=OK; else verdict=UNREACHABLE; fi
fi
cat > ~/.config/seed-airbnb/kiosk.env <<KE
KIOSK_DISPLAY=$disp
KIOSK_XAUTHORITY=$xauth
KE
echo "detected via : ${via:-<none>}"
echo "DISPLAY      : ${disp:-<none>}"
echo "XAUTHORITY   : ${xauth:-<none>}"
echo "WAYLAND      : ${wl:-<none>}"
echo "X sockets    : $(ls /tmp/.X11-unix/ 2>/dev/null | tr '\n' ' ')"
echo "verdict      : $verdict"
EOF
```

Review the output (`tier-2`):

- **`verdict: OK`** — the detected pair reaches the X server. Continue.
- **`verdict: UNVERIFIED`** — `xset` is absent, so the pair could not be tested; the detected values are still the best guess. Continue, but expect to revisit if the kiosk fails.
- **`verdict: UNREACHABLE`, or `DISPLAY: <none>`** — detection failed, most often because no graphical session is logged in right now. Do not guess. Ask the user (`tier-3`) for the correct `DISPLAY` and `XAUTHORITY`, then write them into `~/.config/seed-airbnb/kiosk.env` on the target (`KIOSK_DISPLAY=` / `KIOSK_XAUTHORITY=`) before continuing.

Then patch the unit — swap the `odio` username and rewrite the display/auth lines from the detected values:

```sh
source ~/.config/seed-airbnb/install.env
seed_sh <<'EOF'
set -eu
cd "$DASH_DIR"
. ~/.config/seed-airbnb/kiosk.env
[ -n "${KIOSK_DISPLAY:-}" ] || { echo "KIOSK_DISPLAY is empty — set it in ~/.config/seed-airbnb/kiosk.env first"; exit 1; }
sed -i "s/odio/$TARGET_USER/g" family-kiosk.service
sed -i "s|^Environment=DISPLAY=.*|Environment=DISPLAY=$KIOSK_DISPLAY|" family-kiosk.service
if [ -n "${KIOSK_XAUTHORITY:-}" ]; then
  sed -i "s|^Environment=XAUTHORITY=.*|Environment=XAUTHORITY=$KIOSK_XAUTHORITY|" family-kiosk.service
else
  sed -i "/^Environment=XAUTHORITY=/d" family-kiosk.service
fi
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

`is-active` MUST print `active`. If it does not, stop — the install has failed; the most likely cause is a wrong `DISPLAY`/`XAUTHORITY`, so re-run the detection block (or correct `kiosk.env`), patch again, and `sudo systemctl restart family-kiosk.service`.

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

In remote mode, the agent walks the user through setting up passwordless, key-based SSH so every later step runs over SSH non-interactively.

1. Skip this Action entirely in local mode.
2. Check whether passwordless SSH already works; if so, skip ahead to [[#^act-software]].
3. Ensure this machine has an SSH keypair (create an `ed25519` key if none exists).
4. Direct the **user** to run `ssh-copy-id <PI_USER>@<PI_IP>` themselves in an interactive terminal and enter the Pi password once (`tier-3`); the password goes to `ssh-copy-id`, never to the agent.
5. Confirm passwordless SSH works (`ssh -o BatchMode=yes`). Per [[#^dep-link]].

### Target software is ensured ^act-software

The agent gates on passwordless `sudo`, then confirms the Pi has the required software, installing what is missing.

1. Run the [[#^dep-software]] passwordless-`sudo` gate. If it exits non-zero, the install MUST stop — terminate with `failure` and report the remediation the block printed.
2. Run the software inventory check.
3. For anything missing — or Node below 20.6 — run the install block (`tier-2` confirmation).

### The dashboard is deployed ^act-deploy-dashboard

The agent installs and starts [[#^obj-dashboard-service]].

1. Clone or update [[#^obj-dash-dir]] on the target.
2. Run `npm ci` and `npm run build`.
3. Create [[#^obj-env]] from `.env.example`, `chmod 600` it, and set `ICAL_URL`.
4. Replace `odio` with the target user throughout `family-dashboard.service`.
5. Copy the unit to `/etc/systemd/system/`, `daemon-reload`, `enable --now`.
6. Confirm `systemctl is-active` is `active` and `/healthz` returns `ok`. Per [[#^dep-dashboard]].

### The kiosk is deployed ^act-deploy-kiosk

The agent installs and starts [[#^obj-kiosk-service]], correcting its display settings for the actual target rather than trusting the shipped `:0` / `~/.Xauthority` defaults.

1. Detect the target user's live graphical session — `DISPLAY` and `XAUTHORITY` — and validate the pair reaches an X server.
2. Confirm the detected values (`tier-2`); if detection failed, ask the user for them (`tier-3`).
3. Replace `odio` with the target user, and rewrite the `DISPLAY`/`XAUTHORITY` lines of `family-kiosk.service` from the detected values.
4. Copy the unit to `/etc/systemd/system/`, `daemon-reload`, `enable --now`.
5. Confirm `systemctl is-active` is `active`. Per [[#^dep-kiosk]].

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

- Passwordless `sudo` for the target user is required and is hard-gated at the start of Step 3. The SEED cannot grant it automatically — that needs the user's password — so a failing gate stops the install with remediation instructions. ^o-sudo
- The repo also ships `yodeck-kiosk.service`, which competes with `family-kiosk.service` for the display. This SEED does not disable it; if both are enabled, disable Yodeck manually (`sudo systemctl disable --now yodeck-kiosk.service`). ^o-yodeck
- The kiosk unit calls Chromium at `/usr/bin/chromium`. Some images ship it as `chromium-browser` — adjust the unit's `ExecStart` if so. ^o-chromium
- Step 5 detects `DISPLAY`/`XAUTHORITY` from whatever graphical session is live at install time. If that session is ephemeral — an xrdp/XVNC login, a Wayland greeter's XWayland — the values may not survive a reboot; a persistent boot kiosk needs console autologin so a stable session exists. Re-run the Step 5 detection block after configuring that. ^o-display
- No uninstall path. Removing the install is manual: `systemctl disable --now` both units, delete them from `/etc/systemd/system/`, and delete the deploy directory. ^o-uninstall

## Non-Goals

- No uninstall, rollback, or upgrade orchestration — this is a one-time install.
- One target Pi per run; no multi-Pi fan-out.
- Not a CI/CD pipeline; the install is interactive and human-gated.
- No management of the dashboard's optional message API (`MESSAGE_API_URL`, `DASHBOARD_TOKEN`) — see the README.
