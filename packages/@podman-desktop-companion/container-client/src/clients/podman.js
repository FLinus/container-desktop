const os = require("os");
const fs = require("fs");
const path = require("path");
// vendors
const merge = require("lodash.merge");
// project
const { createLogger } = require("@podman-desktop-companion/logger");
const { exec_launcher } = require("@podman-desktop-companion/executor");
// module
const { findProgram, findProgramVersion } = require("../detector");
const { createApiDriver, getApiConfig, Runner } = require("../api");

const PROGRAM = "podman";

const PODMAN_API_BASE_URL = "http://d/v3.0.0/libpod";
const PODMAN_MACHINE_DEFAULT = "podman-machine-default";

const NATIVE_PODMAN_CLI_PATH = "/usr/bin/podman";
const NATIVE_PODMAN_CLI_VERSION = "4.0.3";
const NATIVE_PODMAN_SOCKET_PATH = "/tmp/podman-desktop-companion-podman-rest-api.sock";

const NATIVE_PODMAN_MACHINE_CLI_VERSION = "4.0.3";
const NATIVE_PODMAN_MACHINE_CLI_PATH = "/usr/bin/podman";

const WINDOWS_PODMAN_NATIVE_CLI_VERSION = "4.0.3-dev";
const WINDOWS_PODMAN_NATIVE_CLI_PATH = "C:\\Program Files\\RedHat\\Podman\\podman.exe";
const WINDOWS_PODMAN_MACHINE_CLI_VERSION = "20.10.14";
const WINDOWS_PODMAN_MACHINE_CLI_PATH = "C:\\Program Files\\PODMAN\\PODMAN\\resources\\bin\\podman.exe";

const MACOS_PODMAN_NATIVE_CLI_VERSION = "4.0.3";
const MACOS_PODMAN_NATIVE_CLI_PATH = "/usr/local/bin/podman";
const MACOS_PODMAN_MACHINE_CLI_VERSION = "4.0.2";
const MACOS_PODMAN_MACHINE_CLI_PATH = "/usr/bin/podman";

const WSL_PODMAN_CLI_PATH = "/usr/bin/podman";
const WSL_PODMAN_CLI_VERSION = "3.4.2";

const LIMA_PODMAN_CLI_PATH = "/usr/bin/podman";
const LIMA_PODMAN_CLI_VERSION = "3.2.1";
const LIMA_PODMAN_INSTANCE = "podman";

const ENGINE_PODMAN_NATIVE = `${PROGRAM}.native`;
const ENGINE_PODMAN_VIRTUALIZED = `${PROGRAM}.virtualized`;
const ENGINE_PODMAN_SUBSYSTEM_WSL = `${PROGRAM}.subsystem.wsl`;
const ENGINE_PODMAN_SUBSYSTEM_LIMA = `${PROGRAM}.subsystem.lima`;

const WSL_PATH = "C:\\Windows\\System32\\wsl.exe";
const WSL_VERSION = "2"; // The cli does not report a version
const WSL_DISTRIBUTION = "Ubuntu-20.04";

const LIMA_PATH = "/usr/local/bin/limactl";
const LIMA_VERSION = "0.9.2";

class BaseClient {
  constructor(userConfiguration, osType) {
    this.userConfiguration = userConfiguration;
    this.osType = osType || os.type();
  }
}

class PodmanClientEngine {
  constructor(userConfiguration, osType) {
    this.userConfiguration = userConfiguration;
    this.settings = undefined;
    this.apiDriver = undefined;
    this.logger = createLogger(`${PROGRAM}.${this.ENGINE || "Engine"}.client`);
    this.osType = osType || os.type();
    this.runner = new Runner(this);
  }
  // Lazy factory
  async getApiDriver() {
    if (!this.apiDriver) {
      const settings = await this.getCurrentSettings();
      const config = await getApiConfig(settings.api.baseURL, settings.api.connectionString);
      this.apiDriver = await createApiDriver(config);
    }
    return this.apiDriver;
  }
  // Settings
  async getExpectedSettings() {
    throw new Error("getExpectedSettings must be implemented");
  }
  // settings = defaults
  async getUserSettings(settings) {
    return {};
  }
  // settings = merge(defaults, user)
  async getDetectedSettings(settings) {
    throw new Error("getDetectedSettings must be implemented");
  }
  async getSettings() {
    if (!this.settings) {
      const expected = await this.getExpectedSettings();
      const detected = await this.getDetectedSettings(expected);
      const user = await this.getUserSettings(merge({}, expected, detected));
      const settings = {
        expected,
        detected,
        user,
        current: merge({}, expected, user, detected)
      };
      this.settings = settings;
    }
    return this.settings;
  }
  async getCurrentSettings() {
    const settings = await this.getSettings();
    return settings.current;
  }
  ///////
  // Api
  async startApi() {
    throw new Error("startApi must be implemented");
  }
  async stopApi() {
    if (!this.runner) {
      return true;
    }
    return await this.runner.stopApi();
  }
  // Availability
  async isProgramAvailable() {
    const result = { success: false, details: undefined };
    const settings = await this.getSettings();
    // Native path to program
    if (!settings.current.program.path) {
      result.details = "Program path is not set";
    }
    if (!fs.existsSync(settings.current.program.path)) {
      result.details = "Program is not accessible";
    }
    return result;
  }
  async isApiAvailable() {
    const result = { success: false, details: undefined };
    const settings = await this.getSettings();
    if (!settings.current.api.baseURL) {
      result.details = "API base URL is not set";
      return result;
    }
    if (!settings.current.api.connectionString) {
      result.details = "API connection string is not set";
      return result;
    }
    // Check unix socket as file
    if (this.osType === "Windows_NT") {
      // TODO: Check named pipe
    } else {
      if (!fs.existsSync(settings.current.api.connectionString)) {
        result.details = "API connection string as unix path is not present";
        return result;
      }
    }
    result.success = true;
    result.details = "API is configured";
    return result;
  }
  async getAvailability() {
    const program = await this.isProgramAvailable();
    const api = await this.isApiRunning();
    const availability = {
      all: program.success && api.success,
      api: api.success,
      program: program.success,
      report: {
        program: program.success ? "Program is available" : program.details,
        api: api.success ? "Api is running" : api.details
      }
    };
    return availability;
  }
  async isApiRunning() {
    // Guard configuration
    const available = await this.isApiAvailable();
    if (!available.success) {
      return available;
    }
    // Test reachability
    const result = {
      success: false,
      details: undefined
    };
    const driver = await this.getApiDriver();
    try {
      const response = await driver.get("/_ping");
      result.success = response?.data === "OK";
      result.details = response?.data || "Api reached";
    } catch (error) {
      result.details = `API is not accessible - ${error.message}`;
    }
    return result;
  }
}

class PodmanClientEngineNative extends PodmanClientEngine {
  ENGINE = ENGINE_PODMAN_NATIVE;
  constructor(userConfiguration, osType) {
    super(userConfiguration, osType);
  }
  // Settings
  async getExpectedSettings() {
    return {
      api: {
        baseURL: PODMAN_API_BASE_URL,
        connectionString: NATIVE_PODMAN_SOCKET_PATH
      },
      program: {
        name: PROGRAM,
        path: NATIVE_PODMAN_CLI_PATH,
        version: NATIVE_PODMAN_CLI_VERSION
      }
    };
  }
  async getUserSettings() {
    return {
      api: {
        baseURL: this.userConfiguration.getKey(`${this.id}.api.baseURL`),
        connectionString: this.userConfiguration.getKey(`${this.id}.api.connectionString`)
      },
      program: {
        path: this.userConfiguration.getKey(`${this.id}.program.path`)
      }
    };
  }
  async getDetectedSettings(settings) {
    let info = {};
    if (fs.existsSync(settings.program.path)) {
      const detectVersion = await findProgramVersion(settings.program.path || PROGRAM);
      info.program = {
        version: detectVersion
      };
    } else {
      info = await findProgram(settings.program.name || PROGRAM);
    }
    return info;
  }
  // Runtime
  async startApi(opts) {
    const running = await this.isApiRunning();
    if (running.success) {
      this.logger.debug("API is already running");
      return true;
    }
    const settings = await this.getCurrentSettings();
    return await this.runner.startApi(opts, {
      path: settings.program.path,
      args: ["system", "service", "--time=0", `unix://${settings.api.connectionString}`, "--log-level=debug"]
    });
  }
}

class PodmanClientEngineControlled extends PodmanClientEngine {
  // Helpers
  async getConnectionString(scope) {
    throw new Error("getConnectionString must be implemented");
  }
  // Settings
  async getExpectedSettings() {
    return {
      api: {
        baseURL: PODMAN_API_BASE_URL,
        connectionString: NATIVE_PODMAN_SOCKET_PATH
      },
      controller: {
        path: "",
        version: "",
        scope: PODMAN_MACHINE_DEFAULT
      },
      program: {
        path: "",
        version: ""
      }
    };
  }
  async getUserSettings() {
    return {
      api: {
        baseURL: this.userConfiguration.getKey(`${this.id}.api.baseURL`),
        connectionString: this.userConfiguration.getKey(`${this.id}.api.connectionString`)
      },
      controller: {
        path: this.userConfiguration.getKey(`${this.id}.controller.path`),
        scope: this.userConfiguration.getKey(`${this.id}.controller.scope`)
      },
      program: {
        path: this.userConfiguration.getKey(`${this.id}.program.path`)
      }
    };
  }
  async getDetectedSettings(settings) {
    let info = {};
    // controller
    if (fs.existsSync(settings.controller.path)) {
      const detectVersion = await findProgramVersion(settings.controller.path || PROGRAM);
      info.controller = {
        version: detectVersion
      };
    } else {
      info = await findProgram(settings.controller.name || PROGRAM);
    }
    return info;
  }
  async getSettings() {
    const settings = await super.getSettings();
    settings.current.api.connectionString = await this.getConnectionString(settings.current.controller.scope);
    return settings;
  }
  // Availability
  async isControllerAvailable() {
    const settings = await this.getSettings();
    let success = false;
    let details;
    if (settings.current.controller.path) {
      if (fs.existsSync(settings.current.controller.path)) {
        success = true;
        details = "Controller is available";
      } else {
        details = `Controller not found in expected ${settings.current.controller.path} location`;
      }
    } else {
      details = "Controller path not set";
    }
    return { success, details };
  }
  async isProgramAvailable() {
    // Controller must be proper
    const controller = await this.isControllerAvailable();
    if (!controller.success) {
      return controller;
    }
    // Perform actual program check
    const result = { success: false, details: undefined };
    const settings = await this.getSettings();
    if (!settings.current.program.path) {
      result.details = "Program path is not set";
    }
    // Controlled path to program
    const check = await this.runScopedCommand("test", ["-f", settings.current.program.path]);
    if (check.success) {
      result.success = true;
      result.details = "Program is available";
    } else {
      result.details = check.stderr;
    }
    return result;
  }
  async getAvailability() {
    const base = await super.getAvailability();
    const controller = await this.isControllerAvailable();
    return {
      ...base,
      all: base.all && base.success,
      controller: controller.success,
      report: {
        ...base.report,
        controller: controller.success ? "Controller is running" : controller.details
      }
    };
  }
  // Executes command inside controller scope
  async runScopedCommand(program, args, opts) {
    throw new Error("runScopedCommand must be implemented");
  }
}

class PodmanClientEngineVirtualized extends PodmanClientEngineControlled {
  ENGINE = ENGINE_PODMAN_VIRTUALIZED;
  // Helpers
  async getConnectionString(scope) {
    let connectionString = NATIVE_PODMAN_SOCKET_PATH;
    if (this.osType === "Windows_NT") {
      connectionString = `//./pipe/${scope}`;
    } else {
      connectionString = path.join(process.env.HOME, ".local/share/containers/podman/machine/", scope, "podman.sock");
    }
    return connectionString;
  }
  // Settings
  async getExpectedSettings() {
    const defaults = await super.getExpectedSettings();
    const connectionString = await this.getConnectionString(PODMAN_MACHINE_DEFAULT);
    let config = {};
    if (this.osType === "Linux") {
      config = {
        controller: {
          path: NATIVE_PODMAN_CLI_PATH,
          version: NATIVE_PODMAN_CLI_VERSION,
          scope: PODMAN_MACHINE_DEFAULT
        },
        program: {
          path: NATIVE_PODMAN_MACHINE_CLI_PATH,
          version: NATIVE_PODMAN_MACHINE_CLI_VERSION
        }
      };
    } else if (this.osType === "Windows_NT") {
      config = {
        controller: {
          path: WINDOWS_PODMAN_NATIVE_CLI_PATH,
          version: WINDOWS_PODMAN_NATIVE_CLI_VERSION,
          scope: PODMAN_MACHINE_DEFAULT
        },
        program: {
          path: WINDOWS_PODMAN_MACHINE_CLI_PATH,
          version: WINDOWS_PODMAN_MACHINE_CLI_VERSION
        }
      };
    } else if (this.osType === "Darwin") {
      config = {
        controller: {
          path: MACOS_PODMAN_NATIVE_CLI_PATH,
          version: MACOS_PODMAN_NATIVE_CLI_VERSION,
          scope: PODMAN_MACHINE_DEFAULT
        },
        program: {
          path: MACOS_PODMAN_MACHINE_CLI_PATH,
          version: MACOS_PODMAN_MACHINE_CLI_VERSION
        }
      };
    }
    return merge({}, defaults, {
      api: {
        baseURL: PODMAN_API_BASE_URL,
        connectionString: connectionString
      },
      ...config
    });
  }
  // Runtime
  async startApi(opts) {
    const running = await this.isApiRunning();
    if (running.success) {
      this.logger.debug("API is already running");
      return true;
    }
    const settings = await this.getCurrentSettings();
    // TODO: Safe to stop first before starting ?
    return await this.runner.startApi(opts, {
      path: settings.controller.path,
      args: ["machine", "start", settings.controller.scope]
    });
  }
  async stopApi(opts) {
    const settings = await this.getCurrentSettings();
    return await this.runner.stopApi(opts, {
      path: settings.controller.path,
      args: ["machine", "stop", settings.controller.scope]
    });
  }
  // Availability
  async isControllerAvailable() {
    const settings = await this.getSettings();
    let flag = settings.current.controller.path.length > 0 && fs.existsSync(settings.current.controller.path);
    let details;
    if (flag) {
      const machines = await this.getMachines();
      const target = machines.find((it) => it.Name === settings.current.controller.scope && it.Running);
      if (target) {
        flag = true;
        details = `${settings.current.controller.scope} is running`;
      } else {
        flag = false;
        details = `Controller ${settings.current.controller.scope} is not running`;
        this.logger.error("Controller is not available - no running machine found");
      }
    }
    return { success: flag, details };
  }
  // Podman machines
  async getMachines(customFormat) {
    let items = [];
    const { controller } = await this.getCurrentSettings();
    const command = ["machine", "list", "--format", customFormat || "json"];
    const result = await exec_launcher(controller.path, command);
    if (!result.success) {
      this.logger.error("Unable to get machines list", result);
      return items;
    }
    try {
      items = result.stdout ? JSON.parse(result.stdout) : items;
    } catch (error) {
      this.logger.error("Unable to decode machines list", error, result);
    }
    return items;
  }

  // Executes command inside controller scope
  async runScopedCommand(program, args, opts) {
    const { controller } = await this.getCurrentSettings();
    const command = ["machine", "ssh", program, ...args];
    const result = await exec_launcher(controller.path, command, opts);
    return result;
  }
}

class PodmanClientEngineSubsystemWSL extends PodmanClientEngineControlled {
  ENGINE = ENGINE_PODMAN_SUBSYSTEM_WSL;
  // Helpers
  async getConnectionString(scope) {
    return `//./pipe/podman-desktop-companion-${PROGRAM}-${scope}`;
  }
  // Settings
  async getExpectedSettings() {
    return {
      api: {
        baseURL: PODMAN_API_BASE_URL,
        connectionString: PODMAN_API_BASE_URL
      },
      controller: {
        path: WSL_PATH,
        version: WSL_VERSION,
        scope: WSL_DISTRIBUTION
      },
      program: {
        name: PROGRAM,
        path: WSL_PODMAN_CLI_PATH,
        version: WSL_PODMAN_CLI_VERSION
      }
    };
  }
  // Runtime
  async startApi() {
    return true;
  }
  async stopApi() {
    return true;
  }
}

class PodmanClientEngineSubsystemLIMA extends PodmanClientEngineControlled {
  ENGINE = ENGINE_PODMAN_SUBSYSTEM_LIMA;
  // Helpers
  async getConnectionString(scope) {
    return path.join(process.env.HOME, ".lima", scope, "sock/podman.sock");
  }
  // Settings
  async getExpectedSettings() {
    return {
      api: {
        baseURL: PODMAN_API_BASE_URL,
        connectionString: PODMAN_API_BASE_URL
      },
      controller: {
        path: LIMA_PATH,
        version: LIMA_VERSION,
        scope: LIMA_PODMAN_INSTANCE
      },
      program: {
        name: PROGRAM,
        path: LIMA_PODMAN_CLI_PATH,
        version: LIMA_PODMAN_CLI_VERSION
      }
    };
  }
  // Runtime
  async startApi(opts) {
    const running = await this.isApiRunning();
    if (running.success) {
      this.logger.debug("API is already running");
      return true;
    }
    const settings = await this.getCurrentSettings();
    // TODO: Safe to stop first before starting ?
    return await this.runner.startApi(opts, {
      path: settings.controller.path,
      args: ["start", settings.controller.scope]
    });
  }
  async stopApi(opts) {
    const settings = await this.getCurrentSettings();
    return await this.runner.stopApi(opts, {
      path: settings.controller.path,
      args: ["stop", settings.controller.scope]
    });
  }
  // Executes command inside controller scope
  async runScopedCommand(program, args, opts) {
    const { controller } = await this.getCurrentSettings();
    const command = ["shell", controller.scope, program, ...args];
    const result = await exec_launcher(controller.path, command, opts);
    return result;
  }
}

class PodmanClient extends BaseClient {
  constructor(userConfiguration, osType) {
    super(userConfiguration, osType);
    this.connectorClientEngineMap = {};
  }

  async detectProgram() {}
  async detectController() {}

  async getEngines() {
    return [
      // PodmanClientEngineNative
      // PodmanClientEngineVirtualized
      // PodmanClientEngineSubsystemWSL
      PodmanClientEngineSubsystemLIMA
    ].map((PodmanClientEngine) => {
      const engine = new PodmanClientEngine(this.userConfiguration, this.osType);
      return engine;
    });
  }

  async getConnectors() {
    const engines = await this.getEngines();
    const connectors = await Promise.all(
      engines.map(async (client) => {
        const id = `engine.default.${client.ENGINE}`;
        if (!this.connectorClientEngineMap[id]) {
          const settings = await client.getSettings();
          const connector = {
            id,
            engine: client.ENGINE,
            availability: await client.getAvailability(),
            settings
          };
          this.connectorClientEngineMap[id] = {
            client,
            connector
          };
        }
        return this.connectorClientEngineMap[id].connector;
      })
    );
    return connectors;
  }

  async getEngineClientById(id) {
    await this.getConnectors();
    return this.connectorClientEngineMap[id].client;
  }
}

module.exports = {
  PodmanClient
};
