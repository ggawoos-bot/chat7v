import { GoogleGenAI } from '@google/genai';
import { FirestoreService, PDFChunk } from './firestoreService';
import { Chunk, QuestionAnalysis } from '../types';
import { UnifiedSynonymService } from './unifiedSynonymService';
import { ComprehensiveSynonymExpansion } from './comprehensiveSynonymExpansion';
import { DynamicSynonymService } from './dynamicSynonymService';
import { ContextQualityOptimizer, EnhancedChunk } from './contextQualityOptimizer';
import { MultiStageSearchSystem } from './multiStageSearchSystem';
import { SemanticSearchEngine } from './semanticSearchEngine';
import { AnswerValidationSystem } from './answerValidationSystem';
import { PromptEngineeringSystem } from './promptEngineeringSystem';

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
   * 강화된 AI 질문 분석 (같은 모델 재시도)
   */
  private async analyzeWithRetry(question: string): Promise<QuestionAnalysis> {
    const apiKeys = this.getApiKeys();
    const model = 'gemini-2.5-flash';
    
    for (const apiKey of apiKeys) {
      try {
        console.log(`AI 분석 시도: ${model} with ${apiKey.substring(0, 10)}...`);
        return await this.analyzeWithModel(question, model, apiKey);
      } catch (error) {
        console.warn(`AI 분석 실패: ${model} with ${apiKey.substring(0, 10)}...`, error);
        continue;
      }
    }
    
    throw new Error('모든 API 키로 분석에 실패했습니다.');
  }

  /**
   * 특정 모델과 API 키로 분석
   */
  private async analyzeWithModel(question: string, model: string, apiKey: string): Promise<QuestionAnalysis> {
    const ai = new GoogleGenAI({ apiKey });
    const chat = ai.chats.create({
      model: model,
      config: {
        systemInstruction: 'You are an expert assistant for analyzing Korean questions about smoking cessation policies and regulations.'
      },
      history: [],
    });

      const analysisPrompt = `
다음 질문을 분석하여 JSON 형태로 답변해주세요:

질문: "${question}"

다음 형식으로 분석해주세요:
{
  "intent": "질문의 의도 (예: 금연구역 지정 절차 문의, 규정 내용 확인 등)",
  "keywords": ["핵심 키워드 배열"],
  "expandedKeywords": ["확장된 키워드 배열 (동의어, 유사어, 전문용어 포함)"],
  "category": "질문 카테고리 (definition/procedure/regulation/comparison/analysis/general)",
  "complexity": "복잡도 (simple/medium/complex)",
  "entities": ["질문에서 언급된 구체적 개체들"],
  "context": "질문의 맥락 설명"
}

분석 기준:
- category: definition(정의), procedure(절차), regulation(규정), comparison(비교), analysis(분석), general(일반)
- complexity: simple(단순), medium(중간), complex(복잡)
- keywords: 질문의 핵심을 나타내는 중요한 단어들 (조사 제거 필수)
- expandedKeywords: 관련 동의어, 유사어, 전문용어를 포함한 확장된 키워드 목록
- entities: 구체적인 명사, 기관명, 법령명 등

**중요 - 키워드 추출 규칙:**
1. 조사가 붙은 단어에서 원형 단어를 추출하세요
   - 예: "항공기에서 흡연" → keywords: ["항공기", "흡연"] (조사 "에서" 제거)
   - 예: "공항에서 흡연하면" → keywords: ["공항", "흡연"] (조사 "에서", "하면" 제거)
   - 예: "학교에서 금연하면" → keywords: ["학교", "금연"] (조사 제거)
2. 일반적인 조사/보조사: 은, 는, 이, 가, 을, 를, 에, 의, 와, 과, 도, 만, 에서, 에게, 한테, 께, 로, 으로, 하면, 하면은, 하면에, 하면을 등
3. 문장 종결어미는 키워드에서 제외: 다, 니다, 요, 어요, 아요, 세요, 지요 등
4. 조사가 붙은 단어는 원형으로 추출하되, 조사 자체는 키워드에 포함하지 않음

특별히 다음 용어들의 관련 키워드를 확장해주세요:
- 금연: 흡연금지, 담배금지, 니코틴금지, 흡연제한, 금연구역, 금연구역
- 공동주택: 아파트, 연립주택, 다세대주택, 주택단지, 아파트단지
- 어린이집: 보육시설, 유치원, 어린이보호시설, 보육원
- 학교: 교육시설, 학원, 교실, 강의실
- 병원: 의료시설, 클리닉, 의원, 보건소
- 항공기: 비행기, 항공편, 기내, 항공, 항공기내부, 항공기내, 항공기안
- 공항: 공항시설, 공항터미널, 공항내, 공항안, 공항시설법
- 법령: 법규, 규정, 조항, 법률, 시행령, 시행규칙
- 위반: 위배, 위법, 불법, 금지행위, 규정위반
- 벌금: 과태료, 처벌, 제재, 벌칙, 과징금

**중요**: Markdown 코드 블록을 사용하지 말고 순수한 JSON 객체만 반환해주세요.
`;

    console.log(`🔍 AI 모델 호출 시작: ${model}`);
    console.log(`🔍 프롬프트:`, analysisPrompt.substring(0, 200) + '...');
    
    const result = await chat.sendMessage({ message: analysisPrompt });
    const text = result.text;
      
      console.log(`🔍 AI 원본 응답:`, text);
      console.log(`🔍 응답 길이:`, text.length);
      console.log(`🔍 응답 시작 부분:`, text.substring(0, 100));
      console.log(`🔍 응답 끝 부분:`, text.substring(Math.max(0, text.length - 100)));
      
    // ✅ 개선: originalQuestion 파라미터 전달
    return this.parseAnalysisResponse(text, question);
  }

  /**
   * 키워드에서 조사 제거 및 정규화 (근본적 해결)
   */
  private normalizeKeywords(keywords: string[]): string[] {
    const normalized: string[] = [];
    
    // 한국어 조사 및 종결어미 목록 (확장)
    const particles = [
      // 조사
      '은', '는', '이', '가', '을', '를', '에', '의', '와', '과', 
      '도', '만', '조차', '마저', '까지', '부터', '에서', '에게', 
      '한테', '께', '로', '으로', '만', '도', '라도', '이라도',
      // 조동사/종결어미
      '하면', '하면은', '하면에', '하면을', '하면의', '하면도', '하면만',
      '하면서', '하면서는', '하면서도', '하면서만',
      '하지만', '하지만은', '하지만에', '하지만을',
      // 문장 종결어미
      '다', '니다', '요', '어요', '아요', '세요', '지요', '네요', '어야', '어야지',
      '야', '이야', '이야요', '인가', '인가요', '인지', '인지요'
    ];
    
    keywords.forEach(keyword => {
      if (!keyword || keyword.trim().length === 0) return;
      
      let cleaned = keyword.trim();
      
      // 조사 제거 (긴 조사부터 확인하여 우선 제거)
      const sortedParticles = [...particles].sort((a, b) => b.length - a.length);
      
      for (const particle of sortedParticles) {
        // 단어 끝에 조사가 붙어있는 경우 제거
        if (cleaned.endsWith(particle) && cleaned.length > particle.length) {
          cleaned = cleaned.slice(0, -particle.length);
          break; // 한 번만 제거 (가장 긴 조사 우선)
        }
      }
      
      // 단어 시작에 조사가 붙어있는 경우 제거 (예: "에서항공기")
      for (const particle of sortedParticles) {
        if (cleaned.startsWith(particle) && cleaned.length > particle.length) {
          cleaned = cleaned.slice(particle.length);
          break;
        }
      }
      
      // 최소 2글자 이상이고, 조사가 아닌 경우만 추가
      if (cleaned.length >= 2 && !particles.includes(cleaned)) {
        normalized.push(cleaned);
      }
    });
    
    return normalized;
  }

  /**
   * 질문에서 직접 키워드 추출 (AI 실패 시 폴백)
   */
  private extractKeywordsFromQuestion(question: string): string[] {
    const keywords: string[] = [];
    
    // 한국어 조사 및 불용어
    const particles = [
      '은', '는', '이', '가', '을', '를', '에', '의', '와', '과',
      '도', '만', '조차', '마저', '까지', '부터', '에서', '에게',
      '한테', '께', '로', '으로', '하면', '하지만', '하다', '되다',
      '것', '수', '있', '없', '등', '때', '경우', '위해', '때문'
    ];
    
    // 1. 연속된 한글 단어 추출 (2-15글자)
    const koreanWords = question.match(/[가-힣]{2,15}/g) || [];
    
    koreanWords.forEach(word => {
      let cleaned = word;
      
      // 조사 제거 (긴 조사부터)
      const sortedParticles = [...particles].sort((a, b) => b.length - a.length);
      
      for (const particle of sortedParticles) {
        if (cleaned.endsWith(particle) && cleaned.length > particle.length) {
          cleaned = cleaned.slice(0, -particle.length);
          break;
        }
      }
      
      // 최소 2글자 이상이고, 조사가 아닌 경우만 추가
      if (cleaned.length >= 2 && !particles.includes(cleaned) && !keywords.includes(cleaned)) {
        keywords.push(cleaned);
      }
    });
    
    // 2. 영어 단어 추출 (3글자 이상)
    const englishWords = question.match(/[A-Za-z]{3,}/g) || [];
    englishWords.forEach(word => {
      const lowerWord = word.toLowerCase();
      if (!particles.includes(lowerWord) && !keywords.includes(lowerWord)) {
        keywords.push(lowerWord);
      }
    });
    
    return keywords;
  }

  /**
   * AI 응답 파싱 (강화된 에러 처리)
   */
  private parseAnalysisResponse(responseText: string, originalQuestion?: string): QuestionAnalysis {
    try {
      console.log(`🔍 JSON 파싱 시작: ${responseText.length}자`);
      
      // 1. Markdown 코드 블록 제거
      let cleanedText = responseText
        .replace(/```json\s*/g, '')
        .replace(/```\s*$/g, '')
        .trim();
      
      console.log(`🔍 정제된 텍스트:`, cleanedText.substring(0, 200) + '...');
      
      // 2. JSON 파싱 시도
      const analysis = JSON.parse(cleanedText);
      
      console.log(`✅ JSON 파싱 성공:`, analysis);
      
      // 3. AI가 반환한 키워드 정규화 (조사 제거)
      const aiKeywords = [
        ...(analysis.keywords || []),
        ...(analysis.expandedKeywords || [])
      ];
      
      const normalizedKeywords = this.normalizeKeywords(aiKeywords);
      console.log(`🔍 AI 키워드 정규화 후 (${normalizedKeywords.length}개):`, normalizedKeywords);
      
      // 4. 질문에서 직접 키워드 추출 (AI 실패 시 폴백)
      let directKeywords: string[] = [];
      if (originalQuestion) {
        directKeywords = this.extractKeywordsFromQuestion(originalQuestion);
        console.log(`🔍 질문에서 직접 추출한 키워드 (${directKeywords.length}개):`, directKeywords);
      }
      
      // 5. AI 키워드와 직접 추출 키워드 병합
      const allKeywords = [...new Set([...normalizedKeywords, ...directKeywords])];
      
      console.log(`✅ 최종 키워드 (${allKeywords.length}개):`, allKeywords);

      return {
        intent: analysis.intent || '일반 문의',
        keywords: allKeywords,
        category: (analysis.category as QuestionAnalysis['category']) || 'general',
        complexity: (analysis.complexity as QuestionAnalysis['complexity']) || 'simple',
        entities: analysis.entities || [],
        context: analysis.context || ''
      };
    } catch (error) {
      console.error('❌ AI 응답 파싱 실패:', error);
      
      // AI 파싱 실패 시 질문에서 직접 키워드 추출
      if (originalQuestion) {
        console.log('⚠️ AI 파싱 실패, 질문에서 직접 키워드 추출');
        const directKeywords = this.extractKeywordsFromQuestion(originalQuestion);
        
        return {
          intent: '일반 문의',
          keywords: directKeywords,
          category: 'general',
          complexity: 'simple',
          entities: [],
          context: originalQuestion
        };
      }
      
      console.error('❌ 원본 응답:', responseText);
      console.error('❌ 정제된 응답:', responseText.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim());
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
  private static unifiedSynonymService: UnifiedSynonymService = UnifiedSynonymService.getInstance();
  private static comprehensiveSynonymExpansion: ComprehensiveSynonymExpansion = ComprehensiveSynonymExpansion.getInstance();
  private static dynamicSynonymService: DynamicSynonymService = DynamicSynonymService.getInstance();
  private static multiStageSearch: MultiStageSearchSystem = new MultiStageSearchSystem();
  private static semanticSearch: SemanticSearchEngine = new SemanticSearchEngine();
  
  // 동적 컨텍스트 길이 제한 상수
  private static readonly MIN_CONTEXT_LENGTH = 15000; // 최소 15,000자
  private static readonly MAX_CONTEXT_LENGTH = 50000; // 최대 50,000자
  private static readonly MAX_CHUNK_LENGTH = 5000; // 각 청크 최대 5,000자
  private static readonly DEFAULT_MAX_CHUNKS = 15; // 기본 최대 청크 수 (5개 → 15개로 증가)
  private static readonly MAX_CHUNKS_COMPLEX = 15; // 복잡한 질문 최대 청크 수

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
   * 질문 복잡도에 따른 동적 컨텍스트 길이 계산
   */
  private static calculateDynamicContextLength(questionAnalysis: QuestionAnalysis): {
    maxContextLength: number;
    maxChunks: number;
  } {
    const { complexity, category, keywords } = questionAnalysis;
    
    let maxContextLength = this.MIN_CONTEXT_LENGTH;
    let maxChunks = this.DEFAULT_MAX_CHUNKS;
    
    // 복잡도에 따른 조정
    switch (complexity) {
      case 'simple':
        maxContextLength = this.MIN_CONTEXT_LENGTH; // 15,000자
        maxChunks = 3;
        break;
      case 'medium':
        maxContextLength = this.MIN_CONTEXT_LENGTH + 10000; // 25,000자
        maxChunks = 8;
        break;
      case 'complex':
        maxContextLength = this.MAX_CONTEXT_LENGTH; // 50,000자
        maxChunks = this.MAX_CHUNKS_COMPLEX; // 15개
        break;
    }
    
    // 카테고리별 추가 조정
    if (category === 'analysis' || category === 'comparison') {
      maxContextLength = Math.min(maxContextLength + 10000, this.MAX_CONTEXT_LENGTH);
      maxChunks = Math.min(maxChunks + 3, this.MAX_CHUNKS_COMPLEX);
    }
    
    // 키워드 수에 따른 조정
    if (keywords.length > 5) {
      maxContextLength = Math.min(maxContextLength + 5000, this.MAX_CONTEXT_LENGTH);
      maxChunks = Math.min(maxChunks + 2, this.MAX_CHUNKS_COMPLEX);
    }
    
    console.log(`🎯 동적 컨텍스트 설정: ${maxContextLength}자, ${maxChunks}개 청크 (복잡도: ${complexity}, 카테고리: ${category})`);
    
    return { maxContextLength, maxChunks };
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
    maxChunks?: number // 동적으로 계산됨
  ): Promise<Chunk[]> {
    console.log(`🔍 컨텍스트 선택 시작: "${questionAnalysis.intent}"`);
    console.log(`📊 질문 분석 정보:`, {
      keywords: questionAnalysis.keywords,
      category: questionAnalysis.category,
      complexity: questionAnalysis.complexity,
      entities: questionAnalysis.entities
    });
    
    // 동적 컨텍스트 길이 계산
    const { maxContextLength, maxChunks: dynamicMaxChunks } = this.calculateDynamicContextLength(questionAnalysis);
    const actualMaxChunks = maxChunks || dynamicMaxChunks;
    
    console.log(`🎯 동적 설정 적용: 최대 ${maxContextLength}자, ${actualMaxChunks}개 청크`);
    console.log(`📈 사용 가능한 총 청크 수: ${allChunks.length}개`);
    
    // 1. Firestore에서 키워드 기반 검색
    let firestoreChunks: Chunk[] = [];
    try {
      console.log(`🔍 1단계: Firestore 키워드 검색 시작`);
      console.log(`🔍 검색 키워드: [${questionAnalysis.keywords.join(', ')}]`);
      console.log(`🔍 최대 청크 수: ${actualMaxChunks}개`);
      
      const firestoreResults = await this.firestoreService.searchChunksByKeywords(
        questionAnalysis.keywords,
        undefined,
        actualMaxChunks
      );
      
      console.log(`📊 Firestore 원본 결과: ${firestoreResults.length}개 청크`);
      
      // Firestore 결과를 Chunk 형식으로 변환
      firestoreChunks = await this.convertPDFChunksToChunks(firestoreResults);
      
      console.log(`✅ 1단계 완료: Firestore 키워드 검색 ${firestoreChunks.length}개 청크`);
      console.log(`📋 검색된 청크 정보:`, firestoreChunks.map(c => ({
        id: c.id,
        contentLength: c.content.length,
        keywords: c.keywords.slice(0, 3),
        section: c.metadata.section
      })));
    } catch (error) {
      console.warn('⚠️ 1단계 실패: Firestore 키워드 검색 실패:', error);
    }

    // 2. Firestore에서 텍스트 기반 검색 (키워드 검색 결과가 부족한 경우)
    if (firestoreChunks.length < actualMaxChunks) {
      try {
        console.log(`🔍 2단계: Firestore 텍스트 검색 시작`);
        console.log(`🔍 검색 텍스트: "${questionAnalysis.context}"`);
        console.log(`🔍 추가 필요 청크: ${actualMaxChunks - firestoreChunks.length}개`);
        
        const textResults = await this.firestoreService.searchChunksByText(
          questionAnalysis.context,
          undefined,
          actualMaxChunks - firestoreChunks.length
        );
        
        console.log(`📊 Firestore 텍스트 검색 원본 결과: ${textResults.length}개 청크`);
        
        // 중복 제거하면서 추가
        const filteredTextResults = textResults
          .filter(chunk => !firestoreChunks.some(existing => existing.id === chunk.id));
        const additionalChunks = await this.convertPDFChunksToChunks(filteredTextResults);
        
        firestoreChunks = [...firestoreChunks, ...additionalChunks];
        console.log(`✅ 2단계 완료: Firestore 텍스트 검색 ${additionalChunks.length}개 추가 청크`);
        console.log(`📋 추가된 청크 정보:`, additionalChunks.map(c => ({
          id: c.id,
          contentLength: c.content.length,
          keywords: c.keywords.slice(0, 3),
          section: c.metadata.section
        })));
      } catch (error) {
        console.warn('⚠️ 2단계 실패: Firestore 텍스트 검색 실패:', error);
      }
    }
    
    // Firestore 결과가 있으면 사용, 없으면 로컬 청크 사용
    let chunksToUse = firestoreChunks.length > 0 ? firestoreChunks : allChunks;
    
    console.log(`🔍 3단계: 최종 청크 선택`);
    console.log(`📊 사용할 청크 소스: ${firestoreChunks.length > 0 ? 'Firestore' : '로컬 캐시'}`);
    console.log(`📊 선택된 청크 수: ${chunksToUse.length}개`);
    
    // 동적 컨텍스트 길이 제한 적용
    console.log(`🔍 4단계: 동적 컨텍스트 길이 제한 적용`);
    console.log(`📏 최대 컨텍스트 길이: ${maxContextLength}자`);
    console.log(`📏 최대 청크 수: ${actualMaxChunks}개`);
    
    chunksToUse = this.applyDynamicContextLengthLimit(chunksToUse, maxContextLength, actualMaxChunks);
    
    console.log(`✅ 4단계 완료: 최종 선택된 청크 ${chunksToUse.length}개`);
    console.log(`📋 최종 청크 상세 정보:`, chunksToUse.map((c, index) => ({
      index: index + 1,
      id: c.id,
      contentLength: c.content.length,
      keywords: c.keywords.slice(0, 3),
      section: c.metadata.section,
      source: c.metadata.source
    })));
    
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

    // 개선된 관련성 점수 계산
    const scoredChunks = chunksToUse.map(chunk => {
      const score = this.calculateEnhancedRelevanceScore(questionAnalysis, chunk);
      return { chunk, score };
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
   * 컨텍스트 길이 제한 적용 (기존)
   */
  private static applyContextLengthLimit(chunks: Chunk[], maxChunks: number): Chunk[] {
    if (chunks.length === 0) return chunks;
    
    // 1. 각 청크의 길이를 MAX_CHUNK_LENGTH로 제한
    const trimmedChunks = chunks.map(chunk => ({
      ...chunk,
      content: chunk.content.length > this.MAX_CHUNK_LENGTH 
        ? chunk.content.substring(0, this.MAX_CHUNK_LENGTH) + '...'
        : chunk.content
    }));
    
    // 2. 총 컨텍스트 길이 계산
    let totalLength = 0;
    const limitedChunks: Chunk[] = [];
    
    for (const chunk of trimmedChunks) {
      const chunkLength = chunk.content.length;
      
      // 컨텍스트 길이 제한 확인
      if (totalLength + chunkLength > this.MAX_CONTEXT_LENGTH) {
        console.log(`⚠️ 컨텍스트 길이 제한 도달: ${totalLength}자 (제한: ${this.MAX_CONTEXT_LENGTH}자)`);
        break;
      }
      
      // 청크 수 제한 확인
      if (limitedChunks.length >= maxChunks) {
        console.log(`⚠️ 최대 청크 수 제한 도달: ${limitedChunks.length}개 (제한: ${maxChunks}개)`);
        break;
      }
      
      limitedChunks.push(chunk);
      totalLength += chunkLength;
    }
    
    console.log(`✅ 컨텍스트 길이 제한 적용: ${limitedChunks.length}개 청크, ${totalLength}자`);
    return limitedChunks;
  }

  /**
   * 동적 컨텍스트 길이 제한 적용 (새로운)
   */
  private static applyDynamicContextLengthLimit(
    chunks: Chunk[], 
    maxContextLength: number, 
    maxChunks: number
  ): Chunk[] {
    if (chunks.length === 0) return chunks;
    
    // 1. 각 청크의 길이를 MAX_CHUNK_LENGTH로 제한
    const trimmedChunks = chunks.map(chunk => ({
      ...chunk,
      content: chunk.content.length > this.MAX_CHUNK_LENGTH 
        ? chunk.content.substring(0, this.MAX_CHUNK_LENGTH) + '...'
        : chunk.content
    }));
    
    // 2. 관련성 점수 기반 정렬 (이미 정렬되어 있다고 가정)
    const sortedChunks = [...trimmedChunks];
    
    // 3. 동적 길이 제한 적용
    let totalLength = 0;
    const limitedChunks: Chunk[] = [];
    
    for (const chunk of sortedChunks) {
      const chunkLength = chunk.content.length;
      
      // 동적 컨텍스트 길이 제한 확인
      if (totalLength + chunkLength > maxContextLength) {
        console.log(`⚠️ 동적 컨텍스트 길이 제한 도달: ${totalLength}자 (제한: ${maxContextLength}자)`);
        break;
      }
      
      // 청크 수 제한 확인
      if (limitedChunks.length >= maxChunks) {
        console.log(`⚠️ 최대 청크 수 제한 도달: ${limitedChunks.length}개 (제한: ${maxChunks}개)`);
        break;
      }
      
      limitedChunks.push(chunk);
      totalLength += chunkLength;
    }
    
    console.log(`✅ 동적 컨텍스트 길이 제한 적용: ${limitedChunks.length}개 청크, ${totalLength}자 (최대: ${maxContextLength}자)`);
    return limitedChunks;
  }

  /**
   * 개선된 관련성 점수 계산
   */
  private static calculateEnhancedRelevanceScore(questionAnalysis: QuestionAnalysis, chunk: Chunk): number {
    let score = 0;
    const { keywords, category, complexity, intent } = questionAnalysis;

    // 1. 키워드 매칭 점수 (가중치 적용)
    const keywordMatches = keywords.filter(keyword =>
      chunk.keywords.some(chunkKeyword =>
        chunkKeyword.toLowerCase().includes(keyword.toLowerCase()) ||
        keyword.toLowerCase().includes(chunkKeyword.toLowerCase())
      )
    ).length;
    score += keywordMatches * 15; // 가중치 증가

    // 2. 내용 매칭 점수 (정확한 매치 우선)
    const exactMatches = keywords.filter(keyword =>
      chunk.content.toLowerCase().includes(keyword.toLowerCase())
    ).length;
    score += exactMatches * 10;

    // 3. 동의어 매칭 점수
    const synonyms = this.getExpandedSynonyms(keywords);
    const synonymMatches = synonyms.filter(synonym =>
      chunk.content.toLowerCase().includes(synonym.toLowerCase())
    ).length;
    score += synonymMatches * 8;

    // 4. 의미적 유사도 점수
    const semanticScore = this.calculateSemanticSimilarity(questionAnalysis, chunk);
    score += semanticScore * 20;

    // 5. 카테고리 매칭 점수 (개선)
    const categoryScore = this.calculateCategoryScore(category, chunk);
    score += categoryScore;

    // 6. 위치 기반 점수 (문서 상단 우선)
    const positionScore = this.calculatePositionScore(chunk);
    score += positionScore;

    // 7. 문서 타입 점수
    const documentTypeScore = this.calculateDocumentTypeScore(chunk);
    score += documentTypeScore;

    // 8. 복잡도 매칭 점수
    const complexityScore = this.calculateComplexityScore(complexity, chunk);
    score += complexityScore;

    return Math.round(score * 100) / 100; // 소수점 2자리까지
  }

  /**
   * 카테고리 매칭 점수 계산
   */
  private static calculateCategoryScore(category: string, chunk: Chunk): number {
    const categoryKeywords = {
      'definition': ['정의', '의미', '개념', '내용', '규정', '조항'],
      'procedure': ['절차', '방법', '과정', '단계', '순서', '절차'],
      'regulation': ['규정', '법령', '조항', '법률', '시행령', '시행규칙'],
      'comparison': ['비교', '차이', '구분', '대조', '상이', '다른'],
      'analysis': ['분석', '검토', '고려', '판단', '평가', '검토'],
      'general': ['일반', '기본', '공통', '표준', '기준', '원칙']
    };

    const keywords = categoryKeywords[category] || [];
    const matches = keywords.filter(keyword =>
      chunk.content.toLowerCase().includes(keyword.toLowerCase()) ||
      chunk.metadata.section.toLowerCase().includes(keyword.toLowerCase())
    ).length;

    return matches * 12;
  }

  /**
   * 위치 기반 점수 계산 (문서 상단 우선)
   */
  private static calculatePositionScore(chunk: Chunk): number {
    const position = chunk.metadata.position || 0;
    const totalSize = chunk.metadata.originalSize || 1;
    const relativePosition = position / totalSize;

    // 상단 20%는 높은 점수
    if (relativePosition < 0.2) return 15;
    // 상단 50%는 중간 점수
    if (relativePosition < 0.5) return 10;
    // 하단 50%는 낮은 점수
    return 5;
  }

  /**
   * 문서 타입 점수 계산
   */
  private static calculateDocumentTypeScore(chunk: Chunk): number {
    const title = chunk.metadata.title.toLowerCase();
    
    // 법령 문서 우선
    if (title.includes('법률') || title.includes('시행령') || title.includes('시행규칙')) {
      return 20;
    }
    // 가이드라인, 지침 우선
    if (title.includes('가이드라인') || title.includes('지침') || title.includes('매뉴얼')) {
      return 15;
    }
    // 안내서 우선
    if (title.includes('안내') || title.includes('안내서')) {
      return 10;
    }
    
    return 5;
  }

  /**
   * 복잡도 매칭 점수 계산
   */
  private static calculateComplexityScore(complexity: string, chunk: Chunk): number {
    const contentLength = chunk.content.length;
    
    switch (complexity) {
      case 'complex':
        // 복잡한 질문은 긴 내용 선호
        if (contentLength > 1000) return 15;
        if (contentLength > 500) return 10;
        return 5;
      case 'medium':
        // 중간 질문은 중간 길이 선호
        if (contentLength > 500 && contentLength < 1000) return 12;
        if (contentLength > 200 && contentLength < 500) return 8;
        return 5;
      case 'simple':
        // 간단한 질문은 짧은 내용 선호
        if (contentLength < 200) return 12;
        if (contentLength < 500) return 8;
        return 5;
      default:
        return 5;
    }
  }

  /**
   * 의미적 유사도 계산
   */
  private static calculateSemanticSimilarity(questionAnalysis: QuestionAnalysis, chunk: Chunk): number {
    const questionWords = questionAnalysis.intent.toLowerCase().split(/\s+/);
    const chunkWords = chunk.content.toLowerCase().split(/\s+/);
    
    // Jaccard 유사도
    const intersection = new Set(questionWords.filter(word => chunkWords.includes(word)));
    const union = new Set([...questionWords, ...chunkWords]);
    
    return intersection.size / union.size;
  }

  /**
   * 확장된 동의어 목록 생성 (동적 동의어 서비스 우선 사용)
   */
  private static getExpandedSynonyms(keywords: string[]): string[] {
    // 1. 동적 동의어 서비스에서 확장 (PDF 기반 포괄적 사전)
    const dynamicExpanded = this.dynamicSynonymService.expandKeywords(keywords);
    
    // 2. 통합 동의어 서비스에서 추가 확장 (폴백)
    const basicExpanded = this.unifiedSynonymService.expandKeywords(keywords);
    
    // 3. 포괄적 동의어 확장 서비스에서 추가 확장
    const comprehensiveExpanded: string[] = [];
    keywords.forEach(keyword => {
      comprehensiveExpanded.push(...this.comprehensiveSynonymExpansion.expandKeyword(keyword));
    });
    
    // 모든 결과 통합 및 중복 제거
    const allExpanded = [...dynamicExpanded, ...basicExpanded, ...comprehensiveExpanded];
    return [...new Set(allExpanded)]; // 중복 제거
  }

  /**
   * Jaccard 유사도 계산
   */
  private static calculateJaccardSimilarity(questionWords: string[], chunkWords: string[]): number {
    const intersection = questionWords.filter(word => chunkWords.includes(word));
    const union = [...new Set([...questionWords, ...chunkWords])];
    
    return intersection.length / union.length; // Jaccard 유사도
  }

  /**
   * PDFChunk를 Chunk로 변환 (document 정보 조회 포함)
   */
  private static async convertPDFChunksToChunks(pdfChunks: PDFChunk[]): Promise<Chunk[]> {
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
        id: pdfChunk.id || `firestore-${Math.random()}`,
        content: pdfChunk.content,
        metadata: {
          source: pdfChunk.metadata?.source || doc?.filename || 'Firestore',
          title: pdfChunk.metadata?.title || doc?.title || 'Unknown',
          page: pdfChunk.metadata?.page || 1,
          section: pdfChunk.metadata?.section || 'Unknown',
          position: pdfChunk.metadata?.position || 0,
          startPosition: pdfChunk.metadata?.startPos || 0,
          endPosition: pdfChunk.metadata?.endPos || 0,
          originalSize: pdfChunk.metadata?.originalSize || 0,
          // ✅ sentencePageMap과 sentences도 함께 로드 (방법 2)
          sentencePageMap: pdfChunk.metadata?.sentencePageMap,
          sentences: pdfChunk.metadata?.sentences
        },
        keywords: pdfChunk.keywords || [],
        location: {
          document: doc?.title || pdfChunk.documentId || 'Unknown',
          section: pdfChunk.metadata?.section || 'Unknown',
          page: pdfChunk.metadata?.page || 1
        }
      };
    });
  }
}

// 싱글톤 인스턴스 생성
export const questionAnalyzer = new QuestionAnalyzer();
export const contextSelector = ContextSelector;
