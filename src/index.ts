import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { parseConfig } from "./config.js";
import { ProcessManager, type ProcessConfig } from "./process-manager.js";

export default definePluginEntry({
  id: "openclaw-gmail-multi",
  name: "Gmail Multi-Account",
  description: "Multi-account Gmail integration with prompt-driven pipelines",
  register(api) {
    let config;
    try {
      config = parseConfig(api.config);
    } catch (err) {
      api.logger.error(`openclaw-gmail-multi: config error: ${err}`);
      return;
    }

    const accountCount = Object.keys(config.accounts).length;
    api.logger.info(`openclaw-gmail-multi: ${accountCount} account(s) configured`);

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
        hookUrl: `http://localhost:${gatewayPort}/hooks/gmail-multi-${accountKey}`,
        hookToken: gatewayToken,
      })
    );

    // Start all gog child processes
    const processManager = new ProcessManager(api.logger);
    processManager.startAll(processConfigs);

    // Register shutdown handler
    process.on("SIGTERM", () => {
      processManager.shutdownAll().catch((err) => {
        api.logger.error(`openclaw-gmail-multi: shutdown error: ${err}`);
      });
    });

    api.logger.info("openclaw-gmail-multi: ready");
  },
});
