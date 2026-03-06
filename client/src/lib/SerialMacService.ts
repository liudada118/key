/**
 * SerialMacService - 通过 Web Serial API 读取硬件 MAC 地址
 * 
 * 工作原理：
 * 1. 用户选择串口并设置波特率
 * 2. 打开串口连接
 * 3. 发送 AT 指令 (AT+NAME=ESP32\r\n)
 * 4. 解析返回数据中的 Unique ID（即 MAC 地址）和版本号
 * 
 * 数据协议：
 * - AT 指令: 0x41 0x54 0x2B 0x4E 0x41 0x4D 0x45 0x3D 0x45 0x53 0x50 0x33 0x32 0x0D 0x0A
 * - 返回格式包含: "Unique ID: XXXXXXXX" 和 "Versions: XXXXXX"
 * - 帧分隔符: AA 55 03 99
 */

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reading' | 'error';

export interface MacResult {
  uniqueId: string;
  version: string;
  port: string;
  baudRate: number;
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

// AT 指令: AT+NAME=ESP32\r\n
const AT_COMMAND = new Uint8Array([0x41, 0x54, 0x2B, 0x4E, 0x41, 0x4D, 0x45, 0x3D, 0x45, 0x53, 0x50, 0x33, 0x32, 0x0D, 0x0A]);

// 帧分隔符
const FRAME_DELIMITER = new Uint8Array([0xAA, 0x55, 0x03, 0x99]);

// 支持的波特率列表
export const BAUD_RATES = [
  9600,
  19200,
  38400,
  57600,
  115200,
  230400,
  460800,
  921600,
  1000000,
  1500000,
  2000000,
  3000000,
];

// 默认波特率
export const DEFAULT_BAUD_RATE = 3000000;

class SerialMacService {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  // @ts-ignore - SerialPort type from Web Serial API
  private isConnected = false;
  private buffer = '';
  private rawBuffer = new Uint8Array(0);
  private atTimer: ReturnType<typeof setInterval> | null = null;
  private macReady = false;
  private currentBaudRate = DEFAULT_BAUD_RATE;
  private sendCount = 0;

  // Callbacks
  private onLogCallback: LogCallback | null = null;
  private onStatusCallback: StatusCallback | null = null;
  private onMacCallback: MacCallback | null = null;

  get connected() {
    return this.isConnected;
  }

  get baudRate() {
    return this.currentBaudRate;
  }

  // Check browser support
  static isSupported(): boolean {
    return 'serial' in navigator;
  }

  // Set callbacks
  setOnLog(callback: LogCallback) {
    this.onLogCallback = callback;
  }

  setOnStatus(callback: StatusCallback) {
    this.onStatusCallback = callback;
  }

  setOnMac(callback: MacCallback) {
    this.onMacCallback = callback;
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

  /**
   * 连接串口
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

      // 弹出串口选择对话框
      this.port = await navigator.serial.requestPort();
      this.log(`串口已选择，正在以 ${baudRate.toLocaleString()} 波特率打开...`);

      await this.port.open({ baudRate });
      this.isConnected = true;
      this.macReady = false;
      this.sendCount = 0;
      this.buffer = '';
      this.rawBuffer = new Uint8Array(0);

      this.log(`串口打开成功，波特率 ${baudRate.toLocaleString()}`, 'success');
      this.setStatus('connected');

      // 获取 writer
      if (this.port.writable) {
        this.writer = this.port.writable.getWriter();
      }

      // 开始读取数据
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
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.stopAtTimer();

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
      if (this.port) {
        await this.port.close();
        this.port = null;
      }
    } catch (e) {
      // ignore close errors
    }

    this.isConnected = false;
    this.macReady = false;
    this.setStatus('disconnected');
    this.log('串口已断开');
  }

  /**
   * 发送 AT 指令读取 MAC 地址
   */
  async sendAtCommand(): Promise<void> {
    if (!this.isConnected || !this.writer) {
      this.log('请先连接串口', 'error');
      return;
    }

    this.macReady = false;
    this.sendCount = 0;
    this.setStatus('reading');
    this.log('开始发送 AT 指令读取 MAC 地址...', 'info');

    // 先发送一次
    await this.sendOnce();

    // 设置定时器，每 300ms 发送一次，直到收到 MAC 地址
    this.atTimer = setInterval(async () => {
      if (this.macReady) {
        this.stopAtTimer();
        return;
      }
      if (this.sendCount >= 30) {
        this.stopAtTimer();
        this.log('发送 AT 指令超时（已发送 30 次），未收到 MAC 地址响应', 'error');
        this.setStatus('connected');
        return;
      }
      await this.sendOnce();
    }, 300);
  }

  /**
   * 发送单次 AT 指令
   */
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

  /**
   * 停止 AT 指令定时器
   */
  private stopAtTimer() {
    if (this.atTimer) {
      clearInterval(this.atTimer);
      this.atTimer = null;
    }
  }

  /**
   * 读取串口数据循环
   */
  private async readLoop(): Promise<void> {
    if (!this.port || !this.port.readable) return;
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
      if (this.reader) {
        this.reader.releaseLock();
        this.reader = null;
      }
    }
  }

  /**
   * 处理接收到的数据
   */
  private processData(chunk: Uint8Array): void {
    // 追加到原始缓冲区
    const newRaw = new Uint8Array(this.rawBuffer.length + chunk.length);
    newRaw.set(this.rawBuffer);
    newRaw.set(chunk, this.rawBuffer.length);
    this.rawBuffer = newRaw;

    // 尝试将数据解析为文本（AT 指令响应是文本格式）
    try {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(chunk);
      this.buffer += text;

      // 检查是否包含 Unique ID 信息
      if (this.buffer.includes('Unique ID')) {
        const uniqueIdMatch = this.buffer.match(/Unique ID:\s*([^\s\-]+)/);
        const versionMatch: RegExpMatchArray | null = this.buffer.match(/Versions?:\s*([^\s\-]+)/);

        if (uniqueIdMatch) {
          const uniqueId = uniqueIdMatch[1];
          const version = versionMatch ? versionMatch[1] : 'N/A';

          this.macReady = true;
          this.stopAtTimer();

          const result: MacResult = {
            uniqueId,
            version,
            port: 'Web Serial',
            baudRate: this.currentBaudRate,
            timestamp: Date.now(),
          };

          this.log(`读取成功! Unique ID: ${uniqueId}`, 'success');
          this.log(`固件版本: ${version}`, 'success');
          this.log(`发送次数: ${this.sendCount}`, 'info');
          this.setStatus('connected');
          this.onMacCallback?.(result);

          // 清空缓冲区
          this.buffer = '';
        }
      }

      // 防止缓冲区过大
      if (this.buffer.length > 10000) {
        this.buffer = this.buffer.slice(-2000);
      }
    } catch (e) {
      // 非文本数据，忽略
    }

    // 防止原始缓冲区过大
    if (this.rawBuffer.length > 50000) {
      this.rawBuffer = this.rawBuffer.slice(-10000);
    }
  }

  /**
   * 发送自定义 AT 指令
   */
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
