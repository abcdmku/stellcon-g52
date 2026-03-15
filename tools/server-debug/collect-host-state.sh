#!/usr/bin/env bash

set -Eeuo pipefail

timestamp="$(date +%Y%m%d-%H%M%S)"
root_dir="${1:-$PWD/host-state-$timestamp}"

mkdir -p "$root_dir"

note() {
  printf '[%s] %s\n' "$(date '+%F %T')" "$*"
}

capture() {
  local name="$1"
  shift
  local target="$root_dir/$name"
  local cmd=("$@")

  note "Capturing $name"
  {
    printf '$'
    for arg in "${cmd[@]}"; do
      printf ' %q' "$arg"
    done
    printf '\n\n'
    "${cmd[@]}"
  } >"$target" 2>&1 || true
}

capture_shell() {
  local name="$1"
  local command="$2"
  local target="$root_dir/$name"

  note "Capturing $name"
  {
    printf '$ %s\n\n' "$command"
    bash -lc "$command"
  } >"$target" 2>&1 || true
}

capture "00-summary.txt" env LC_ALL=C bash -lc '
  echo "timestamp=$(date --iso-8601=seconds)"
  echo "hostname=$(hostname)"
  echo "kernel=$(uname -r)"
  echo "uptime=$(uptime -p)"
  echo
  command -v hostnamectl >/dev/null && hostnamectl || true
  echo
  cat /etc/os-release || true
'

capture "01-load.txt" env LC_ALL=C bash -lc '
  uptime || true
  echo
  free -h || true
  echo
  swapon --show || true
  echo
  vmstat -w 1 5 || true
'

capture "02-disk.txt" env LC_ALL=C bash -lc '
  df -h || true
  echo
  df -ih || true
  echo
  lsblk -o NAME,SIZE,FSTYPE,TYPE,MOUNTPOINTS || true
'

capture "03-reboots.txt" env LC_ALL=C bash -lc '
  last -x | head -n 50 || true
'

capture "04-failed-services.txt" env LC_ALL=C bash -lc '
  systemctl --failed || true
  echo
  systemctl list-units --type=service --state=failed || true
'

capture "05-current-boot-journal.txt" env LC_ALL=C bash -lc '
  journalctl -b --no-pager || true
'

capture "06-previous-boot-journal.txt" env LC_ALL=C bash -lc '
  journalctl -b -1 --no-pager || true
'

capture "07-kernel-current.txt" env LC_ALL=C bash -lc '
  journalctl -k -b --no-pager || true
'

capture "08-kernel-previous.txt" env LC_ALL=C bash -lc '
  journalctl -k -b -1 --no-pager || true
'

capture "09-dmesg.txt" env LC_ALL=C bash -lc '
  dmesg -T || true
'

capture "10-red-flags.txt" env LC_ALL=C bash -lc '
  journalctl --no-pager | grep -Ei "out of memory|oom-killer|killed process|no space left on device|i/o error|ext4-fs error|xfs|btrfs|watchdog|netdev watchdog|link is down|reset adapter|segfault|kernel panic|call trace|hardware error|mce|thermal|overheat" || true
'

capture "11-network.txt" env LC_ALL=C bash -lc '
  ip -brief link || true
  echo
  ip -brief addr || true
  echo
  ip route || true
  echo
  ss -tulpn || true
  echo
  command -v networkctl >/dev/null && networkctl status --all || true
  echo
  command -v nmcli >/dev/null && nmcli device status || true
'

capture_shell "12-ethtool.txt" '
  if ! command -v ethtool >/dev/null; then
    echo "ethtool not installed"
    exit 0
  fi

  for nic in $(ls /sys/class/net); do
    case "$nic" in
      lo|docker*|br-*|veth*|virbr*|tailscale*|zt*|wg*)
        continue
        ;;
    esac

    echo "===== $nic ====="
    ethtool "$nic" || true
    echo
    ethtool -S "$nic" || true
    echo
  done
'

capture "13-processes.txt" env LC_ALL=C bash -lc '
  ps aux --sort=-%mem | head -n 40 || true
  echo
  ps aux --sort=-%cpu | head -n 40 || true
'

capture "14-docker.txt" env LC_ALL=C bash -lc '
  if ! command -v docker >/dev/null; then
    echo "docker not installed"
    exit 0
  fi

  docker ps -a || true
  echo
  docker stats --no-stream || true
  echo
  docker system df || true
  echo
  docker info || true
'

capture_shell "15-docker-logs-red-flags.txt" '
  if ! command -v docker >/dev/null; then
    echo "docker not installed"
    exit 0
  fi

  for cid in $(docker ps -q); do
    name="$(docker inspect --format "{{.Name}}" "$cid" 2>/dev/null | sed "s#^/##")"
    echo "===== $name ($cid) ====="
    docker logs --tail 200 "$cid" 2>&1 | grep -Ei "out of memory|killed|fatal|panic|ENOMEM|EAI_AGAIN|ECONNRESET|no space left|segfault" || true
    echo
  done
'

capture_shell "16-coolify.txt" '
  if ! command -v docker >/dev/null; then
    echo "docker not installed"
    exit 0
  fi

  docker ps -a --format "{{.ID}} {{.Image}} {{.Names}}" | grep -Ei "coolify|traefik|redis" || true
'

capture_shell "17-storage-hotspots.txt" '
  du -xhd1 /var/lib 2>/dev/null | sort -h || true
  echo
  du -xhd1 /var/log 2>/dev/null | sort -h || true
  echo
  du -xhd1 /var/lib/docker 2>/dev/null | sort -h || true
'

capture_shell "18-hardware.txt" '
  lscpu || true
  echo
  command -v lsmem >/dev/null && lsmem || true
  echo
  command -v sensors >/dev/null && sensors || true
'

capture_shell "19-smart.txt" '
  if ! command -v smartctl >/dev/null; then
    echo "smartctl not installed"
    exit 0
  fi

  for disk in $(lsblk -ndo NAME,TYPE | awk "$2 == \"disk\" { print \"/dev/\" $1 }"); do
    echo "===== $disk ====="
    smartctl -a "$disk" || true
    echo
  done
'

note "Host state written to $root_dir"
