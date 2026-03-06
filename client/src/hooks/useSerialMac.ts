import { useState, useCallback, useRef, useEffect } from 'react';
import { serialMacService, ConnectionStatus, MacResult, LogEntry, DEFAULT_BAUD_RATE } from '@/lib/SerialMacService';

export function useSerialMac() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [macResults, setMacResults] = useState<MacResult[]>([]);
  const [baudRate, setBaudRate] = useState(DEFAULT_BAUD_RATE);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    serialMacService.setOnLog((entry) => {
      setLogs(prev => [...prev.slice(-200), entry]);
    });

    serialMacService.setOnStatus((newStatus) => {
      setStatus(newStatus);
    });

    serialMacService.setOnMac((result) => {
      setMacResults(prev => [result, ...prev]);
    });
  }, []);

  const connect = useCallback(async (rate?: number) => {
    const targetRate = rate ?? baudRate;
    setBaudRate(targetRate);
    return serialMacService.connect(targetRate);
  }, [baudRate]);

  const disconnect = useCallback(async () => {
    await serialMacService.disconnect();
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

  return {
    status,
    logs,
    macResults,
    baudRate,
    setBaudRate,
    connect,
    disconnect,
    readMac,
    sendCustomCommand,
    clearLogs,
    clearResults,
    isSupported: typeof navigator !== 'undefined' && 'serial' in navigator,
  };
}
