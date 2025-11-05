// 로깅 서비스 - 시스템 모니터링 및 디버깅을 위한 통합 로깅
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: any;
  userId?: string;
  sessionId?: string;
  apiKey?: string;
  duration?: number;
}

export interface SystemMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  apiKeyUsage: Record<string, number>;
  errorCounts: Record<string, number>;
  lastResetTime: string;
}

class LoggingService {
  private logs: LogEntry[] = [];
  private maxLogs = 1000; // 최대 로그 수
  private metrics: SystemMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    apiKeyUsage: {},
    errorCounts: {},
    lastResetTime: new Date().toISOString()
  };

  // 로그 레벨별 색상
  private getLogColor(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG: return '#6B7280'; // 회색
      case LogLevel.INFO: return '#3B82F6';  // 파란색
      case LogLevel.WARN: return '#F59E0B';  // 주황색
      case LogLevel.ERROR: return '#EF4444'; // 빨간색
      default: return '#000000';
    }
  }

  // 로그 출력 (콘솔 + 내부 저장)
  private outputLog(entry: LogEntry): void {
    const color = this.getLogColor(entry.level);
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    
    console.log(
      `%c[${timestamp}] ${entry.level}: ${entry.message}`,
      `color: ${color}; font-weight: bold;`,
      entry.context || ''
    );

    // 내부 로그 저장
    this.logs.push(entry);
    
    // 최대 로그 수 초과 시 오래된 로그 제거
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
  }

  // 일반 로그
  log(level: LogLevel, message: string, context?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context
    };
    this.outputLog(entry);
  }

  // 디버그 로그
  debug(message: string, context?: any): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  // 정보 로그
  info(message: string, context?: any): void {
    this.log(LogLevel.INFO, message, context);
  }

  // 경고 로그
  warn(message: string, context?: any): void {
    this.log(LogLevel.WARN, message, context);
  }

  // 오류 로그
  error(message: string, context?: any): void {
    this.log(LogLevel.ERROR, message, context);
  }

  // API 호출 로그
  logApiCall(apiKey: string, endpoint: string, duration: number, success: boolean, error?: any): void {
    const maskedKey = apiKey.substring(0, 10) + '...';
    
    this.info(`API 호출 ${success ? '성공' : '실패'}`, {
      apiKey: maskedKey,
      endpoint,
      duration: `${duration}ms`,
      success
    });

    // 메트릭 업데이트
    this.metrics.totalRequests++;
    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
      if (error) {
        const errorType = error.message || 'Unknown Error';
        this.metrics.errorCounts[errorType] = (this.metrics.errorCounts[errorType] || 0) + 1;
      }
    }

    // 평균 응답 시간 업데이트
    const totalTime = this.metrics.averageResponseTime * (this.metrics.totalRequests - 1) + duration;
    this.metrics.averageResponseTime = totalTime / this.metrics.totalRequests;

    // API 키 사용량 업데이트
    this.metrics.apiKeyUsage[maskedKey] = (this.metrics.apiKeyUsage[maskedKey] || 0) + 1;
  }

  // 시스템 상태 로그
  logSystemStatus(): void {
    this.info('시스템 상태', {
      totalRequests: this.metrics.totalRequests,
      successRate: `${((this.metrics.successfulRequests / this.metrics.totalRequests) * 100).toFixed(2)}%`,
      averageResponseTime: `${this.metrics.averageResponseTime.toFixed(2)}ms`,
      activeApiKeys: this.metrics.apiKeyUsage.size,
      errorTypes: Object.fromEntries(this.metrics.errorCounts)
    });
  }

  // 로그 조회
  getLogs(level?: LogLevel, limit?: number): LogEntry[] {
    let filteredLogs = this.logs;
    
    if (level) {
      filteredLogs = filteredLogs.filter(log => log.level === level);
    }
    
    if (limit) {
      filteredLogs = filteredLogs.slice(-limit);
    }
    
    return filteredLogs;
  }

  // 메트릭 조회
  getMetrics(): SystemMetrics {
    return { ...this.metrics };
  }

  // 메트릭 리셋
  resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      apiKeyUsage: {},
      errorCounts: {},
      lastResetTime: new Date().toISOString()
    };
    this.logs = [];
    this.info('메트릭이 리셋되었습니다.');
  }

  // 로그 내보내기 (디버깅용)
  exportLogs(): string {
    return JSON.stringify({
      logs: this.logs,
      metrics: this.metrics
    }, null, 2);
  }

  // 성능 모니터링 래퍼
  async monitorPerformance<T>(
    operation: () => Promise<T>,
    operationName: string,
    context?: any
  ): Promise<T> {
    const startTime = performance.now();
    this.debug(`${operationName} 시작`, context);
    
    try {
      const result = await operation();
      const duration = performance.now() - startTime;
      
      this.info(`${operationName} 완료`, {
        ...context,
        duration: `${duration.toFixed(2)}ms`
      });
      
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      
      this.error(`${operationName} 실패`, {
        ...context,
        duration: `${duration.toFixed(2)}ms`,
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw error;
    }
  }
}

// 싱글톤 인스턴스
export const loggingService = new LoggingService();

// 전역 로깅 함수들 (편의용)
export const log = {
  debug: (message: string, context?: any) => loggingService.debug(message, context),
  info: (message: string, context?: any) => loggingService.info(message, context),
  warn: (message: string, context?: any) => loggingService.warn(message, context),
  error: (message: string, context?: any) => loggingService.error(message, context),
  apiCall: (apiKey: string, endpoint: string, duration: number, success: boolean, error?: any) => 
    loggingService.logApiCall(apiKey, endpoint, duration, success, error),
  systemStatus: () => loggingService.logSystemStatus(),
  monitor: <T>(operation: () => Promise<T>, operationName: string, context?: any) =>
    loggingService.monitorPerformance(operation, operationName, context)
};
