// RPD (Requests Per Day) 관리 서비스 - IndexedDB 버전
export interface ApiKeyRpdInfo {
  keyId: string;
  keyName: string;
  maskedKey: string; // 마스킹된 키 (보안)
  usedToday: number;
  maxPerDay: number;
  lastResetDate: string;
  isActive: boolean;
}

export interface RpdStats {
  totalUsed: number;
  totalMax: number;
  remaining: number;
  resetTime: string;
  apiKeys: ApiKeyRpdInfo[];
}

class RpdService {
  private readonly DB_NAME = 'RpdDB';
  private readonly DB_VERSION = 1;
  private readonly STORE_NAME = 'rpd_stats';
  private db: IDBDatabase | null = null;
  private readonly MAX_RPD_PER_KEY = 250; // 각 키당 250회
  private readonly TOTAL_MAX_RPD = 750; // 250 * 3 = 750 (3개 키 합계)

  // API 키를 마스킹하는 함수 (보안)
  private maskApiKey(key: string): string {
    if (!key || key.length < 8) return '****';
    return key.substring(0, 4) + '****' + key.substring(key.length - 4);
  }

  // 오늘 날짜를 YYYY-MM-DD 형식으로 반환
  private getTodayString(): string {
    return new Date().toISOString().split('T')[0];
  }

  // IndexedDB 초기화
  private async initDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => {
        console.error('IndexedDB 초기화 실패:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('✅ RPD IndexedDB 초기화 완료');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  // IndexedDB에서 RPD 데이터 로드
  private async loadRpdData(): Promise<RpdStats> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      
      return new Promise<RpdStats>((resolve, reject) => {
        const request = store.get('current');
        
        request.onsuccess = () => {
          const data = request.result?.data;
          if (data) {
            // 날짜가 바뀌었으면 리셋
            if (data.resetTime !== this.getTodayString()) {
              this.resetRpdDataAsync().then(resolve).catch(reject);
            } else {
              resolve(data);
            }
          } else {
            this.resetRpdDataAsync().then(resolve).catch(reject);
          }
        };
        
        request.onerror = () => {
          console.error('RPD 데이터 로드 실패:', request.error);
          this.resetRpdDataAsync().then(resolve).catch(reject);
        };
      });
    } catch (error) {
      console.error('RPD 데이터 로드 실패:', error);
      return this.resetRpdDataAsync();
    }
  }

  // RPD 데이터 리셋 (새로운 날) - 비동기 버전
  private async resetRpdDataAsync(): Promise<RpdStats> {
    const today = this.getTodayString();
    const data: RpdStats = {
      totalUsed: 0,
      totalMax: this.TOTAL_MAX_RPD,
      remaining: this.TOTAL_MAX_RPD,
      resetTime: today,
      apiKeys: [
        {
          keyId: 'key1',
          keyName: 'API Key #1',
          maskedKey: 'AIza****O0',
          usedToday: 0,
          maxPerDay: this.MAX_RPD_PER_KEY,
          lastResetDate: today,
          isActive: true
        },
        {
          keyId: 'key2',
          keyName: 'API Key #2',
          maskedKey: 'AIza****U4',
          usedToday: 0,
          maxPerDay: this.MAX_RPD_PER_KEY,
          lastResetDate: today,
          isActive: true
        },
        {
          keyId: 'key3',
          keyName: 'API Key #3',
          maskedKey: 'AIza****3I',
          usedToday: 0,
          maxPerDay: this.MAX_RPD_PER_KEY,
          lastResetDate: today,
          isActive: true
        }
      ]
    };
    await this.saveRpdData(data);
    console.log('RPD 데이터 리셋 완료:', data);
    return data;
  }

  // RPD 데이터 저장 (IndexedDB)
  private async saveRpdData(data: RpdStats): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        const db = await this.initDB();
        const transaction = db.transaction([this.STORE_NAME], 'readwrite');
        const store = transaction.objectStore(this.STORE_NAME);
        
        const request = store.put({ id: 'current', data, timestamp: Date.now() });
        
        request.onsuccess = () => {
          console.log('✅ RPD 데이터 IndexedDB 저장 완료');
          resolve();
        };
        
        request.onerror = () => {
          console.error('RPD 데이터 저장 실패:', request.error);
          reject(request.error);
        };
      } catch (error) {
        console.error('RPD 데이터 저장 실패:', error);
        reject(error);
      }
    });
  }

  // API 키 사용 기록 (비동기)
  async recordApiCall(keyId: string): Promise<boolean> {
    try {
      // keyId 유효성 검증
      if (!keyId || typeof keyId !== 'string') {
        console.warn(`유효하지 않은 키 ID: ${keyId}`);
        return false;
      }

      const data = this.loadRpdData();
      
      // 데이터 유효성 검증
      if (!data || !Array.isArray(data.apiKeys)) {
        console.warn('RPD 데이터가 유효하지 않습니다.');
        return false;
      }

      const keyInfo = data.apiKeys.find(key => key && key.keyId === keyId);
      
      if (!keyInfo) {
        console.warn(`API 키 ${keyId}를 찾을 수 없습니다.`);
        return false;
      }

      if (!keyInfo.isActive) {
        console.warn(`API 키 ${keyId}가 비활성화되었습니다.`);
        return false;
      }

      if (keyInfo.usedToday >= keyInfo.maxPerDay) {
        console.warn(`API 키 ${keyId}의 일일 한도를 초과했습니다. (${keyInfo.usedToday}/${keyInfo.maxPerDay})`);
        return false;
      }

      // 사용 횟수 증가
      keyInfo.usedToday++;
      data.totalUsed++;
      data.remaining = data.totalMax - data.totalUsed;

      await this.saveRpdData(data);
      console.log(`API 키 ${keyId} 사용 기록: ${keyInfo.usedToday}/${keyInfo.maxPerDay}`);
      return true;
    } catch (error) {
      console.error('RPD 기록 중 오류 발생:', error);
      return false;
    }
  }

  // RPD 통계 조회 (비동기)
  async getRpdStats(): Promise<RpdStats> {
    return await this.loadRpdData();
  }

  // 특정 키 비활성화/활성화 (비동기)
  async toggleKeyStatus(keyId: string): Promise<boolean> {
    const data = await this.loadRpdData();
    const keyInfo = data.apiKeys.find(key => key.keyId === keyId);
    
    if (keyInfo) {
      keyInfo.isActive = !keyInfo.isActive;
      await this.saveRpdData(data);
      return true;
    }
    return false;
  }

  // 다음 사용 가능한 키 조회 (비동기)
  async getNextAvailableKey(): Promise<string | null> {
    try {
      const data = await this.loadRpdData();
      
      // 데이터 유효성 검증
      if (!data || !Array.isArray(data.apiKeys) || data.apiKeys.length === 0) {
        console.warn('RPD 데이터가 유효하지 않습니다. 기본 키를 사용합니다.');
        return 'key1';
      }
      
      const availableKey = data.apiKeys.find(key => 
        key && key.isActive && key.usedToday < key.maxPerDay
      );
      
      if (!availableKey) {
        console.warn('사용 가능한 RPD 키가 없습니다. 기본 키를 사용합니다.');
        return 'key1';
      }
      
      return availableKey.keyId;
    } catch (error) {
      console.error('RPD 키 조회 중 오류 발생:', error);
      return 'key1'; // 오류 발생 시 기본 키 반환
    }
  }

  // 리셋까지 남은 시간 계산
  getTimeUntilReset(): string {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const diff = tomorrow.getTime() - now.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    return `${hours}시간 ${minutes}분`;
  }

  // 사용량 백분율 계산
  getUsagePercentage(used: number, max: number): number {
    return Math.min(100, (used / max) * 100);
  }

  // 사용량 상태 색상 반환
  getUsageStatusColor(percentage: number): string {
    if (percentage >= 90) return 'bg-red-500';
    if (percentage >= 70) return 'bg-yellow-500';
    return 'bg-green-500';
  }

  // 사용량 상태 텍스트 반환
  getUsageStatusText(percentage: number): string {
    if (percentage >= 90) return '위험';
    if (percentage >= 70) return '주의';
    return '정상';
  }

  // RPD 데이터 강제 리셋 (디버깅용)
  async forceResetRpdData(): Promise<void> {
    console.log('RPD 데이터 강제 리셋 중...');
    await this.resetRpdDataAsync();
  }
}

export const rpdService = new RpdService();
