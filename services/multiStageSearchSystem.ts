/**
 * 다단계 검색 시스템
 * 단계별 검색 결과 통합 및 검색 정확도 향상
 */

import { Chunk, QuestionAnalysis } from '../types';
import { FirestoreService, PDFChunk } from './firestoreService';
import { ContextQualityOptimizer, EnhancedChunk } from './contextQualityOptimizer';
import { UnifiedSynonymService } from './unifiedSynonymService';
import { ComprehensiveSynonymExpansion } from './comprehensiveSynonymExpansion';

export interface SearchStage {
  name: string;
  weight: number;
  results: Chunk[];
  executionTime: number;
  success: boolean;
}

export interface MultiStageSearchResult {
  stages: SearchStage[];
  finalResults: EnhancedChunk[];
  totalExecutionTime: number;
  qualityMetrics: {
    totalChunks: number;
    averageRelevance: number;
    searchCoverage: number;
    resultDiversity: number;
  };
}

export class MultiStageSearchSystem {
  private firestoreService: FirestoreService;
  private unifiedSynonymService: UnifiedSynonymService = UnifiedSynonymService.getInstance();
  private comprehensiveSynonymExpansion: ComprehensiveSynonymExpansion = ComprehensiveSynonymExpansion.getInstance();
  private static readonly MAX_RESULTS_PER_STAGE = 15;
  private static readonly MAX_FINAL_RESULTS = 10;

  constructor() {
    this.firestoreService = FirestoreService.getInstance();
  }

  /**
   * 다단계 검색 실행
   */
  async executeMultiStageSearch(
    questionAnalysis: QuestionAnalysis,
    maxChunks: number = 10
  ): Promise<MultiStageSearchResult> {
    const startTime = Date.now();
    console.log(`🔍 다단계 검색 시작: "${questionAnalysis.context}"`);
    
    const stages: SearchStage[] = [];
    
    try {
      // 1단계: 정확한 키워드 매칭
      const stage1 = await this.executeExactKeywordSearch(questionAnalysis);
      stages.push(stage1);
      
      // 2단계: 동의어 확장 검색
      const stage2 = await this.executeSynonymExpandedSearch(questionAnalysis);
      stages.push(stage2);
      
      // 3단계: 의미적 유사도 검색
      const stage3 = await this.executeSemanticSimilaritySearch(questionAnalysis);
      stages.push(stage3);
      
      // 4단계: 문맥 기반 검색
      const stage4 = await this.executeContextualSearch(questionAnalysis);
      stages.push(stage4);
      
      // 5단계: 하이브리드 검색 (모든 방법 결합)
      const stage5 = await this.executeHybridSearch(questionAnalysis);
      stages.push(stage5);
      
      // 결과 통합 및 랭킹
      const finalResults = await this.mergeAndRankResults(stages, questionAnalysis, maxChunks);
      
      const totalExecutionTime = Date.now() - startTime;
      
      const result: MultiStageSearchResult = {
        stages,
        finalResults,
        totalExecutionTime,
        qualityMetrics: this.calculateQualityMetrics(stages, finalResults)
      };
      
      console.log(`✅ 다단계 검색 완료: ${finalResults.length}개 결과, ${totalExecutionTime}ms`);
      console.log(`📊 검색 품질: 평균 관련성 ${result.qualityMetrics.averageRelevance.toFixed(3)}`);
      
      return result;
      
    } catch (error) {
      console.error('❌ 다단계 검색 오류:', error);
      throw error;
    }
  }

  /**
   * 1단계: 정확한 키워드 매칭
   */
  private async executeExactKeywordSearch(questionAnalysis: QuestionAnalysis): Promise<SearchStage> {
    const startTime = Date.now();
    console.log(`🔍 1단계: 정확한 키워드 매칭 시작`);
    
    try {
      const results = await this.firestoreService.searchChunksByKeywords(
        questionAnalysis.keywords,
        undefined,
        this.MAX_RESULTS_PER_STAGE
      );
      
      const chunks = await this.convertPDFChunksToChunks(results);
      const executionTime = Date.now() - startTime;
      
      console.log(`✅ 1단계 완료: ${chunks.length}개 결과, ${executionTime}ms`);
      
      return {
        name: '정확한 키워드 매칭',
        weight: 1.0,
        results: chunks,
        executionTime,
        success: true
      };
    } catch (error) {
      console.error('❌ 1단계 검색 실패:', error);
      return {
        name: '정확한 키워드 매칭',
        weight: 1.0,
        results: [],
        executionTime: Date.now() - startTime,
        success: false
      };
    }
  }

  /**
   * 2단계: 동의어 확장 검색
   */
  private async executeSynonymExpandedSearch(questionAnalysis: QuestionAnalysis): Promise<SearchStage> {
    const startTime = Date.now();
    console.log(`🔍 2단계: 동의어 확장 검색 시작`);
    
    try {
      const expandedKeywords = questionAnalysis.expandedKeywords || questionAnalysis.keywords;
      const results = await this.firestoreService.searchChunksByKeywords(
        expandedKeywords,
        undefined,
        this.MAX_RESULTS_PER_STAGE
      );
      
      const chunks = await this.convertPDFChunksToChunks(results);
      const executionTime = Date.now() - startTime;
      
      console.log(`✅ 2단계 완료: ${chunks.length}개 결과, ${executionTime}ms`);
      
      return {
        name: '동의어 확장 검색',
        weight: 0.8,
        results: chunks,
        executionTime,
        success: true
      };
    } catch (error) {
      console.error('❌ 2단계 검색 실패:', error);
      return {
        name: '동의어 확장 검색',
        weight: 0.8,
        results: [],
        executionTime: Date.now() - startTime,
        success: false
      };
    }
  }

  /**
   * 3단계: 의미적 유사도 검색
   */
  private async executeSemanticSimilaritySearch(questionAnalysis: QuestionAnalysis): Promise<SearchStage> {
    const startTime = Date.now();
    console.log(`🔍 3단계: 의미적 유사도 검색 시작`);
    
    try {
      // 의미적으로 유사한 키워드 생성
      const semanticKeywords = this.generateSemanticKeywords(questionAnalysis);
      
      const results = await this.firestoreService.searchChunksByKeywords(
        semanticKeywords,
        undefined,
        this.MAX_RESULTS_PER_STAGE
      );
      
      const chunks = await this.convertPDFChunksToChunks(results);
      const executionTime = Date.now() - startTime;
      
      console.log(`✅ 3단계 완료: ${chunks.length}개 결과, ${executionTime}ms`);
      
      return {
        name: '의미적 유사도 검색',
        weight: 0.6,
        results: chunks,
        executionTime,
        success: true
      };
    } catch (error) {
      console.error('❌ 3단계 검색 실패:', error);
      return {
        name: '의미적 유사도 검색',
        weight: 0.6,
        results: [],
        executionTime: Date.now() - startTime,
        success: false
      };
    }
  }

  /**
   * 4단계: 문맥 기반 검색
   */
  private async executeContextualSearch(questionAnalysis: QuestionAnalysis): Promise<SearchStage> {
    const startTime = Date.now();
    console.log(`🔍 4단계: 문맥 기반 검색 시작`);
    
    try {
      const results = await this.firestoreService.searchChunksByText(
        questionAnalysis.context,
        undefined,
        this.MAX_RESULTS_PER_STAGE
      );
      
      const chunks = await this.convertPDFChunksToChunks(results);
      const executionTime = Date.now() - startTime;
      
      console.log(`✅ 4단계 완료: ${chunks.length}개 결과, ${executionTime}ms`);
      
      return {
        name: '문맥 기반 검색',
        weight: 0.4,
        results: chunks,
        executionTime,
        success: true
      };
    } catch (error) {
      console.error('❌ 4단계 검색 실패:', error);
      return {
        name: '문맥 기반 검색',
        weight: 0.4,
        results: [],
        executionTime: Date.now() - startTime,
        success: false
      };
    }
  }

  /**
   * 5단계: 하이브리드 검색
   */
  private async executeHybridSearch(questionAnalysis: QuestionAnalysis): Promise<SearchStage> {
    const startTime = Date.now();
    console.log(`🔍 5단계: 하이브리드 검색 시작`);
    
    try {
      // 모든 검색 방법을 결합한 키워드 생성
      const hybridKeywords = [
        ...questionAnalysis.keywords,
        ...(questionAnalysis.expandedKeywords || []),
        ...this.generateSemanticKeywords(questionAnalysis)
      ];
      
      // 중복 제거
      const uniqueKeywords = [...new Set(hybridKeywords)];
      
      const results = await this.firestoreService.searchChunksByKeywords(
        uniqueKeywords,
        undefined,
        this.MAX_RESULTS_PER_STAGE
      );
      
      const chunks = await this.convertPDFChunksToChunks(results);
      const executionTime = Date.now() - startTime;
      
      console.log(`✅ 5단계 완료: ${chunks.length}개 결과, ${executionTime}ms`);
      
      return {
        name: '하이브리드 검색',
        weight: 0.9,
        results: chunks,
        executionTime,
        success: true
      };
    } catch (error) {
      console.error('❌ 5단계 검색 실패:', error);
      return {
        name: '하이브리드 검색',
        weight: 0.9,
        results: [],
        executionTime: Date.now() - startTime,
        success: false
      };
    }
  }

  /**
   * 의미적 키워드 생성 (통합 서비스 사용)
   */
  private generateSemanticKeywords(questionAnalysis: QuestionAnalysis): string[] {
    const keywords = questionAnalysis.keywords;
    
    // 통합 동의어 서비스에서 확장
    const basicExpanded = this.unifiedSynonymService.expandKeywords(keywords);
    
    // 포괄적 동의어 확장 서비스에서 추가 확장
    const comprehensiveExpanded: string[] = [];
    keywords.forEach(keyword => {
      comprehensiveExpanded.push(...this.comprehensiveSynonymExpansion.expandKeyword(keyword));
    });
    
    // 모든 결과 통합 및 중복 제거
    const allExpanded = [...basicExpanded, ...comprehensiveExpanded];
    return [...new Set(allExpanded)]; // 중복 제거
  }

  /**
   * 결과 통합 및 랭킹
   */
  private async mergeAndRankResults(
    stages: SearchStage[],
    questionAnalysis: QuestionAnalysis,
    maxChunks: number
  ): Promise<EnhancedChunk[]> {
    console.log(`🔄 검색 결과 통합 및 랭킹 시작`);
    
    // 모든 결과를 통합
    const allResults = new Map<string, Chunk & { stageWeights: number[] }>();
    
    stages.forEach(stage => {
      stage.results.forEach(chunk => {
        const key = chunk.id;
        if (allResults.has(key)) {
          allResults.get(key)!.stageWeights.push(stage.weight);
        } else {
          allResults.set(key, {
            ...chunk,
            stageWeights: [stage.weight]
          });
        }
      });
    });
    
    // 가중치 계산
    const weightedResults = Array.from(allResults.values()).map(chunk => ({
      ...chunk,
      combinedWeight: chunk.stageWeights.reduce((sum, weight) => sum + weight, 0) / chunk.stageWeights.length
    }));
    
    // 컨텍스트 품질 최적화 적용
    const optimizedResults = ContextQualityOptimizer.optimizeContextQuality(
      weightedResults,
      questionAnalysis,
      maxChunks
    );
    
    console.log(`✅ 결과 통합 완료: ${optimizedResults.length}개 최종 결과`);
    
    return optimizedResults;
  }

  /**
   * PDFChunk를 Chunk로 변환 (document 정보 조회 포함)
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
          originalSize: pdfChunk.metadata.originalSize || 0,
          documentType: pdfChunk.metadata.documentType
        },
        keywords: pdfChunk.keywords || [],
        location: {
          document: pdfChunk.location?.document || doc?.title || pdfChunk.documentId || 'Unknown',
          section: pdfChunk.location?.section || pdfChunk.metadata.section || 'general',
          page: pdfChunk.location?.page || pdfChunk.metadata.page || 0
        }
      };
    });
  }

  /**
   * 품질 지표 계산
   */
  private calculateQualityMetrics(
    stages: SearchStage[],
    finalResults: EnhancedChunk[]
  ): {
    totalChunks: number;
    averageRelevance: number;
    searchCoverage: number;
    resultDiversity: number;
  } {
    const totalChunks = finalResults.length;
    const averageRelevance = finalResults.length > 0 
      ? finalResults.reduce((sum, chunk) => sum + chunk.qualityMetrics.relevanceScore, 0) / finalResults.length
      : 0;
    
    const successfulStages = stages.filter(stage => stage.success).length;
    const searchCoverage = successfulStages / stages.length;
    
    // 결과 다양성 계산 (문서 유형별 분포)
    const documentTypes = new Set(finalResults.map(chunk => chunk.metadata.documentType));
    const resultDiversity = documentTypes.size / Math.max(finalResults.length, 1);
    
    return {
      totalChunks,
      averageRelevance: Number(averageRelevance.toFixed(3)),
      searchCoverage: Number(searchCoverage.toFixed(3)),
      resultDiversity: Number(resultDiversity.toFixed(3))
    };
  }

  /**
   * 검색 성능 통계 생성
   */
  static generateSearchStatistics(result: MultiStageSearchResult): {
    totalExecutionTime: number;
    averageStageTime: number;
    successfulStages: number;
    totalStages: number;
    resultsPerStage: number[];
    qualityBreakdown: any;
  } {
    const totalExecutionTime = result.totalExecutionTime;
    const averageStageTime = result.stages.reduce((sum, stage) => sum + stage.executionTime, 0) / result.stages.length;
    const successfulStages = result.stages.filter(stage => stage.success).length;
    const totalStages = result.stages.length;
    const resultsPerStage = result.stages.map(stage => stage.results.length);
    
    const qualityBreakdown = ContextQualityOptimizer.generateQualitySummary(result.finalResults);
    
    return {
      totalExecutionTime,
      averageStageTime: Number(averageStageTime.toFixed(2)),
      successfulStages,
      totalStages,
      resultsPerStage,
      qualityBreakdown
    };
  }
}
