import cron, { type ScheduledTask } from "node-cron";
import { config } from "./config.js";
import { logJob } from "./db/index.js";
import { runCollectJob } from "./collectors/index.js";
import { runProcessJob } from "./ai/jobs.js";
import { runPublishJob } from "./publishers/index.js";

let running = {
  collect: false,
  process: false,
  publish: false,
};

const tasks: { collect?: ScheduledTask; process?: ScheduledTask; publish?: ScheduledTask } = {};

async function wrap(name: keyof typeof running, fn: () => Promise<unknown>) {
  if (!config.AUTO_RUN) {
    return;
  }
  if (running[name]) {
    logJob(name, "上一轮仍在执行，跳过", "warn");
    return;
  }
  running[name] = true;
  try {
    logJob(name, "定时任务开始");
    await fn();
    logJob(name, "定时任务结束");
  } catch (err) {
    logJob(name, `定时任务异常: ${(err as Error).message}`, "error");
  } finally {
    running[name] = false;
  }
}

function stopAll() {
  for (const t of Object.values(tasks)) {
    try {
      t?.stop();
    } catch {
      // ignore
    }
  }
  tasks.collect = undefined;
  tasks.process = undefined;
  tasks.publish = undefined;
}

export function startScheduler() {
  stopAll();

  if (!cron.validate(config.CRON_COLLECT)) {
    logJob("scheduler", `无效 CRON_COLLECT: ${config.CRON_COLLECT}`, "error");
  } else {
    tasks.collect = cron.schedule(config.CRON_COLLECT, () => {
      void wrap("collect", runCollectJob);
    });
  }

  if (!cron.validate(config.CRON_PROCESS)) {
    logJob("scheduler", `无效 CRON_PROCESS: ${config.CRON_PROCESS}`, "error");
  } else {
    tasks.process = cron.schedule(config.CRON_PROCESS, () => {
      void wrap("process", () => runProcessJob(5));
    });
  }

  if (!cron.validate(config.CRON_PUBLISH)) {
    logJob("scheduler", `无效 CRON_PUBLISH: ${config.CRON_PUBLISH}`, "error");
  } else {
    tasks.publish = cron.schedule(config.CRON_PUBLISH, () => {
      void wrap("publish", () => runPublishJob(5));
    });
  }

  logJob(
    "scheduler",
    `调度已${config.AUTO_RUN ? "启用" : "暂停(仅保留计划)"} | 采集=${config.CRON_COLLECT} 加工=${config.CRON_PROCESS} 发布=${config.CRON_PUBLISH}`
  );
}

export function reloadScheduler() {
  startScheduler();
}

export function schedulerStatus() {
  return {
    autoRun: config.AUTO_RUN,
    running: { ...running },
    cron: {
      collect: config.CRON_COLLECT,
      process: config.CRON_PROCESS,
      publish: config.CRON_PUBLISH,
    },
  };
}

export { wrap as runGuarded };
