/**
 * Firestore 데이터 전용 캐싱 서비스 (IndexedDB 버전)
 * - localStorage 대신 IndexedDB를 사용하여 대용량 캐싱 지원
 * - 문서 메타데이터, 청크 데이터, 검색 결과만 캐싱
 * - AI 답변이나 동적 분석 결과는 캐싱하지 않음
 */

export interface PDFDocument {
  id: string;
  title: string;
  totalPages: number;
  processedAt: Date;
  documentType?: 'legal' | 'guideline';
}

export interface PDFChunk {
  id: string;
  content: string;
  metadata: {
    source: string;
    title: string;
    page: number;
    section: string;
    position: number;
    startPosition: number;
    endPosition: number;
    originalSize: number;
    documentType?: 'legal' | 'guideline';
  };
  keywords: string[];
  location: {
    document: string;
    section: string;
    page: number;
  };
  relevanceScore?: number;
}

export class FirestoreCacheService {
  private static readonly CACHE_PREFIX = 'firestore_cache_';
  private static readonly CACHE_VERSION = 'v1.0';
  private static readonly CACHE_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30일
  
  // IndexedDB 관련
  private static db: IDBDatabase | null = null;
  private static readonly DB_NAME = 'FirestoreCacheDB';
  private static readonly DB_VERSION = 1;

  /**
   * 문서 목록 캐싱 조회
   */
  static async getCachedDocuments(): Promise<PDFDocument[] | null> {
    const cacheKey = `${this.CACHE_PREFIX}documents_all`;
    return this.getCache(cacheKey);
  }

  /**
   * 문서 목록 캐싱 저장
   */
  static async setCachedDocuments(documents: PDFDocument[]): Promise<void> {
    const cacheKey = `${this.CACHE_PREFIX}documents_all`;
    await this.setCache(cacheKey, documents);
    console.log(`✅ 문서 목록 캐시 저장: ${documents.length}개`);
  }

  /**
   * 청크 데이터 캐싱 조회
   */
  static async getCachedChunks(documentId: string): Promise<PDFChunk[] | null> {
    const cacheKey = `${this.CACHE_PREFIX}chunks_${documentId}`;
    return this.getCache(cacheKey);
  }

  /**
   * 청크 데이터 캐싱 저장
   */
  static async setCachedChunks(documentId: string, chunks: PDFChunk[]): Promise<void> {
    const cacheKey = `${this.CACHE_PREFIX}chunks_${documentId}`;
    await this.setCache(cacheKey, chunks);
    console.log(`✅ 청크 데이터 캐시 저장: ${documentId} (${chunks.length}개)`);
  }

  /**
   * 검색 결과 캐싱 조회 (키워드 기반)
   */
  static async getCachedSearchResults(
    keywords: string[], 
    documentId?: string
  ): Promise<PDFChunk[] | null> {
    const searchKey = this.generateSearchKey(keywords, documentId);
    const cacheKey = `${this.CACHE_PREFIX}search_${searchKey}`;
    return this.getCache(cacheKey);
  }

  /**
   * 검색 결과 캐싱 저장
   */
  static async setCachedSearchResults(
    keywords: string[], 
    documentId: string | undefined,
    chunks: PDFChunk[]
  ): Promise<void> {
    const searchKey = this.generateSearchKey(keywords, documentId);
    const cacheKey = `${this.CACHE_PREFIX}search_${searchKey}`;
    await this.setCache(cacheKey, chunks);
    console.log(`✅ 검색 결과 캐시 저장: ${searchKey} (${chunks.length}개)`);
  }

  /**
   * 텍스트 검색 결과 캐싱 조회
   */
  static async getCachedTextSearchResults(
    searchText: string,
    documentId?: string
  ): Promise<PDFChunk[] | null> {
    const searchKey = this.generateTextSearchKey(searchText, documentId);
    const cacheKey = `${this.CACHE_PREFIX}text_search_${searchKey}`;
    return this.getCache(cacheKey);
  }

  /**
   * 텍스트 검색 결과 캐싱 저장
   */
  static async setCachedTextSearchResults(
    searchText: string,
    documentId: string | undefined,
    chunks: PDFChunk[]
  ): Promise<void> {
    const searchKey = this.generateTextSearchKey(searchText, documentId);
    const cacheKey = `${this.CACHE_PREFIX}text_search_${searchKey}`;
    await this.setCache(cacheKey, chunks);
    console.log(`✅ 텍스트 검색 결과 캐시 저장: ${searchKey} (${chunks.length}개)`);
  }

  /**
   * 캐시 키 생성 (키워드 기반)
   */
  private static generateSearchKey(keywords: string[], documentId?: string): string {
    const sortedKeywords = keywords.sort().join('_');
    return `${sortedKeywords}_${documentId || 'all'}`;
  }

  /**
   * 캐시 키 생성 (텍스트 기반)
   */
  private static generateTextSearchKey(searchText: string, documentId?: string): string {
    const normalizedText = searchText.toLowerCase().replace(/\s+/g, '_');
    return `${normalizedText}_${documentId || 'all'}`;
  }

  /**
   * IndexedDB 초기화
   */
  private static async initDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => {
        console.error('IndexedDB 초기화 실패:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('✅ IndexedDB 초기화 완료');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // 캐시 저장소 생성
        if (!db.objectStoreNames.contains('cache')) {
          const cacheStore = db.createObjectStore('cache', { keyPath: 'key' });
          cacheStore.createIndex('timestamp', 'timestamp', { unique: false });
          cacheStore.createIndex('version', 'version', { unique: false });
        }
        
        console.log('IndexedDB 스키마 업그레이드 완료');
      };
    });
  }

  /**
   * 기본 캐시 조회 메서드 (IndexedDB 버전)
   */
  private static async getCache(key: string): Promise<any | null> {
    try {
      const db = await this.initDB();
      
      const transaction = db.transaction(['cache'], 'readonly');
      const store = transaction.objectStore('cache');
      
      return new Promise((resolve) => {
        const request = store.get(key);
        
        request.onsuccess = () => {
          if (!request.result) {
            resolve(null);
            return;
          }
          
          const data = request.result;
          
          // 버전 체크
          if (data.version !== this.CACHE_VERSION) {
            console.log(`🗑️ 버전 불일치로 캐시 삭제: ${key}`);
            this.deleteCacheItem(key);
            resolve(null);
            return;
          }
          
          // 만료 체크
          if (Date.now() - data.timestamp > this.CACHE_EXPIRY) {
            console.log(`🗑️ 만료로 캐시 삭제: ${key}`);
            this.deleteCacheItem(key);
            resolve(null);
            return;
          }
          
          console.log(`📦 IndexedDB 캐시 조회: ${key}`);
          resolve(data.content);
        };
        
        request.onerror = () => {
          console.warn('캐시 조회 실패:', request.error);
          resolve(null);
        };
      });
      
    } catch (error) {
      console.warn('캐시 조회 실패:', error);
      return null;
    }
  }
  
  /**
   * 캐시 항목 삭제 (IndexedDB)
   */
  private static async deleteCacheItem(key: string): Promise<void> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction(['cache'], 'readwrite');
      const store = transaction.objectStore('cache');
      store.delete(key);
    } catch (error) {
      console.warn('캐시 삭제 실패:', error);
    }
  }

  /**
   * 기본 캐시 저장 메서드 (IndexedDB 버전)
   */
  private static async setCache(key: string, content: any): Promise<void> {
    try {
      const db = await this.initDB();
      
      const data = {
        key: key,
        content: content,
        timestamp: Date.now(),
        version: this.CACHE_VERSION
      };
      
      // 크기 체크 (IndexedDB는 대용량 지원하지만 로깅용)
      const dataString = JSON.stringify(data);
      const sizeInMB = new Blob([dataString]).size / 1024 / 1024;
      
      if (sizeInMB > 5) {
        console.warn(`⚠️ 캐시 데이터가 큼 (${sizeInMB.toFixed(2)}MB): ${key}`);
      }
      
      // IndexedDB 저장
      const transaction = db.transaction(['cache'], 'readwrite');
      const store = transaction.objectStore('cache');
      
      return new Promise((resolve, reject) => {
        const request = store.put(data);
        
        request.onsuccess = () => {
          console.log(`✅ IndexedDB 캐시 저장 완료: ${key}`);
          resolve();
        };
        
        request.onerror = () => {
          console.error('IndexedDB 저장 실패:', request.error);
          reject(request.error);
        };
      });
      
    } catch (error) {
      console.error('캐시 저장 실패:', error);
      throw error;
    }
  }

  /**
   * 오래된 캐시 정리 (IndexedDB)
   */
  private static async cleanupOldCache(): Promise<void> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction(['cache'], 'readwrite');
      const store = transaction.objectStore('cache');
      const index = store.index('timestamp');
      
      const request = index.openCursor();
      let cleanedCount = 0;
      
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const data = cursor.value;
          if (Date.now() - data.timestamp > this.CACHE_EXPIRY) {
            cursor.delete();
            cleanedCount++;
          }
          cursor.continue();
        } else {
          if (cleanedCount > 0) {
            console.log(`🗑️ 오래된 캐시 ${cleanedCount}개 정리 완료`);
          }
        }
      };
    } catch (error) {
      console.warn('캐시 정리 실패:', error);
    }
  }

  /**
   * 공간 확보를 위한 캐시 정리 (IndexedDB)
   */
  private static async cleanupSpace(): Promise<void> {
    console.log('🗑️ IndexedDB 공간 확보 시도...');
    
    try {
      const db = await this.initDB();
      const transaction = db.transaction(['cache'], 'readwrite');
      const store = transaction.objectStore('cache');
      const index = store.index('timestamp');
      
      // 가장 오래된 항목부터 삭제 (최대 50개)
      const request = index.openCursor(null, 'next');
      let deletedCount = 0;
      const maxDelete = 50; // 최대 50개 삭제
      
      return new Promise((resolve) => {
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor && deletedCount < maxDelete) {
            cursor.delete();
            deletedCount++;
            cursor.continue();
          } else {
            console.log(`✅ IndexedDB 공간 확보 완료: ${deletedCount}개 항목 삭제`);
            resolve();
          }
        };
        
        request.onerror = () => {
          console.warn('공간 확보 실패:', request.error);
          resolve();
        };
      });
      
    } catch (error) {
      console.warn('공간 확보 실패:', error);
    }
  }

  /**
   * 전체 Firestore 캐시 삭제 (IndexedDB)
   */
  static async clearAllFirestoreCache(): Promise<void> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction(['cache'], 'readwrite');
      const store = transaction.objectStore('cache');
      
      // 모든 항목 삭제
      const request = store.clear();
      
      request.onsuccess = () => {
        console.log(`🗑️ Firestore 캐시 전체 삭제 완료`);
      };
      
      request.onerror = () => {
        console.error('캐시 삭제 실패:', request.error);
      };
    } catch (error) {
      console.error('캐시 삭제 실패:', error);
    }
  }

  /**
   * 특정 문서 캐시 삭제 (IndexedDB)
   */
  static async clearDocumentCache(documentId: string): Promise<void> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction(['cache'], 'readwrite');
      const store = transaction.objectStore('cache');
      
      const request = store.openCursor();
      let deletedCount = 0;
      
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const key = cursor.value.key;
          if (key.includes(`chunks_${documentId}`) || key.includes(`search_`) || key.includes(`text_search_`)) {
            cursor.delete();
            deletedCount++;
          }
          cursor.continue();
        } else {
          console.log(`🗑️ 문서 캐시 삭제 완료: ${documentId} (${deletedCount}개)`);
        }
      };
    } catch (error) {
      console.error('문서 캐시 삭제 실패:', error);
    }
  }

  /**
   * 캐시 상태 확인 (IndexedDB)
   */
  static async getCacheStatus(): Promise<any> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction(['cache'], 'readonly');
      const store = transaction.objectStore('cache');
      
      return new Promise((resolve) => {
        const request = store.getAll();
        
        request.onsuccess = () => {
          const allItems = request.result;
          
          let totalSize = 0;
          let documentCaches = 0;
          let chunkCaches = 0;
          let searchCaches = 0;
          let textSearchCaches = 0;
          let validCaches = 0;
          
          allItems.forEach((item: any) => {
            const dataString = JSON.stringify(item);
            totalSize += dataString.length;
            
            const key = item.key;
            if (key.includes('documents_')) documentCaches++;
            else if (key.includes('chunks_')) chunkCaches++;
            else if (key.includes('search_')) searchCaches++;
            else if (key.includes('text_search_')) textSearchCaches++;
            
            // 유효한 캐시인지 확인
            if (item.version === this.CACHE_VERSION && 
                Date.now() - item.timestamp <= this.CACHE_EXPIRY) {
              validCaches++;
            }
          });
          
          resolve({
            totalCaches: allItems.length,
            validCaches: validCaches,
            documentCaches: documentCaches,
            chunkCaches: chunkCaches,
            searchCaches: searchCaches,
            textSearchCaches: textSearchCaches,
            totalSize: `${(totalSize / 1024 / 1024).toFixed(2)}MB`,
            cacheExpiry: `${(this.CACHE_EXPIRY / 24 / 60 / 60 / 1000).toFixed(0)}일`
          });
        };
        
        request.onerror = () => {
          console.warn('캐시 상태 확인 실패:', request.error);
          resolve({
            totalCaches: 0,
            validCaches: 0,
            documentCaches: 0,
            chunkCaches: 0,
            searchCaches: 0,
            textSearchCaches: 0,
            totalSize: '0MB',
            cacheExpiry: '0일'
          });
        };
      });
      
    } catch (error) {
      console.warn('캐시 상태 확인 실패:', error);
      return {
        totalCaches: 0,
        validCaches: 0,
        documentCaches: 0,
        chunkCaches: 0,
        searchCaches: 0,
        textSearchCaches: 0,
        totalSize: '0MB',
        cacheExpiry: '0일'
      };
    }
  }

  /**
   * 캐시 히트율 계산
   */
  static getCacheHitRate(): { hits: number; misses: number; hitRate: string } {
    // 실제 구현에서는 히트/미스 카운터를 유지해야 함
    return {
      hits: 0,
      misses: 0,
      hitRate: '0.00%'
    };
  }
}
