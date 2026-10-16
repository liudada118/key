import type { UsageEvent } from "../../../server/usageSchema";
import { SENSOR_LABELS } from "@shared/licenseScopes";

export const usageFeatureLabels: Record<string, string> = {
  application: "软件运行", system_navigation: "展示系统访问", monitoring: "传感器监测", collection: "数据采集", export: "CSV 导出", playback: "历史回放",
  connection: "设备连接", halow_listener: "HaLow 接收服务", algorithms: "算法运行", agent: "Agent 任务", agent_tool: "Agent 工具",
  workspace: "展示系统配置", workspace_copy: "系统复制", workspace_bindings: "算法绑定", agent_settings: "Agent 配置与应用",
  foreground: "窗口前台时长", background: "窗口后台时长", interaction: "交互活跃窗口", renderer_long_task: "页面长任务",
  main_event_loop: "主进程响应延迟", main_memory: "主进程内存", sensor_frame_gap: "数据流间隔",
  sensor_ruler: "传感点量尺", region_selection: "区域框选", diagnostics: "错误诊断",
  data_adjustment: "数据调节", view_tools: "视角工具", workspace_tools: "工具箱", calibration_zero: "归零与恢复",
  tuning_gaussian: "高斯平滑", tuning_point_size: "点大小", tuning_rotation_speed: "旋转速度", tuning_color_range: "颜色范围",
  tuning_filter: "数据过滤", tuning_height: "高度", tuning_consistency: "一致性", tuning_initial_value: "初始值", tuning_model_transform: "模型位置与旋转",
  display_switch: "可视化切换", algorithm_binding: "系统算法绑定", agent_proposal: "Agent 方案", agent_results: "Agent 成果",
  sensor_first_frame: "设备首帧", sensor_stream_gap: "数据中断与恢复", sensor_frames: "设备帧接收摘要",
  license_activation: "密钥激活", license_refresh: "密钥刷新", license_authorization: "电脑授权核验",
  software_update: "安装包更新", webpage_update: "网页更新", playback_load: "回放加载", playback_control: "回放操作",
  collection_save: "采集保存", system_submission: "提交公司系统", system_sync: "公司系统同步", system_install: "公司系统安装",
};

const actionLabels: Record<string, string> = {
  adjust: "完成调节", reset: "恢复默认", restore_default: "恢复默认", zero: "归零", restore: "恢复", open: "打开", configure: "配置", stop: "停止",
  enable: "启用", disable: "停用", bind: "绑定", automatic_start: "自动启动",
  runtime_running: "运行中", runtime_waiting: "等待数据", runtime_paused: "数据暂时中断", runtime_error: "运行异常", runtime_stopped: "已停止",
  first_frame: "收到首帧", first_frame_timeout: "首帧等待超时", first_frame_recovered: "超时后收到首帧",
  stream_paused: "数据暂时中断", stream_recovered: "数据恢复", receive_summary: "接收统计",
  activate: "启用", refresh: "刷新", verify: "核验", check: "检查更新", available: "有可用更新", current: "已是最新版本",
  check_current: "已是最新版本", update_available: "有可用更新", download_ready: "下载就绪", installer_handoff: "交给安装程序",
  installation_verified: "新版本启动已核验", installation_not_confirmed: "尚未确认新版本启动", update_failed: "更新失败",
  rollback: "启动失败后回退", cache_rejected: "缓存校验失败", select_renderer: "切换渲染器", select_profile: "切换展示方案", select_mode: "切换展示模式",
  load: "加载", play: "播放", pause: "暂停", speed: "调整倍速", seek: "跳转", threshold: "调整回放阈值", control: "控制",
  enter_system: "进入成果系统", locate_system: "定位成果系统", activate_algorithm: "使用成果算法", prepare_binding: "准备绑定算法",
  delete_record: "删除记录", switch_mode: "切换实时与回放", storage_error: "保存异常", save: "保存", duplicate: "复制",
  create_native: "创建原生副本", edit_native: "编辑原生副本", edit_display: "编辑展示", delete: "删除系统", submit: "提交审核", sync: "同步", install: "安装系统",
};
const proposalLabels: Record<string, string> = { create_system: "创建系统", duplicate_system: "复制系统", builtin_system: "原生副本",
  update_display: "展示配置", update_native_system: "原生系统配置", update_manifest_algorithms: "算法绑定", delete_native_system: "删除系统",
  connect_device: "设备连接", algorithm_package: "分类算法" };

/** Translate finite product actions without treating future identifiers as missing records. */
export function usageActionLabel(value: string) {
  if (actionLabels[value]) return actionLabels[value];
  const proposal = /^(generated|view|apply|restore)_(.+)$/.exec(value);
  if (proposal && proposalLabels[proposal[2]]) return `${({ generated: "生成", view: "查看", apply: "应用", restore: "恢复" } as Record<string, string>)[proposal[1]]} · ${proposalLabels[proposal[2]]}`;
  return value;
}

const errorLabels: Record<string, string> = {
  DEVICE_LIMIT_REACHED: "已达到密钥的电脑数量上限", DEVICE_LEASE_EXPIRED: "离线电脑授权凭证已到期",
  DEVICE_LEASE_INVALID: "电脑授权凭证校验失败", LICENSE_ONLINE_ACTIVATION_REQUIRED: "需要首次联网验证",
  LICENSE_EXPIRED: "密钥已到期", LICENSE_INACTIVE: "密钥已停用", LICENSE_CUSTOMER_INACTIVE: "关联客户已停用",
  ALGORITHM_BIND_START_FAILED: "系统算法自动启动失败", ALGORITHM_INPUT_OR_RUNTIME_INVALID: "算法输入或运行异常",
  ALGORITHM_RUNTIME_FAILED: "算法运行失败", FRONTEND_CACHE_INVALID: "网页缓存校验失败",
  FRONTEND_BOOT_FAILED: "新版网页启动失败", SOFTWARE_UPDATE_FAILED: "安装包更新失败",
  SYSTEM_INSTALL_FAILED: "公司系统安装失败", SYSTEM_SUBMISSION_TIMEOUT: "提交审核超时", OPERATION_FAILED: "操作未完成",
};

/** Present known failure reasons while retaining diagnostic codes from future clients. */
export function usageErrorLabel(value: string) { return errorLabels[value] || value; }

/** Translate known feature groups while preserving future client identifiers. */
export function usageFeatureLabel(value?: string | null) { return value ? usageFeatureLabels[value] || value : "软件"; }

/** Custom identifiers distinguish systems within one installation without publishing customer names. */
export function usageSystemLabel(value: string) {
  if (/^(custom|copy)\.[a-f0-9]{16}$/.test(value)) return `${value.startsWith("copy.") ? "系统副本" : "自定义系统"} · ${value.split(".")[1]}`;
  return value === "custom" ? "自定义系统（旧版未区分）" : value === "copy" ? "系统副本（旧版未区分）" : SENSOR_LABELS[value] || value;
}

type FeatureMetric = { featureId: string; category: string; uses: number; successes: number; entries?: number;
  observedEvents: number; monitoringMs: number; monitoringSamples: number; collectionMs: number; collectionSamples: number };

/** Product metrics use domain evidence, never the sum of exposure/attempt/result event counts. */
export function usageFeaturePrimaryMetric(row: FeatureMetric) {
  if (row.category === "diagnostic") return { label: "运行记录", value: `${row.observedEvents} 条` };
  if (row.featureId === "monitoring") return { label: "监测时长", value: row.monitoringSamples ? usageDurationText(row.monitoringMs) : "未上报时长" };
  if (row.featureId === "collection") return { label: "成功采集", value: `${row.successes} 次` };
  if (row.featureId === "export") return { label: "成功导出", value: `${row.successes} 次` };
  if (row.featureId === "playback") return { label: "开始回放", value: `${row.uses} 次` };
  if (row.featureId === "system_navigation") return { label: "系统访问记录", value: `${row.entries ?? 0} 条` };
  return { label: "已确认使用", value: `${row.uses} 次` };
}

export const usageEventLabels: Record<UsageEvent["eventName"], string> = {
  app_session_started: "软件启动", feature_exposed: "功能入口展示", feature_attempted: "功能操作发起",
  system_entered: "进入系统", device_connection_result: "设备连接结果", monitoring_usage_summary: "监测时长汇总",
  collection_started: "开始采集", collection_finished: "采集结束", export_result: "导出结果", playback_started: "开始回放",
  algorithm_result: "算法结果", analysis_tool_used: "分析工具操作", custom_system_saved: "系统配置操作结果",
  agent_task_result: "Agent 操作结果", usage_session_summary: "运行与使用摘要", error_reported: "错误上报",
};

/** Match the UTC date buckets used by the API instead of mixing them with browser-local timestamps. */
export function usageTime(value: string | number | Date | null | undefined) {
  return value == null ? "未观测到" : new Date(value).toLocaleString("zh-CN", { timeZone: "UTC", hour12: false });
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
  if (properties.featureId === "sensor_frames") return `收到 ${count} 帧 · 观测 ${(duration / 1000).toFixed(1)} 秒${duration > 0 ? ` · 平均 ${(count * 1000 / duration).toFixed(1)} 帧/秒` : ""}（不等于丢帧统计）`;
  if (properties.featureId === "collection" && properties.count !== undefined) return `已保存 ${count} 条帧记录 · 采集 ${(duration / 1000).toFixed(1)} 秒`;
  if (properties.featureId === "webpage_update" && properties.action === "download_ready") return `实际下载 ${(count / 1048576).toFixed(2)} MiB · 耗时 ${(duration / 1000).toFixed(1)} 秒`;
  return [properties.durationMs !== undefined ? `耗时/时长：${(duration / 1000).toFixed(1)} 秒` : null,
    properties.count !== undefined ? `${properties.format === "csv" ? "文件数" : "数量"}：${count}` : null].filter(Boolean).join(" · ");
}
