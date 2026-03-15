# Ubuntu/Coolify Host Debugging

This is for a host that becomes unreachable from SSH and disappears from the LAN while the Ethernet link light stays up.

That symptom is usually one of these:

1. The host is running out of RAM or swap and the kernel gets stuck under pressure.
2. The disk is filling up, usually under `/var/lib/docker` or container logs.
3. The kernel or NIC driver is hanging or resetting.
4. The machine has a hardware problem: bad RAM, storage errors, overheating, or power instability.

For this repo specifically, the most likely trigger is server-side image builds. The root `Dockerfile` builds the full pnpm workspace. On a small Coolify host, that can spike memory, CPU, and disk usage during deploys.

## Immediate Stabilization

1. Stop building this repo on the server if you can avoid it.

This repository already publishes a container image in [docker-publish.yml](/c:/Users/cafal/OneDrive/Documents/GitHub/stellcon-g52/.github/workflows/docker-publish.yml). In Coolify, prefer deploying the GHCR image instead of building from source on the host.

Expected image format:

```text
ghcr.io/<owner>/<repo>:main
```

2. Make logs survive a forced reboot.

```bash
sudo mkdir -p /var/log/journal
sudo sed -i 's/^#\?Storage=.*/Storage=persistent/' /etc/systemd/journald.conf
sudo systemctl restart systemd-journald
```

3. If the server has less than 4 GB RAM, add swap.

```bash
free -h
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

4. Rotate Docker logs so they cannot silently fill the disk.

Create `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

Then restart Docker:

```bash
sudo systemctl restart docker
```

5. Run the collector after the next forced reboot.

```bash
chmod +x tools/server-debug/collect-host-state.sh
sudo ./tools/server-debug/collect-host-state.sh
```

It writes a timestamped folder with kernel logs, previous-boot logs, Docker state, disk usage, and network information.

## What To Look For

Open the files in the generated folder and check for these signatures:

- `10-red-flags.txt`: `Out of memory`, `Killed process`, `oom-killer`
- `10-red-flags.txt`: `No space left on device`, `EXT4-fs error`, `I/O error`
- `08-kernel-previous.txt`: `NETDEV WATCHDOG`, `link is down`, `reset adapter`, `r8169`, `e1000e`, `igc`
- `19-smart.txt`: failing SMART attributes or media errors
- `18-hardware.txt`: thermal warnings or obvious overheating

## If The Box Hard-Freezes Again

If the next failure leaves no useful logs, enable the hardware watchdog so the system reboots instead of staying hung:

Edit `/etc/systemd/system.conf` and set:

```ini
RuntimeWatchdogSec=20s
```

Then reboot the host.

That does not fix the root cause, but it shortens downtime and preserves logs from the failed boot.

## Likely Fixes By Symptom

- OOM or heavy memory pressure: use image deploys instead of source builds, add swap, and add per-service memory limits in Coolify.
- Disk pressure: prune old images and volumes, enable Docker log rotation, keep free space under `/var/lib/docker`.
- NIC or driver errors: update the Ubuntu kernel, disable aggressive NIC power saving, and test another cable or switch port.
- Storage errors: replace the disk.
- No logs plus random freezes: run a memory test and check power and thermals.
