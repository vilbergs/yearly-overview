use std::{env, net::SocketAddr, path::PathBuf};

use anyhow::Context;

#[derive(Clone, Debug)]
pub struct Config {
    pub bind_addr: SocketAddr,
    pub database_url: String,
    /// The built frontend (`npm run build` output). Not served when missing.
    pub static_dir: Option<PathBuf>,
    /// When non-empty, requests whose `Host` isn't listed are refused. There is no login, so
    /// this guards against DNS rebinding when the port is reachable from other machines.
    pub allowed_hosts: Vec<String>,
}

fn var(name: &str) -> Option<String> {
    env::var(name).ok().filter(|value| !value.trim().is_empty())
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let port: u16 = var("PORT")
            .map(|port| port.parse())
            .transpose()
            .context("PORT must be a number")?
            .unwrap_or(8080);

        let bind_addr = var("BIND_ADDR")
            // Local only by default; `tailscale serve` (or another proxy) publishes it.
            .unwrap_or_else(|| format!("127.0.0.1:{port}"))
            .parse()
            .context("BIND_ADDR must look like 0.0.0.0:8080")?;

        let static_dir = var("STATIC_DIR")
            .map(PathBuf::from)
            .or_else(|| Some(PathBuf::from("build")))
            .filter(|dir| dir.join("index.html").is_file());

        Ok(Self {
            bind_addr,
            database_url: var("DATABASE_URL").context(
                "DATABASE_URL is required, e.g. postgres://yearly_overview:PASSWORD@localhost/yearly_overview",
            )?,
            static_dir,
            allowed_hosts: var("ALLOWED_HOSTS")
                .map(|hosts| {
                    hosts
                        .split(',')
                        .map(|host| host.trim().to_ascii_lowercase())
                        .filter(|host| !host.is_empty())
                        .collect()
                })
                .unwrap_or_default(),
        })
    }
}
