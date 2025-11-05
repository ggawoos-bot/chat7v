import { GoogleGenAI } from '@google/generative-ai';
import { FirestoreService, PDFChunk } from './firestoreService';

// 타입 정의
export interface QuestionAnalysis {
  intent: string;
  keywords: string[];
  category: 'definition' | 'procedure' | 'regulation' | 'comparison' | 'analysis' | 'general';
  complexity: 'simple' | 'medium' | 'complex';
  entities: string[];
  context: string;
}

export interface Chunk {
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
  };
  keywords: string[];
  location: {
    document: string;
    section: string;
    page: number;
  };
}

/**
 * 질문 분석기 (AI 기반)
 */
export class QuestionAnalyzer {
  private apiKeys: string[] = [];
  private currentKeyIndex = 0;

  constructor() {
    this.initializeApiKeys();
  }

  /**
   * API 키 초기화
   */
  private initializeApiKeys(): void {
    const primaryKey = import.meta.env.VITE_GEMINI_API_KEY;
    const backupKeys = [
      import.meta.env.VITE_GEMINI_API_KEY_2,
      import.meta.env.VITE_GEMINI_API_KEY_3,
      import.meta.env.VITE_GEMINI_API_KEY_4,
      import.meta.env.VITE_GEMINI_API_KEY_5
    ].filter(key => key && key.trim() !== '');

    this.apiKeys = [primaryKey, ...backupKeys].filter(key => key && key.trim() !== '');
    console.log(`QuestionAnalyzer API 키 로드: ${this.apiKeys.length}개`);
  }

  /**
   * 사용 가능한 API 키 목록 반환
   */
  private getApiKeys(): string[] {
    return this.apiKeys.filter(key => key && key.trim() !== '');
  }

  /**
   * 다음 사용 가능한 API 키 선택
   */
  private getNextAvailableKey(): string | null {
    const availableKeys = this.getApiKeys();
    if (availableKeys.length === 0) {
      return null;
    }

    const selectedKey = availableKeys[this.currentKeyIndex % availableKeys.length];
    const keyIndex = this.currentKeyIndex;
    this.currentKeyIndex = (this.currentKeyIndex + 1) % availableKeys.length;
    
    console.log(`QuestionAnalyzer API 키 선택: ${selectedKey.substring(0, 10)}... (인덱스: ${keyIndex})`);
    
    return selectedKey;
  }

  /**
   * 강화된 AI 질문 분석 (다중 재시도 + 에러 처리)
   */
  async analyzeQuestion(question: string): Promise<QuestionAnalysis> {
    console.log(`🔍 질문 분석 시작: "${question}"`);
    
    try {
      // 강화된 재시도 메커니즘 사용
      const analysis = await this.analyzeWithRetry(question);
      console.log(`✅ 질문 분석 완료: ${analysis.intent}`);
      return analysis;
      
    } catch (error) {
      console.error('❌ 모든 AI 분석 시도 실패:', error);
      
      // 상세한 에러 정보와 함께 시스템 종료
      const errorMessage = `
AI 질문 분석 서비스를 사용할 수 없습니다.

오류 상세:
- 원인: ${error instanceof Error ? error.message : '알 수 없는 오류'}
- 시간: ${new Date().toISOString()}
- 질문: "${question}"

해결 방법:
1. 페이지를 새로고침해주세요
2. 잠시 후 다시 시도해주세요
3. 문제가 지속되면 관리자에게 문의해주세요

시스템을 다시 시작합니다...
      `;
      
      console.error(errorMessage);
      throw new Error('AI 분석 서비스 실패: ' + (error instanceof Error ? error.message : '알 수 없는 오류'));
    }
  }

  /**
   * 강화된 AI 질문 분석 (다중 재시도)
   */
  private async analyzeWithRetry(question: string): Promise<QuestionAnalysis> {
    const apiKeys = this.getApiKeys();
    const models = ['gemini-1.5-flash', 'gemini-1.0-pro'];
    
    for (const model of models) {
      for (const apiKey of apiKeys) {
        try {
          console.log(`AI 분석 시도: ${model} with ${apiKey.substring(0, 10)}...`);
          return await this.analyzeWithModel(question, model, apiKey);
        } catch (error) {
          console.warn(`AI 분석 실패: ${model} with ${apiKey.substring(0, 10)}...`, error);
          continue;
        }
      }
    }
    
    throw new Error('모든 AI 모델과 API 키로 분석에 실패했습니다.');
  }

  /**
   * 특정 모델과 API 키로 분석
   */
  private async analyzeWithModel(question: string, model: string, apiKey: string): Promise<QuestionAnalysis> {
    const ai = new GoogleGenAI({ apiKey });
    const aiModel = ai.getGenerativeModel({ model });

    const analysisPrompt = `
다음 질문을 분석하여 JSON 형태로 답변해주세요:

질문: "${question}"

다음 형식으로 분석해주세요:
{
  "intent": "질문의 의도 (예: 금연구역 지정 절차 문의, 규정 내용 확인 등)",
  "keywords": ["핵심 키워드 배열"],
  "category": "질문 카테고리 (definition/procedure/regulation/comparison/analysis/general)",
  "complexity": "복잡도 (simple/medium/complex)",
  "entities": ["질문에서 언급된 구체적 개체들"],
  "context": "질문의 맥락 설명"
}

분석 기준:
- category: definition(정의), procedure(절차), regulation(규정), comparison(비교), analysis(분석), general(일반)
- complexity: simple(단순), medium(중간), complex(복잡)
- keywords: 질문의 핵심을 나타내는 중요한 단어들
- entities: 구체적인 명사, 기관명, 법령명 등
`;

    const result = await aiModel.generateContent(analysisPrompt);
    const response = await result.response;
    const text = response.text();
    
    return this.parseAnalysisResponse(text);
  }

  /**
   * AI 응답 파싱 (강화된 에러 처리)
   */
  private parseAnalysisResponse(responseText: string): QuestionAnalysis {
    try {
      // JSON 파싱 시도
      const analysis = JSON.parse(responseText);
      return {
        intent: analysis.intent || '일반 문의',
        keywords: analysis.keywords || [],
        category: (analysis.category as QuestionAnalysis['category']) || 'general',
        complexity: (analysis.complexity as QuestionAnalysis['complexity']) || 'simple',
        entities: analysis.entities || [],
        context: analysis.context || ''
      };
    } catch (error) {
      console.error('❌ AI 응답 파싱 실패:', error);
      throw new Error('AI 응답을 파싱할 수 없습니다: ' + (error instanceof Error ? error.message : '알 수 없는 오류'));
    }
  }
}

/**
 * 컨텍스트 선택기 (Firestore 우선)
 */
export class ContextSelector {
  private static chunks: Chunk[] = [];
  private static firestoreService: FirestoreService = FirestoreService.getInstance();

  /**
   * 청크 설정
   */
  static setChunks(chunks: Chunk[]): void {
    this.chunks = chunks;
    console.log(`ContextSelector 청크 설정: ${chunks.length}개`);
  }

  /**
   * 청크 가져오기
   */
  static getChunks(): Chunk[] {
    return this.chunks;
  }

  /**
   * 실시간 PDF 파싱 강제 실행
   */
  private static async forceRealtimeParsing(questionAnalysis: QuestionAnalysis): Promise<Chunk[]> {
    try {
      console.log('🔄 실시간 PDF 파싱 강제 실행 중...');
      
      // GeminiService의 실시간 파싱 메서드 호출
      const geminiService = (window as any).geminiService;
      if (!geminiService) {
        throw new Error('GeminiService를 찾을 수 없습니다.');
      }
      
      // 실시간 PDF 파싱 실행
      await geminiService.loadPdfSourcesOptimized();
      const chunks = geminiService.allChunks || [];
      
      if (chunks.length === 0) {
        throw new Error('실시간 PDF 파싱 결과가 비어있습니다.');
      }
      
      console.log(`✅ 실시간 PDF 파싱 완료: ${chunks.length}개 청크 로드`);
      return chunks;
      
    } catch (error) {
      console.error('❌ 실시간 PDF 파싱 실패:', error);
      throw error;
    }
  }

  /**
   * 질문을 분석하고 관련 컨텍스트를 선택하는 통합 메서드 (Firestore 지원)
   */
  static async selectRelevantContext(
    question: string, 
    questionAnalysis: QuestionAnalysis
  ): Promise<Chunk[]> {
    const allChunks = this.getChunks();
    if (allChunks.length === 0) {
      console.warn('ContextSelector에 설정된 청크가 없습니다.');
      return [];
    }
    
    return await this.selectRelevantContexts(questionAnalysis, allChunks);
  }

  /**
   * Firestore에서 관련 컨텍스트 검색
   */
  static async selectRelevantContexts(
    questionAnalysis: QuestionAnalysis,
    allChunks: Chunk[], // This will be the fallback if Firestore fails
    maxChunks: number = 5
  ): Promise<Chunk[]> {
    console.log(`🔍 컨텍스트 선택 시작: "${questionAnalysis.intent}"`);
    
    // 1. Firestore에서 키워드 기반 검색
    let firestoreChunks: Chunk[] = [];
    try {
      const firestoreResults = await this.firestoreService.searchChunksByKeywords(
        questionAnalysis.keywords,
        undefined,
        maxChunks * 2
      );
      
      // Firestore 결과를 Chunk 형식으로 변환
      firestoreChunks = firestoreResults.map((chunk: PDFChunk) => ({
        id: chunk.id || `firestore-${Math.random()}`,
        content: chunk.content,
        metadata: {
          source: chunk.metadata?.source || 'Firestore',
          title: chunk.metadata?.title || 'Unknown',
          page: chunk.metadata?.page || 1,
          section: chunk.metadata?.section || 'Unknown',
          position: chunk.metadata?.position || 0,
          startPosition: chunk.metadata?.startPosition || 0,
          endPosition: chunk.metadata?.endPosition || 0,
          originalSize: chunk.metadata?.originalSize || 0
        },
        keywords: chunk.keywords || [],
        location: {
          document: chunk.metadata?.source || 'Unknown',
          section: chunk.metadata?.section || 'Unknown',
          page: chunk.metadata?.page || 1
        }
      }));
      
      console.log(`✅ Firestore 검색 완료: ${firestoreChunks.length}개 청크`);
    } catch (error) {
      console.warn('⚠️ Firestore 검색 실패:', error);
    }

    // 2. Firestore에서 텍스트 기반 검색 (키워드 검색 결과가 부족한 경우)
    if (firestoreChunks.length < maxChunks) {
      try {
        const textResults = await this.firestoreService.searchChunksByText(
          questionAnalysis.context,
          undefined,
          maxChunks
        );
        
        // 중복 제거하면서 추가
        const additionalChunks = textResults
          .filter(chunk => !firestoreChunks.some(existing => existing.id === chunk.id))
          .map((chunk: PDFChunk) => ({
            id: chunk.id || `firestore-text-${Math.random()}`,
            content: chunk.content,
            metadata: {
              source: chunk.metadata?.source || 'Firestore',
              title: chunk.metadata?.title || 'Unknown',
              page: chunk.metadata?.page || 1,
              section: chunk.metadata?.section || 'Unknown',
              position: chunk.metadata?.position || 0,
              startPosition: chunk.metadata?.startPosition || 0,
              endPosition: chunk.metadata?.endPosition || 0,
              originalSize: chunk.metadata?.originalSize || 0
            },
            keywords: chunk.keywords || [],
            location: {
              document: chunk.metadata?.source || 'Unknown',
              section: chunk.metadata?.section || 'Unknown',
              page: chunk.metadata?.page || 1
            }
          }));
        
        firestoreChunks = [...firestoreChunks, ...additionalChunks];
        console.log(`✅ Firestore 텍스트 검색 완료: ${additionalChunks.length}개 추가 청크`);
      } catch (error) {
        console.warn('⚠️ Firestore 텍스트 검색 실패:', error);
      }
    }
    
    // Firestore 결과가 있으면 사용, 없으면 로컬 청크 사용
    const chunksToUse = firestoreChunks.length > 0 ? firestoreChunks : allChunks;
    
    if (chunksToUse.length === 0) {
      console.warn('⚠️ 사용 가능한 청크가 없습니다. 실시간 PDF 파싱을 강제 실행합니다.');
      
      try {
        // 실시간 PDF 파싱 강제 실행
        const realtimeChunks = await this.forceRealtimeParsing(questionAnalysis);
        
        if (realtimeChunks.length === 0) {
          throw new Error('실시간 PDF 파싱도 실패했습니다.');
        }
        
        console.log(`✅ 실시간 PDF 파싱 성공: ${realtimeChunks.length}개 청크 로드`);
        return realtimeChunks;
        
      } catch (error) {
        console.error('❌ 실시간 PDF 파싱 실패:', error);
        
        // 최종 에러 메시지
        const errorChunks: Chunk[] = [
          {
            id: 'error-1',
            content: `
시스템에 일시적인 문제가 발생했습니다.

현재 상태:
- Firestore: 데이터 로드 실패
- 실시간 PDF 파싱: 실패
- 오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}

해결 방법:
1. 페이지를 새로고침해주세요
2. 잠시 후 다시 시도해주세요
3. 문제가 지속되면 관리자에게 문의해주세요

시스템을 다시 시작합니다...
            `,
            metadata: {
              source: '시스템',
              title: '시스템 오류',
              page: 1,
              section: '오류',
              position: 1,
              startPosition: 0,
              endPosition: 200,
              originalSize: 200
            },
            keywords: ['오류', '시스템', '문제'],
            location: {
              document: '시스템',
              section: '오류',
              page: 1
            }
          }
        ];
        
        return errorChunks;
      }
    }

    // 키워드 기반 점수 계산
    const scoredChunks = chunksToUse.map(chunk => {
      let score = 0;

      // 1. 키워드 매칭 점수
      const keywordMatches = questionAnalysis.keywords.filter(keyword =>
        chunk.keywords.some(chunkKeyword =>
          chunkKeyword.toLowerCase().includes(keyword.toLowerCase()) ||
          keyword.toLowerCase().includes(chunkKeyword.toLowerCase())
        )
      ).length;

      score += keywordMatches * 10;

      // 2. 내용 매칭 점수
      const contentMatches = questionAnalysis.keywords.filter(keyword =>
        chunk.content.toLowerCase().includes(keyword.toLowerCase())
      ).length;

      score += contentMatches * 5;

      // 3. 카테고리 매칭 점수
      if (questionAnalysis.category === 'definition' && chunk.metadata.section.includes('정의')) {
        score += 15;
      } else if (questionAnalysis.category === 'procedure' && chunk.metadata.section.includes('절차')) {
        score += 15;
      } else if (questionAnalysis.category === 'regulation' && chunk.metadata.section.includes('규정')) {
        score += 15;
      }

      // 4. 복잡도 매칭 점수
      if (questionAnalysis.complexity === 'complex' && chunk.content.length > 500) {
        score += 10;
      } else if (questionAnalysis.complexity === 'simple' && chunk.content.length < 200) {
        score += 5;
      }

      return {
        chunk,
        score
      };
    });

    // 점수순으로 정렬하고 상위 청크 선택
    const sortedChunks = scoredChunks
      .sort((a, b) => b.score - a.score)
      .slice(0, maxChunks)
      .map(item => item.chunk);

    console.log(`✅ 컨텍스트 선택 완료: ${sortedChunks.length}개 청크 (최고 점수: ${scoredChunks[0]?.score || 0})`);
    
    return sortedChunks;
  }

  /**
   * Jaccard 유사도 계산
   */
  private static calculateJaccardSimilarity(questionWords: string[], chunkWords: string[]): number {
    const intersection = questionWords.filter(word => chunkWords.includes(word));
    const union = [...new Set([...questionWords, ...chunkWords])];
    
    return intersection.length / union.length; // Jaccard 유사도
  }
}

// 싱글톤 인스턴스 생성
export const questionAnalyzer = new QuestionAnalyzer();
export const contextSelector = ContextSelector;
