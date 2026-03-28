import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { parseConfig } from "./config.js";
import { ProcessManager, type ProcessConfig } from "./process-manager.js";
import { registerHooks } from "./hook-handler.js";

export default definePluginEntry(async (api) => {
  api.log.info("openclaw-gmail-multi: initializing");

  let config;
  try {
    config = parseConfig(api.config);
  } catch (err) {
    api.log.error(`openclaw-gmail-multi: config error: ${err}`);
    return;
  }

  const accountCount = Object.keys(config.accounts).length;
  api.log.info(`openclaw-gmail-multi: ${accountCount} account(s) configured`);

  // Register hook handlers for all accounts
  registerHooks(api, config.accounts);

  // Build process configs
  const gatewayPort = Number(process.env.OPENCLAW_GATEWAY_PORT) || 18789;
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN ?? "";

  const processConfigs: ProcessConfig[] = Object.entries(config.accounts).map(
    ([accountKey, account]) => ({
      accountKey,
      email: account.email,
      port: account.port,
      pubsubPath: account.pubsubPath,
      token: account.token,
      includeBody: account.gog.includeBody,
      maxBytes: account.gog.maxBytes,
      hookUrl: `http://localhost:${gatewayPort}/hooks/gmail-multi/${accountKey}/incoming`,
      hookToken: gatewayToken,
    })
  );

  // Start all gog child processes
  const processManager = new ProcessManager(api.log);
  processManager.startAll(processConfigs);

  // Register shutdown handler
  const shutdown = () => {
    processManager.shutdownAll().catch((err) => {
      api.log.error(`openclaw-gmail-multi: shutdown error: ${err}`);
    });
  };

  if (typeof api.onShutdown === "function") {
    api.onShutdown(shutdown);
  } else {
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }

  api.log.info("openclaw-gmail-multi: ready");
});
