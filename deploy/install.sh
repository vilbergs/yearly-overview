#!/usr/bin/env bash
# Installs or upgrades Yearly Overview on this machine (e.g. a Raspberry Pi).
# Run from the unpacked release directory:
#   sudo ./install.sh [--create-database] [--tailscale-serve]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX=/opt/yearly-overview
ENV_FILE=/etc/yearly-overview.env
UNITS=/etc/systemd/system
TAILSCALE_SERVE=false
CREATE_DATABASE=false
DB_NAME=yearly_overview
DB_ROLE=yearly_overview

for arg in "$@"; do
	case "$arg" in
	--tailscale-serve) TAILSCALE_SERVE=true ;;
	--create-database) CREATE_DATABASE=true ;;
	-h | --help)
		echo "Usage: sudo $0 [--create-database] [--tailscale-serve]"
		echo "  --create-database  create the PostgreSQL role and database on this machine"
		echo "                     and write the connection into $ENV_FILE"
		echo "  --tailscale-serve  publish the app on your tailnet over HTTPS (port 443)"
		exit 0
		;;
	*)
		echo "Unknown option: $arg" >&2
		exit 1
		;;
	esac
done

if [[ $EUID -ne 0 ]]; then
	echo "Run this with sudo." >&2
	exit 1
fi

binary_arch="$(cat "$HERE/ARCH")"
case "$(uname -m)" in
aarch64 | arm64) machine_arch=aarch64 ;;
armv7l | armv8l) machine_arch=armv7 ;;
*) machine_arch="$(uname -m)" ;;
esac
if [[ "$binary_arch" != "$machine_arch" ]]; then
	echo "This package is for $binary_arch, but this machine is $(uname -m)." >&2
	exit 1
fi

# Fail before changing an installation when dependencies or package files are missing.
for command in curl pg_dump python3 systemctl; do
	command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done
for file in yearly-overview-server backup.sh pg-dump.py yearly-overview.env yearly-overview.service yearly-overview-backup.service yearly-overview-backup.timer build/index.html; do
	[[ -f "$HERE/$file" ]] || { echo "Missing package file: $file" >&2; exit 1; }
done
if $CREATE_DATABASE; then
	command -v psql >/dev/null && id postgres >/dev/null 2>&1 || { echo "Install PostgreSQL first." >&2; exit 1; }
	(cd / && runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -qtA -c 'SELECT 1') >/dev/null
fi

if [[ -f "$ENV_FILE" ]]; then
	echo "Keeping existing $ENV_FILE"
	chmod 0600 "$ENV_FILE"
else
	# It holds the database password.
	install -m 0600 "$HERE/yearly-overview.env" "$ENV_FILE"
	echo "Created $ENV_FILE"
fi

psql_admin() {
	(cd / && runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -qtA "$@")
}

if $CREATE_DATABASE; then
	if ! command -v psql >/dev/null || ! id postgres >/dev/null 2>&1; then
		echo "PostgreSQL doesn't seem to be installed here (no psql or postgres user)." >&2
		exit 1
	fi
	if grep -q '^DATABASE_URL=.*CHANGE_ME' "$ENV_FILE"; then
		password="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
		if [[ "$(psql_admin -c "SELECT 1 FROM pg_roles WHERE rolname = '$DB_ROLE'")" == 1 ]]; then
			echo "Refusing to change the password of existing role $DB_ROLE. Configure DATABASE_URL explicitly." >&2
			exit 1
		else
			echo "Creating role $DB_ROLE"
			psql_admin <<SQL
CREATE ROLE $DB_ROLE WITH LOGIN PASSWORD '$password';
SQL
		fi
		sed -i -f /dev/stdin "$ENV_FILE" <<SED
s|^DATABASE_URL=.*|DATABASE_URL=postgres://$DB_ROLE:$password@localhost/$DB_NAME|
SED
	else
		echo "Keeping the DATABASE_URL in $ENV_FILE"
	fi
	if [[ "$(psql_admin -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")" != 1 ]]; then
		echo "Creating database $DB_NAME"
		psql_admin -c "CREATE DATABASE $DB_NAME OWNER $DB_ROLE"
	elif [[ "$(psql_admin -c "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '$DB_NAME'")" != "$DB_ROLE" ]]; then
		echo "Refusing to change ownership of existing database $DB_NAME." >&2
		exit 1
	else
		echo "Database $DB_NAME already exists"
	fi
fi

if grep -q '^DATABASE_URL=.*CHANGE_ME' "$ENV_FILE"; then
	echo >&2
	echo "Set DATABASE_URL in $ENV_FILE to your PostgreSQL database, or run again with" >&2
	echo "--create-database to have one created here. Then run this again." >&2
	exit 1
fi

# Migrations run on startup, so preserve the database before upgrading a live service.
if systemctl is-active --quiet yearly-overview.service; then
	echo "Backing up the existing database before upgrading"
	systemctl start yearly-overview-backup.service
fi

echo "Installing to $PREFIX"
install -d -m 0755 "$PREFIX"
install -m 0755 "$HERE/yearly-overview-server" "$PREFIX/yearly-overview-server.new"
if [[ -f "$PREFIX/yearly-overview-server" ]]; then
	cp -p "$PREFIX/yearly-overview-server" "$PREFIX/yearly-overview-server.old"
fi
mv "$PREFIX/yearly-overview-server.new" "$PREFIX/yearly-overview-server"
install -m 0755 "$HERE/backup.sh" "$PREFIX/backup.sh"
install -m 0644 "$HERE/pg-dump.py" "$PREFIX/pg-dump.py"
# Stage the complete frontend before moving it into place.
rm -rf "$PREFIX/build.new"
cp -r "$HERE/build" "$PREFIX/build.new"
chmod -R u=rwX,go=rX "$PREFIX/build.new"
rm -rf "$PREFIX/build.old"
[[ -d "$PREFIX/build" ]] && mv "$PREFIX/build" "$PREFIX/build.old"
mv "$PREFIX/build.new" "$PREFIX/build"

install -m 0644 "$HERE/yearly-overview.service" "$UNITS/yearly-overview.service"
install -m 0644 "$HERE/yearly-overview-backup.service" "$UNITS/yearly-overview-backup.service"
install -m 0644 "$HERE/yearly-overview-backup.timer" "$UNITS/yearly-overview-backup.timer"
systemctl daemon-reload
systemctl enable yearly-overview.service >/dev/null
systemctl enable --now yearly-overview-backup.timer >/dev/null
systemctl restart yearly-overview.service

bind="$(sed -n 's/^BIND_ADDR=//p' "$ENV_FILE" | tail -n1)"
port="${bind##*:}"
port="${port:-8080}"
echo -n "Waiting for the server"
for _ in $(seq 1 30); do
	if curl --connect-timeout 2 --max-time 5 -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
		echo " - running."
		break
	fi
	echo -n "."
	sleep 1
done
if ! curl --connect-timeout 2 --max-time 5 -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
	echo
	echo "The server didn't start. See: journalctl -u yearly-overview -n 50" >&2
	echo "(A wrong DATABASE_URL in $ENV_FILE is the usual cause.)" >&2
	echo "Previous binary/frontend, when present, are retained as *.old in $PREFIX." >&2
	exit 1
fi

rm -f "$PREFIX/yearly-overview-server.old"
rm -rf "$PREFIX/build.old"

if $TAILSCALE_SERVE; then
	if ! command -v tailscale >/dev/null; then
		echo "tailscale is not installed; skipping --tailscale-serve." >&2
	else
		tailscale serve --bg --https=443 "http://127.0.0.1:$port"
		echo
		tailscale serve status
	fi
else
	echo
	echo "For private HTTPS through Caddy, follow caddy.md in the release directory."
	echo "Alternatively, to publish with Tailscale Serve:"
	echo "  sudo tailscale serve --bg --https=443 http://127.0.0.1:$port"
fi
