/**
 * SerialMacService - 串口设备自动识别与 MAC 地址读取
 *
 * 工作流程（按文档协议）：
 * 1. 用户选择串口
 * 2. 自动波特率探测：依次尝试候选波特率，检测分隔符 AA 55 03 99
 * 3. 根据匹配的波特率映射设备大类（手套/坐垫/脚垫）
 * 4. 对所有设备尝试发送 AT 指令获取 MAC 地址，最长1分钟超时
 *
 * 波特率 → 设备映射：
 *   921600  → hand（手套）
 *   1000000 → sit（坐垫）
 *   3000000 → foot（脚垫）
 */

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'detecting'
  | 'connected'
  | 'reading'
  | 'error';

export type DeviceCategory = 'hand' | 'sit' | 'foot' | 'unknown';

export interface DetectResult {
  baudRate: number;
  deviceCategory: DeviceCategory;
  deviceLabel: string;
}

export interface MacResult {
  uniqueId: string;
  version: string;
  port: string;
  baudRate: number;
  deviceCategory: DeviceCategory;
  deviceLabel: string;
  timestamp: number;
}

export interface LogEntry {
  message: string;
  type: 'info' | 'error' | 'data' | 'success' | 'warning';
  timestamp: number;
}

type LogCallback = (entry: LogEntry) => void;
type StatusCallback = (status: ConnectionStatus) => void;
type MacCallback = (result: MacResult) => void;
type DetectCallback = (result: DetectResult) => void;

// AT 指令: AT+NAME=ESP32\r\n
const AT_COMMAND = new Uint8Array([
  0x41, 0x54, 0x2b, 0x4e, 0x41, 0x4d, 0x45, 0x3d, 0x45, 0x53, 0x50, 0x33,
  0x32, 0x0d, 0x0a,
]);

// 帧分隔符 AA 55 03 99
const FRAME_DELIMITER = [0xaa, 0x55, 0x03, 0x99];

// 默认波特率 → 设备大类映射
const DEFAULT_BAUD_DEVICE_MAP: Record<number, { category: DeviceCategory; label: string }> = {
  921600: { category: 'hand', label: '手套' },
  1000000: { category: 'sit', label: '坐垫' },
  3000000: { category: 'foot', label: '脚垫' },
};

// 默认候选波特率（探测顺序）
const DEFAULT_BAUD_CANDIDATES = [921600, 1000000, 3000000];

// 波特率探测超时（毫秒）
const DETECT_TIMEOUT = 800;

// MAC 读取总超时（毫秒）= 1 分钟
const MAC_READ_TIMEOUT = 60000;

// AT 指令发送间隔（毫秒）
const AT_SEND_INTERVAL = 300;

// 导出供前端使用
export const BAUD_RATES = [
  9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1000000, 1500000,
  2000000, 3000000,
];

export const DEFAULT_BAUD_RATE = 3000000;

class SerialMacService {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private isConnected = false;
  private buffer = '';
  private rawBuffer = new Uint8Array(0);
  private atTimer: ReturnType<typeof setInterval> | null = null;
  private macTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private macReady = false;
  private currentBaudRate = DEFAULT_BAUD_RATE;
  private currentDeviceCategory: DeviceCategory = 'unknown';
  private currentDeviceLabel = '未知';
  private sendCount = 0;
  private readLoopActive = false;
  private abortDetect = false;

  // 可配置的候选波特率列表
  private _baudCandidates: number[] = [...DEFAULT_BAUD_CANDIDATES];

  // 可配置的波特率 → 设备映射
  private _baudDeviceMap: Record<number, { category: DeviceCategory; label: string }> = {
    ...DEFAULT_BAUD_DEVICE_MAP,
  };

  // Callbacks
  private onLogCallback: LogCallback | null = null;
  private onStatusCallback: StatusCallback | null = null;
  private onMacCallback: MacCallback | null = null;
  private onDetectCallback: DetectCallback | null = null;

  get connected() {
    return this.isConnected;
  }

  get baudRate() {
    return this.currentBaudRate;
  }

  get deviceCategory() {
    return this.currentDeviceCategory;
  }

  get deviceLabel() {
    return this.currentDeviceLabel;
  }

  get baudCandidates() {
    return [...this._baudCandidates];
  }

  get baudDeviceMap() {
    return { ...this._baudDeviceMap };
  }

  static isSupported(): boolean {
    return 'serial' in navigator;
  }

  // --- 配置方法 ---

  /** 设置候选波特率列表 */
  setBaudCandidates(candidates: number[]) {
    this._baudCandidates = [...candidates];
  }

  /** 添加一个候选波特率 */
  addBaudCandidate(rate: number, deviceCategory?: DeviceCategory, deviceLabel?: string) {
    if (!this._baudCandidates.includes(rate)) {
      this._baudCandidates.push(rate);
    }
    if (deviceCategory && deviceLabel) {
      this._baudDeviceMap[rate] = { category: deviceCategory, label: deviceLabel };
    }
  }

  /** 移除一个候选波特率 */
  removeBaudCandidate(rate: number) {
    this._baudCandidates = this._baudCandidates.filter((r) => r !== rate);
    delete this._baudDeviceMap[rate];
  }

  // --- Callbacks ---

  setOnLog(callback: LogCallback) {
    this.onLogCallback = callback;
  }

  setOnStatus(callback: StatusCallback) {
    this.onStatusCallback = callback;
  }

  setOnMac(callback: MacCallback) {
    this.onMacCallback = callback;
  }

  setOnDetect(callback: DetectCallback) {
    this.onDetectCallback = callback;
  }

  private log(message: string, type: LogEntry['type'] = 'info') {
    const entry: LogEntry = { message, type, timestamp: Date.now() };
    this.onLogCallback?.(entry);
    if (type === 'error') {
      console.error(`[SerialMac] ${message}`);
    } else {
      console.log(`[SerialMac] ${message}`);
    }
  }

  private setStatus(status: ConnectionStatus) {
    this.onStatusCallback?.(status);
  }

  // --- 核心：自动探测连接 ---

  /**
   * 自动探测连接：选择串口 → 自动探测波特率 → 识别设备 → 尝试读取 MAC
   */
  async autoDetectConnect(): Promise<boolean> {
    if (!SerialMacService.isSupported()) {
      this.log('当前浏览器不支持 Web Serial API，请使用 Chrome 89+ 或 Edge 89+', 'error');
      this.setStatus('error');
      return false;
    }

    try {
      this.setStatus('connecting');
      this.log('正在请求串口访问权限...');

      // 弹出串口选择对话框
      this.port = await navigator.serial.requestPort();
      this.log('串口已选择，开始自动探测波特率...', 'info');
      this.setStatus('detecting');

      // 阶段一：波特率探测
      const detectedRate = await this.detectBaudRate();

      if (detectedRate === null) {
        this.log('所有候选波特率均未匹配，无法识别设备', 'error');
        this.setStatus('error');
        await this.closePort();
        return false;
      }

      // 阶段二：设备大类映射
      const mapping = this._baudDeviceMap[detectedRate];
      this.currentBaudRate = detectedRate;
      if (mapping) {
        this.currentDeviceCategory = mapping.category;
        this.currentDeviceLabel = mapping.label;
      } else {
        this.currentDeviceCategory = 'unknown';
        this.currentDeviceLabel = `未知 (${detectedRate})`;
      }

      this.log(
        `波特率探测成功: ${detectedRate.toLocaleString()} → 设备类型: ${this.currentDeviceLabel}`,
        'success'
      );

      this.onDetectCallback?.({
        baudRate: detectedRate,
        deviceCategory: this.currentDeviceCategory,
        deviceLabel: this.currentDeviceLabel,
      });

      // 阶段三：以正确波特率重新打开串口，建立稳定连接
      this.log(`正在以 ${detectedRate.toLocaleString()} 波特率建立稳定连接...`);
      await this.port.open({ baudRate: detectedRate });
      this.isConnected = true;
      this.macReady = false;
      this.sendCount = 0;
      this.buffer = '';
      this.rawBuffer = new Uint8Array(0);

      // 获取 writer
      if (this.port.writable) {
        this.writer = this.port.writable.getWriter();
      }

      // 开始读取数据
      this.readLoop();

      this.log(`连接建立成功`, 'success');
      this.setStatus('connected');

      return true;
    } catch (error: any) {
      if (error.name === 'NotFoundError') {
        this.log('未选择串口设备', 'warning');
      } else {
        this.log(`连接失败: ${error.message}`, 'error');
      }
      this.setStatus('error');
      return false;
    }
  }

  /**
   * 手动指定波特率连接（不做探测）
   */
  async connect(baudRate: number = DEFAULT_BAUD_RATE): Promise<boolean> {
    if (!SerialMacService.isSupported()) {
      this.log('当前浏览器不支持 Web Serial API，请使用 Chrome 89+ 或 Edge 89+', 'error');
      this.setStatus('error');
      return false;
    }

    try {
      this.setStatus('connecting');
      this.currentBaudRate = baudRate;
      this.log(`正在请求串口访问权限...`);

      this.port = await navigator.serial.requestPort();
      this.log(`串口已选择，正在以 ${baudRate.toLocaleString()} 波特率打开...`);

      await this.port.open({ baudRate });
      this.isConnected = true;
      this.macReady = false;
      this.sendCount = 0;
      this.buffer = '';
      this.rawBuffer = new Uint8Array(0);

      // 映射设备类型
      const mapping = this._baudDeviceMap[baudRate];
      if (mapping) {
        this.currentDeviceCategory = mapping.category;
        this.currentDeviceLabel = mapping.label;
      } else {
        this.currentDeviceCategory = 'unknown';
        this.currentDeviceLabel = `未知 (${baudRate})`;
      }

      this.log(`串口打开成功，波特率 ${baudRate.toLocaleString()} → ${this.currentDeviceLabel}`, 'success');
      this.setStatus('connected');

      if (this.port.writable) {
        this.writer = this.port.writable.getWriter();
      }

      this.readLoop();
      return true;
    } catch (error: any) {
      if (error.name === 'NotFoundError') {
        this.log('未选择串口设备', 'warning');
      } else {
        this.log(`连接失败: ${error.message}`, 'error');
      }
      this.setStatus('error');
      return false;
    }
  }

  /**
   * 波特率自动探测
   * 依次尝试候选波特率，以每个波特率打开串口，在 800ms 内检测分隔符 AA 55 03 99
   */
  private async detectBaudRate(): Promise<number | null> {
    this.abortDetect = false;

    for (const candidate of this._baudCandidates) {
      if (this.abortDetect) return null;

      const label = this._baudDeviceMap[candidate]?.label || '未知';
      this.log(`尝试波特率 ${candidate.toLocaleString()} (${label})...`, 'info');

      try {
        await this.port!.open({ baudRate: candidate });

        const matched = await this.listenForDelimiter(DETECT_TIMEOUT);

        // 关闭串口以便下次尝试
        try {
          if (this.port!.readable) {
            const r = this.port!.readable.getReader();
            await r.cancel();
            r.releaseLock();
          }
        } catch (_) {}
        await this.port!.close();

        if (matched) {
          this.log(
            `波特率 ${candidate.toLocaleString()} 匹配成功 (检测到分隔符 AA 55 03 99)`,
            'success'
          );
          return candidate;
        } else {
          this.log(`波特率 ${candidate.toLocaleString()} 未匹配`, 'warning');
        }
      } catch (error: any) {
        this.log(`波特率 ${candidate.toLocaleString()} 打开失败: ${error.message}`, 'warning');
        // 确保串口关闭
        try {
          await this.port!.close();
        } catch (_) {}
      }
    }

    return null;
  }

  /**
   * 在指定超时内监听串口数据，检测是否包含分隔符 AA 55 03 99
   */
  private listenForDelimiter(timeout: number): Promise<boolean> {
    return new Promise(async (resolve) => {
      if (!this.port || !this.port.readable) {
        resolve(false);
        return;
      }

      let found = false;
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      const buf: number[] = [];

      const timer = setTimeout(() => {
        found = false;
        try {
          reader?.cancel();
        } catch (_) {}
      }, timeout);

      try {
        reader = this.port.readable.getReader();

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            for (let i = 0; i < value.length; i++) {
              buf.push(value[i]);
              // 只保留最近 4 字节检查
              if (buf.length > 4) buf.shift();
              if (
                buf.length === 4 &&
                buf[0] === FRAME_DELIMITER[0] &&
                buf[1] === FRAME_DELIMITER[1] &&
                buf[2] === FRAME_DELIMITER[2] &&
                buf[3] === FRAME_DELIMITER[3]
              ) {
                found = true;
                clearTimeout(timer);
                break;
              }
            }
            if (found) break;
          }
        }
      } catch (_) {
        // reader cancelled by timeout or error
      } finally {
        clearTimeout(timer);
        try {
          reader?.releaseLock();
        } catch (_) {}
      }

      resolve(found);
    });
  }

  // --- 断开连接 ---

  async disconnect(): Promise<void> {
    this.abortDetect = true;
    this.stopAtTimer();
    this.stopMacTimeout();

    try {
      if (this.reader) {
        await this.reader.cancel();
        this.reader.releaseLock();
        this.reader = null;
      }
      if (this.writer) {
        this.writer.releaseLock();
        this.writer = null;
      }
      await this.closePort();
    } catch (_) {}

    this.isConnected = false;
    this.macReady = false;
    this.readLoopActive = false;
    this.currentDeviceCategory = 'unknown';
    this.currentDeviceLabel = '未知';
    this.setStatus('disconnected');
    this.log('串口已断开');
  }

  private async closePort() {
    try {
      if (this.port) {
        await this.port.close();
        this.port = null;
      }
    } catch (_) {}
  }

  // --- MAC 地址读取 ---

  /**
   * 发送 AT 指令读取 MAC 地址
   * 所有设备都尝试，最长 1 分钟超时
   */
  async sendAtCommand(): Promise<void> {
    if (!this.isConnected || !this.writer) {
      this.log('请先连接串口', 'error');
      return;
    }

    this.macReady = false;
    this.sendCount = 0;
    this.setStatus('reading');
    this.log(`开始发送 AT 指令读取 MAC 地址（最长等待 60 秒）...`, 'info');

    // 先发送一次
    await this.sendOnce();

    // 每 300ms 发送一次
    this.atTimer = setInterval(async () => {
      if (this.macReady) {
        this.stopAtTimer();
        this.stopMacTimeout();
        return;
      }
      await this.sendOnce();
    }, AT_SEND_INTERVAL);

    // 1 分钟总超时
    this.macTimeoutTimer = setTimeout(() => {
      if (!this.macReady) {
        this.stopAtTimer();
        this.log(
          `MAC 地址读取超时（已持续 60 秒，发送 ${this.sendCount} 次 AT 指令）。该设备可能不支持 MAC 地址查询。`,
          'warning'
        );
        this.setStatus('connected');
      }
    }, MAC_READ_TIMEOUT);
  }

  private async sendOnce(): Promise<void> {
    if (!this.writer) return;
    try {
      await this.writer.write(AT_COMMAND);
      this.sendCount++;
      this.log(`发送 AT 指令 [${this.sendCount}] → AT+NAME=ESP32`, 'data');
    } catch (error: any) {
      this.log(`发送失败: ${error.message}`, 'error');
    }
  }

  private stopAtTimer() {
    if (this.atTimer) {
      clearInterval(this.atTimer);
      this.atTimer = null;
    }
  }

  private stopMacTimeout() {
    if (this.macTimeoutTimer) {
      clearTimeout(this.macTimeoutTimer);
      this.macTimeoutTimer = null;
    }
  }

  // --- 数据读取循环 ---

  private async readLoop(): Promise<void> {
    if (!this.port || !this.port.readable) return;
    if (this.readLoopActive) return;
    this.readLoopActive = true;
    this.reader = this.port.readable.getReader();

    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) {
          this.processData(value);
        }
      }
    } catch (error: any) {
      if (this.isConnected) {
        this.log(`读取错误: ${error.message}`, 'error');
      }
    } finally {
      this.readLoopActive = false;
      if (this.reader) {
        try {
          this.reader.releaseLock();
        } catch (_) {}
        this.reader = null;
      }
    }
  }

  private processData(chunk: Uint8Array): void {
    // 追加到原始缓冲区
    const newRaw = new Uint8Array(this.rawBuffer.length + chunk.length);
    newRaw.set(this.rawBuffer);
    newRaw.set(chunk, this.rawBuffer.length);
    this.rawBuffer = newRaw;

    // 尝试解析文本（AT 指令响应是文本格式）
    try {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(chunk);
      this.buffer += text;

      // 检查是否包含 Unique ID
      if (this.buffer.includes('Unique ID')) {
        const uniqueIdMatch = this.buffer.match(/Unique ID:\s*([^\s\-]+)/);
        const versionMatch: RegExpMatchArray | null = this.buffer.match(
          /Versions?:\s*([^\s\-]+)/
        );

        if (uniqueIdMatch) {
          const uniqueId = uniqueIdMatch[1];
          const version = versionMatch ? versionMatch[1] : 'N/A';

          this.macReady = true;
          this.stopAtTimer();
          this.stopMacTimeout();

          const result: MacResult = {
            uniqueId,
            version,
            port: 'Web Serial',
            baudRate: this.currentBaudRate,
            deviceCategory: this.currentDeviceCategory,
            deviceLabel: this.currentDeviceLabel,
            timestamp: Date.now(),
          };

          this.log(`读取成功! Unique ID: ${uniqueId}`, 'success');
          this.log(`固件版本: ${version}`, 'success');
          this.log(`设备类型: ${this.currentDeviceLabel}`, 'success');
          this.log(`发送次数: ${this.sendCount}`, 'info');
          this.setStatus('connected');
          this.onMacCallback?.(result);

          this.buffer = '';
        }
      }

      // 防止缓冲区过大
      if (this.buffer.length > 10000) {
        this.buffer = this.buffer.slice(-2000);
      }
    } catch (_) {}

    if (this.rawBuffer.length > 50000) {
      this.rawBuffer = this.rawBuffer.slice(-10000);
    }
  }

  // --- 自定义指令 ---

  async sendCustomCommand(command: string): Promise<void> {
    if (!this.isConnected || !this.writer) {
      this.log('请先连接串口', 'error');
      return;
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(command + '\r\n');

    try {
      await this.writer.write(data);
      this.log(`发送自定义指令: ${command}`, 'data');
    } catch (error: any) {
      this.log(`发送失败: ${error.message}`, 'error');
    }
  }
}

export const serialMacService = new SerialMacService();
export default SerialMacService;
