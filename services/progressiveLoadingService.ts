/**
 * 점진적 로딩 서비스
 * PDF를 하나씩 로드하여 초기 로딩 시간을 단축하고 메모리 사용량을 최적화
 */

import { Chunk } from '../types';
import { pdfCompressionService } from './pdfCompressionService';

export interface LoadingProgress {
  current: number;
  total: number;
  currentFile: string;
  status: string;
  successfulFiles: string[];
  failedFiles: string[];
  loadedChunks: number;
  estimatedTimeRemaining: number;
}

export interface PDFLoadResult {
  success: boolean;
  filename: string;
  text?: string;
  chunks?: Chunk[];
  error?: string;
  loadTime: number;
}

export class ProgressiveLoadingService {
  private loadedPDFs: Map<string, PDFLoadResult> = new Map();
  private allChunks: Chunk[] = [];
  private loadingProgress: LoadingProgress = {
    current: 0,
    total: 0,
    currentFile: '',
    status: '대기 중...',
    successfulFiles: [],
    failedFiles: [],
    loadedChunks: 0,
    estimatedTimeRemaining: 0
  };
  private progressCallbacks: ((progress: LoadingProgress) => void)[] = [];

  /**
   * 진행률 콜백 등록
   */
  onProgress(callback: (progress: LoadingProgress) => void) {
    this.progressCallbacks.push(callback);
  }

  /**
   * 진행률 업데이트
   */
  private updateProgress(updates: Partial<LoadingProgress>) {
    this.loadingProgress = { ...this.loadingProgress, ...updates };
    this.progressCallbacks.forEach(callback => callback(this.loadingProgress));
  }

  /**
   * PDF 파일들을 점진적으로 로드
   */
  async loadPDFsProgressively(
    pdfFiles: string[],
    baseUrl: string = '/pdf/'
  ): Promise<PDFLoadResult[]> {
    console.log(`점진적 로딩 시작: ${pdfFiles.length}개 파일`);
    
    this.updateProgress({
      current: 0,
      total: pdfFiles.length,
      currentFile: '',
      status: '시작 중...',
      successfulFiles: [],
      failedFiles: [],
      loadedChunks: 0,
      estimatedTimeRemaining: 0
    });

    const results: PDFLoadResult[] = [];
    const startTime = Date.now();

    for (let i = 0; i < pdfFiles.length; i++) {
      const file = pdfFiles[i];
      const fileStartTime = Date.now();
      
      this.updateProgress({
        current: i + 1,
        currentFile: file,
        status: `${i + 1}/${pdfFiles.length} 파일 처리 중...`
      });

      try {
        const result = await this.loadSinglePDF(file, baseUrl);
        results.push(result);
        
        if (result.success) {
          this.loadedPDFs.set(file, result);
          this.allChunks.push(...(result.chunks || []));
          
          this.updateProgress({
            successfulFiles: [...this.loadingProgress.successfulFiles, file],
            loadedChunks: this.allChunks.length
          });
          
          console.log(`✅ PDF 로딩 성공: ${file} (${result.loadTime}ms)`);
        } else {
          this.updateProgress({
            failedFiles: [...this.loadingProgress.failedFiles, file]
          });
          
          console.warn(`⚠️ PDF 로딩 실패: ${file} - ${result.error}`);
        }
      } catch (error) {
        const errorResult: PDFLoadResult = {
          success: false,
          filename: file,
          error: error instanceof Error ? error.message : '알 수 없는 오류',
          loadTime: Date.now() - fileStartTime
        };
        
        results.push(errorResult);
        this.loadedPDFs.set(file, errorResult);
        
        this.updateProgress({
          failedFiles: [...this.loadingProgress.failedFiles, file]
        });
        
        console.error(`❌ PDF 로딩 오류: ${file}`, error);
      }

      // 예상 남은 시간 계산
      const elapsed = Date.now() - startTime;
      const avgTimePerFile = elapsed / (i + 1);
      const remainingFiles = pdfFiles.length - (i + 1);
      const estimatedRemaining = Math.round(avgTimePerFile * remainingFiles);

      this.updateProgress({
        estimatedTimeRemaining: estimatedRemaining
      });

      // 메모리 정리를 위한 짧은 대기
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const totalTime = Date.now() - startTime;
    console.log(`점진적 로딩 완료: ${totalTime}ms, 성공: ${this.loadingProgress.successfulFiles.length}, 실패: ${this.loadingProgress.failedFiles.length}`);

    this.updateProgress({
      status: `로딩 완료 (${totalTime}ms)`,
      estimatedTimeRemaining: 0
    });

    return results;
  }

  /**
   * 단일 PDF 파일 로드
   */
  private async loadSinglePDF(filename: string, baseUrl: string): Promise<PDFLoadResult> {
    const startTime = Date.now();
    
    try {
      // PDF 파싱
      const text = await this.parsePdfFromUrl(baseUrl + filename);
      
      if (!text || text.trim().length === 0) {
        throw new Error('PDF 텍스트가 비어있습니다.');
      }

      // 청크 생성
      const chunks = pdfCompressionService.splitIntoChunks(text, filename);
      
      const loadTime = Date.now() - startTime;
      
      return {
        success: true,
        filename,
        text,
        chunks,
        loadTime
      };
    } catch (error) {
      const loadTime = Date.now() - startTime;
      
      return {
        success: false,
        filename,
        error: error instanceof Error ? error.message : '알 수 없는 오류',
        loadTime
      };
    }
  }

  /**
   * PDF 파싱 (기존 로직 재사용)
   */
  private async parsePdfFromUrl(url: string): Promise<string> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const pdfData = await response.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(pdfData) }).promise;
      
      let fullText = '';
      const filename = url.split('/').pop() || '';
      const isLegal = this.isLegalDocument(filename);

      console.log(`PDF 총 페이지 수: ${pdf.numPages}, 법령 문서: ${isLegal}`);

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();

        // 줄바꿈 보존
        let pageText = '';
        for (let j = 0; j < textContent.items.length; j++) {
          const item = textContent.items[j];
          pageText += item.str;
          if (item.hasEOL) {
            pageText += '\n';
          }
        }

        if (isLegal) {
          const articles = this.extractLegalArticles(pageText, filename);
          if (articles.length > 0) {
            const articleMarkers = articles.map(article => `[ARTICLE_${article}]`).join(' ');
            fullText += `${articleMarkers} ${pageText}\n\n`;
          } else {
            const actualPageNumber = this.extractActualPageNumber(pageText, i);
            fullText += `[PAGE_${actualPageNumber}] ${pageText}\n\n`;
          }
        } else {
          const actualPageNumber = this.extractActualPageNumber(pageText, i);
          fullText += `[PAGE_${actualPageNumber}] ${pageText}\n\n`;
        }
      }

      return fullText;
    } catch (err) {
      console.error(`Error parsing PDF from ${url}:`, err);
      throw new Error(`Failed to parse ${url.split('/').pop()}: ${(err as Error).message}`);
    }
  }

  /**
   * 법령 문서 여부 판단
   */
  private isLegalDocument(filename: string): boolean {
    const legalKeywords = ['법률', '법', '시행령', '시행규칙', '규제법', '해설집'];
    return legalKeywords.some(keyword => 
      filename.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  /**
   * 법령 조항 추출 (시행령/시행규칙 구분)
   */
  private extractLegalArticles(pageText: string, filename: string): string[] {
    const articles: string[] = [];
    
    // 파일명에서 법령 유형 판단
    const isEnforcementDecree = filename.includes('시행령');
    const isEnforcementRule = filename.includes('시행규칙');
    
    // 법령 조항 패턴들
    const articlePatterns = [
      /제(\d+)조/g,
      /제(\d+)조제(\d+)항/g,
      /제(\d+)조제(\d+)항제(\d+)호/g,
      /제(\d+)조제(\d+)항제(\d+)호([가-힣])목/g,
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

  /**
   * 실제 PDF 페이지 번호 추출
   */
  private extractActualPageNumber(pageText: string, pageIndex: number): number {
    const lines = pageText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const bottomLines = lines.slice(-5);
    
    for (let i = bottomLines.length - 1; i >= 0; i--) {
      const line = bottomLines[i];
      const pageNumberPatterns = [
        /^(\d+)$/, /^페이지\s*(\d+)$/i, /^Page\s*(\d+)$/i, /^(\d+)\s*\/\s*\d+$/,
        /^(\d+)\s*of\s*\d+$/i, /^p\.\s*(\d+)$/i, /^P\.\s*(\d+)$/i
      ];
      
      for (const pattern of pageNumberPatterns) {
        const match = line.match(pattern);
        if (match && match[1]) {
          const pageNum = parseInt(match[1], 10);
          if (pageNum >= 1 && pageNum <= 999) {
            return pageNum;
          }
        }
      }
    }
    
    // 폴백: 순차 인덱스 사용
    return pageIndex;
  }

  /**
   * 로드된 청크들 반환
   */
  getAllChunks(): Chunk[] {
    return this.allChunks;
  }

  /**
   * 로드된 PDF 결과 반환
   */
  getLoadedPDFs(): Map<string, PDFLoadResult> {
    return this.loadedPDFs;
  }

  /**
   * 현재 진행률 반환
   */
  getProgress(): LoadingProgress {
    return this.loadingProgress;
  }

  /**
   * 성공적으로 로드된 PDF들의 텍스트 결합
   */
  getCombinedText(): string {
    const successfulResults = Array.from(this.loadedPDFs.values())
      .filter(result => result.success && result.text);
    
    return successfulResults
      .map(result => result.text!)
      .join('\n--- END OF DOCUMENT ---\n\n--- START OF DOCUMENT ---\n');
  }

  /**
   * 메모리 정리
   */
  cleanup() {
    this.loadedPDFs.clear();
    this.allChunks = [];
    this.progressCallbacks = [];
    this.updateProgress({
      current: 0,
      total: 0,
      currentFile: '',
      status: '정리 완료',
      successfulFiles: [],
      failedFiles: [],
      loadedChunks: 0,
      estimatedTimeRemaining: 0
    });
  }
}

// 싱글톤 인스턴스
export const progressiveLoadingService = new ProgressiveLoadingService();
