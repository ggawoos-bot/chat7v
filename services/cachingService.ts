/**
 * 캐싱 서비스
 * IndexedDB 기반 영구 캐싱으로 오프라인 지원 및 성능 향상
 */

import { Chunk } from '../types';

export interface CacheMetadata {
  filename: string;
  version: string;
  lastModified: number;
  size: number;
  chunks: number;
  checksum: string;
}

export interface CachedPDF {
  filename: string;
  text: string;
  chunks: Chunk[];
  metadata: CacheMetadata;
  timestamp: number;
}

export interface CacheStats {
  totalPDFs: number;
  totalSize: number;
  oldestEntry: number;
  newestEntry: number;
  hitRate: number;
  missRate: number;
}

export class CachingService {
  private db: IDBDatabase | null = null;
  private dbName = 'PDFCacheDB';
  private dbVersion = 1;
  private isInitialized = false;
  private hits = 0;
  private misses = 0;

  /**
   * IndexedDB 초기화
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('IndexedDB 초기화 실패:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;
        console.log('IndexedDB 초기화 완료');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // PDF 저장소 생성
        if (!db.objectStoreNames.contains('pdfs')) {
          const pdfStore = db.createObjectStore('pdfs', { keyPath: 'filename' });
          pdfStore.createIndex('timestamp', 'timestamp', { unique: false });
          pdfStore.createIndex('version', 'metadata.version', { unique: false });
        }

        // 청크 저장소 생성
        if (!db.objectStoreNames.contains('chunks')) {
          const chunkStore = db.createObjectStore('chunks', { keyPath: 'id' });
          chunkStore.createIndex('pdfFilename', 'pdfFilename', { unique: false });
          chunkStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 메타데이터 저장소 생성
        if (!db.objectStoreNames.contains('metadata')) {
          const metadataStore = db.createObjectStore('metadata', { keyPath: 'filename' });
          metadataStore.createIndex('lastModified', 'lastModified', { unique: false });
        }

        console.log('IndexedDB 스키마 업그레이드 완료');
      };
    });
  }

  /**
   * PDF 캐시에 저장
   */
  async cachePDF(
    filename: string,
    text: string,
    chunks: Chunk[],
    version: string = '1.0.0'
  ): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.db) {
      throw new Error('IndexedDB가 초기화되지 않았습니다.');
    }

    const timestamp = Date.now();
    const checksum = await this.calculateChecksum(text);
    
    const metadata: CacheMetadata = {
      filename,
      version,
      lastModified: timestamp,
      size: text.length,
      chunks: chunks.length,
      checksum
    };

    const cachedPDF: CachedPDF = {
      filename,
      text,
      chunks,
      metadata,
      timestamp
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['pdfs', 'chunks', 'metadata'], 'readwrite');
      
      // PDF 저장
      const pdfStore = transaction.objectStore('pdfs');
      const pdfRequest = pdfStore.put(cachedPDF);

      // 청크들 저장
      const chunkStore = transaction.objectStore('chunks');
      const chunkPromises = chunks.map(chunk => {
        const chunkWithMetadata = {
          ...chunk,
          pdfFilename: filename,
          timestamp
        };
        return new Promise<void>((chunkResolve, chunkReject) => {
          const chunkRequest = chunkStore.put(chunkWithMetadata);
          chunkRequest.onsuccess = () => chunkResolve();
          chunkRequest.onerror = () => chunkReject(chunkRequest.error);
        });
      });

      // 메타데이터 저장
      const metadataStore = transaction.objectStore('metadata');
      const metadataRequest = metadataStore.put(metadata);

      transaction.oncomplete = () => {
        console.log(`PDF 캐시 저장 완료: ${filename}`);
        resolve();
      };

      transaction.onerror = () => {
        console.error('PDF 캐시 저장 실패:', transaction.error);
        reject(transaction.error);
      };

      // 모든 청크 저장 완료 대기
      Promise.all(chunkPromises).catch(reject);
    });
  }

  /**
   * PDF 캐시에서 가져오기
   */
  async getCachedPDF(filename: string): Promise<CachedPDF | null> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.db) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['pdfs'], 'readonly');
      const store = transaction.objectStore('pdfs');
      const request = store.get(filename);

      request.onsuccess = () => {
        if (request.result) {
          this.hits++;
          console.log(`PDF 캐시 히트: ${filename}`);
          resolve(request.result);
        } else {
          this.misses++;
          console.log(`PDF 캐시 미스: ${filename}`);
          resolve(null);
        }
      };

      request.onerror = () => {
        this.misses++;
        console.error('PDF 캐시 조회 실패:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 청크 캐시에서 가져오기
   */
  async getCachedChunks(pdfFilename: string): Promise<Chunk[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.db) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['chunks'], 'readonly');
      const store = transaction.objectStore('chunks');
      const index = store.index('pdfFilename');
      const request = index.getAll(pdfFilename);

      request.onsuccess = () => {
        const chunks = request.result.map((item: any) => {
          const { pdfFilename, timestamp, ...chunk } = item;
          return chunk;
        });
        resolve(chunks);
      };

      request.onerror = () => {
        console.error('청크 캐시 조회 실패:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 캐시된 PDF 목록 가져오기
   */
  async getCachedPDFList(): Promise<string[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.db) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['pdfs'], 'readonly');
      const store = transaction.objectStore('pdfs');
      const request = store.getAllKeys();

      request.onsuccess = () => {
        resolve(request.result as string[]);
      };

      request.onerror = () => {
        console.error('캐시된 PDF 목록 조회 실패:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 캐시에서 PDF 제거
   */
  async removeCachedPDF(filename: string): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.db) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['pdfs', 'chunks', 'metadata'], 'readwrite');
      
      // PDF 제거
      const pdfStore = transaction.objectStore('pdfs');
      pdfStore.delete(filename);

      // 관련 청크들 제거
      const chunkStore = transaction.objectStore('chunks');
      const index = chunkStore.index('pdfFilename');
      const request = index.getAllKeys(filename);
      
      request.onsuccess = () => {
        const deletePromises = request.result.map((key: any) => {
          return new Promise<void>((deleteResolve, deleteReject) => {
            const deleteRequest = chunkStore.delete(key);
            deleteRequest.onsuccess = () => deleteResolve();
            deleteRequest.onerror = () => deleteReject(deleteRequest.error);
          });
        });

        Promise.all(deletePromises).then(() => {
          // 메타데이터 제거
          const metadataStore = transaction.objectStore('metadata');
          metadataStore.delete(filename);
        });
      };

      transaction.oncomplete = () => {
        console.log(`PDF 캐시 제거 완료: ${filename}`);
        resolve();
      };

      transaction.onerror = () => {
        console.error('PDF 캐시 제거 실패:', transaction.error);
        reject(transaction.error);
      };
    });
  }

  /**
   * 캐시 통계 가져오기
   */
  async getCacheStats(): Promise<CacheStats> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.db) {
      return {
        totalPDFs: 0,
        totalSize: 0,
        oldestEntry: 0,
        newestEntry: 0,
        hitRate: 0,
        missRate: 0
      };
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['pdfs'], 'readonly');
      const store = transaction.objectStore('pdfs');
      const request = store.getAll();

      request.onsuccess = () => {
        const pdfs = request.result as CachedPDF[];
        
        if (pdfs.length === 0) {
          resolve({
            totalPDFs: 0,
            totalSize: 0,
            oldestEntry: 0,
            newestEntry: 0,
            hitRate: 0,
            missRate: 0
          });
          return;
        }

        const totalSize = pdfs.reduce((sum, pdf) => sum + pdf.metadata.size, 0);
        const timestamps = pdfs.map(pdf => pdf.timestamp);
        const oldestEntry = Math.min(...timestamps);
        const newestEntry = Math.max(...timestamps);
        
        const total = this.hits + this.misses;
        const hitRate = total > 0 ? this.hits / total : 0;
        const missRate = total > 0 ? this.misses / total : 0;

        resolve({
          totalPDFs: pdfs.length,
          totalSize,
          oldestEntry,
          newestEntry,
          hitRate,
          missRate
        });
      };

      request.onerror = () => {
        console.error('캐시 통계 조회 실패:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 오래된 캐시 정리
   */
  async cleanupOldCache(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<number> { // 7일
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.db) {
      return 0;
    }

    const cutoffTime = Date.now() - maxAge;
    let removedCount = 0;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['pdfs'], 'readonly');
      const store = transaction.objectStore('pdfs');
      const index = store.index('timestamp');
      const range = IDBKeyRange.upperBound(cutoffTime);
      const request = index.getAllKeys(range);

      request.onsuccess = () => {
        const oldKeys = request.result as string[];
        
        if (oldKeys.length === 0) {
          resolve(0);
          return;
        }

        // 오래된 항목들 제거
        const deleteTransaction = this.db!.transaction(['pdfs', 'chunks', 'metadata'], 'readwrite');
        
        oldKeys.forEach(filename => {
          this.removeCachedPDF(filename).then(() => {
            removedCount++;
            if (removedCount === oldKeys.length) {
              console.log(`오래된 캐시 정리 완료: ${removedCount}개 항목 제거`);
              resolve(removedCount);
            }
          }).catch(reject);
        });
      };

      request.onerror = () => {
        console.error('오래된 캐시 조회 실패:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 전체 캐시 비우기
   */
  async clearAllCache(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.db) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['pdfs', 'chunks', 'metadata'], 'readwrite');
      
      const pdfStore = transaction.objectStore('pdfs');
      const chunkStore = transaction.objectStore('chunks');
      const metadataStore = transaction.objectStore('metadata');
      
      pdfStore.clear();
      chunkStore.clear();
      metadataStore.clear();

      transaction.oncomplete = () => {
        console.log('전체 캐시 비우기 완료');
        this.hits = 0;
        this.misses = 0;
        resolve();
      };

      transaction.onerror = () => {
        console.error('전체 캐시 비우기 실패:', transaction.error);
        reject(transaction.error);
      };
    });
  }

  /**
   * 체크섬 계산
   */
  private async calculateChecksum(text: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * 캐시 무효화 (버전 변경 시)
   */
  async invalidateCache(filename: string, newVersion: string): Promise<boolean> {
    const cachedPDF = await this.getCachedPDF(filename);
    
    if (!cachedPDF) {
      return false;
    }

    if (cachedPDF.metadata.version !== newVersion) {
      await this.removeCachedPDF(filename);
      console.log(`캐시 무효화: ${filename} (${cachedPDF.metadata.version} -> ${newVersion})`);
      return true;
    }

    return false;
  }

  /**
   * 캐시 상태 확인
   */
  isCacheAvailable(): boolean {
    return this.isInitialized && this.db !== null;
  }
}

// 싱글톤 인스턴스
export const cachingService = new CachingService();
