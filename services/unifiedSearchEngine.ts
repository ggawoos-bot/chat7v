/**
 * 통합 검색 엔진
 * 중복을 제거하고 성능을 최적화한 단일 검색 시스템
 */

import { Chunk, QuestionAnalysis } from '../types';
import { FirestoreService, PDFChunk } from './firestoreService';
import { ContextQualityOptimizer, EnhancedChunk } from './contextQualityOptimizer';
import { UnifiedSynonymService } from './unifiedSynonymService';
import { ComprehensiveSynonymExpansion } from './comprehensiveSynonymExpansion';
import { LocalEmbeddingService } from './localEmbeddingService';

export interface UnifiedSearchResult {
  chunks: EnhancedChunk[];
  searchMetrics: {
    totalProcessed: number;
    uniqueResults: number;
    averageRelevance: number;
    executionTime: number;
    scoreBreakdown: {
      keyword: number;
      synonym: number;
      semantic: number;
    };
  };
}

export interface ScoredChunk {
  chunk: PDFChunk | Chunk;
  score: number;
  breakdown: {
    keyword: number;
    synonym: number;
    semantic: number;
  };
}

export class UnifiedSearchEngine {
  private firestoreService: FirestoreService;
  private unifiedSynonymService: UnifiedSynonymService;
  private comprehensiveSynonymExpansion: ComprehensiveSynonymExpansion;
  private localEmbeddingService: LocalEmbeddingService;
  
  constructor() {
    this.firestoreService = FirestoreService.getInstance();
    this.unifiedSynonymService = UnifiedSynonymService.getInstance();
    this.comprehensiveSynonymExpansion = ComprehensiveSynonymExpansion.getInstance();
    this.localEmbeddingService = LocalEmbeddingService.getInstance();
  }

  /**
   * 통합 검색 실행 (중복 제거 + 성능 최적화)
   */
  async executeUnifiedSearch(
    questionAnalysis: QuestionAnalysis,
    maxChunks: number = 50  // ✅ 하이브리드 개선: 20 → 50
  ): Promise<UnifiedSearchResult> {
    const startTime = Date.now();
    console.log(`🚀 통합 검색 시작: "${questionAnalysis.context}"`);
    
    try {
      // 1단계: 단일 Firestore 쿼리로 대량 데이터 로드
      console.log('🔍 Firestore 대량 데이터 로드...');
      const allChunks = await this.fetchChunksInBulk(
        questionAnalysis.keywords,
        questionAnalysis.expandedKeywords || [],
        500
      );
      
      console.log(`✅ 대량 데이터 로드 완료: ${allChunks.length}개 청크`);
      
      // 2단계: 다양한 스코어링 방식 적용
      console.log('📊 다중 전략 스코어링 시작...');
      const scoredChunks = await this.scoreChunksByMultipleStrategies(
        allChunks,
        questionAnalysis
      );
      
      console.log(`✅ 스코어링 완료: ${scoredChunks.length}개 청크`);
      
      // 3단계: 결과 정렬 및 중복 제거
      const uniqueChunks = this.removeDuplicatesAndRank(
        scoredChunks,
        maxChunks
      );
      
      console.log(`✅ 중복 제거 완료: ${uniqueChunks.length}개 최종 결과`);
      
      // 4단계: 컨텍스트 품질 최적화
      const chunks: EnhancedChunk[] = uniqueChunks.map(scored => {
        const chunk: EnhancedChunk = {
          ...(scored.chunk as Chunk),
          qualityMetrics: {
            relevanceScore: scored.score,
            completenessScore: scored.score,
            accuracyScore: scored.score,
            clarityScore: scored.score,
            overallScore: scored.score
          },
          contextInfo: {
            documentType: 'PDF',
            section: scored.chunk.metadata?.section || 'general',
            importance: 'medium' as const
          }
        };
        return chunk;
      });
      
      const optimizedChunks = ContextQualityOptimizer.optimizeContextQuality(
        chunks,
        questionAnalysis,
        maxChunks
      );
      
      const executionTime = Date.now() - startTime;
      
      // 점수 통계 계산
      const scoreBreakdown = this.calculateScoreBreakdown(scoredChunks);
      
      const result: UnifiedSearchResult = {
        chunks: optimizedChunks,
        searchMetrics: {
          totalProcessed: allChunks.length,
          uniqueResults: optimizedChunks.length,
          averageRelevance: this.calculateAverageRelevance(optimizedChunks),
          executionTime,
          scoreBreakdown
        }
      };
      
      console.log(`🎉 통합 검색 완료: ${optimizedChunks.length}개 최종 결과, ${executionTime}ms`);
      console.log(`📊 평균 관련성: ${result.searchMetrics.averageRelevance.toFixed(3)}`);
      console.log(`📊 점수 분포: 키워드 ${scoreBreakdown.keyword.toFixed(2)}, 동의어 ${scoreBreakdown.synonym.toFixed(2)}, 의미 ${scoreBreakdown.semantic.toFixed(2)}`);
      
      return result;
      
    } catch (error) {
      console.error('❌ 통합 검색 오류:', error);
      throw error;
    }
  }
  
  /**
   * ✅ 하이브리드 검색: 다단계 병렬 검색 + 폴백
   * 평상시: 키워드 기반 필터링으로 빠른 검색
   * 폴백: 결과 부족 시 전체 스캔으로 안전장치
   */
  private async fetchChunksInBulk(
    keywords: string[],
    expandedKeywords: string[],
    limit: number = 600
  ): Promise<PDFChunk[]> {
    try {
      console.log(`🔍 하이브리드 검색 시작: ${keywords.length}개 키워드, ${expandedKeywords.length}개 동의어`);
      
      // 1단계: 다단계 병렬 검색 (키워드, 동의어, 의미)
      const chunks = await this.fetchChunksWithMultipleStrategies(keywords, expandedKeywords);
      
      console.log(`✅ 1단계 완료: ${chunks.length}개 청크 발견`);
      
      // 2단계: 폴백 검증 (결과 부족 시 전체 스캔)
      if (chunks.length < 50) {
        console.warn(`⚠️ 검색 결과 부족 (${chunks.length}개 < 50개), 전체 스캔 시작...`);
        const allChunks = await this.fetchAllChunks();
        const filteredChunks = this.filterChunksByKeywords(allChunks, [...keywords, ...expandedKeywords]);
        
        console.log(`✅ 폴백 완료: ${filteredChunks.length}개 청크 발견`);
        return filteredChunks;
      }
      
      return chunks;
      
    } catch (error) {
      console.error('❌ 하이브리드 검색 실패:', error);
      return [];
    }
  }

  /**
   * 다단계 병렬 검색 (키워드 + 동의어 + 의미)
   */
  private async fetchChunksWithMultipleStrategies(
    keywords: string[],
    expandedKeywords: string[]
  ): Promise<PDFChunk[]> {
    const results: PDFChunk[] = [];
    
    // 병렬 실행: 3가지 검색 전략
    const [result1, result2, result3] = await Promise.all([
      // 전략1: 기본 키워드 검색
      this.firestoreService.searchChunksByKeywords(keywords, undefined, 500).catch(() => []),
      
      // 전략2: 동의어 확장 검색
      expandedKeywords.length > 0
        ? this.firestoreService.searchChunksByKeywords(expandedKeywords, undefined, 500).catch(() => [])
        : Promise.resolve([]),
      
      // 전략3: 넓은 범위 의미 검색
      this.fetchSemanticChunks(keywords, expandedKeywords, 500).catch(() => [])
    ]);
    
    // 결과 병합
    results.push(...result1);
    results.push(...result2);
    results.push(...result3);
    
    // 중복 제거
    const uniqueChunks = this.deduplicateChunks(results);
    
    return uniqueChunks;
  }

  /**
   * ✅ 개선: 넓은 범위 의미 검색 (Firestore 쿼리 직접 사용)
   * 전체 청크를 로드하지 않고, 키워드 필터링된 청크만 가져오기
   */
  private async fetchSemanticChunks(
    keywords: string[],
    expandedKeywords: string[],
    limit: number
  ): Promise<PDFChunk[]> {
    try {
      // 모든 키워드 통합
      const allKeywords = [...new Set([...keywords, ...expandedKeywords])];
      
      // Firestore에서 키워드 필터링된 청크만 가져오기 (전체 로드 방지)
      const chunks = await this.firestoreService.searchChunksByKeywords(
        allKeywords,
        undefined,
        limit
      );
      
      return chunks;
      
    } catch (error) {
      console.error('❌ 의미 검색 실패:', error);
      return [];
    }
  }

  /**
   * 전체 청크 가져오기 (폴백용)
   */
  private async fetchAllChunks(): Promise<PDFChunk[]> {
    try {
      const allDocuments = await this.firestoreService.getAllDocuments();
      const allChunks: PDFChunk[] = [];
      
      for (const doc of allDocuments) {
        const chunks = await this.firestoreService.getChunksByDocument(doc.id);
        allChunks.push(...chunks);
      }
      
      return allChunks;
      
    } catch (error) {
      console.error('❌ 전체 청크 로드 실패:', error);
      return [];
    }
  }

  /**
   * 키워드로 청크 필터링
   */
  private filterChunksByKeywords(chunks: PDFChunk[], keywords: string[]): PDFChunk[] {
    return chunks.filter(chunk => {
      // keywords 필드 매칭
      if (chunk.keywords?.some(k => keywords.some(kw => k.toLowerCase().includes(kw.toLowerCase())))) {
        return true;
      }
      
      // content 매칭
      const contentLower = chunk.content?.toLowerCase() || '';
      return keywords.some(kw => contentLower.includes(kw.toLowerCase()));
    });
  }

  /**
   * 청크 중복 제거
   */
  private deduplicateChunks(chunks: PDFChunk[]): PDFChunk[] {
    const seen = new Set<string>();
    return chunks.filter(chunk => {
      const key = `${chunk.documentId}_${chunk.metadata?.position || 0}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  
  /**
   * 다중 전략 스코어링 (중복 없음)
   */
  private async scoreChunksByMultipleStrategies(
    chunks: PDFChunk[],
    questionAnalysis: QuestionAnalysis
  ): Promise<Array<{ chunk: Chunk; score: number; breakdown: any }>> {
    // ✅ PDFChunk를 Chunk로 변환
    const convertedChunks = await this.convertPDFChunksToChunks(chunks);
    
    const results: Array<{ chunk: Chunk; score: number; breakdown: any }> = [];
    
    // 질문 임베딩 사전 계산 (벡터 검색에만 사용)
    let questionEmbedding: number[] | null = null;
    try {
      await this.localEmbeddingService.initialize();
      const embedding = await this.localEmbeddingService.embedText(questionAnalysis.context);
      questionEmbedding = embedding;
      console.log(`✅ 질문 임베딩 생성 완료: ${embedding.length}차원`);
    } catch (error) {
      console.warn('⚠️ 질문 임베딩 생성 실패, 벡터 스코어링 제외:', error);
    }
    
    console.log('📊 청크 스코어링 시작...');
    
    // 병렬 처리로 성능 최적화 (배치 처리)
    const BATCH_SIZE = 100;
    for (let i = 0; i < convertedChunks.length; i += BATCH_SIZE) {
      const batch = convertedChunks.slice(i, i + BATCH_SIZE);
      
      const batchPromises = batch.map(async (chunk, index) => {
        const originalChunk = chunks[i + index];
        
        const keywordScore = this.calculateKeywordScore(
          questionAnalysis.keywords,
          originalChunk
        );
        
        const synonymScore = this.calculateSynonymScore(
          questionAnalysis.expandedKeywords || [],
          originalChunk
        );
        
        let semanticScore = 0;
        if (questionEmbedding && originalChunk.embedding) {
          semanticScore = this.calculateSemanticSimilarity(
            questionEmbedding,
            originalChunk.embedding
          );
        }
        
        const totalScore = 
          keywordScore * 0.4 + 
          synonymScore * 0.3 + 
          semanticScore * 0.3;
        
        return {
          chunk,
          score: totalScore,
          breakdown: {
            keyword: keywordScore,
            synonym: synonymScore,
            semantic: semanticScore
          }
        };
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      if (i % 500 === 0) {
        console.log(`  진행률: ${Math.min(i + BATCH_SIZE, convertedChunks.length)}/${convertedChunks.length}`);
      }
    }
    
    return results;
  }
  
  /**
   * 키워드 점수 계산 (0~1)
   */
  private calculateKeywordScore(keywords: string[], chunk: PDFChunk): number {
    let score = 0;
    let matches = 0;
    
    keywords.forEach(keyword => {
      const keywordLower = keyword.toLowerCase();
      const contentLower = (chunk.content || '').toLowerCase();
      const keywordsLower = (chunk.keywords || []).map(k => k.toLowerCase());
      
      // keywords 배열에서 정확히 매칭
      if (keywordsLower.includes(keywordLower)) {
        score += 10;
        matches++;
      }
      // content에서 포함 여부
      else if (contentLower.includes(keywordLower)) {
        const count = (contentLower.match(new RegExp(keywordLower, 'g')) || []).length;
        score += Math.min(count * 2, 10);
        matches++;
      }
    });
    
    if (matches === 0) return 0;
    
    return Math.min(score / (keywords.length * 10), 1.0);
  }
  
  /**
   * 동의어 점수 계산 (0~1)
   */
  private calculateSynonymScore(expandedKeywords: string[], chunk: PDFChunk): number {
    if (expandedKeywords.length === 0) return 0;
    
    let score = 0;
    const contentLower = (chunk.content || '').toLowerCase();
    
    expandedKeywords.forEach(synonym => {
      const synonymLower = synonym.toLowerCase();
      
      if (contentLower.includes(synonymLower)) {
        const count = (contentLower.match(new RegExp(synonymLower, 'g')) || []).length;
        score += Math.min(count, 5);
      }
    });
    
    return Math.min(score / (expandedKeywords.length * 5), 1.0);
  }
  
  /**
   * 의미적 유사도 계산 (코사인 유사도)
   */
  private calculateSemanticSimilarity(vector1: number[], vector2: number[]): number {
    try {
      // 벡터 길이 맞추기
      const maxLength = Math.max(vector1.length, vector2.length);
      const v1 = this.padVector(vector1, maxLength);
      const v2 = this.padVector(vector2, maxLength);
      
      // 내적 계산
      let dotProduct = 0;
      let magnitude1 = 0;
      let magnitude2 = 0;
      
      for (let i = 0; i < maxLength; i++) {
        dotProduct += v1[i] * v2[i];
        magnitude1 += v1[i] * v1[i];
        magnitude2 += v2[i] * v2[i];
      }
      
      magnitude1 = Math.sqrt(magnitude1);
      magnitude2 = Math.sqrt(magnitude2);
      
      if (magnitude1 === 0 || magnitude2 === 0) return 0;
      
      return dotProduct / (magnitude1 * magnitude2);
    } catch (error) {
      console.warn('⚠️ 의미적 유사도 계산 실패:', error);
      return 0;
    }
  }
  
  /**
   * 벡터 길이 맞추기
   */
  private padVector(vector: number[], targetLength: number): number[] {
    if (vector.length >= targetLength) {
      return vector.slice(0, targetLength);
    }
    
    const padded = [...vector];
    while (padded.length < targetLength) {
      padded.push(0);
    }
    return padded;
  }
  
  /**
   * PDFChunk를 Chunk로 변환
   */
  private async convertPDFChunksToChunks(pdfChunks: PDFChunk[]): Promise<Chunk[]> {
    // documentId별로 그룹화하여 중복 조회 방지
    const documentIds = [...new Set(pdfChunks.map(p => p.documentId))];
    
    // 모든 문서 정보 조회
    const documents = await Promise.all(
      documentIds.map(id => this.firestoreService.getDocumentById(id))
    );
    
    // documentId -> PDFDocument 맵 생성
    const docMap = new Map(documents.filter(d => d !== null).map(d => [d.id, d]));
    
    return pdfChunks.map(pdfChunk => {
      const doc = docMap.get(pdfChunk.documentId);
      
      return {
        id: pdfChunk.id || '',
        documentId: pdfChunk.documentId,  // ✅ 추가
        content: pdfChunk.content,
        metadata: {
          source: doc?.filename || 'Firestore',
          title: pdfChunk.metadata.title || doc?.title || 'Unknown',
          page: pdfChunk.metadata.page || 0,
          section: pdfChunk.metadata.section || 'general',
          position: pdfChunk.metadata.position || 0,
          startPosition: pdfChunk.metadata.startPos || 0,
          endPosition: pdfChunk.metadata.endPos || 0,
          originalSize: pdfChunk.metadata.originalSize || 0
        },
        keywords: pdfChunk.keywords || [],
        location: {
          document: doc?.title || pdfChunk.documentId || 'Unknown',
          section: pdfChunk.metadata.section || 'general',
          page: pdfChunk.metadata.page || 0
        }
      };
    });
  }
  
  /**
   * 중복 제거 및 랭킹
   */
  private removeDuplicatesAndRank(
    scoredChunks: Array<{ chunk: Chunk; score: number; breakdown: any }>,
    maxChunks: number
  ): Array<{ chunk: Chunk; score: number; breakdown: any }> {
    // 중복 제거 (동일한 ID)
    const uniqueMap = new Map<string, { chunk: Chunk; score: number; breakdown: any }>();
    
    scoredChunks.forEach(scored => {
      const existing = uniqueMap.get(scored.chunk.id || '');
      
      if (!existing || existing.score < scored.score) {
        uniqueMap.set(scored.chunk.id || '', scored);
      }
    });
    
    // 점수 순으로 정렬
    const uniqueChunks = Array.from(uniqueMap.values());
    uniqueChunks.sort((a, b) => b.score - a.score);
    
    // 최대 개수 제한
    return uniqueChunks.slice(0, maxChunks);
  }
  
  /**
   * 평균 관련성 계산
   */
  private calculateAverageRelevance(chunks: EnhancedChunk[]): number {
    if (chunks.length === 0) return 0;
    
    const sum = chunks.reduce((acc, chunk) => acc + (chunk.relevanceScore || 0), 0);
    return sum / chunks.length;
  }
  
  /**
   * 점수 분포 계산
   */
  private calculateScoreBreakdown(scoredChunks: ScoredChunk[]): {
    keyword: number;
    synonym: number;
    semantic: number;
  } {
    if (scoredChunks.length === 0) {
      return { keyword: 0, synonym: 0, semantic: 0 };
    }
    
    const sums = scoredChunks.reduce(
      (acc, scored) => ({
        keyword: acc.keyword + scored.breakdown.keyword,
        synonym: acc.synonym + scored.breakdown.synonym,
        semantic: acc.semantic + scored.breakdown.semantic
      }),
      { keyword: 0, synonym: 0, semantic: 0 }
    );
    
    return {
      keyword: sums.keyword / scoredChunks.length,
      synonym: sums.synonym / scoredChunks.length,
      semantic: sums.semantic / scoredChunks.length
    };
  }
}
