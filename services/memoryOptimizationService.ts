/**
 * 메모리 최적화 서비스
 * LRU 캐시와 청크 관리를 통한 메모리 사용량 최적화
 */

import { Chunk } from '../types';

export interface CacheEntry<T> {
  key: string;
  value: T;
  lastAccessed: number;
  accessCount: number;
  size: number;
}

export interface MemoryStats {
  totalChunks: number;
  activeChunks: number;
  cachedChunks: number;
  memoryUsage: number;
  hitRate: number;
  missRate: number;
}

export class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private maxMemory: number; // 바이트 단위
  private currentMemory = 0;
  private hits = 0;
  private misses = 0;

  constructor(maxSize: number = 20, maxMemory: number = 2 * 1024 * 1024) { // 2MB 기본
    this.maxSize = maxSize;
    this.maxMemory = maxMemory;
  }

  /**
   * 캐시에서 값 가져오기
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (entry) {
      // 최근 사용으로 업데이트
      entry.lastAccessed = Date.now();
      entry.accessCount++;
      this.hits++;
      
      // LRU 순서 유지를 위해 삭제 후 재삽입
      this.cache.delete(key);
      this.cache.set(key, entry);
      
      return entry.value;
    }
    
    this.misses++;
    return null;
  }

  /**
   * 캐시에 값 저장
   */
  set(key: string, value: T, size?: number): void {
    const entrySize = size || this.estimateSize(value);
    
    // 메모리 제한 확인
    if (entrySize > this.maxMemory) {
      console.warn(`항목이 너무 큽니다: ${entrySize} bytes > ${this.maxMemory} bytes`);
      return;
    }

    // 기존 항목이 있으면 메모리에서 제거
    const existing = this.cache.get(key);
    if (existing) {
      this.currentMemory -= existing.size;
    }

    // 새 항목 추가
    const entry: CacheEntry<T> = {
      key,
      value,
      lastAccessed: Date.now(),
      accessCount: 1,
      size: entrySize
    };

    this.cache.set(key, entry);
    this.currentMemory += entrySize;

    // 크기 제한 확인
    this.enforceSizeLimit();
    
    // 메모리 제한 확인
    this.enforceMemoryLimit();
  }

  /**
   * 캐시에서 항목 제거
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentMemory -= entry.size;
      return this.cache.delete(key);
    }
    return false;
  }

  /**
   * 캐시 비우기
   */
  clear(): void {
    this.cache.clear();
    this.currentMemory = 0;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * 캐시 크기 제한 적용
   */
  private enforceSizeLimit(): void {
    while (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.delete(firstKey);
      }
    }
  }

  /**
   * 메모리 제한 적용
   */
  private enforceMemoryLimit(): void {
    while (this.currentMemory > this.maxMemory && this.cache.size > 0) {
      // 가장 오래된 항목 제거
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.delete(oldestKey);
      }
    }
  }

  /**
   * 값의 크기 추정
   */
  private estimateSize(value: T): number {
    if (typeof value === 'string') {
      return value.length * 2; // UTF-16 문자당 2바이트
    }
    
    if (value && typeof value === 'object') {
      try {
        return JSON.stringify(value).length * 2;
      } catch {
        return 1024; // 기본값
      }
    }
    
    return 64; // 기본값
  }

  /**
   * 캐시 통계 반환
   */
  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      memoryUsage: this.currentMemory,
      maxMemory: this.maxMemory,
      hitRate: total > 0 ? this.hits / total : 0,
      missRate: total > 0 ? this.misses / total : 0,
      hits: this.hits,
      misses: this.misses
    };
  }

  /**
   * 캐시 크기 반환
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 캐시에 키가 있는지 확인
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }
}

export class MemoryOptimizationService {
  private chunkCache: LRUCache<Chunk>;
  private textCache: LRUCache<string>;
  private memoryStats: MemoryStats = {
    totalChunks: 0,
    activeChunks: 0,
    cachedChunks: 0,
    memoryUsage: 0,
    hitRate: 0,
    missRate: 0
  };

  constructor() {
    // 청크 캐시: 최대 20개, 1MB
    this.chunkCache = new LRUCache<Chunk>(20, 1024 * 1024);
    
    // 텍스트 캐시: 최대 10개, 1MB
    this.textCache = new LRUCache<string>(10, 1024 * 1024);
  }

  /**
   * 청크 캐시에 저장
   */
  cacheChunk(chunk: Chunk): void {
    this.chunkCache.set(chunk.id, chunk);
    this.updateStats();
  }

  /**
   * 청크 캐시에서 가져오기
   */
  getChunk(chunkId: string): Chunk | null {
    const chunk = this.chunkCache.get(chunkId);
    if (chunk) {
      this.updateStats();
    }
    return chunk;
  }

  /**
   * 텍스트 캐시에 저장
   */
  cacheText(key: string, text: string): void {
    this.textCache.set(key, text);
    this.updateStats();
  }

  /**
   * 텍스트 캐시에서 가져오기
   */
  getText(key: string): string | null {
    const text = this.textCache.get(key);
    if (text) {
      this.updateStats();
    }
    return text;
  }

  /**
   * 여러 청크를 한 번에 캐시
   */
  cacheChunks(chunks: Chunk[]): void {
    chunks.forEach(chunk => {
      this.cacheChunk(chunk);
    });
  }

  /**
   * 관련 청크들을 스마트하게 로드
   */
  async loadRelatedChunks(
    questionKeywords: string[],
    allChunks: Chunk[],
    maxChunks: number = 10
  ): Promise<Chunk[]> {
    // 1. 캐시에서 관련 청크 찾기
    const cachedChunks: Chunk[] = [];
    const uncachedChunkIds: string[] = [];

    for (const chunk of allChunks) {
      if (this.chunkCache.has(chunk.id)) {
        const cachedChunk = this.getChunk(chunk.id);
        if (cachedChunk && this.isChunkRelevant(cachedChunk, questionKeywords)) {
          cachedChunks.push(cachedChunk);
        }
      } else {
        if (this.isChunkRelevant(chunk, questionKeywords)) {
          uncachedChunkIds.push(chunk.id);
        }
      }
    }

    // 2. 캐시되지 않은 관련 청크들을 캐시에 로드
    const uncachedChunks = allChunks.filter(chunk => 
      uncachedChunkIds.includes(chunk.id)
    );

    // 3. 관련도 순으로 정렬하고 상위 청크들만 캐시
    const sortedChunks = this.sortChunksByRelevance(uncachedChunks, questionKeywords);
    const topChunks = sortedChunks.slice(0, maxChunks - cachedChunks.length);
    
    topChunks.forEach(chunk => {
      this.cacheChunk(chunk);
    });

    // 4. 모든 관련 청크 반환
    const allRelevantChunks = [...cachedChunks, ...topChunks];
    return this.sortChunksByRelevance(allRelevantChunks, questionKeywords).slice(0, maxChunks);
  }

  /**
   * 청크가 질문과 관련이 있는지 확인
   */
  private isChunkRelevant(chunk: Chunk, questionKeywords: string[]): boolean {
    const chunkText = chunk.content.toLowerCase();
    const chunkKeywords = chunk.keywords.map(k => k.toLowerCase());
    
    // 키워드 매칭 확인
    const keywordMatches = questionKeywords.filter(keyword =>
      chunkText.includes(keyword.toLowerCase()) ||
      chunkKeywords.some(chunkKeyword => 
        chunkKeyword.includes(keyword.toLowerCase()) ||
        keyword.toLowerCase().includes(chunkKeyword)
      )
    ).length;

    return keywordMatches > 0;
  }

  /**
   * 청크들을 관련도 순으로 정렬
   */
  private sortChunksByRelevance(chunks: Chunk[], questionKeywords: string[]): Chunk[] {
    return chunks
      .map(chunk => ({
        chunk,
        score: this.calculateRelevanceScore(chunk, questionKeywords)
      }))
      .sort((a, b) => b.score - a.score)
      .map(item => item.chunk);
  }

  /**
   * 청크의 관련도 점수 계산
   */
  private calculateRelevanceScore(chunk: Chunk, questionKeywords: string[]): number {
    let score = 0;
    const chunkText = chunk.content.toLowerCase();
    const chunkKeywords = chunk.keywords.map(k => k.toLowerCase());

    // 1. 키워드 매칭 점수
    questionKeywords.forEach(keyword => {
      const keywordLower = keyword.toLowerCase();
      
      // 텍스트에서 직접 매칭
      const textMatches = (chunkText.match(new RegExp(keywordLower, 'g')) || []).length;
      score += textMatches * 10;
      
      // 청크 키워드에서 매칭
      const keywordMatches = chunkKeywords.filter(chunkKeyword => 
        chunkKeyword.includes(keywordLower) || keywordLower.includes(chunkKeyword)
      ).length;
      score += keywordMatches * 15;
    });

    // 2. 청크 품질 점수
    if (chunk.content.length > 500 && chunk.content.length < 3000) {
      score += 5; // 이상적인 길이
    }

    // 3. 구조적 요소 점수
    if (chunk.content.includes('제') && chunk.content.includes('조')) {
      score += 3; // 법조문
    }
    if (chunk.content.includes('규정') || chunk.content.includes('지침')) {
      score += 2; // 규정 관련
    }

    return Math.max(0, score);
  }

  /**
   * 메모리 통계 업데이트
   */
  private updateStats(): void {
    const chunkStats = this.chunkCache.getStats();
    const textStats = this.textCache.getStats();
    
    this.memoryStats = {
      totalChunks: this.chunkCache.size() + this.textCache.size(),
      activeChunks: this.chunkCache.size(),
      cachedChunks: this.chunkCache.size(),
      memoryUsage: chunkStats.memoryUsage + textStats.memoryUsage,
      hitRate: (chunkStats.hitRate + textStats.hitRate) / 2,
      missRate: (chunkStats.missRate + textStats.missRate) / 2
    };
  }

  /**
   * 메모리 통계 반환
   */
  getMemoryStats(): MemoryStats {
    this.updateStats();
    return { ...this.memoryStats };
  }

  /**
   * 캐시 정리 (오래된 항목 제거)
   */
  cleanup(): void {
    // 현재는 LRU가 자동으로 관리하므로 특별한 정리 불필요
    this.updateStats();
  }

  /**
   * 모든 캐시 비우기
   */
  clearAll(): void {
    this.chunkCache.clear();
    this.textCache.clear();
    this.updateStats();
  }

  /**
   * 메모리 사용량이 임계값을 초과했는지 확인
   */
  isMemoryPressureHigh(): boolean {
    const stats = this.getMemoryStats();
    return stats.memoryUsage > 1.5 * 1024 * 1024; // 1.5MB 초과
  }

  /**
   * 압박 상황에서 캐시 크기 축소
   */
  reduceCacheSize(): void {
    // 가장 오래된 항목들을 제거
    const chunkStats = this.chunkCache.getStats();
    if (chunkStats.size > 10) {
      // 청크 캐시 크기를 절반으로 축소
      const keysToRemove = Array.from(this.chunkCache['cache'].keys()).slice(0, Math.floor(chunkStats.size / 2));
      keysToRemove.forEach(key => this.chunkCache.delete(key));
    }
    
    this.updateStats();
  }
}

// 싱글톤 인스턴스
export const memoryOptimizationService = new MemoryOptimizationService();
