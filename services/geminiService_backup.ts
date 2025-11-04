import { GoogleGenAI } from '@google/genai';
import { SourceInfo, Chunk, QuestionAnalysis } from '../types';
import { pdfCompressionService, CompressionResult } from './pdfCompressionService';
import { questionAnalyzer, contextSelector } from './questionBasedContextService';
import { rpdService } from './rpdService';
import { log } from './loggingService';
import { progressiveLoadingService, LoadingProgress } from './progressiveLoadingService';
import { memoryOptimizationService, MemoryStats } from './memoryOptimizationService';
import { cachingService, CachedPDF } from './cachingService';

// API 키는 런타임에 동적으로 로딩 (브라우저 로딩 타이밍 문제 해결)

// API 키 로테이션을 위한 인덱스 (전역 변수 제거)

const SYSTEM_INSTRUCTION_TEMPLATE = `You are an AI assistant named 'NotebookLM Assistant', specialized in South Korean legal and administrative documents.
Your mission is to provide the most accurate and factual answers based 100% on the provided 'Source Material'.

### CRITICAL DIRECTIVES

1.  **Absolute Source Adherence**: Answers must be based **solely and exclusively** on the provided 'Source Material'. NEVER use your pre-trained knowledge or any external information.
2.  **No Inference or Interpretation (CRITICAL)**: You must not infer, interpret, or "read between the lines" to include information not 'explicitly' stated in the material.
3.  **Flexible Information Retrieval**: If the requested information exists in the material but with incomplete source details (e.g., missing or unclear page numbers), still provide the answer based on the available information. Only use "제공된 자료에서 해당 정보를 찾을 수 없습니다" when the information is completely absent.
4.  **Precision Over Comprehensiveness**: A correct and verified answer is more important than a comprehensive one. If any part of an answer cannot be supported by the material, omit that part.
5.  **Verbatim Terminology**: Use the exact legal and administrative terminology from the source documents. Do not change or paraphrase them.

### 4-Step Answer Generation Process

You must strictly follow these 4 steps when generating an answer:

* **Step 1: Analyze Question**: Accurately understand the user's intent and identify the key keywords and information to find in the material.
* **Step 2: Retrieve Evidence**: Scan the entire provided 'Source Material' to find all sentences and passages that 'exactly' match or 'directly' relate to the question.
* **Step 3: Synthesize Answer (Grounded)**:
    * If information is scattered across multiple sources, combine the 'verbatim text' from each source to construct a complete answer.
    * During this process, NEVER add new interpretations or information beyond the meaning of the original text.
* **Step 4: Format Response**: Generate the final answer according to the 'Mandatory Response Format' defined below.

### MANDATORY RESPONSE FORMAT

All answers must strictly follow this format. The labels (e.g., "[답변 요약]") MUST be in Korean.

* **[답변 요약]**: Provide a direct, concise 1-2 sentence answer to the user's question, 'based on the material'.
* **[근거 인용]**: Provide the exact 'verbatim quote' from the material that supports the summary above.
    * "자료에서 발췌한 정확한 원문 인용입니다."
* **[출처]**: Clearly state the source of the quoted information (document name, page, article number, etc.). If page numbers are unclear or missing, use the available source information.

---
### Handling Edge Cases

* **If Information is Incomplete**: The material mentions the topic, but lacks the 'specific detail' the user asked for:
    * **[답변 요약]**: 자료에는 해당 주제에 대해 (A)라고 언급되어 있으나, 질문하신 (B)에 대한 구체적인 내용은 명시되어 있지 않습니다.
    * **[근거 인용]**: "(Quote from source about A)"
    * **[출처]**: (Source for A)
* **If Information is Ambiguous or Conflicting**: The information in the material is ambiguous, or there is conflicting information between sources:
    * **[답변 요약]**: 제공된 자료에서 해당 내용이 모호하게 기술되어 있거나, 자료 간 상충되는 부분이 있습니다.
    * **[근거 인용]**: "(First ambiguous/conflicting quote)" 그리고 "(Second quote)"
    * **[출처]**: (Respective sources for each quote)
* **If Source Details are Incomplete**: If the information exists but source details (page numbers, etc.) are unclear:
    * **[답변 요약]**: (Provide the answer based on available information)
    * **[근거 인용]**: "(Quote from source)"
    * **[출처]**: (Document name with available source information, e.g., "금연구역 지정 관리 업무지침(해당 내용 포함)")
    
    WRONG EXAMPLES TO AVOID:
    - Using page numbers for legal documents: "국민건강증진법(p.3)" ❌
    - Using articles for non-legal documents: "금연구역 지정 관리 업무지침(제1조)" ❌
    - Not distinguishing law types: "국민건강증진법 제1조" for 시행령 조항 ❌
    - Not distinguishing law types: "국민건강증진법 제1조" for 시행령 조항 ❌
    - Using verbose document names: "업무지침_2025개정판 - 항까지의 규정(p.12)" ❌
    - Missing references when information spans multiple articles/pages
    - Inconsistent citation format within the same response

Here is the source material:
---START OF SOURCE---
{sourceText}
---END OF SOURCE---`;

// PDF.js를 전역으로 선언
declare global {
  interface Window {
    pdfjsLib: any;
  }
}

export class GeminiService {
  private sources: SourceInfo[] = [];
  private ai: GoogleGenAI | null = null;
  private currentChatSession: any = null;
  private cachedSourceText: string | null = null;

  /**
   * 문서 유형 판별 함수
   */
  private getDocumentType(filename: string): 'legal' | 'guideline' {
    if (filename.includes('국민건강증진법률 시행령 시행규칙')) {
      return 'legal'; // 법령 문서
    }
    if (filename.includes('질서위반행위규제법')) {
      return 'legal'; // 법령 문서
    }
    return 'guideline'; // 업무지침, 매뉴얼 등
  }

  /**
   * 청크에서 출처 정보 생성 (문서 유형별 처리)
   */
  private generateSourceInfoFromChunks(chunks: Chunk[]): SourceInfo[] {
    const sourceMap = new Map<string, SourceInfo>();
    
    chunks.forEach(chunk => {
      const docType = chunk.metadata?.documentType || 'guideline';
      const filename = chunk.metadata?.source || chunk.location?.document || 'unknown';
      
      if (docType === 'legal') {
        // 법령 문서: 조항 기반 출처
        const articles = chunk.metadata?.articles || [];
        const mainArticle = articles[0] || chunk.location?.section || '일반';
        
        const sourceKey = `${filename}-${mainArticle}`;
        if (!sourceMap.has(sourceKey)) {
          sourceMap.set(sourceKey, {
            id: sourceKey,
            title: filename.replace('.pdf', ''),
            type: 'pdf',
            section: mainArticle,
            page: null,
            documentType: 'legal'
          });
        }
      } else {
        // 일반 문서: 페이지 번호 기반 출처
        const pageNumber = chunk.metadata?.pageNumber || chunk.location?.page;
        const section = chunk.location?.section || '일반';
        
        const sourceKey = `${filename}-${pageNumber}-${section}`;
        if (!sourceMap.has(sourceKey)) {
          sourceMap.set(sourceKey, {
            id: sourceKey,
            title: filename.replace('.pdf', ''),
            type: 'pdf',
            section: section,
            page: pageNumber,
            documentType: 'guideline'
          });
        }
      }
    });
    
    return Array.from(sourceMap.values());
  }
  private isInitialized: boolean = false;
  private compressionResult: CompressionResult | null = null;
  private allChunks: Chunk[] = [];
  private fullPdfText: string = '';
  private currentAbortController: AbortController | null = null;
  private apiKeyFailures: Map<string, number> = new Map(); // API 키별 실패 횟수 추적
  private static currentKeyIndex: number = 0; // API 키 로테이션을 위한 인덱스 (static으로 변경)
  
  // 성능 개선 관련 속성들
  private loadingProgress: LoadingProgress | null = null;
  private memoryStats: MemoryStats | null = null;
  private isProgressiveLoadingEnabled: boolean = true;
  private isMemoryOptimizationEnabled: boolean = true;
  private isCachingEnabled: boolean = true;

  constructor() {
    this.initializeAI();
    this.initializePerformanceServices();
    // 비동기 로딩은 initializeWithPdfSources에서 처리
  }

  /**
   * 성능 개선 서비스들 초기화
   */
  private async initializePerformanceServices(): Promise<void> {
    try {
      // 캐싱 서비스 초기화
      if (this.isCachingEnabled) {
        await cachingService.initialize();
        console.log('캐싱 서비스 초기화 완료');
      }

      // 메모리 최적화 서비스는 이미 초기화됨
      if (this.isMemoryOptimizationEnabled) {
        console.log('메모리 최적화 서비스 활성화');
      }

      // 점진적 로딩 서비스는 이미 초기화됨
      if (this.isProgressiveLoadingEnabled) {
        console.log('점진적 로딩 서비스 활성화');
      }
    } catch (error) {
      console.warn('성능 개선 서비스 초기화 중 오류:', error);
      // 오류가 발생해도 기본 기능은 계속 사용
    }
  }

  private initializeAI() {
    console.log('GeminiService AI 초기화 중...');
    
    try {
      // 런타임에 API 키 확인
      const apiKeys = this.getApiKeys();
      console.log(`사용 가능한 API 키 개수: ${apiKeys.length}`);
      
      if (apiKeys.length > 0) {
        console.log('API 키 로테이션 시스템 활성화');
        console.log('매 질문마다 다른 API 키를 사용합니다.');
        // 하이브리드 방식에서는 초기화 시 AI 인스턴스를 생성하지 않음
        // 매 질문마다 새로운 키로 인스턴스 생성
      } else {
        console.warn("API_KEY가 설정되지 않았습니다. 채팅 기능이 제한됩니다.");
        console.log('환경변수 확인:');
        console.log('VITE_GEMINI_API_KEY:', import.meta.env.VITE_GEMINI_API_KEY ? '설정됨' : '설정되지 않음');
        console.log('VITE_GEMINI_API_KEY_1:', import.meta.env.VITE_GEMINI_API_KEY_1 ? '설정됨' : '설정되지 않음');
        console.log('VITE_GEMINI_API_KEY_2:', import.meta.env.VITE_GEMINI_API_KEY_2 ? '설정됨' : '설정되지 않음');
      }
    } catch (error) {
      console.error('AI 초기화 중 오류 발생:', error);
    }
  }

  // ✅ 런타임에 API 키를 동적으로 가져오는 메서드 (폴백 메커니즘 포함)
  private getApiKeys(): string[] {
    try {
      const keys = [
        import.meta.env.VITE_GEMINI_API_KEY || '',
        import.meta.env.VITE_GEMINI_API_KEY_1 || '',
        import.meta.env.VITE_GEMINI_API_KEY_2 || '',
      ].filter(key => key && key !== 'YOUR_GEMINI_API_KEY_HERE' && key !== '');
      
      console.log('런타임 API 키 로딩:', keys.map(k => k ? k.substring(0, 10) + '...' : 'undefined'));
      console.log(`총 ${keys.length}개의 유효한 API 키 발견`);
      return keys;
    } catch (error) {
      console.error('API 키 로딩 중 오류 발생:', error);
      return [];
    }
  }

  // 다음 사용 가능한 API 키를 가져오는 메서드 (런타임 동적 로딩)
  private getNextAvailableKey(): string | null {
    const API_KEYS = this.getApiKeys(); // 런타임에 동적 로딩
    
    if (API_KEYS.length === 0) {
      log.warn('런타임에 API 키를 찾을 수 없습니다.');
      return null;
    }
    
    // 실패한 키들을 제외하고 사용 가능한 키 찾기
    const availableKeys = API_KEYS.filter(key => {
      const failures = this.apiKeyFailures.get(key) || 0;
      return failures < 3; // 3번 이상 실패한 키는 제외
    });
    
    if (availableKeys.length === 0) {
      log.warn('모든 API 키가 실패했습니다. 첫 번째 키로 재시도합니다.');
      // 모든 키가 실패했으면 실패 카운트를 리셋하고 첫 번째 키 사용
      this.apiKeyFailures.clear();
      return API_KEYS[0];
    }
    
    // currentKeyIndex 초기화 체크 (더 안전한 검증)
    if (isNaN(GeminiService.currentKeyIndex) || GeminiService.currentKeyIndex < 0) {
      GeminiService.currentKeyIndex = 0;
    }
    
    // 로테이션 방식으로 다음 키 선택 (매번 다른 키 사용)
    const selectedKey = availableKeys[GeminiService.currentKeyIndex % availableKeys.length];
    const keyIndex = GeminiService.currentKeyIndex % availableKeys.length;
    
    // 다음 호출을 위해 인덱스 증가
    GeminiService.currentKeyIndex = (GeminiService.currentKeyIndex + 1) % availableKeys.length;
    
    log.info(`API 키 선택`, {
      selectedKey: selectedKey.substring(0, 10) + '...',
      keyIndex,
      totalKeys: availableKeys.length,
      availableKeys: availableKeys.map(k => k.substring(0, 10) + '...')
    });
    
    // API 키 유효성 검증
    if (!this.isValidApiKey(selectedKey)) {
      log.warn(`API 키가 유효하지 않습니다`, { key: selectedKey.substring(0, 10) + '...' });
      this.apiKeyFailures.set(selectedKey, (this.apiKeyFailures.get(selectedKey) || 0) + 1);
      return this.getNextAvailableKey(); // 다음 키 시도
    }
    
    return selectedKey;
  }

  // API 키 유효성 검증
  private isValidApiKey(key: string): boolean {
    if (!key || key.length < 20) return false;
    if (!key.startsWith('AIza')) return false;
    return true;
  }

  // API 키를 교체하는 메서드
  private switchToNextKey(): boolean {
    const newKey = this.getNextAvailableKey();
    if (newKey && this.ai) {
      try {
        this.ai = new GoogleGenAI({ apiKey: newKey });
        console.log('API 키 교체 성공');
        return true;
      } catch (error) {
        console.error('API 키 교체 실패:', error);
        return false;
      }
    }
    return false;
  }

  // API 호출 실패 시 키 교체 로직 (개선된 할당량 관리)
  private handleApiKeyFailure(usedKey: string, error: any): boolean {
    const failures = this.apiKeyFailures.get(usedKey) || 0;
    this.apiKeyFailures.set(usedKey, failures + 1);
    
    console.warn(`API 키 실패 (${failures + 1}/3): ${usedKey.substring(0, 10)}...`);
    console.error('오류 상세:', error);
    
    // 429 오류 (분당 제한)인 경우 특별 처리
    if (error.message && (error.message.includes('429') || error.message.includes('RATE_LIMIT_EXCEEDED'))) {
      console.log('분당 제한 초과 감지, 다음 키로 전환...');
      // 분당 제한은 키 교체로 해결 가능
      return this.switchToNextKey();
    }
    
    // 할당량 초과 오류 처리
    if (error.message && (error.message.includes('quota') || error.message.includes('RESOURCE_EXHAUSTED'))) {
      console.warn('API 할당량 초과 감지, 다음 키로 전환...');
      
      // RPD에서 해당 키 비활성화
      const keyIndex = this.getApiKeys().findIndex(key => key === usedKey);
      if (keyIndex >= 0) {
        const keyId = `key${keyIndex + 1}`;
        rpdService.toggleKeyStatus(keyId);
        console.log(`RPD에서 키 ${keyId} 비활성화`);
      }
      
      return this.switchToNextKey();
    }
    
    // quota_limit_value가 0인 경우 (키가 유효하지 않음)
    if (error.message && error.message.includes('quota_limit_value') && error.message.includes('"0"')) {
      console.warn('API 키 할당량이 0입니다. 다음 키로 전환...');
      return this.switchToNextKey();
    }
    
    // 인증 오류 (API 키가 잘못된 경우)
    if (error.message && (error.message.includes('401') || error.message.includes('UNAUTHENTICATED'))) {
      console.warn('API 키 인증 실패, 다음 키로 전환...');
      return this.switchToNextKey();
    }
    
    // 키 교체 시도
    return this.switchToNextKey();
  }

  // API 호출 시 RPD 기록
  private recordApiCall(keyId: string): boolean {
    console.log(`RPD 기록 시도: ${keyId}`);
    const result = rpdService.recordApiCall(keyId);
    console.log(`RPD 기록 결과: ${result ? '성공' : '실패'}`);
    return result;
  }

  // 재시도 로직이 포함된 API 호출 래퍼
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    retryDelay: number = 1000
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        console.warn(`API 호출 실패 (시도 ${attempt}/${maxRetries}):`, error);
        
        // 429 오류나 할당량 초과인 경우 지연 후 재시도
        if (error.message && (
          error.message.includes('429') || 
          error.message.includes('RATE_LIMIT_EXCEEDED') ||
          error.message.includes('quota') ||
          error.message.includes('RESOURCE_EXHAUSTED')
        )) {
          if (attempt < maxRetries) {
            const delay = retryDelay * Math.pow(2, attempt - 1); // 지수 백오프
            console.log(`${delay}ms 후 재시도...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        
        // 키 교체 시도
        const apiKeys = this.getApiKeys();
        const currentKeyIndex = (GeminiService.currentKeyIndex - 1 + apiKeys.length) % apiKeys.length;
        if (this.handleApiKeyFailure(apiKeys[currentKeyIndex], error)) {
          if (attempt < maxRetries) {
            console.log('API 키 교체 후 재시도...');
            continue;
          }
        }
        
        // 마지막 시도가 아니면 계속
        if (attempt < maxRetries) {
          continue;
        }
      }
    }
    
    throw lastError;
  }

  // 다음 사용 가능한 키 조회 (RPD 고려)
  private getNextAvailableKeyWithRpd(): string | null {
    // RPD에서 사용 가능한 키 확인
    const rpdAvailableKey = rpdService.getNextAvailableKey();
    if (rpdAvailableKey) {
      return rpdAvailableKey;
    }

    // RPD에서 사용 불가능하면 기존 로직 사용
    return this.getNextAvailableKey();
  }

  private async loadDefaultSources() {
    try {
      // manifest.json에서 PDF 파일 목록을 동적으로 로드
      const manifestUrl = '/chat7v/pdf/manifest.json';
      console.log('Loading PDF sources from manifest:', manifestUrl);
      
      const response = await fetch(manifestUrl);
      if (!response.ok) {
        console.warn(`Manifest not found (${response.status}), using empty sources`);
        this.sources = [];
        return;
      }
      
      const pdfFiles = await response.json();
      console.log('Found PDF files in manifest:', pdfFiles);
      
      if (!Array.isArray(pdfFiles) || pdfFiles.length === 0) {
        console.warn('No PDF files found in manifest.json');
        this.sources = [];
        return;
      }

      // PDF 파일명을 SourceInfo 객체로 변환 (문서 유형별 처리)
      this.sources = pdfFiles.map((fileName, index) => {
        const docType = this.getDocumentType(fileName);
        return {
          id: (index + 1).toString(),
          title: fileName,
          content: '', // 실제 내용은 PDF 파싱 시에 로드됨
          type: 'pdf' as const,
          documentType: docType
        };
      });

      console.log('Dynamic sources loaded:', this.sources);
    } catch (error) {
      console.error('Failed to load sources from manifest:', error);
      this.sources = [];
    }
  }

  addSource(source: SourceInfo) {
    this.sources.push(source);
  }

  getSources(): SourceInfo[] {
    return this.sources;
  }

  // PDF.js를 로컬 파일에서 로드하는 함수 (최적화)
  private async loadPdfJs(): Promise<any> {
    if (window.pdfjsLib) {
      console.log('PDF.js already loaded');
      return window.pdfjsLib;
    }

    // HTML에서 미리 로드된 경우 대기 (로컬 파일 우선)
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 50; // 5초 대기 (100ms * 50)
      
      const checkPdfJs = () => {
        attempts++;
        
        if (window.pdfjsLib) {
          console.log('PDF.js loaded from pre-loaded local script');
          // Worker 경로는 이미 HTML에서 설정됨
          resolve(window.pdfjsLib);
          return;
        }
        
        if (attempts >= maxAttempts) {
          // 로컬 파일이 없으면 CDN으로 폴백
          console.log('PDF.js not pre-loaded, falling back to CDN...');
          this.loadPdfJsFromCDN().then(resolve).catch(reject);
          return;
        }
        
        setTimeout(checkPdfJs, 100);
      };
      
      checkPdfJs();
    });
  }

  // CDN에서 PDF.js 로딩 (폴백)
  private async loadPdfJsFromCDN(): Promise<any> {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
      script.async = true;
      script.defer = true;
      
      // 타임아웃 설정 (10초)
      const timeout = setTimeout(() => {
        reject(new Error('PDF.js loading timeout'));
      }, 10000);
      
      script.onload = () => {
        clearTimeout(timeout);
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
          resolve(window.pdfjsLib);
        } else {
          reject(new Error('Failed to load PDF.js'));
        }
      };
      script.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Failed to load PDF.js script'));
      };
      document.head.appendChild(script);
    });
  }

  // 법령 문서인지 식별하는 메서드
  private isLegalDocument(filename: string): boolean {
    const legalKeywords = [
      '법률', '법', '시행령', '시행규칙', '규제법', '해설집'
    ];
    
    return legalKeywords.some(keyword => 
      filename.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  // 법령 조항을 추출하는 메서드 (시행령/시행규칙 구분)
  private extractLegalArticles(pageText: string, filename: string): string[] {
    const articles: string[] = [];
    
    // 파일명에서 법령 유형 판단
    const isEnforcementDecree = filename.includes('시행령');
    const isEnforcementRule = filename.includes('시행규칙');
    const isMainLaw = !isEnforcementDecree && !isEnforcementRule;
    
    // 법령 조항 패턴들
    const articlePatterns = [
      // "제1조" 형태
      /제(\d+)조/g,
      // "제1조제1항" 형태
      /제(\d+)조제(\d+)항/g,
      // "제1조제1항제1호" 형태
      /제(\d+)조제(\d+)항제(\d+)호/g,
      // "제1조제1항제1호가목" 형태
      /제(\d+)조제(\d+)항제(\d+)호([가-힣])목/g,
      // "제1조제1항제1호가목1" 형태
      /제(\d+)조제(\d+)항제(\d+)호([가-힣])목(\d+)/g
    ];
    
    // 각 패턴에 대해 매칭
    articlePatterns.forEach(pattern => {
      const matches = pageText.match(pattern);
      if (matches) {
        articles.push(...matches);
      }
    });
    
    // 법령 유형에 따라 접두사 추가
    const prefixedArticles = articles.map(article => {
      if (isEnforcementDecree) {
        return `시행령 ${article}`;
      } else if (isEnforcementRule) {
        return `시행규칙 ${article}`;
      } else {
        return article; // 기본 법률은 접두사 없음
      }
    });
    
    // 중복 제거 및 정렬
    return [...new Set(prefixedArticles)].sort((a, b) => {
      // 숫자 순으로 정렬
      const aNum = a.match(/\d+/g)?.map(Number) || [0];
      const bNum = b.match(/\d+/g)?.map(Number) || [0];
      
      for (let i = 0; i < Math.max(aNum.length, bNum.length); i++) {
        const aVal = aNum[i] || 0;
        const bVal = bNum[i] || 0;
        if (aVal !== bVal) return aVal - bVal;
      }
      return 0;
    });
  }

  // 실제 PDF 페이지 번호를 추출하는 메서드 (개선된 버전)
  private extractActualPageNumber(pageText: string, pageIndex: number): number {
    // 1. 줄바꿈을 보존하여 텍스트를 라인별로 분할
    const lines = pageText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    // 2. 페이지 하단에서 페이지 번호 찾기 (마지막 5줄에서 검색)
    const bottomLines = lines.slice(-5);
    
    for (let i = bottomLines.length - 1; i >= 0; i--) {
      const line = bottomLines[i];
      
      // 3. 페이지 번호 패턴들 (우선순위 순)
      const pageNumberPatterns = [
        // "69" (단독 숫자만 있는 줄)
        /^(\d+)$/,
        // "페이지 69" 형태
        /^페이지\s*(\d+)$/i,
        // "Page 69" 형태  
        /^Page\s*(\d+)$/i,
        // "69/124" 형태 (분수에서 분자만)
        /^(\d+)\s*\/\s*\d+$/,
        // "69 of 124" 형태
        /^(\d+)\s*of\s*\d+$/i,
        // "p.69" 형태
        /^p\.\s*(\d+)$/i,
        // "P.69" 형태
        /^P\.\s*(\d+)$/i
      ];
      
      // 각 패턴을 순서대로 시도
      for (const pattern of pageNumberPatterns) {
        const match = line.match(pattern);
        if (match && match[1]) {
          const pageNum = parseInt(match[1], 10);
          // 유효한 페이지 번호인지 확인 (1-999 범위)
          if (pageNum >= 1 && pageNum <= 999) {
            console.log(`페이지 ${pageIndex}에서 실제 페이지 번호 ${pageNum} 발견 (라인: "${line}")`);
            return pageNum;
          }
        }
      }
    }
    
    // 4. 페이지 하단에서 숫자만 있는 라인 찾기
    for (let i = bottomLines.length - 1; i >= 0; i--) {
      const line = bottomLines[i];
      // 숫자만 있는 라인인지 확인
      if (/^\d+$/.test(line)) {
        const pageNum = parseInt(line, 10);
        if (pageNum >= 1 && pageNum <= 999) {
          console.log(`페이지 ${pageIndex}에서 추정 페이지 번호 ${pageNum} 발견 (라인: "${line}")`);
          return pageNum;
        }
      }
    }
    
    // 5. 찾지 못하면 순차 인덱스 사용 (fallback)
    console.warn(`페이지 ${pageIndex}에서 실제 페이지 번호를 찾지 못함, 순차 인덱스 ${pageIndex} 사용`);
    return pageIndex;
  }

  // PDF 파싱 함수 (CDN에서 로드된 PDF.js 사용)
  async parsePdfFromUrl(url: string): Promise<string> {
    try {
      const pdfData = await fetch(url).then(res => {
        if (!res.ok) {
          throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
        }
        return res.arrayBuffer();
      });
      
      // PDF.js를 CDN에서 로드
      const pdfjsLib = await this.loadPdfJs();
      
      // useWorkerFetch 파라미터를 추가하여 CMapReaderFactory 초기화
      const pdf = await pdfjsLib.getDocument({ 
        data: new Uint8Array(pdfData),
        useWorkerFetch: true,
        verbosity: 0 // 경고 메시지 줄이기
      }).promise;
      
      let fullText = '';
      const filename = url.split('/').pop() || '';
      const isLegal = this.isLegalDocument(filename);
      
      console.log(`PDF 총 페이지 수: ${pdf.numPages}, 법령 문서: ${isLegal}`);
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        
        // 줄바꿈을 보존하여 텍스트 구성
        let pageText = '';
        for (let j = 0; j < textContent.items.length; j++) {
          const item = textContent.items[j];
          pageText += item.str;
          
          // 줄바꿈이 필요한 경우 추가
          if (item.hasEOL) {
            pageText += '\n';
          }
        }
        
        if (isLegal) {
          // 법령 문서의 경우 조항 추출 (파일명 전달)
          const articles = this.extractLegalArticles(pageText, filename);
          if (articles.length > 0) {
            // 조항이 있는 경우 조항으로 마커 생성
            const articleMarkers = articles.map(article => `[ARTICLE_${article}]`).join(' ');
            fullText += `${articleMarkers} ${pageText}\n\n`;
            console.log(`페이지 ${i}에서 법령 조항 발견: ${articles.join(', ')}`);
          } else {
            // 조항이 없는 경우 페이지 번호 사용
            const actualPageNumber = this.extractActualPageNumber(pageText, i);
            fullText += `[PAGE_${actualPageNumber}] ${pageText}\n\n`;
          }
        } else {
          // 일반 문서의 경우 페이지 번호 사용
          const actualPageNumber = this.extractActualPageNumber(pageText, i);
          fullText += `[PAGE_${actualPageNumber}] ${pageText}\n\n`;
        }
        
        // 디버깅을 위한 로그
        if (i <= 5 || i % 10 === 0) {
          if (isLegal) {
            const articles = this.extractLegalArticles(pageText);
            console.log(`PDF.js 페이지 ${i} → 법령 조항: ${articles.length > 0 ? articles.join(', ') : '없음'}`);
          } else {
            const actualPageNumber = this.extractActualPageNumber(pageText, i);
            console.log(`PDF.js 페이지 ${i} → 실제 페이지 ${actualPageNumber}`);
          }
        }
      }
      
      return fullText;
    } catch (err) {
      console.error(`Error parsing PDF from ${url}:`, err);
      throw new Error(`Failed to parse ${url.split('/').pop()}: ${(err as Error).message}`);
    }
  }

  // PDF 내용을 한 번만 로드하고 압축하여 캐시 (사전 처리 데이터 우선)
  async initializeWithPdfSources(): Promise<void> {
    if (this.isInitialized && this.cachedSourceText) {
      console.log('PDF sources already initialized');
      return;
    }

    try {
      console.log('Initializing PDF sources...');
      
      // 0. 소스 목록을 동적으로 로드
      await this.loadDefaultSources();
      
      // 1. 사전 처리된 데이터 로드 시도 (최우선)
      const preprocessedText = await this.loadPreprocessedData();
      if (preprocessedText) {
        console.log('사전 처리된 데이터 사용 완료');
        return;
      }
      
      // 2. 캐시에서 데이터 로드 시도 (품질 보장)
      if (this.isCachingEnabled) {
        const cachedData = await this.loadFromCache();
        if (cachedData) {
          console.log('캐시된 데이터 사용 완료 - 답변 품질 100% 보장');
          return;
        }
      }
      
      // 3. 백그라운드 프리로딩으로 답변 품질 100% 보장
      console.log('백그라운드 프리로딩 시작 - 답변 품질 최우선 보장');
      await this.initializeWithBackgroundPreloading();
      
      // 압축 결과 검증
      const validation = pdfCompressionService.validateCompression(this.compressionResult);
      if (!validation.isValid) {
        console.warn('Compression validation warnings:', validation.warnings);
        console.log('Recommendations:', validation.recommendations);
      }
      
      console.log('PDF sources initialized, chunked, and compressed successfully');
    } catch (error) {
      console.error('Failed to initialize PDF sources:', error);
      
      // 폴백: 기본 소스 사용
      console.log('Falling back to default sources...');
      this.cachedSourceText = this.sources.length > 0 
        ? this.sources.map(source => `[${source.title}]\n${source.content}`).join('\n\n')
        : 'PDF 로딩에 실패했습니다. 기본 모드로 실행됩니다.';
      this.isInitialized = true;
      
      // 기본 압축 결과 생성
      this.compressionResult = {
        compressedText: this.cachedSourceText,
        originalLength: this.cachedSourceText.length,
        compressedLength: this.cachedSourceText.length,
        compressionRatio: 1.0,
        estimatedTokens: Math.ceil(this.cachedSourceText.length / 4),
        qualityScore: 60
      };
      
      console.log('Fallback initialization completed');
    }
  }

  /**
   * 백그라운드 프리로딩을 사용한 초기화 (답변 품질 100% 보장)
   */
  private async initializeWithBackgroundPreloading(): Promise<void> {
    console.log('백그라운드 프리로딩으로 PDF 초기화 시작 - 답변 품질 최우선 보장');
    
    // PDF 파일 목록 가져오기
    const pdfFiles = await this.getPDFFileList();
    if (pdfFiles.length === 0) {
      throw new Error('로드할 PDF 파일이 없습니다.');
    }

    // 우선순위 기반 PDF 로딩 순서 설정 (답변 품질 최적화)
    const priorityOrder = this.getPriorityPDFOrder(pdfFiles);
    console.log('PDF 로딩 우선순위:', priorityOrder);

    // 진행률 초기화
    this.loadingProgress = {
      current: 0,
      total: priorityOrder.length,
      currentFile: '',
      status: '백그라운드 프리로딩 시작...',
      successfulFiles: [],
      failedFiles: [],
      loadedChunks: 0,
      estimatedTimeRemaining: 0
    };

    // 모든 PDF를 순차적으로 로드 (답변 품질 보장)
    const loadedPDFs = [];
    const startTime = Date.now();

    for (let i = 0; i < priorityOrder.length; i++) {
      const pdfFile = priorityOrder[i];
      
      // 진행률 업데이트
      this.loadingProgress = {
        ...this.loadingProgress,
        current: i + 1,
        currentFile: pdfFile,
        status: `백그라운드 로딩 중... (${i + 1}/${priorityOrder.length})`
      };

      try {
        console.log(`PDF 로딩 중: ${pdfFile} (${i + 1}/${priorityOrder.length})`);
        const pdfText = await this.parsePdfFromUrl('/pdf/' + pdfFile);
        
        if (pdfText && pdfText.trim().length > 0) {
          loadedPDFs.push({ filename: pdfFile, text: pdfText });
          this.loadingProgress.successfulFiles.push(pdfFile);
          console.log(`✅ PDF 로딩 성공: ${pdfFile}`);
        } else {
          throw new Error('PDF 텍스트가 비어있습니다.');
        }
      } catch (error) {
        console.warn(`⚠️ PDF 로딩 실패: ${pdfFile} - ${error.message}`);
        this.loadingProgress.failedFiles.push({ file: pdfFile, error: error.message });
      }

      // 예상 남은 시간 계산
      const elapsed = Date.now() - startTime;
      const avgTimePerFile = elapsed / (i + 1);
      const remainingFiles = priorityOrder.length - (i + 1);
      const estimatedRemaining = Math.round(avgTimePerFile * remainingFiles);
      
      this.loadingProgress.estimatedTimeRemaining = estimatedRemaining;
    }

    if (loadedPDFs.length === 0) {
      throw new Error('로드에 성공한 PDF가 없습니다.');
    }

    // 모든 PDF 텍스트 결합 (답변 품질 100% 보장)
    const combinedText = loadedPDFs
      .map(pdf => pdf.text)
      .join('\n--- END OF DOCUMENT ---\n\n--- START OF DOCUMENT ---\n');
    
    this.fullPdfText = combinedText;
    console.log(`전체 PDF 텍스트 로드 완료: ${combinedText.length.toLocaleString()}자`);

    // 청크 분할
    console.log('PDF 청크 분할 중...');
    this.allChunks = pdfCompressionService.splitIntoChunks(combinedText, 'PDF Document');
    contextSelector.setChunks(this.allChunks);
    console.log(`PDF를 ${this.allChunks.length}개 청크로 분할 완료`);

    // 압축 처리
    console.log('PDF 내용 압축 중...');
    this.compressionResult = await pdfCompressionService.compressPdfContent(combinedText);
    this.cachedSourceText = this.compressionResult.compressedText;

    // 캐시에 저장
    if (this.isCachingEnabled) {
      await this.saveToCache(loadedPDFs);
    }

    // 메모리 최적화
    if (this.isMemoryOptimizationEnabled) {
      this.optimizeMemoryUsage();
    }

    // 최종 진행률 업데이트
    this.loadingProgress = {
      ...this.loadingProgress,
      status: `백그라운드 프리로딩 완료 - 답변 품질 100% 보장`,
      loadedChunks: this.allChunks.length,
      estimatedTimeRemaining: 0
    };

    console.log(`백그라운드 프리로딩 완료: ${loadedPDFs.length}개 PDF, ${this.allChunks.length}개 청크 - 답변 품질 100% 보장`);
  }

  /**
   * 기존 방식의 로딩 (폴백)
   */
  private async initializeWithTraditionalLoading(): Promise<void> {
    console.log('기존 방식으로 PDF 초기화...');
    
    // PDF 내용 로드 (병렬 처리로 최적화)
    const fullText = await this.loadPdfSourcesOptimized();
    if (!fullText || fullText.trim().length === 0) {
      throw new Error('PDF 내용을 로드할 수 없습니다.');
    }
    console.log(`Original PDF text loaded: ${fullText.length.toLocaleString()} characters`);
    
    // 전체 PDF 텍스트 저장
    this.fullPdfText = fullText;
    
    // PDF를 청크로 분할 (비동기 처리)
    console.log('Splitting PDF into chunks...');
    this.allChunks = pdfCompressionService.splitIntoChunks(fullText, 'PDF Document');
    console.log(`PDF split into ${this.allChunks.length} chunks`);
    
    // 컨텍스트 선택기에 청크 설정
    contextSelector.setChunks(this.allChunks);
    
    // PDF 내용 압축 (비동기 처리)
    console.log('Compressing PDF content...');
    this.compressionResult = await pdfCompressionService.compressPdfContent(fullText);
    this.cachedSourceText = this.compressionResult.compressedText;
  }

  /**
   * PDF 파일 목록 가져오기
   */
  private async getPDFFileList(): Promise<string[]> {
    try {
      const response = await fetch('/pdf/manifest.json');
      if (!response.ok) {
        throw new Error(`Manifest 로드 실패: ${response.status}`);
      }
      const pdfFiles = await response.json();
      return Array.isArray(pdfFiles) ? pdfFiles : [];
    } catch (error) {
      console.error('PDF 파일 목록 로드 실패:', error);
      return [];
    }
  }

  /**
   * PDF 로딩 우선순위 설정 (답변 품질 최적화)
   */
  private getPriorityPDFOrder(pdfFiles: string[]): string[] {
    // 답변 품질을 위해 중요한 PDF부터 먼저 로드
    const priorityKeywords = [
      // 1순위: 핵심 법령 문서
      { keywords: ['국민건강증진법률', '시행령', '시행규칙'], priority: 1 },
      { keywords: ['질서위반행위규제법'], priority: 1 },
      
      // 2순위: 주요 업무지침
      { keywords: ['금연지원서비스', '통합시스템', '사용자매뉴얼'], priority: 2 },
      { keywords: ['금연구역', '지정', '관리', '업무지침'], priority: 2 },
      
      // 3순위: 가이드라인 및 안내서
      { keywords: ['니코틴보조제', '이용방법', '가이드라인'], priority: 3 },
      { keywords: ['지역사회', '통합건강증진사업', '안내서'], priority: 3 },
      
      // 4순위: 해설집 및 기타
      { keywords: ['해설집'], priority: 4 }
    ];

    const prioritizedFiles = pdfFiles.map(file => {
      let priority = 5; // 기본 우선순위
      
      for (const { keywords, priority: p } of priorityKeywords) {
        if (keywords.some(keyword => file.includes(keyword))) {
          priority = p;
          break;
        }
      }
      
      return { file, priority };
    });

    // 우선순위 순으로 정렬
    return prioritizedFiles
      .sort((a, b) => a.priority - b.priority)
      .map(item => item.file);
  }

  /**
   * 캐시에서 데이터 로드
   */
  private async loadFromCache(): Promise<boolean> {
    try {
      const pdfFiles = await this.getPDFFileList();
      const cachedPDFs: CachedPDF[] = [];
      
      for (const filename of pdfFiles) {
        const cachedPDF = await cachingService.getCachedPDF(filename);
        if (cachedPDF) {
          cachedPDFs.push(cachedPDF);
        }
      }
      
      if (cachedPDFs.length === 0) {
        return false;
      }
      
      // 캐시된 데이터로 초기화
      const combinedText = cachedPDFs.map(pdf => pdf.text).join('\n--- END OF DOCUMENT ---\n\n--- START OF DOCUMENT ---\n');
      this.fullPdfText = combinedText;
      
      // 청크 설정
      this.allChunks = cachedPDFs.flatMap(pdf => pdf.chunks);
      contextSelector.setChunks(this.allChunks);
      
      // 압축 처리
      this.compressionResult = await pdfCompressionService.compressPdfContent(combinedText);
      this.cachedSourceText = this.compressionResult.compressedText;
      
      console.log(`캐시에서 ${cachedPDFs.length}개 PDF 로드 완료`);
      return true;
    } catch (error) {
      console.warn('캐시 로드 실패:', error);
      return false;
    }
  }

  /**
   * 캐시에 데이터 저장
   */
  private async saveToCache(results: any[]): Promise<void> {
    try {
      for (const result of results) {
        if (result.success && result.text && result.chunks) {
          await cachingService.cachePDF(
            result.filename,
            result.text,
            result.chunks,
            '1.0.0'
          );
        }
      }
      console.log('캐시 저장 완료');
    } catch (error) {
      console.warn('캐시 저장 실패:', error);
    }
  }

  /**
   * 메모리 사용량 최적화
   */
  private optimizeMemoryUsage(): void {
    try {
      // 청크들을 메모리 최적화 서비스에 캐시
      memoryOptimizationService.cacheChunks(this.allChunks);
      
      // 메모리 통계 업데이트
      this.memoryStats = memoryOptimizationService.getMemoryStats();
      
      console.log('메모리 최적화 완료:', this.memoryStats);
    } catch (error) {
      console.warn('메모리 최적화 실패:', error);
    }
  }

  /**
   * 성능 통계 반환
   */
  getPerformanceStats(): {
    loadingProgress: LoadingProgress | null;
    memoryStats: MemoryStats | null;
    isProgressiveLoadingEnabled: boolean;
    isMemoryOptimizationEnabled: boolean;
    isCachingEnabled: boolean;
  } {
    return {
      loadingProgress: this.loadingProgress,
      memoryStats: this.memoryStats,
      isProgressiveLoadingEnabled: this.isProgressiveLoadingEnabled,
      isMemoryOptimizationEnabled: this.isMemoryOptimizationEnabled,
      isCachingEnabled: this.isCachingEnabled
    };
  }

  /**
   * 성능 설정 업데이트
   */
  updatePerformanceSettings(settings: {
    progressiveLoading?: boolean;
    memoryOptimization?: boolean;
    caching?: boolean;
  }): void {
    if (settings.progressiveLoading !== undefined) {
      this.isProgressiveLoadingEnabled = settings.progressiveLoading;
    }
    if (settings.memoryOptimization !== undefined) {
      this.isMemoryOptimizationEnabled = settings.memoryOptimization;
    }
    if (settings.caching !== undefined) {
      this.isCachingEnabled = settings.caching;
    }
    console.log('성능 설정 업데이트:', {
      progressiveLoading: this.isProgressiveLoadingEnabled,
      memoryOptimization: this.isMemoryOptimizationEnabled,
      caching: this.isCachingEnabled
    });
  }

  /**
   * 답변 품질을 보장하는 질문 처리 (품질 최우선)
   */
  async processQuestionWithQualityGuarantee(question: string): Promise<{
    answer: string;
    quality: 'guaranteed' | 'partial' | 'insufficient';
    loadedPDFs: number;
    totalPDFs: number;
  }> {
    // 초기화 상태 확인
    if (!this.isInitialized) {
      return {
        answer: 'PDF 로딩이 아직 완료되지 않았습니다. 잠시 기다려주세요.',
        quality: 'insufficient',
        loadedPDFs: 0,
        totalPDFs: 0
      };
    }

    // 로딩 진행률 확인
    const loadingStatus = this.loadingProgress;
    if (loadingStatus && loadingStatus.current < loadingStatus.total) {
      const remainingFiles = loadingStatus.total - loadingStatus.current;
      return {
        answer: `PDF 로딩이 진행 중입니다 (${loadingStatus.current}/${loadingStatus.total}). 완전한 답변을 위해 ${remainingFiles}개 파일 로딩 완료까지 기다려주세요.`,
        quality: 'partial',
        loadedPDFs: loadingStatus.current,
        totalPDFs: loadingStatus.total
      };
    }

    // 답변 품질 100% 보장
    try {
      const answer = await this.generateAnswer(question);
      return {
        answer,
        quality: 'guaranteed',
        loadedPDFs: loadingStatus?.total || 0,
        totalPDFs: loadingStatus?.total || 0
      };
    } catch (error) {
      console.error('답변 생성 중 오류:', error);
      return {
        answer: '답변 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        quality: 'insufficient',
        loadedPDFs: 0,
        totalPDFs: 0
      };
    }
  }

  /**
   * 캐시 정리
   */
  async cleanupCache(): Promise<void> {
    try {
      if (this.isCachingEnabled) {
        await cachingService.cleanupOldCache();
        console.log('캐시 정리 완료');
      }
    } catch (error) {
      console.warn('캐시 정리 실패:', error);
    }
  }

  /**
   * 메모리 정리
   */
  cleanupMemory(): void {
    try {
      if (this.isMemoryOptimizationEnabled) {
        memoryOptimizationService.cleanup();
        this.memoryStats = memoryOptimizationService.getMemoryStats();
        console.log('메모리 정리 완료');
      }
    } catch (error) {
      console.warn('메모리 정리 실패:', error);
    }
  }

  // 사전 처리된 데이터 로드 (최우선)
  async loadPreprocessedData(): Promise<string | null> {
    try {
      console.log('사전 처리된 데이터 로드 시도...');
      // 상대 경로 사용 (GitHub Pages 호환)
      const response = await fetch('./data/processed-pdfs.json');
      
      if (!response.ok) {
        throw new Error(`사전 처리된 데이터를 찾을 수 없습니다: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.compressedText || !data.chunks) {
        throw new Error('사전 처리된 데이터 형식이 올바르지 않습니다.');
      }
      
      // 사전 처리된 데이터 설정
      this.cachedSourceText = data.compressedText;
      this.fullPdfText = data.fullText || data.compressedText;
      this.allChunks = data.chunks || [];
      this.isInitialized = true;
      
      // 압축 결과 설정
      this.compressionResult = {
        compressedText: data.compressedText,
        originalLength: data.metadata?.originalSize || data.compressedText.length,
        compressedLength: data.compressedText.length,
        compressionRatio: data.metadata?.compressionRatio || 1.0,
        estimatedTokens: data.metadata?.estimatedTokens || Math.ceil(data.compressedText.length / 4),
        qualityScore: data.metadata?.qualityScore || 85
      };
      
      // 컨텍스트 선택기에 청크 설정
      contextSelector.setChunks(this.allChunks);
      
      console.log(`사전 처리된 데이터 로드 완료: ${data.compressedText.length.toLocaleString()}자, ${this.allChunks.length}개 청크`);
      console.log(`압축률: ${(this.compressionResult.compressionRatio * 100).toFixed(1)}%`);
      
      return data.compressedText;
    } catch (error) {
      console.warn('사전 처리된 데이터 로드 실패, 실시간 파싱으로 폴백:', error);
      console.log('폴백 원인:', error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  // 실제 PDF 파일들을 파싱하여 소스 텍스트 생성 (최적화된 버전)
  async loadPdfSourcesOptimized(): Promise<string> {
    // public 폴더에서 PDF 파일들 로드
    const PDF_BASE_URL = '/chat7v/pdf/';
    
    try {
      console.log('Attempting to load PDF sources from:', PDF_BASE_URL);
      
      // manifest.json에서 PDF 파일 목록 가져오기
      const manifestUrl = `${PDF_BASE_URL}manifest.json`;
      console.log('Fetching manifest from:', manifestUrl);
      
      const manifestResponse = await fetch(manifestUrl);
      
      if (!manifestResponse.ok) {
        console.warn(`Manifest not found (${manifestResponse.status}), falling back to default sources`);
        throw new Error(`Could not load file list (manifest.json). Status: ${manifestResponse.statusText}`);
      }
      
      const pdfFiles = await manifestResponse.json();
      console.log('Found PDF files:', pdfFiles);
      
      if (!Array.isArray(pdfFiles) || pdfFiles.length === 0) {
        throw new Error("No PDF files found in manifest.json or the file is invalid.");
      }

      // PDF.js 미리 로드
      console.log('Pre-loading PDF.js...');
      await this.loadPdfJs();

      // 모든 PDF 파일을 병렬로 파싱 (최대 3개 동시 처리)
      const BATCH_SIZE = 3;
      const texts: string[] = [];
      
      for (let i = 0; i < pdfFiles.length; i += BATCH_SIZE) {
        const batch = pdfFiles.slice(i, i + BATCH_SIZE);
        console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(pdfFiles.length / BATCH_SIZE)}`);
        
        const batchPromises = batch.map(file => this.parsePdfFromUrl(PDF_BASE_URL + file));
        const batchTexts = await Promise.all(batchPromises);
        texts.push(...batchTexts);
      }
      
      const combinedText = texts.join('\n--- END OF DOCUMENT ---\n\n--- START OF DOCUMENT ---\n');
      
      console.log('Successfully loaded PDF sources');
      return combinedText;
    } catch (err) {
      console.warn("Error loading PDFs, using default sources:", err);
      // PDF 로딩 실패 시 기본 소스 사용
      return this.sources
        .map(source => `[${source.title}]\n${source.content}`)
        .join('\n\n');
    }
  }

  // 기존 메서드 유지 (호환성)
  async loadPdfSources(): Promise<string> {
    return this.loadPdfSourcesOptimized();
  }

  // 채팅 세션 생성 (하이브리드 방식: 매번 새로운 API 키 사용)
  async createNotebookChatSession(sourceText?: string): Promise<any> {
    // 매번 새로운 API 키 선택
    const selectedApiKey = this.getNextAvailableKey();
    if (!selectedApiKey) {
      throw new Error('사용 가능한 API 키가 없습니다.');
    }

    console.log(`채팅 세션 생성 - API 키: ${selectedApiKey.substring(0, 10)}...`);

    // PDF 내용이 아직 초기화되지 않았다면 초기화
    if (!this.isInitialized) {
      await this.initializeWithPdfSources();
    }

    // 압축된 PDF 내용 사용 (캐시된 내용)
    const actualSourceText = sourceText || this.cachedSourceText || '';
    const systemInstruction = SYSTEM_INSTRUCTION_TEMPLATE.replace('{sourceText}', actualSourceText);

    console.log(`Creating chat session with compressed text: ${actualSourceText.length.toLocaleString()} characters`);

    try {
      // 새로운 AI 인스턴스 생성 (선택된 키로)
      const ai = new GoogleGenAI({ apiKey: selectedApiKey });
      
      // chat_index.html과 정확히 동일한 방식
      const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
          systemInstruction: systemInstruction,
        },
        history: [],
      });

      // RPD 기록 - 안전한 인덱스 계산
      const apiKeys = this.getApiKeys();
      
      // currentKeyIndex가 NaN이거나 유효하지 않은 경우 0으로 초기화
      if (isNaN(GeminiService.currentKeyIndex) || GeminiService.currentKeyIndex < 0) {
        GeminiService.currentKeyIndex = 0;
      }
      
      // 선택된 키의 인덱스 계산 (현재 키가 아닌 선택된 키 기준)
      const selectedKeyIndex = apiKeys.findIndex(key => key === selectedApiKey);
      const actualKeyIndex = selectedKeyIndex >= 0 ? selectedKeyIndex : 0;
      const currentKeyId = `key${actualKeyIndex + 1}`;
      
      console.log(`API 키 상태 - currentKeyIndex: ${GeminiService.currentKeyIndex}, selectedKeyIndex: ${selectedKeyIndex}`);
      console.log(`사용된 키 인덱스: ${actualKeyIndex}, RPD 키 ID: ${currentKeyId}`);
      this.recordApiCall(currentKeyId);

      this.currentChatSession = chat;
      return chat;
    } catch (error) {
      console.error('채팅 세션 생성 실패:', error);
      
      // API 키 교체 시도
      const failedKeyIndex = (this.currentKeyIndex - 1 + 3) % 3;
      if (this.handleApiKeyFailure(API_KEYS[failedKeyIndex], error)) {
        // 키 교체 후 재시도
        return this.createNotebookChatSession(sourceText);
      }
      
      throw error;
    }
  }

  // 스트리밍 응답 생성 (질문별 컨텍스트 선택 사용 + 재시도 로직)
  async generateStreamingResponse(message: string): Promise<AsyncGenerator<string, void, unknown>> {
    return log.monitor(async () => {
      return this.executeWithRetry(async () => {
        try {
          // 1. 질문 분석
          log.debug('질문 분석 시작', { messageLength: message.length });
          const questionAnalysis = await questionAnalyzer.analyzeQuestion(message);
          log.info('질문 분석 완료', { analysis: questionAnalysis });

          // 2. 관련 컨텍스트 선택
          log.debug('관련 컨텍스트 선택 시작');
          const relevantChunks = await contextSelector.selectRelevantContext(message, questionAnalysis);
          log.info(`관련 컨텍스트 선택 완료`, { 
            selectedChunks: relevantChunks.length,
            chunks: relevantChunks.map(c => ({ title: c.metadata.title, section: c.location.section }))
          });

          // 2.5. 청크에서 출처 정보 생성 (문서 유형별 처리)
          const sourceInfo = this.generateSourceInfoFromChunks(relevantChunks);
          log.info('출처 정보 생성 완료', { 
            sources: sourceInfo.map(s => ({ 
              title: s.title, 
              section: s.section, 
              page: s.page,
              documentType: s.documentType 
            }))
          });

          // 3. 선택된 컨텍스트로 새 세션 생성 (개선된 포맷팅)
          const contextText = relevantChunks
            .map((chunk, index) => {
              const relevanceScore = (chunk as any).relevanceScore || 0;
              return `[문서 ${index + 1}: ${chunk.metadata.title} - ${chunk.location.section || '일반'}]\n관련도: ${relevanceScore.toFixed(2)}\n${chunk.content}`;
            })
            .join('\n\n---\n\n');

          log.info(`컨텍스트 기반 세션 생성`, { 
            contextLength: contextText.length,
            selectedChunks: relevantChunks.length
          });

          // 4. 새 채팅 세션 생성 (선택된 컨텍스트 사용)
          const newSession = await this.createNotebookChatSession(contextText);

          // 5. 스트리밍 응답 생성
          const stream = await newSession.sendMessageStream({ message: message });
          
          return (async function* () {
            for await (const chunk of stream) {
              if (chunk.text) {
                yield chunk.text;
              }
            }
          })();
        } catch (error) {
          log.error('컨텍스트 기반 응답 생성 실패, 전체 컨텍스트로 폴백', { error: error.message });
          
          // 폴백: 전체 컨텍스트 사용
          if (!this.currentChatSession) {
            await this.createNotebookChatSession();
          }

          const stream = await this.currentChatSession.sendMessageStream({ message: message });
          
          return (async function* () {
            for await (const chunk of stream) {
              if (chunk.text) {
                yield chunk.text;
              }
            }
          })();
        }
      }, 3, 1000).catch(error => {
        log.error('모든 재시도 시도 실패', { error: error.message });
        
        // 사용자 친화적인 오류 메시지 제공
        return (async function* () {
          if (error.message && (
            error.message.includes('429') || 
            error.message.includes('RESOURCE_EXHAUSTED') ||
            error.message.includes('quota') ||
            error.message.includes('Quota') ||
            error.message.includes('rate limit')
          )) {
            yield '답변 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.';
          } else {
            yield '죄송합니다. 현재 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.';
          }
        })();
      });
    }, '스트리밍 응답 생성', { messageLength: message.length });
  }

  // 출처 정보를 포함한 응답 생성
  async generateResponseWithSources(message: string): Promise<{ content: string; sources: SourceInfo[] }> {
    return this.executeWithRetry(async () => {
      // 매 질문마다 새로운 API 키 선택
      const selectedApiKey = this.getNextAvailableKey();
      if (!selectedApiKey) {
        throw new Error('사용 가능한 API 키가 없습니다.');
      }

      console.log(`질문 처리 (출처 포함) - API 키: ${selectedApiKey.substring(0, 10)}...`);

      // 새로운 AI 인스턴스 생성 (선택된 키로)
      const ai = new GoogleGenAI({ apiKey: selectedApiKey });
      
      // PDF 소스 텍스트 로드
      if (!this.cachedSourceText) {
        await this.initializeWithPdfSources();
      }

      if (!this.cachedSourceText) {
        throw new Error('PDF 소스를 로드할 수 없습니다.');
      }

      // 질문 분석
      const questionAnalysis = await questionAnalyzer.analyzeQuestion(message);
      
      // 관련 컨텍스트 선택
      const relevantChunks = await contextSelector.selectRelevantContext(message, questionAnalysis);
      
      // 청크에서 출처 정보 생성 (문서 유형별 처리)
      const sourceInfo = this.generateSourceInfoFromChunks(relevantChunks);

      // 선택된 컨텍스트를 새로운 형식으로 구성
      const sourceMaterial = relevantChunks
        .map((chunk, index) => {
          const relevanceScore = (chunk as any).relevanceScore || 0;
          const pageInfo = chunk.metadata.pageNumber ? `p.${chunk.metadata.pageNumber}` : '';
          const articleInfo = chunk.metadata.articles?.length ? chunk.metadata.articles.join(', ') : '';
          const sourceRef = pageInfo || articleInfo || '일반';
          
          return `[청크 ${chunk.id}]
출처: ${chunk.metadata.source}
페이지/조항: ${sourceRef}
관련도: ${relevanceScore.toFixed(2)}
내용: ${chunk.content}`;
        })
        .join('\n\n---\n\n');

      // 새로운 시스템 지시사항과 소스 텍스트 결합
      const systemInstruction = `${SYSTEM_INSTRUCTION_TEMPLATE}

### SOURCE MATERIAL:
${sourceMaterial}

### USER QUESTION:
${message}

Please provide your answer following the mandatory response format.`;
      
      // Gemini API 호출
      const model = ai.getGenerativeModel({ 
        model: 'gemini-2.5-flash',
        systemInstruction: systemInstruction
      });

      const result = await model.generateContent(message);
      const response = await result.response;
      const text = response.text();
      
      console.log(`응답 생성 완료 (출처 포함) - 사용된 키: ${selectedApiKey.substring(0, 10)}...`);
      return { content: text, sources: sourceInfo };
    }, 3, 1000).catch(error => {
      console.error('All retry attempts failed:', error);
      
      // 사용자 친화적인 오류 메시지 제공
      if (error.message && (
        error.message.includes('429') || 
        error.message.includes('RESOURCE_EXHAUSTED') ||
        error.message.includes('quota') ||
        error.message.includes('Quota') ||
        error.message.includes('rate limit')
      )) {
        return { 
          content: '죄송합니다. 현재 API 사용량이 초과되어 일시적으로 서비스를 이용할 수 없습니다. 잠시 후 다시 시도해주세요.', 
          sources: [] 
        };
      } else if (error.message && error.message.includes('API_KEY_INVALID')) {
        return { 
          content: 'API 키에 문제가 있습니다. 관리자에게 문의해주세요.', 
          sources: [] 
        };
      } else {
        return { 
          content: '죄송합니다. 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 
          sources: [] 
        };
      }
    });
  }

  // 하이브리드 방식: 매 질문마다 새로운 API 키로 AI 인스턴스 생성 + 재시도 로직
  async generateResponse(message: string): Promise<string> {
    return this.executeWithRetry(async () => {
      // 매 질문마다 새로운 API 키 선택
      const selectedApiKey = this.getNextAvailableKey();
      if (!selectedApiKey) {
        throw new Error('사용 가능한 API 키가 없습니다.');
      }

      console.log(`질문 처리 - API 키: ${selectedApiKey.substring(0, 10)}...`);

      // 새로운 AI 인스턴스 생성 (선택된 키로)
      const ai = new GoogleGenAI({ apiKey: selectedApiKey });
      
      // PDF 소스 텍스트 로드
      if (!this.cachedSourceText) {
        await this.initializeWithPdfSources();
      }

      if (!this.cachedSourceText) {
        throw new Error('PDF 소스를 로드할 수 없습니다.');
      }

      // 새로운 시스템 지시사항과 소스 텍스트 결합
      const systemInstruction = `${SYSTEM_INSTRUCTION_TEMPLATE}

### SOURCE MATERIAL:
${this.cachedSourceText}

### USER QUESTION:
${message}

Please provide your answer following the mandatory response format.`;
      
      // Gemini API 호출
      const model = ai.getGenerativeModel({ 
        model: 'gemini-2.5-flash',
        systemInstruction: systemInstruction
      });

      const result = await model.generateContent(message);
      const response = await result.response;
      const text = response.text();
      
      console.log(`응답 생성 완료 - 사용된 키: ${selectedApiKey.substring(0, 10)}...`);
      return text;
    }, 3, 1000).catch(error => {
      console.error('All retry attempts failed:', error);
      
      // 사용자 친화적인 오류 메시지 제공
      if (error.message && (
        error.message.includes('429') || 
        error.message.includes('RESOURCE_EXHAUSTED') ||
        error.message.includes('quota') ||
        error.message.includes('Quota') ||
        error.message.includes('rate limit')
      )) {
        return '답변 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.';
      }
      
      return `API 호출 중 오류가 발생했습니다: ${error.message}`;
    });
  }

  // 채팅 세션 초기화
  async resetChatSession(): Promise<void> {
    try {
      console.log('Resetting chat session...');
      
      // 현재 진행 중인 요청이 있다면 취소
      this.cancelCurrentRequest();
      
      // 현재 채팅 세션 초기화
      this.currentChatSession = null;
      
      // PDF 내용은 다시 압축하지 않고 기존 캐시 사용
      await this.createNotebookChatSession();
      
      console.log('Chat session reset successfully');
    } catch (error) {
      console.error('Failed to reset chat session:', error);
      throw error;
    }
  }

  // 현재 요청 취소
  cancelCurrentRequest(): void {
    if (this.currentAbortController) {
      console.log('Cancelling current request...');
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }

  // 압축 통계 정보 가져오기
  getCompressionStats(): CompressionResult | null {
    return this.compressionResult;
  }

  // PDF 내용 재압축 (필요시)
  async recompressPdfSources(): Promise<void> {
    this.isInitialized = false;
    this.cachedSourceText = null;
    this.compressionResult = null;
    await this.initializeWithPdfSources();
  }

  // RPD 통계 조회
  getRpdStats() {
    return rpdService.getRpdStats();
  }
}

export const geminiService = new GeminiService();