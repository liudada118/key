import { useState, useCallback, useRef, useEffect } from 'react';
import {
  serialMacService,
  ConnectionStatus,
  MacResult,
  LogEntry,
  DetectResult,
  DeviceCategory,
  DEFAULT_BAUD_RATE,
  BAUD_RATES,
} from '@/lib/SerialMacService';

export { BAUD_RATES, DEFAULT_BAUD_RATE };
export type { ConnectionStatus, MacResult, LogEntry, DetectResult, DeviceCategory };

export function useSerialMac() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [macResults, setMacResults] = useState<MacResult[]>([]);
  const [baudRate, setBaudRate] = useState(DEFAULT_BAUD_RATE);
  const [detectResult, setDetectResult] = useState<DetectResult | null>(null);
  const [baudCandidates, setBaudCandidates] = useState<number[]>(serialMacService.baudCandidates);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    serialMacService.setOnLog((entry) => {
      setLogs((prev) => [...prev.slice(-200), entry]);
    });

    serialMacService.setOnStatus((newStatus) => {
      setStatus(newStatus);
    });

    serialMacService.setOnMac((result) => {
      setMacResults((prev) => [result, ...prev]);
    });

    serialMacService.setOnDetect((result) => {
      setDetectResult(result);
      setBaudRate(result.baudRate);
    });
  }, []);

  /** 自动探测连接 */
  const autoDetectConnect = useCallback(async () => {
    setDetectResult(null);
    return serialMacService.autoDetectConnect();
  }, []);

  /** 手动指定波特率连接 */
  const connect = useCallback(
    async (rate?: number) => {
      const targetRate = rate ?? baudRate;
      setBaudRate(targetRate);
      return serialMacService.connect(targetRate);
    },
    [baudRate]
  );

  const disconnect = useCallback(async () => {
    await serialMacService.disconnect();
    setDetectResult(null);
  }, []);

  const readMac = useCallback(async () => {
    await serialMacService.sendAtCommand();
  }, []);

  const sendCustomCommand = useCallback(async (command: string) => {
    await serialMacService.sendCustomCommand(command);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const clearResults = useCallback(() => {
    setMacResults([]);
  }, []);

  /** 添加候选波特率 */
  const addBaudCandidate = useCallback((rate: number, category?: DeviceCategory, label?: string) => {
    serialMacService.addBaudCandidate(rate, category, label);
    setBaudCandidates(serialMacService.baudCandidates);
  }, []);

  /** 移除候选波特率 */
  const removeBaudCandidate = useCallback((rate: number) => {
    serialMacService.removeBaudCandidate(rate);
    setBaudCandidates(serialMacService.baudCandidates);
  }, []);

  return {
    status,
    logs,
    macResults,
    baudRate,
    setBaudRate,
    detectResult,
    baudCandidates,
    autoDetectConnect,
    connect,
    disconnect,
    readMac,
    sendCustomCommand,
    clearLogs,
    clearResults,
    addBaudCandidate,
    removeBaudCandidate,
    isSupported: typeof navigator !== 'undefined' && 'serial' in navigator,
  };
}
