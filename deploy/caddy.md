# Private HTTPS on your own domain

Traffic flows over Tailscale to Caddy on the Pi's Tailscale address (port 443), then to the
planner on `127.0.0.1:8080`. Caddy serves both the frontend and API through the Rust server.
The app has no authentication; tailnet access rules control who can use it.
See [the communication diagrams](network.md) for DNS, HTTPS and certificate renewal.

The examples use `planner.example.com` in the `example.com` zone and `100.64.0.1` as the
Pi's Tailscale address (`tailscale ip -4` on the Pi). Substitute your own values throughout.

## Prerequisites

In Cloudflare DNS for `example.com`, create an **A** record named `planner` with the Pi's
Tailscale address as its value, set to **DNS only** (proxy off). If the Pi runs a Cloudflare
Tunnel, do not add this hostname to it. The DNS record is public, but the address is
reachable only through the tailnet. Remove any conflicting records for this hostname.

In the Tailscale admin DNS settings, add a custom nameserver `1.1.1.1`, restricted
to `planner.example.com`. This avoids home routers with DNS rebinding protection rejecting
a public DNS answer containing a Tailscale IP. Leave the global DNS override setting unchanged.
If a client still fails to resolve the name, `tailscale dns status` should list the
route; run `tailscale set --accept-dns=false` then `--accept-dns=true` to re-apply it.

Install a Caddy build containing `github.com/caddy-dns/cloudflare`, retaining the
existing modules and a backup of the current binary. Follow Caddy's
[custom-build instructions for Debian](https://caddyserver.com/docs/build#package-support-files-for-custom-builds-for-debianubunturaspbian)
so package upgrades do not replace the custom binary. Confirm:

```bash
caddy list-modules | grep '^dns.providers.cloudflare$'
```

Create a Cloudflare API token with **Zone / DNS / Edit** and **Zone / Zone / Read**,
restricted to your zone. Store it on the Pi in a root-owned, mode `0600`
file `/etc/caddy/cloudflare.env`, containing `CLOUDFLARE_API_TOKEN=...`.
Keep the token out of the repository, shell history and chat.

DNS verification allows Caddy to obtain and renew a publicly trusted certificate
without opening public ports. This custom domain does not need Tailscale HTTPS
certificates, `TS_PERMIT_CERT_UID`, or Tailscale Serve.

## Configure the services

Install the planner from the unpacked release:

```bash
sudo ./install.sh --create-database
```

Keep `BIND_ADDR=127.0.0.1:8080` in `/etc/yearly-overview.env`. Add
`ALLOWED_HOSTS=planner.example.com` and restart the planner after changing its settings.
Do not pass `--tailscale-serve`.

Use `sudo systemctl edit caddy` to add the following override. If your Caddy unit
runs Caddy with `--environ`, which logs its environment, remove that flag before
introducing the Cloudflare token. Verify the binary path if using a custom build.

```ini
[Unit]
Wants=tailscaled.service
After=tailscaled.service

[Service]
EnvironmentFile=/etc/caddy/cloudflare.env
ExecStart=
ExecStart=/usr/bin/caddy run --config /etc/caddy/Caddyfile
```

Copy `Caddyfile.yearly-overview` to `/etc/caddy/yearly-overview.caddy` and replace the
hostname and bind address in it. Keep any existing sites intact. Add this import to
`/etc/caddy/Caddyfile`, outside other site blocks:

```caddyfile
import /etc/caddy/yearly-overview.caddy
```

If Caddy already serves other sites on plain `:80`, add `auto_https disable_redirects`
to the global options block at the beginning of `/etc/caddy/Caddyfile` (create the
block if absent):

```caddyfile
{
	auto_https disable_redirects
}
```

This leaves port 80 with the existing sites and avoids creating another
HTTP listener on the tailnet address. Open the planner using its full `https://`
URL. This option disables automatic HTTP redirects for all sites in this Caddy
configuration, so sites relying on them need an explicit `:80` block.

## Validate and activate

Before changing the running service, back up the existing Caddyfile and validate
the complete configuration using the custom Caddy binary. Validation does not
prove that the token can issue a certificate.

```bash
sudo bash -c 'set -a; . /etc/caddy/cloudflare.env; caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile'
```

The first activation requires `systemctl daemon-reload` and a Caddy restart to load
the new binary and environment. That briefly interrupts any other sites Caddy serves.
Later configuration-only changes can use `systemctl reload caddy`.

From another device connected to Tailscale, verify:

```bash
curl --fail https://planner.example.com/api/health
```

Also check the planner UI, any other sites, and that Caddy's port 443 is bound to the
Tailscale address rather than a wildcard address. A client without Tailscale
should not be able to connect to the planner.

References: [Cloudflare module and token permissions](https://github.com/caddy-dns/cloudflare),
[Caddy HTTPS challenges](https://caddyserver.com/docs/automatic-https#dns-challenge).
