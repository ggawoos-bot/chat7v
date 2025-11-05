/**
 * 로컬 임베딩 서비스 (Transformers.js 기반)
 * 외부 API 없이 브라우저에서 의미적 임베딩 생성
 */

import { pipeline, env } from '@xenova/transformers';

// 모델 캐시 최적화
env.allowLocalModels = true;
env.useBrowserCache = true;
env.allowRemoteModels = true; // 원격 모델 허용 (자동 다운로드)
env.useCustomCache = true; // 커스텀 캐시 사용
env.modelCachePath = 'indexeddb://'; // IndexedDB에 모델 캐싱

export class LocalEmbeddingService {
  private static instance: LocalEmbeddingService;
  private generateEmbedding: any = null;
  private modelLoading: Promise<any> | null = null;
  private cache = new Map<string, number[]>();

  private constructor() {}

  public static getInstance(): LocalEmbeddingService {
    if (!LocalEmbeddingService.instance) {
      LocalEmbeddingService.instance = new LocalEmbeddingService();
    }
    return LocalEmbeddingService.instance;
  }

  /**
   * 모델 초기화
   */
  async initialize() {
    if (this.generateEmbedding) {
      console.log('✅ 로컬 임베딩 모델 이미 로드됨');
      return;
    }

    if (this.modelLoading) {
      console.log('⏳ 모델 로딩 중... 재사용');
      return this.modelLoading;
    }

    console.log('🔄 로컬 임베딩 모델 로딩 시작...');
    
    this.modelLoading = pipeline(
      'feature-extraction',
      'Xenova/paraphrase-multilingual-MiniLM-L12-v2', // 다국어 지원 모델
      {
        quantized: true, // 양자화된 모델 사용 (용량 절감)
        progress_callback: (progress: any) => {
          if (progress.status === 'progress') {
            console.log(`📊 모델 로딩 진행: ${(progress.progress * 100).toFixed(0)}%`);
          }
        }
      }
    ).then((model: any) => {
      this.generateEmbedding = model;
      console.log('✅ 로컬 임베딩 모델 로드 완료');
      this.modelLoading = null;
      return model;
    }).catch((error: any) => {
      console.error('❌ 로컬 임베딩 모델 로드 실패:', error);
      this.modelLoading = null;
      throw error;
    });

    return this.modelLoading;
  }

  /**
   * 텍스트 임베딩 생성 (캐싱 포함)
   */
  async embedText(text: string): Promise<number[]> {
    // ✅ 캐시 확인
    const hash = this.hashText(text);
    if (this.cache.has(hash)) {
      console.log('📦 캐시된 임베딩 사용');
      return this.cache.get(hash)!;
    }

    // ✅ 모델 로딩 확인
    if (!this.generateEmbedding) {
      console.log('🔄 모델 로딩 필요');
      await this.initialize();
    }

    console.log(`🔍 임베딩 생성: "${text.substring(0, 50)}..."`);

    try {
      // 🔴 로컬에서 임베딩 생성 (API 호출 없음!)
      const output = await this.generateEmbedding(text, {
        pooling: 'mean',
        normalize: true,
      });

      const embedding = Array.from(output.data) as number[];

      // ✅ 캐시에 저장
      this.cache.set(hash, embedding);

      // 최대 1000개만 캐싱 (메모리 관리)
      if (this.cache.size > 1000) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
        console.log('🗑️ 임베딩 캐시 최대치 도달, 오래된 항목 삭제');
      }

      console.log(`✅ 임베딩 생성 완료: ${embedding.length}차원`);
      return embedding;

    } catch (error) {
      console.error('❌ 임베딩 생성 실패:', error);
      throw error;
    }
  }

  /**
   * 코사인 유사도 계산
   */
  cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
      console.warn('⚠️ 벡터 차원 불일치:', vec1.length, vec2.length);
      return 0;
    }

    let dotProduct = 0;
    let mag1 = 0;
    let mag2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      mag1 += vec1[i] * vec1[i];
      mag2 += vec2[i] * vec2[i];
    }

    mag1 = Math.sqrt(mag1);
    mag2 = Math.sqrt(mag2);

    if (mag1 === 0 || mag2 === 0) {
      return 0;
    }

    return dotProduct / (mag1 * mag2);
  }

  /**
   * 텍스트 해시 생성
   */
  private hashText(text: string): string {
    return text.toLowerCase().trim();
  }

  /**
   * 캐시 상태 확인
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      maxSize: 1000,
    };
  }

  /**
   * 캐시 초기화
   */
  clearCache() {
    this.cache.clear();
    console.log('🗑️ 임베딩 캐시 초기화');
  }
}

export const localEmbeddingService = LocalEmbeddingService.getInstance();

