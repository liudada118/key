import type { UsageEvent } from "../../../server/usageSchema";

export const usageFeatureLabels: Record<string, string> = {
  application: "软件运行", monitoring: "传感器监测", collection: "数据采集", export: "CSV 导出", playback: "历史回放",
  connection: "设备连接", halow_listener: "HaLow 接收服务", algorithms: "算法运行", agent: "Agent 任务", agent_tool: "Agent 工具",
  workspace: "展示系统配置", workspace_copy: "系统复制", workspace_bindings: "算法绑定", agent_settings: "Agent 配置与应用",
  foreground: "窗口前台时长", background: "窗口后台时长", interaction: "交互活跃窗口", renderer_long_task: "页面长任务",
  main_event_loop: "主进程响应延迟", main_memory: "主进程内存", sensor_frame_gap: "数据流间隔",
  sensor_ruler: "传感点量尺", region_selection: "区域框选", diagnostics: "错误诊断",
};

/** Translate known feature groups while preserving future client identifiers. */
export function usageFeatureLabel(value?: string | null) { return value ? usageFeatureLabels[value] || value : "软件"; }

/** Custom identifiers distinguish systems within one installation without publishing customer names. */
export function usageSystemLabel(value: string) {
  if (/^(custom|copy)\.[a-f0-9]{16}$/.test(value)) return `${value.startsWith("copy.") ? "系统副本" : "自定义系统"} · ${value.split(".")[1]}`;
  return value === "custom" ? "自定义系统（旧版未区分）" : value === "copy" ? "系统副本（旧版未区分）" : value;
}

/** Keep short observed durations visible instead of rounding them to zero hours. */
export function usageDurationText(value: number) {
  if (value > 0 && value < 1000) return "不足 1 秒";
  if (value < 60000) return `${Math.round(value / 1000)} 秒`;
  if (value < 3600000) return `${(value / 60000).toFixed(1)} 分钟`;
  return `${(value / 3600000).toFixed(1)} 小时`;
}

/** Each numeric field has an explicit unit and meaning; memory is never formatted as a time. */
export function usageMetricText(properties: UsageEvent["properties"]) {
  const duration = properties.durationMs ?? 0, count = properties.count ?? 0;
  if (properties.featureId === "main_memory") return `主进程峰值驻留内存：${count} MiB`;
  if (properties.featureId === "main_event_loop") return `窗口最大延迟：${Math.round(duration)} ms · ≥250 ms 的延迟采样：${count} 次`;
  if (properties.featureId === "renderer_long_task") return `≥50 ms 的页面长任务：${count} 次 · 累计 ${(duration / 1000).toFixed(1)} 秒`;
  if (properties.featureId === "sensor_frame_gap") return `大于 2 秒的数据流间隔：${count} 次 · 最大 ${(duration / 1000).toFixed(1)} 秒（不等于丢帧数）`;
  return [properties.durationMs !== undefined ? `耗时/时长：${(duration / 1000).toFixed(1)} 秒` : null,
    properties.count !== undefined ? `${properties.format === "csv" ? "文件数" : "数量"}：${count}` : null].filter(Boolean).join(" · ");
}
