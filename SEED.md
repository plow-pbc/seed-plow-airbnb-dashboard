# Purpose

> See [[README#Purpose]].

## Normative Language

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY, and OPTIONAL in this document are to be interpreted as described in RFC 2119.

## Dependencies

This SEED performs a **one-time install** of the plow-airbnb-dashboard (a calendar/reservation web service, plus a Chromium **kiosk** when the target has a display) onto a single host machine. The install runs in one of two modes:

- **local** (default) — the target is *this* machine, i.e. the **main host** you run the install on; every deploy command runs in a local shell. This is the assumption unless the user explicitly asks to target a separate machine.
- **remote** — the target is a *separate* machine (for example a dedicated Raspberry Pi wall-display) reached over the network; every deploy command runs on it over SSH from this machine.

Every deploy command therefore runs *on the target machine*. A helper, [[#^obj-seed-sh]] (`seed_sh`), hides the local/remote split: it reads a script on stdin and runs it on the target. The steps below are written once, against the target, and work in both modes.

Secret hygiene: the calendar credentials (an `.ics` URL, a Hostex access token, a Guesty `CLIENT_ID`+`CLIENT_SECRET` pair, or any combination) and — remote mode only — the target machine's login password are secrets. No step places either on a process command line (`argv`); the password is never read into the agent's context at all (see [[#^act-link]]).

The Bash tool does not persist shell state between calls — so every step that uses `seed_sh` first `source`s the config file written in Step 1.

All shell blocks below are `tier-2`: each MUST be displayed in full and confirmed before it runs. Entries are ordered hardware → calendar → software, then the five install steps.

### Invocation as a sub-seed ^dep-subseed

This SEED runs in one of two ways:

- **Standalone** — the operator runs it directly. It installs on the **main host** (`local` mode) by default; remote (a separate machine such as a Raspberry Pi) is used only when the operator explicitly asks. Step 1 collects every parameter, including the calendar credentials, from scratch. Everything below describes this path.
- **As a sub-seed** — it is invoked at the end of `plow-pbc/seed-hermes-airbnb-manager`'s install (that SEED's §16, gated on its `INSTALL_DASHBOARD=yes` up-front opt-in). The sub-seed run is **fully non-interactive** — once the parent's single up-front opt-in is given, this SEED MUST NOT prompt for anything. Specifically, when invoked as a sub-seed:
  - **Install mode is fixed to `local` on the main host** (the box running the Hermes stack). `INSTALL_MODE=local`, `TARGET_USER=$(id -un)`. Step 2 (SSH) is skipped; the operator is never asked to choose local/remote or for a Pi address.
  - **The sole calendar source is the reused `HOSTEX_ACCESS_TOKEN`** the parent already collected (see [[#^act-collect]]). This SEED MUST NOT prompt for an `.ics` URL or a Guesty pair — both are left empty. The Hostex token alone satisfies the "at least one source" rule.
  - **`tier-2` per-block confirmations are waived** — shell blocks run directly, since the parent procedure is itself non-interactive and the operator consented at the opt-in.
  - **The kiosk (Step 5) is best-effort:** if the host has a graphical session, install it; if the host is headless, install only the dashboard web service and **skip the kiosk without prompting** for `DISPLAY`/`XAUTHORITY` (the [[#^act-deploy-kiosk]] tier-3 fallback does not apply in sub-seed mode).
  - **Passwordless `sudo` on the host is still REQUIRED** (Step 3's hard gate). If it is missing, the sub-seed STOPS with the remediation Step 3 prints — it does not prompt to work around it.

  The token is carried in the agent's context across the hand-off and, per the secret hygiene above, is written only into the mode-`600` [[#^obj-env]] in Step 4. Apart from these non-interactive defaults, the same steps and `## Verify` apply (with the kiosk gate relaxed for a headless host).

### Hardware

- A **host machine** running a `systemd`-based Linux (Debian, Raspberry Pi OS, etc.), reachable as the install target. By default this is *this* machine (`local` mode); in `remote` mode it is a separate machine such as a Raspberry Pi.
- For the kiosk unit (**optional**): an **attached display** and a graphical session (typically `:0`, `graphical.target`). A **headless** host installs only the dashboard web service and skips the kiosk.
- **remote** mode only: a second machine — the one running this install — on the same network as the target.

### Calendar access

- **At least one** calendar credential — the dashboard's data sources — collected in [[#^act-collect]] and written to [[#^obj-env]]. Each source supplied becomes its own dashboard panel; supplying multiple shows them side-by-side. Treated as secrets. The available credentials are:
  - a private **`.ics` calendar URL** (an event-list panel),
  - a **Hostex OpenAPI access token** (a reservation-timeline panel), **and/or**
  - a **Guesty Open API credential pair** — both `GUESTY_CLIENT_ID` and `GUESTY_CLIENT_SECRET` (a reservation-timeline panel; both vars are required for the panel to appear). **Experimental — gated:** Guesty is only offered when the environment variable `GUESTY_SUPPORT` is set in the agent's environment at SEED runtime. When it is unset, the agent MUST NOT mention or prompt for Guesty credentials anywhere in this SEED, MUST NOT count Guesty toward the "at least one source" requirement, and MUST leave the Guesty value variables empty in Step 4.

### Software

On the **target Pi**: `git`, Node.js ≥ 20.6 with `npm`, `chromium` (at `/usr/bin/chromium`), `systemd`, `curl`, and — **required** — `sudo` usable **without a password** by the target user (the default on Raspberry Pi OS). Step 3 hard-gates on passwordless `sudo` and installs any missing packages.

On the **local machine** (remote mode only): a standard OpenSSH client — `ssh`, `ssh-keygen`, and `ssh-copy-id` — all included with OpenSSH on macOS and Linux. No other tooling is needed.

### Step 1 — Collect install parameters ^dep-collect

Collect, per [[#^act-collect]]:

| Parameter | Tier | Notes |
|---|---|---|
| Install mode | `tier-2` | `local` (default — this main host) or `remote` (a separate machine, e.g. a Pi). Fixed to `local` and not asked when run as a sub-seed. |
| Calendar credentials — `.ics` URL | `tier-3` | Optional. Adds the event-list panel. Secret — held by the agent, not stored in `install.env`. |
| Calendar credentials — Hostex access token | `tier-3` | Optional. Adds the Hostex reservations panel. Secret. |
| Calendar credentials — Guesty `CLIENT_ID` | `tier-3` | Optional. **Only offered when `GUESTY_SUPPORT` is set** in the agent's environment (experimental). Must be paired with the Guesty `CLIENT_SECRET` below to add the Guesty reservations panel. Secret. |
| Calendar credentials — Guesty `CLIENT_SECRET` | `tier-3` | Optional. **Only offered when `GUESTY_SUPPORT` is set** (experimental). Must be paired with the Guesty `CLIENT_ID` above. Secret. |
| (At least one source) | — | The credentials above are individually optional, but **at least one source** is required: the `.ics` URL, the Hostex token, or — when `GUESTY_SUPPORT` is set — **both** Guesty vars. Any combination is accepted. |
| Pi IP address | `tier-3` | remote mode only. IPv4 of the Pi. |
| Pi username | `tier-3` | remote mode only. The Pi login user. |
| Target user | `tier-1` | local mode: the output of `id -un` (report it). remote mode: equals the Pi username. |

Write the collected values into a config file — but **not** the calendar credentials: they are secrets and `install.env` is not access-restricted, so the agent keeps the values it collected in this step in context and writes them only into the mode-`600` [[#^obj-env]] in Step 4. Fill the four values below; leave `PI_*` blank for a local install:

```sh
mkdir -p ~/.config/seed-airbnb
cat > ~/.config/seed-airbnb/install.env <<'CONF'
# Filled by Step 1. Sourced by every later step.
INSTALL_MODE=local                 # 'local' or 'remote'
TARGET_USER=pi                     # local: output of `id -un`; remote: the Pi username
PI_USER=                           # remote only — the Pi login user
PI_IP=                             # remote only — the Pi IPv4 address
DASH_DIR="/home/$TARGET_USER/services/plow-airbnb-dashboard"

# Run a script (read from stdin) on the target machine.
# remote mode authenticates with the dedicated install key minted in Step 2.
seed_sh() {
  if [ "$INSTALL_MODE" = remote ]; then
    ssh -i "$HOME/.ssh/id_ed25519_seed_airbnb" -o IdentitiesOnly=yes \
        -o StrictHostKeyChecking=accept-new "$PI_USER@$PI_IP" \
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

A remote install runs every later step over SSH non-interactively, so the Pi must accept an SSH **key** with no password prompt. This SEED uses a **dedicated, passphrase-less install key** — `~/.ssh/id_ed25519_seed_airbnb`, minted just for this job — and never your personal key. A throwaway key for a one-time install is guaranteed passphrase-less (so `ssh-agent` state is irrelevant and no passphrase prompt can stall a step), leaves your real key untouched, and keeps exactly one known key in play. `ssh-copy-id` installs it on the Pi after a single password entry; every later `ssh` then pins it with `-i ... -o IdentitiesOnly=yes`, so no other key is ever offered. You run `ssh-copy-id` yourself, so the password goes straight into it and never passes through the agent. The key is removable once the install is done — see [[#^o-install-key]].

**Step 2.1 — Is it already set up?** The agent runs this. If it prints `already passwordless`, skip straight to Step 3:

```sh
source ~/.config/seed-airbnb/install.env
ssh -i ~/.ssh/id_ed25519_seed_airbnb -o IdentitiesOnly=yes \
    -o BatchMode=yes -o ConnectTimeout=5 "$PI_USER@$PI_IP" true \
  && echo "already passwordless — skip to Step 3" \
  || echo "not set up yet — continue with Steps 2.2-2.4"
```

**Step 2.2 — Mint the dedicated install key.** The agent runs this. It creates a passphrase-less `ed25519` keypair reserved for this install — `~/.ssh/id_ed25519_seed_airbnb` — generating it only if it is not already there. This SEED never reads, reuses, or depends on your personal `~/.ssh/id_ed25519`:

```sh
ls ~/.ssh/id_ed25519_seed_airbnb.pub >/dev/null 2>&1 \
  && echo "install key already present — reusing it" \
  || ssh-keygen -t ed25519 -N '' -C seed-airbnb-install -f ~/.ssh/id_ed25519_seed_airbnb
```

**Step 2.3 — Copy the install key to the Pi (you run this one).** `ssh-copy-id` must prompt *you* for the Pi password, so it needs a real interactive terminal. Run it yourself in a normal terminal application (Terminal.app, iTerm, a Linux terminal emulator) — **not** through Claude Code's `!` prefix, which runs commands non-interactively, captures their output, and gives the password prompt no TTY to read from. The `-i` flag installs exactly the dedicated key from Step 2.2 and `IdentitiesOnly=yes` keeps your other keys out of the connection, so the password prompt is reached cleanly. Substitute the Pi username and IP from Step 1:

```sh
ssh-copy-id -i ~/.ssh/id_ed25519_seed_airbnb.pub -o IdentitiesOnly=yes <PI_USER>@<PI_IP>
```

On the first connection it asks `Are you sure you want to continue connecting?` — type `yes`. Then at `<PI_USER>@<PI_IP>'s password:` type the Pi password. Success prints `Number of key(s) added: 1`.

If `ssh-copy-id` is not installed, the same thing by hand (run it yourself, enter the password when prompted):

```sh
cat ~/.ssh/id_ed25519_seed_airbnb.pub | ssh -i ~/.ssh/id_ed25519_seed_airbnb -o IdentitiesOnly=yes <PI_USER>@<PI_IP> 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
```

**Step 2.4 — Confirm passwordless login works.** The agent runs this; it MUST print `passwordless SSH OK` with no password prompt:

```sh
source ~/.config/seed-airbnb/install.env
ssh -i ~/.ssh/id_ed25519_seed_airbnb -o IdentitiesOnly=yes \
    -o BatchMode=yes "$PI_USER@$PI_IP" true && echo "passwordless SSH OK"
```

If this fails, triage in one command — `ssh -v` prints a `Server accepts key` line when the Pi already holds the key:

```sh
source ~/.config/seed-airbnb/install.env
ssh -v -i ~/.ssh/id_ed25519_seed_airbnb -o IdentitiesOnly=yes -o BatchMode=yes \
    "$PI_USER@$PI_IP" true 2>&1 | grep -i 'Server accepts key' || echo 'absent — key not accepted'
```

If the `Server accepts key` line is **present**, the Pi has the key and the fault is client-side (wrong key path, or permissions on `~/.ssh/id_ed25519_seed_airbnb`). If it is **absent**, the key never reached the Pi — server-side — so repeat Step 2.3.

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
  git clone https://github.com/plow-pbc/seed-plow-airbnb-dashboard.git "$DASH_DIR"
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

Create `.env` from `.env.example`, lock it to mode `600`, and fill in the calendar credentials collected in Step 1 — do **not** prompt for them again. Fill `ICAL_URL_VALUE`, `HOSTEX_TOKEN_VALUE`, and/or the Guesty pair (`GUESTY_CLIENT_ID_VALUE` + `GUESTY_CLIENT_SECRET_VALUE`) from the secrets the agent is holding; leave any unused ones empty. At least one source MUST be non-empty (Guesty needs **both** vars to count as a source) — the block aborts otherwise. This block uses an **unquoted** heredoc so the secrets expand locally and travel via stdin, never `argv` (`\$DASH_DIR` is escaped so it expands on the target):

```sh
source ~/.config/seed-airbnb/install.env
ICAL_URL_VALUE=''                               # set if collected; empty omits it
HOSTEX_TOKEN_VALUE=''                           # set if collected; empty omits it
GUESTY_CLIENT_ID_VALUE=''                       # set if collected; both Guesty
GUESTY_CLIENT_SECRET_VALUE=''                   # vars required to enable Guesty
seed_sh <<EOF
set -eu
cd "\$DASH_DIR"
[ -n '$ICAL_URL_VALUE' ] || [ -n '$HOSTEX_TOKEN_VALUE' ] \
  || { [ -n '$GUESTY_CLIENT_ID_VALUE' ] && [ -n '$GUESTY_CLIENT_SECRET_VALUE' ]; } \
  || { echo "no calendar credential supplied — at least one of ICAL_URL, HOSTEX_ACCESS_TOKEN, or both GUESTY_CLIENT_ID and GUESTY_CLIENT_SECRET is required" >&2; exit 1; }
{
  grep -vE '^(ICAL_URL|HOSTEX_ACCESS_TOKEN|GUESTY_CLIENT_ID|GUESTY_CLIENT_SECRET)=' .env.example
  [ -n '$ICAL_URL_VALUE'             ] && printf 'ICAL_URL=%s\n'             '$ICAL_URL_VALUE'             ||:
  [ -n '$HOSTEX_TOKEN_VALUE'         ] && printf 'HOSTEX_ACCESS_TOKEN=%s\n'  '$HOSTEX_TOKEN_VALUE'         ||:
  if [ -n '$GUESTY_CLIENT_ID_VALUE' ] && [ -n '$GUESTY_CLIENT_SECRET_VALUE' ]; then
    printf 'GUESTY_CLIENT_ID=%s\n'     '$GUESTY_CLIENT_ID_VALUE'
    printf 'GUESTY_CLIENT_SECRET=%s\n' '$GUESTY_CLIENT_SECRET_VALUE'
  fi
} > .env
chmod 600 .env
EOF
```

Replace the placeholder `odio` username throughout `plow-airbnb-dashboard.service` with the target user:

```sh
source ~/.config/seed-airbnb/install.env
seed_sh <<'EOF'
set -eu
cd "$DASH_DIR"
sed -i "s/odio/$TARGET_USER/g" plow-airbnb-dashboard.service
grep -nE 'User|WorkingDirectory|ExecStart' plow-airbnb-dashboard.service
EOF
```

Install, enable, and start the service, then report its state and the health check:

```sh
source ~/.config/seed-airbnb/install.env
seed_sh <<'EOF'
set -eu
cd "$DASH_DIR"
sudo cp plow-airbnb-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now plow-airbnb-dashboard.service || true
sleep 2
sudo systemctl --no-pager status plow-airbnb-dashboard.service || true
echo "is-active: $(systemctl is-active plow-airbnb-dashboard.service || true)"
echo "healthz:   $(curl -s http://localhost:5174/healthz || echo FAILED)"
EOF
```

`is-active` MUST print `active` and `healthz` MUST print `ok`. If either does not, stop — the install has failed.

### Step 5 — Deploy the kiosk ^dep-kiosk

See [[#^act-deploy-kiosk]].

The shipped `plow-airbnb-kiosk.service` hardcodes `Environment=DISPLAY=:0` and `Environment=XAUTHORITY=/home/odio/.Xauthority`. Those defaults suit a Raspberry Pi's console session but are wrong for many setups — an xrdp/XVNC session runs on `:10` or higher, a Wayland greeter parks XWayland elsewhere, and the X authority file is rarely at `~/.Xauthority`. This step **detects** the values from the target user's live graphical session and **rewrites** the unit, rather than trusting the defaults.

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
- **`verdict: UNREACHABLE`, or `DISPLAY: <none>`** — detection failed, most often because no graphical session is logged in right now. In **standalone** mode, do not guess: ask the user (`tier-3`) for the correct `DISPLAY` and `XAUTHORITY`, then write them into `~/.config/seed-airbnb/kiosk.env` on the target (`KIOSK_DISPLAY=` / `KIOSK_XAUTHORITY=`) before continuing. In **sub-seed** mode (see [[#^dep-subseed]]), do NOT prompt — treat the host as headless, **skip the kiosk entirely**, and finish with just the dashboard web service installed.

Then patch the unit — swap the `odio` username and rewrite the display/auth lines from the detected values:

```sh
source ~/.config/seed-airbnb/install.env
seed_sh <<'EOF'
set -eu
cd "$DASH_DIR"
. ~/.config/seed-airbnb/kiosk.env
[ -n "${KIOSK_DISPLAY:-}" ] || { echo "KIOSK_DISPLAY is empty — set it in ~/.config/seed-airbnb/kiosk.env first"; exit 1; }
sed -i "s/odio/$TARGET_USER/g" plow-airbnb-kiosk.service
sed -i "s|^Environment=DISPLAY=.*|Environment=DISPLAY=$KIOSK_DISPLAY|" plow-airbnb-kiosk.service
if [ -n "${KIOSK_XAUTHORITY:-}" ]; then
  sed -i "s|^Environment=XAUTHORITY=.*|Environment=XAUTHORITY=$KIOSK_XAUTHORITY|" plow-airbnb-kiosk.service
else
  sed -i "/^Environment=XAUTHORITY=/d" plow-airbnb-kiosk.service
fi
grep -nE 'User|Environment|ExecStart' plow-airbnb-kiosk.service
EOF
```

Install, enable, and start the kiosk unit, then report its state:

```sh
source ~/.config/seed-airbnb/install.env
seed_sh <<'EOF'
set -eu
cd "$DASH_DIR"
sudo cp plow-airbnb-kiosk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now plow-airbnb-kiosk.service || true
sleep 2
sudo systemctl --no-pager status plow-airbnb-kiosk.service || true
echo "is-active: $(systemctl is-active plow-airbnb-kiosk.service || true)"
EOF
```

`is-active` MUST print `active`. If it does not, stop — the install has failed; the most likely cause is a wrong `DISPLAY`/`XAUTHORITY`, so re-run the detection block (or correct `kiosk.env`), patch again, and `sudo systemctl restart plow-airbnb-kiosk.service`.

## Objects

The named entities that exist once [[#^act-deploy-kiosk]] completes.

### Target machine ^obj-target

- The Raspberry Pi receiving the install — *this* machine in local mode, the remote Pi in remote mode. Every deploy command runs here.

### `seed_sh` helper ^obj-seed-sh

- A shell function defined in `~/.config/seed-airbnb/install.env` on the local machine. It reads a script on stdin and runs it on [[#^obj-target]] — directly in local mode, over SSH in remote mode. Steps 3–5 and `## Verify` route every target command through it.

### Deploy directory ^obj-dash-dir

- `/home/<target-user>/services/plow-airbnb-dashboard` on [[#^obj-target]] — the clone of `https://github.com/plow-pbc/seed-plow-airbnb-dashboard.git`, built (`npm run build`) and configured.

### Environment file ^obj-env

- `.env` inside [[#^obj-dash-dir]], mode `600`, derived from `.env.example`. Holds the calendar credentials the dashboard proxies — `ICAL_URL` (a private `.ics` URL), `HOSTEX_ACCESS_TOKEN` (a Hostex access token), and/or the Guesty pair `GUESTY_CLIENT_ID` + `GUESTY_CLIENT_SECRET` (both required together); at least one source is set, multiple are allowed (each becomes its own dashboard panel).

### Dashboard service ^obj-dashboard-service

- `plow-airbnb-dashboard.service`, a `systemd` unit at `/etc/systemd/system/`. Runs the Node proxy plus the built SPA as the target user, listening on `http://localhost:5174`, and exposes `/healthz`.

### Kiosk service ^obj-kiosk-service

- `plow-airbnb-kiosk.service`, a `systemd` unit at `/etc/systemd/system/`. Launches Chromium in kiosk mode against `http://localhost:5174`, ordered `After=plow-airbnb-dashboard.service`.

## Actions

The verbs performed during the install. Each maps to a checklist the agent tracks. All shell lives in `## Dependencies`; the steps below are descriptive.

### Install parameters are collected ^act-collect

The agent gathers the install mode and credentials, then writes `~/.config/seed-airbnb/install.env`.

1. Determine the install mode. **Default to `local`** (install on this main host); only use `remote` — a separate machine such as a Raspberry Pi reached over SSH — if the user explicitly asks for it (`tier-2`). As a sub-seed (see [[#^dep-subseed]]), the mode is fixed to `local` and is NOT asked.
2. Ask for the calendar credentials (`tier-3`), prompting **separately** for each secret to match the SEED's per-secret pattern — a private `.ics` calendar URL, a Hostex access token, **and — only when `GUESTY_SUPPORT` is set in the agent's environment at SEED runtime** — the Guesty `CLIENT_ID` + `CLIENT_SECRET` pair (both Guesty vars must be supplied together for the panel to enable). When `GUESTY_SUPPORT` is unset, do not mention or prompt for Guesty at all (the feature is experimental). At least one source is required; any combination is accepted (each becomes its own dashboard panel). Collected up front, here, so the user is not stopped for them partway through the install; the agent holds them in context for [[#^act-deploy-dashboard]]. **When this SEED runs as a sub-seed** (see [[#^dep-subseed]]), this step is non-interactive: the agent already holds a `HOSTEX_ACCESS_TOKEN` from the parent install and MUST reuse it as the **sole** Hostex source. It MUST NOT prompt for an `.ics` URL or a Guesty pair at all — both are left empty.
3. In remote mode, ask for the target machine's IP address and login username (`tier-3`). Skipped in `local` mode (including every sub-seed run).
4. Resolve the target user: in local mode run `id -un` and report it (`tier-1`); in remote mode it is the target machine's username.
5. Write [[#^dep-collect]]'s `install.env` with those values and confirm it — the calendar credentials are deliberately **not** written there (they are secrets; see [[#^dep-collect]]).

### Remote access is established ^act-link

In remote mode, the agent walks the user through setting up passwordless, key-based SSH so every later step runs over SSH non-interactively.

1. Skip this Action entirely in local mode.
2. Check whether passwordless SSH already works; if so, skip ahead to [[#^act-software]].
3. Mint a dedicated, passphrase-less `ed25519` install key — `~/.ssh/id_ed25519_seed_airbnb` — if it is not already present; the user's personal key is never read or used.
4. Direct the **user** to run `ssh-copy-id -i ~/.ssh/id_ed25519_seed_airbnb.pub <PI_USER>@<PI_IP>` themselves in a real terminal application and enter the Pi password once (`tier-3`); the password goes to `ssh-copy-id`, never to the agent.
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
3. Create [[#^obj-env]] from `.env.example`, `chmod 600` it, and set the calendar credentials — `ICAL_URL`, `HOSTEX_ACCESS_TOKEN`, and/or the Guesty pair `GUESTY_CLIENT_ID` + `GUESTY_CLIENT_SECRET` — collected in [[#^act-collect]]; no new prompt.
4. Replace `odio` with the target user throughout `plow-airbnb-dashboard.service`.
5. Copy the unit to `/etc/systemd/system/`, `daemon-reload`, `enable --now`.
6. Confirm `systemctl is-active` is `active` and `/healthz` returns `ok`. Per [[#^dep-dashboard]].

### The kiosk is deployed ^act-deploy-kiosk

The agent installs and starts [[#^obj-kiosk-service]], correcting its display settings for the actual target rather than trusting the shipped `:0` / `~/.Xauthority` defaults.

1. Detect the target user's live graphical session — `DISPLAY` and `XAUTHORITY` — and validate the pair reaches an X server.
2. Confirm the detected values (`tier-2`); if detection failed, ask the user for them (`tier-3`) — **except in sub-seed mode**, where a headless host means the kiosk is skipped without prompting (see [[#^dep-subseed]]) and the remaining steps do not run.
3. Replace `odio` with the target user, and rewrite the `DISPLAY`/`XAUTHORITY` lines of `plow-airbnb-kiosk.service` from the detected values.
4. Copy the unit to `/etc/systemd/system/`, `daemon-reload`, `enable --now`.
5. Confirm `systemctl is-active` is `active`. Per [[#^dep-kiosk]].

## Verify

Read-only checks confirming the install succeeded. Each runs on [[#^obj-target]] via [[#^obj-seed-sh]]; the shell is `tier-2` — display and confirm before running. None mutate installed state.

1. **Dashboard service is running.** ^v-dashboard-active

   ```sh
   source ~/.config/seed-airbnb/install.env
   seed_sh <<'EOF'
   systemctl is-active plow-airbnb-dashboard.service
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
   stat -c '%a' "$DASH_DIR/.env" && grep -qE '^(ICAL_URL|HOSTEX_ACCESS_TOKEN|GUESTY_CLIENT_ID|GUESTY_CLIENT_SECRET)=.' "$DASH_DIR/.env" && echo credential-set
   EOF
   ```

   Expected: `600` followed by `credential-set`.

4. **Service units carry the real username, not `odio`.** ^v-username

   ```sh
   source ~/.config/seed-airbnb/install.env
   seed_sh <<'EOF'
   grep -l odio /etc/systemd/system/plow-airbnb-dashboard.service /etc/systemd/system/plow-airbnb-kiosk.service 2>/dev/null && echo FOUND-odio || echo clean
   EOF
   ```

   Expected: `clean`.

5. **Kiosk service is running.** ^v-kiosk-active

   ```sh
   source ~/.config/seed-airbnb/install.env
   seed_sh <<'EOF'
   systemctl is-active plow-airbnb-kiosk.service
   EOF
   ```

   Expected: `active` — **or** the kiosk was intentionally skipped because the host is headless (sub-seed mode; see [[#^dep-subseed]]). In that case this gate does not apply and only the dashboard web-service gates (1–4 above) must pass.

## Feedback

(none)

## Open

- Passwordless `sudo` for the target user is required and is hard-gated at the start of Step 3. The SEED cannot grant it automatically — that needs the user's password — so a failing gate stops the install with remediation instructions. ^o-sudo
- The kiosk unit calls Chromium at `/usr/bin/chromium`. Some images ship it as `chromium-browser` — adjust the unit's `ExecStart` if so. ^o-chromium
- Step 5 detects `DISPLAY`/`XAUTHORITY` from whatever graphical session is live at install time. If that session is ephemeral — an xrdp/XVNC login, a Wayland greeter's XWayland — the values may not survive a reboot; a persistent boot kiosk needs console autologin so a stable session exists. Re-run the Step 5 detection block after configuring that. ^o-display
- **remote mode only:** Step 2 mints a dedicated SSH key, `~/.ssh/id_ed25519_seed_airbnb`, used only to drive this one-time install. Once the install — and `## Verify` — is complete it is safe to remove: delete the keypair on this machine (`rm ~/.ssh/id_ed25519_seed_airbnb ~/.ssh/id_ed25519_seed_airbnb.pub`) and strip its line — the one ending `seed-airbnb-install` — from `~/.ssh/authorized_keys` on the Pi. The dashboard and kiosk services need no SSH; only the install does. ^o-install-key
- No uninstall path. Removing the install is manual: `systemctl disable --now` both units, delete them from `/etc/systemd/system/`, and delete the deploy directory. ^o-uninstall
- This SEED can run standalone or as a sub-seed of `plow-pbc/seed-hermes-airbnb-manager` (its §16; see [[#^dep-subseed]]). As a sub-seed it installs on the **main host** (`local` mode) fully non-interactively — reusing the parent's Hostex token, skipping `.ics`/Guesty prompts, and installing the kiosk only when the host has a display. The two stacks are otherwise independent: they share only the Hostex credential — no shared process, port, or compose network — and installing one never rolls back the other. To put the kiosk on a separate Raspberry Pi instead, run this SEED standalone in `remote` mode. ^o-subseed

## Non-Goals

- No uninstall, rollback, or upgrade orchestration — this is a one-time install.
- One target Pi per run; no multi-Pi fan-out.
- Not a CI/CD pipeline; the install is interactive and human-gated.
- No management of the dashboard's optional message API (`MESSAGE_API_URL`, `DASHBOARD_TOKEN`) — see the README.
