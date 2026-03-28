import { spawn, ChildProcess } from "node:child_process";

export interface ProcessConfig {
  accountKey: string;
  email: string;
  port: number;
  pubsubPath: string;
  token: string;
  includeBody: boolean;
  maxBytes: number;
  hookUrl: string;
  hookToken: string;
}

interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export class ProcessManager {
  private processes: Map<string, ChildProcess> = new Map();
  private backoff: Map<string, number> = new Map();
  private healthTimers: Map<string, NodeJS.Timeout> = new Map();
  private restartTimers: Map<string, NodeJS.Timeout> = new Map();
  private configs: Map<string, ProcessConfig> = new Map();
  private shuttingDown = false;
  private log: Logger;

  constructor(log: Logger) {
    this.log = log;
  }

  startAll(configs: ProcessConfig[]): void {
    for (const config of configs) {
      this.configs.set(config.accountKey, config);
      this.startOne(config);
    }
  }

  private startOne(config: ProcessConfig): void {
    const args = [
      "gmail", "watch", "serve",
      "--account", config.email,
      "--port", String(config.port),
      "--path", config.pubsubPath,
      "--token", config.token,
      "--max-bytes", String(config.maxBytes),
      "--hook-url", config.hookUrl,
      "--hook-token", config.hookToken,
      "--bind", "0.0.0.0",
      "--no-input",
    ];

    if (config.includeBody) {
      args.push("--include-body");
    }

    const cmd = `gog ${args.join(" ")}`;
    this.log.info(`[${config.accountKey}] Spawning: ${cmd}`);

    let child: ChildProcess;
    try {
      child = spawn("gog", args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      this.log.error(`[${config.accountKey}] Failed to spawn gog: ${err}`);
      return;
    }

    this.processes.set(config.accountKey, child);

    child.stdout?.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n").filter(Boolean)) {
        this.log.info(`[${config.accountKey}] ${line}`);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n").filter(Boolean)) {
        this.log.error(`[${config.accountKey}] ${line}`);
      }
    });

    child.on("error", (err) => {
      this.log.error(`[${config.accountKey}] Process error: ${err.message}`);
    });

    child.on("exit", (code) => {
      this.handleExit(config.accountKey, code);
    });

    // After 5 minutes of healthy running, reset backoff
    const healthTimer = setTimeout(() => {
      this.backoff.set(config.accountKey, 0);
    }, 5 * 60 * 1000);
    this.healthTimers.set(config.accountKey, healthTimer);
  }

  private handleExit(accountKey: string, code: number | null): void {
    this.processes.delete(accountKey);

    const healthTimer = this.healthTimers.get(accountKey);
    if (healthTimer) {
      clearTimeout(healthTimer);
      this.healthTimers.delete(accountKey);
    }

    if (this.shuttingDown) {
      return;
    }

    this.log.error(`[${accountKey}] Process exited with code ${code}`);

    const attempts = this.backoff.get(accountKey) ?? 0;
    const delay = Math.min(Math.pow(2, attempts) * 1000, 60000);
    this.backoff.set(accountKey, attempts + 1);

    this.log.info(`[${accountKey}] Restarting in ${delay}ms (attempt ${attempts + 1})`);

    const config = this.configs.get(accountKey);
    if (!config) return;

    const restartTimer = setTimeout(() => {
      this.restartTimers.delete(accountKey);
      this.startOne(config);
    }, delay);
    this.restartTimers.set(accountKey, restartTimer);
  }

  async shutdownAll(): Promise<void> {
    this.shuttingDown = true;

    // Clear all timers
    for (const timer of this.healthTimers.values()) clearTimeout(timer);
    this.healthTimers.clear();
    for (const timer of this.restartTimers.values()) clearTimeout(timer);
    this.restartTimers.clear();

    const entries = [...this.processes.entries()];
    if (entries.length === 0) return;

    // SIGTERM all
    for (const [key, child] of entries) {
      this.log.info(`[${key}] Sending SIGTERM`);
      child.kill("SIGTERM");
    }

    // Wait up to 5 seconds for clean exit
    await Promise.race([
      Promise.all(
        entries.map(
          ([, child]) =>
            new Promise<void>((resolve) => {
              if (child.exitCode !== null) {
                resolve();
                return;
              }
              child.on("exit", () => resolve());
            })
        )
      ),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);

    // SIGKILL any remaining
    for (const [key, child] of this.processes.entries()) {
      if (child.exitCode === null) {
        this.log.info(`[${key}] Sending SIGKILL`);
        child.kill("SIGKILL");
      }
    }

    this.processes.clear();
  }
}
