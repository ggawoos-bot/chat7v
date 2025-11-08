import React, { useState, useEffect, useCallback } from 'react';
import ChatWindow from './components/ChatWindow';
import SourceInfo from './components/SourceInfo';
import CompressionStats from './components/CompressionStats';
import ConfirmDialog from './components/ConfirmDialog';
import { FirestoreCacheManager } from './components/FirestoreCacheManager';
import { AdvancedSearchTest } from './components/AdvancedSearchTest';
import { SourceViewer } from './components/SourceViewer';
import { TooltipProvider } from './components/TooltipContext';
import { geminiService } from './services/geminiService';
import { FirestoreService } from './services/firestoreService';
import { SourceInfo as SourceInfoType } from './types';

// ✅ PDF.js 타입 선언
declare global {
  interface Window {
    pdfjsLib?: any;
  }
}

function App() {
  const [sources, setSources] = useState<SourceInfoType[]>([]);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showCompressionStats, setShowCompressionStats] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showAdvancedSearchTest, setShowAdvancedSearchTest] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [chatKey, setChatKey] = useState(0); // ChatWindow 리렌더링을 위한 키
  
  // ✅ SourceViewer 상태 관리
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>();
  const [highlightedChunkId, setHighlightedChunkId] = useState<string>();
  const [questionContent, setQuestionContent] = useState<string>(''); // ✅ 질문 내용 저장
  
  // ✅ PDF 뷰어 상태 관리
  const [pdfViewerMode, setPdfViewerMode] = useState<'text' | 'pdf'>('text');
  const [pdfCurrentPage, setPdfCurrentPage] = useState<number>(1);
  const [pdfFilename, setPdfFilename] = useState<string>('');
  
  // ✅ 사이드바 리사이징 관련 상태
  const [sidebarWidth, setSidebarWidth] = useState<number>(450); // 기본값: 450px (약 25-30%)
  const [isResizing, setIsResizing] = useState(false);
  const [originalSidebarWidth, setOriginalSidebarWidth] = useState<number>(450); // 원래 사이드바 너비 저장
  
  // ✅ 리사이즈 핸들러들
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    // 리사이즈 업데이트 rAF 스로틀링
    let rafId: number | null = null;
    let pendingWidth: number | null = null;

    const flushWidth = () => {
      if (pendingWidth !== null) {
        setSidebarWidth(pendingWidth);
        pendingWidth = null;
      }
      rafId = null;
    };

    const handleResize = (e: MouseEvent) => {
      if (!isResizing) return;
      // 최소 너비: 250px, 최대 너비: 800px (더 작게 조정 가능하게)
      const newWidth = Math.min(Math.max(250, e.clientX), 800);
      pendingWidth = newWidth;
      if (rafId === null) {
        rafId = requestAnimationFrame(flushWidth);
      }
    };

    const handleResizeEnd = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleResize);
      document.addEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleResize);
      document.removeEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isResizing]);

  // ✅ 소스뷰어 표시/숨김 시 사이드바 너비 자동 조정
  useEffect(() => {
    if (selectedDocumentId) {
      // 소스뷰어가 표시될 때: 현재 너비를 원래 너비로 저장하고 2배로 확장
      const currentWidth = sidebarWidth;
      setOriginalSidebarWidth(currentWidth);
      const expandedWidth = Math.min(currentWidth * 1.5, 800); // 최대 800px, 1.5배로 확장
      setSidebarWidth(expandedWidth);
    } else if (selectedDocumentId === undefined) {
      // 소스뷰어가 닫힐 때: 원래 너비로 복원
      setSidebarWidth(originalSidebarWidth);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDocumentId]);
  
  // ✅ 소스 클릭 핸들러
  const handleSourceClick = async (sourceId: string) => {
    console.log('🖱️ 소스 클릭됨, sourceId:', sourceId);
    
    // sourceId가 숫자만 있는 경우 (인덱스일 가능성)
    if (/^\d+$/.test(sourceId)) {
      console.warn('⚠️ sourceId가 숫자입니다. 이는 배열 인덱스일 수 있습니다.');
      console.log('📋 sources 배열:', sources);
      
      // 인덱스로 변환
      const index = parseInt(sourceId);
      if (sources && sources[index]) {
        const actualSourceId = sources[index].id;
        console.log('✅ 인덱스를 실제 sourceId로 변환:', actualSourceId);
        await handleSourceClick(actualSourceId);
        return;
      } else {
        console.error('❌ 유효하지 않은 인덱스:', index, 'sources 길이:', sources.length);
        return;
      }
    }
    
    try {
      // FirestoreService 인스턴스 가져오기
      const firestoreService = FirestoreService.getInstance();
      
      // Firestore에서 모든 문서 가져오기
      const allDocuments = await firestoreService.getAllDocuments();
      console.log('📚 전체 문서 목록:', allDocuments.map(d => ({ id: d.id, title: d.title, filename: d.filename })));
      
      // sourceId에서 파일명 추출 (예: "filename-page-section" 또는 "filename-section")
      const parts = sourceId.split('-');
      console.log('🔍 sourceId 파싱:', parts);
      
      // 가능한 모든 조합 시도
      let matchingDoc = null;
      
      // 방법 1: sourceId가 Firestore document ID와 일치하는 경우
      matchingDoc = allDocuments.find(doc => doc.id === sourceId);
      
      if (!matchingDoc) {
        // 방법 2: filename에 .pdf 추가
        matchingDoc = allDocuments.find(doc => 
          doc.filename === parts[0] + '.pdf' || 
          doc.filename === parts[0] ||
          doc.filename.startsWith(parts[0])
        );
      }
      
      if (!matchingDoc && parts.length > 1) {
        // 방법 3: 파일명에 하이픈이 포함된 경우
        const firstTwo = parts[0] + '-' + parts[1];
        matchingDoc = allDocuments.find(doc => 
          doc.filename.includes(firstTwo) || 
          doc.filename.startsWith(parts[0])
        );
      }
      
      if (matchingDoc) {
        setSelectedDocumentId(matchingDoc.id);
        setPdfFilename(matchingDoc.filename); // ✅ PDF 파일명 설정 추가
        console.log('✅ 소스 선택 완료:', matchingDoc.title, 'ID:', matchingDoc.id);
      } else {
        console.warn('❌ 문서를 찾을 수 없습니다. sourceId:', sourceId, '전체 문서:', allDocuments.map(d => d.filename));
      }
    } catch (error) {
      console.error('❌ 소스 클릭 오류:', error);
    }
  };

  // 앱 시작 시 PDF 소스 로드 (압축 기능 포함 + 진행률 표시)
  useEffect(() => {
    const initializeSources = async () => {
      try {
        console.log('Starting PDF initialization...');
        
        // PDF 내용을 압축하여 초기화 (비동기 처리)
        // ✅ 성능 최적화: 초기화 시 세션 생성 제거 (지연 생성으로 변경)
        // 세션은 질문 전송 시 필요할 때 생성됩니다.
        await geminiService.initializeWithPdfSources();
        
        // 소스 목록 업데이트 (초기화 완료 후 반드시 실행)
        const loadedSources = geminiService.getSources();
        console.log('📋 로드된 소스 목록:', loadedSources.length, '개');
        if (loadedSources.length === 0) {
          console.warn('⚠️ 소스 목록이 비어있습니다. manifest.json을 확인하세요.');
        } else {
          console.log('📄 소스 파일들:', loadedSources.map(s => s.title));
        }
        setSources(loadedSources);
        
        console.log('Initialization completed successfully');
        setIsInitializing(false);
      } catch (error) {
        console.error('Failed to initialize PDF sources:', error);
        // 초기화 실패 시에도 소스 목록은 가져오기 시도
        try {
          const fallbackSources = geminiService.getSources();
          if (fallbackSources.length > 0) {
            console.log('✅ 초기화 실패했지만 소스 목록은 로드됨:', fallbackSources.length, '개');
            setSources(fallbackSources);
          } else {
            console.warn('⚠️ 초기화 실패 및 소스 목록도 비어있음');
            // 소스 목록을 다시 로드 시도
            await geminiService.loadDefaultSources();
            const retrySources = geminiService.getSources();
            if (retrySources.length > 0) {
              console.log('✅ 재시도로 소스 목록 로드 성공:', retrySources.length, '개');
              setSources(retrySources);
            }
          }
        } catch (sourceError) {
          console.error('❌ 소스 목록 로드 실패:', sourceError);
        }
        // 초기화 실패 시에도 앱을 계속 실행
        console.warn('초기화에 실패했지만 앱을 계속 실행합니다.');
        setIsInitializing(false);
      }
    };

    // 초기화를 비동기로 실행하여 UI 블로킹 방지
    initializeSources();
  }, []);

  // ✅ 열린 PDF 창 참조 저장 (전역)
  const pdfViewerWindowRef = React.useRef<Window | null>(null);
  
  // ✅ 페이지 검색 캐시 (성능 최적화)
  const pageSearchCache = React.useRef<Map<string, number>>(new Map());
  const MAX_CACHE_SIZE = 1000;
  
  // ✅ PDF.js 로드 확인 및 초기화
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.pdfjsLib) {
      // ✅ PDF.js 버전 통일: 5.4.296 (package.json과 일치)
      const pdfjsVersion = '5.4.296';
      const script = document.createElement('script');
      script.src = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.min.js`;
      script.onload = () => {
        if (window.pdfjsLib) {
          // ✅ Worker 설정을 로컬 파일로 우선 설정 (안정적, CDN 의존성 제거)
          const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
          const localWorkerPath = isDevelopment 
            ? '/assets/pdf.worker.min.js'
            : '/chat7v/assets/pdf.worker.min.js';
          
          // ✅ 로컬 파일 우선 설정 (CDN 실패 방지)
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = localWorkerPath;
          console.log(`✅ PDF.js 로드 완료 (v${pdfjsVersion}), Worker: 로컬 파일 (${localWorkerPath})`);
        }
      };
      script.onerror = () => {
        console.warn('⚠️ PDF.js CDN 로드 실패, 로컬 파일 시도');
        // 로컬 파일 폴백은 index.html에서 처리됨
      };
      document.head.appendChild(script);
    }
  }, []);
  
  // ✅ 텍스트 정규화 함수 (매칭 정확도 향상)
  const normalizeTextForSearch = (text: string): string => {
    if (!text) return '';
    return text
      .replace(/\s+/g, ' ')           // 연속 공백을 하나로
      .replace(/[\n\r\t]/g, ' ')      // 줄바꿈/탭을 공백으로
      .replace(/[^\w가-힣\s:;]/g, '') // 특수문자 제거 (콜론, 세미콜론은 유지)
      .toLowerCase()
      .trim();
  };
  
  /**
   * PDF에서 문장을 검색하여 정확한 페이지 찾기 (주변 3페이지 집중 분석 + 단어 단위 매칭)
   * fallbackPage 기준 앞뒤 1페이지만 비교하여 정확도와 성능 최적화
   */
  const findExactPageInPDF = async (
    pdfUrl: string, 
    searchSentence: string, 
    fallbackPage: number
  ): Promise<number> => {
    try {
      console.log('🔍 PDF에서 정확한 페이지 검색 시작 (주변 3페이지 분석 + 단어 매칭):', {
        searchSentence: searchSentence.substring(0, 50),
        fallbackPage
      });

      // 캐시 키 생성 (성능 최적화)
      const cacheKey = `${pdfUrl}:${searchSentence.substring(0, 100)}`;
      const cachedPage = pageSearchCache.current.get(cacheKey);
      if (cachedPage) {
        console.log('✅ 캐시에서 페이지 찾음:', cachedPage);
        return cachedPage;
      }

      // PDF.js가 로드되었는지 확인
      if (!window.pdfjsLib) {
        console.warn('⚠️ PDF.js가 로드되지 않음, fallback 페이지 사용');
        return fallbackPage;
      }

      // ✅ 개선: PDF.js Worker 설정 (로컬 파일 우선, Worker 리셋 지원)
      try {
        if (window.pdfjsLib) {
          // ✅ Worker가 이미 설정되어 있으면 리셋 시도 (새로운 설정 적용을 위해)
          if (window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
            try {
              // PDF.js 내부 Worker 인스턴스 리셋
              if (window.pdfjsLib.GlobalWorkerOptions.workerPort) {
                window.pdfjsLib.GlobalWorkerOptions.workerPort.terminate();
              }
              // Worker 포트 초기화
              window.pdfjsLib.GlobalWorkerOptions.workerPort = null;
            } catch (e) {
              // 리셋 실패해도 계속 진행
              console.warn('⚠️ Worker 리셋 실패 (계속 진행):', e);
            }
          }
          
          // ✅ 로컬 파일 우선 설정 (안정적, CDN 의존성 제거)
          const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
          const localWorkerPath = isDevelopment 
            ? '/assets/pdf.worker.min.js'
            : '/chat7v/assets/pdf.worker.min.js';
          
          // 로컬 파일 우선 설정
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = localWorkerPath;
          console.log('✅ PDF.js Worker 설정 (로컬 파일 우선):', localWorkerPath);
        }
      } catch (error) {
        console.warn('⚠️ PDF.js Worker 설정 실패:', error);
        // Worker 없이도 기본 기능은 작동하므로 계속 진행
      }

      // PDF.js로 PDF 로드 (Worker 경로 검증 후)
      let pdf;
      try {
        // ✅ Worker 경로가 설정되어 있는지 확인 및 검증
        if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
          // Worker가 설정되지 않았으면 로컬 파일로 설정
          const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
          const localWorkerPath = isDevelopment 
            ? '/assets/pdf.worker.min.js'
            : '/chat7v/assets/pdf.worker.min.js';
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = localWorkerPath;
          console.log('✅ Worker 경로 자동 설정:', localWorkerPath);
        }
        
        const loadingTask = window.pdfjsLib.getDocument({
          url: pdfUrl,
          verbosity: 0
        });
        pdf = await loadingTask.promise;
      } catch (error) {
        // Worker 로딩 실패인 경우 다른 CDN 시도
        if (error.message && (error.message.includes('worker') || error.message.includes('Failed to fetch'))) {
          console.warn('⚠️ 첫 번째 CDN 실패, 대체 CDN 시도:', error.message);
          try {
            // ✅ 버전 감지
            const pdfjsVersion = window.pdfjsLib?.version || '5.4.296';
            
            // 대체 CDN 시도 (npm 패키지 경로 사용, ESM 모듈 우선)
            const alternativeUrls = [
              `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/build/pdf.worker.min.mjs`,
              `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsVersion}/build/pdf.worker.min.mjs`,
              // legacy 빌드도 시도
              `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/legacy/build/pdf.worker.min.js`,
              `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsVersion}/legacy/build/pdf.worker.min.js`,
              // cdnjs는 마지막에 시도
              `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.min.js`
            ];
            
            for (const altUrl of alternativeUrls) {
              try {
                // ✅ Worker 리셋 후 재설정 (새로운 Worker 경로 적용을 위해)
                try {
                  if (window.pdfjsLib.GlobalWorkerOptions.workerPort) {
                    window.pdfjsLib.GlobalWorkerOptions.workerPort.terminate();
                  }
                  window.pdfjsLib.GlobalWorkerOptions.workerPort = null;
                } catch (e) {
                  // 리셋 실패해도 계속 진행
                }
                
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = altUrl;
                console.log('🔄 대체 CDN 시도 (Worker 리셋 후):', altUrl);
                
                const loadingTask2 = window.pdfjsLib.getDocument({
                  url: pdfUrl,
                  verbosity: 0
                });
                pdf = await loadingTask2.promise;
                console.log('✅ 대체 CDN으로 PDF 로드 성공');
                break;
              } catch (retryError) {
                console.warn('⚠️ 대체 CDN 실패:', altUrl, retryError.message);
                continue;
              }
            }
            
            // ✅ 추가: 모든 CDN 실패 시 로컬 파일 시도
            if (!pdf) {
              console.warn('⚠️ 모든 CDN 실패, 로컬 파일 시도');
              try {
                // ✅ Worker 리셋 후 로컬 파일 설정 (새로운 Worker 경로 적용을 위해)
                try {
                  if (window.pdfjsLib.GlobalWorkerOptions.workerPort) {
                    window.pdfjsLib.GlobalWorkerOptions.workerPort.terminate();
                  }
                  window.pdfjsLib.GlobalWorkerOptions.workerPort = null;
                } catch (e) {
                  // 리셋 실패해도 계속 진행
                }
                
                const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                const localWorkerPath = isDevelopment 
                  ? '/assets/pdf.worker.min.js'
                  : '/chat7v/assets/pdf.worker.min.js';
                
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = localWorkerPath;
                console.log('🔄 로컬 Worker 파일 시도 (Worker 리셋 후):', localWorkerPath);
                
                const loadingTask3 = window.pdfjsLib.getDocument({
                  url: pdfUrl,
                  verbosity: 0
                });
                pdf = await loadingTask3.promise;
                console.log('✅ 로컬 Worker 파일로 PDF 로드 성공');
              } catch (localError) {
                console.error('❌ 로컬 Worker 파일도 실패, fallback 페이지 사용:', localError);
                return fallbackPage;
              }
            }
            
            if (!pdf) {
              console.error('❌ 모든 방법 실패, fallback 페이지 사용');
              return fallbackPage;
            }
          } catch (error2) {
            console.error('❌ PDF 로드 재시도 실패, fallback 페이지 사용:', error2);
            return fallbackPage;
          }
        } else {
          // Worker 외의 다른 오류
          console.error('❌ PDF 로드 실패, fallback 페이지 사용:', error);
          return fallbackPage;
        }
      }
      
      // 참조 문장 정규화 (매칭 정확도 향상)
      const normalizedSearch = normalizeTextForSearch(searchSentence);
      
      if (normalizedSearch.length < 10) {
        console.warn('⚠️ 검색 문장이 너무 짧음, fallback 페이지 사용');
        return fallbackPage;
      }

      // ✅ 개선: 주변 3페이지(-1, 0, +1) 집중 분석 (앞뒤 1페이지만 비교)
      const candidatePages: number[] = [];
      const startPage = Math.max(1, fallbackPage - 1);  // 앞 1페이지
      const endPage = Math.min(pdf.numPages, fallbackPage + 1);  // 뒤 1페이지
      
      for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
        candidatePages.push(pageNum);
      }
      
      console.log(`📄 주변 페이지 분석: ${candidatePages.join(', ')} (총 ${pdf.numPages}페이지 중, 범위: -1 ~ +1)`);

      // ✅ 개선: 검색 문장을 단어로 분리 (줄바꿈/공백 문제 해결)
      const searchWords = normalizedSearch
        .split(/\s+/) // 공백으로 분리
        .filter(w => w.trim().length >= 2) // 최소 2자 이상 단어만
        .filter(w => {
          // 불필요한 단어 제거 (조사, 접속사 등)
          const stopWords = ['은', '는', '이', '가', '을', '를', '에', '의', '와', '과', '도', '만', '로', '으로'];
          return !stopWords.includes(w.trim());
        });
      
      console.log(`📝 검색 단어 (${searchWords.length}개):`, searchWords.slice(0, 10).join(', '));

      // 주변 3페이지(-1, 0, +1)에서 매칭 점수 계산
      const pageScores: Array<{page: number, score: number, matchedWords: number, wordRatio: number}> = [];
      
      const pagePromises = candidatePages.map(pageNum => 
        pdf.getPage(pageNum).then(async (page: any) => {
          const textContent = await page.getTextContent();
          
          // 페이지 텍스트 추출 (줄바꿈 보존)
          let pageText = '';
          for (let i = 0; i < textContent.items.length; i++) {
            const item = textContent.items[i];
            pageText += item.str;
            if (item.hasEOL) {
              pageText += '\n';
            }
          }
          
          // 정규화된 페이지 텍스트
          const normalizedPageText = normalizeTextForSearch(pageText);
          
          // ✅ 개선: 페이지 텍스트도 단어로 분리
          const pageWords = normalizedPageText
            .split(/\s+/)
            .filter(w => w.trim().length >= 2);
          
          // ✅ 핵심: 단어 단위 매칭 (줄바꿈/공백 문제 해결)
          let matchedWords = 0;
          const matchedWordList: string[] = [];
          
          for (const searchWord of searchWords) {
            // 정확한 단어 매칭 또는 포함 관계 확인
            const found = pageWords.some(pageWord => {
              // 정확히 일치하거나 서로 포함하는 경우
              return pageWord === searchWord || 
                     pageWord.includes(searchWord) || 
                     searchWord.includes(pageWord);
            });
            
            if (found) {
              matchedWords++;
              matchedWordList.push(searchWord);
            }
          }
          
          // 단어 매칭 비율 계산
          const wordRatio = searchWords.length > 0 ? matchedWords / searchWords.length : 0;
          
          // ✅ 점수 계산 (단어 매칭 기반)
          let score = 0;
          
          // 1. 단어 매칭 점수 (가장 중요 - 줄바꿈/공백 문제 해결)
          if (wordRatio >= 0.8) {
            // 80% 이상 단어 매칭 = 매우 높은 점수
            score += 1000 + (matchedWords * 50);
          } else if (wordRatio >= 0.6) {
            // 60% 이상 단어 매칭 = 높은 점수
            score += 500 + (matchedWords * 30);
          } else if (wordRatio >= 0.4) {
            // 40% 이상 단어 매칭 = 중간 점수
            score += 200 + (matchedWords * 20);
          } else if (wordRatio >= 0.2) {
            // 20% 이상 단어 매칭 = 낮은 점수
            score += 50 + (matchedWords * 10);
          }
          
          // 2. 전체 문장 포함 여부 (보너스 - 정확히 일치할 때만)
          if (normalizedPageText.includes(normalizedSearch)) {
            score += 500; // 보너스 점수
          }
          
          // 3. 연속된 단어 그룹 매칭 (문맥 보존)
          if (searchWords.length >= 3) {
            // 연속된 3개 이상 단어가 순서대로 매칭되는지 확인
            let consecutiveMatches = 0;
            let maxConsecutive = 0;
            
            for (let i = 0; i < searchWords.length; i++) {
              const searchWord = searchWords[i];
              const found = pageWords.some(pw => 
                pw === searchWord || pw.includes(searchWord) || searchWord.includes(pw)
              );
              
              if (found) {
                consecutiveMatches++;
                maxConsecutive = Math.max(maxConsecutive, consecutiveMatches);
              } else {
                consecutiveMatches = 0;
              }
            }
            
            if (maxConsecutive >= 3) {
              score += maxConsecutive * 30; // 연속 매칭 보너스
            }
          }
          
          // 4. 원래 페이지에 가까울수록 보너스 점수 (동점 처리)
          if (pageNum === fallbackPage) {
            score += 30; // 원래 페이지에 보너스
          }
          
          console.log(`📊 페이지 ${pageNum} 매칭 결과:`, {
            점수: score,
            매칭단어: `${matchedWords}/${searchWords.length}`,
            매칭비율: `${(wordRatio * 100).toFixed(1)}%`,
            매칭단어목록: matchedWordList.slice(0, 5).join(', ')
          });
          
          return { 
            page: pageNum, 
            score, 
            matchedWords, 
            wordRatio 
          };
        })
      );
      
      const results = await Promise.all(pagePromises);
      pageScores.push(...results);

      // 가장 높은 점수의 페이지 선택
      if (pageScores.length === 0) {
        console.warn('⚠️ 매칭된 페이지 없음, fallback 사용');
        return fallbackPage;
      }

      // 점수 기준 정렬
      pageScores.sort((a, b) => {
        // 1순위: 점수 높은 순
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        // 2순위: 단어 매칭 비율 높은 순
        if (b.wordRatio !== a.wordRatio) {
          return b.wordRatio - a.wordRatio;
        }
        // 3순위: 매칭 단어 개수 많은 순
        if (b.matchedWords !== a.matchedWords) {
          return b.matchedWords - a.matchedWords;
        }
        // 4순위: 원래 페이지에 가까운 순
        const aDistance = Math.abs(a.page - fallbackPage);
        const bDistance = Math.abs(b.page - fallbackPage);
        if (aDistance !== bDistance) {
          return aDistance - bDistance;
        }
        // 5순위: 페이지 번호 낮은 순
        return a.page - b.page;
      });

      const bestMatch = pageScores[0];
      console.log('✅ 최적 페이지 찾음:', {
        page: bestMatch.page,
        score: bestMatch.score,
        matchedWords: `${bestMatch.matchedWords}/${searchWords.length}`,
        wordRatio: `${(bestMatch.wordRatio * 100).toFixed(1)}%`,
        fallbackPage,
        changed: bestMatch.page !== fallbackPage
      });

      // 최소 점수 임계값 (너무 낮은 점수면 fallback 사용)
      // 단어 매칭 비율이 20% 이상이거나 점수가 100 이상이면 사용
      if (bestMatch.wordRatio >= 0.2 || bestMatch.score >= 100) {
        // 캐시에 저장 (캐시 크기 제한)
        if (pageSearchCache.current.size >= MAX_CACHE_SIZE) {
          const firstKey = pageSearchCache.current.keys().next().value;
          pageSearchCache.current.delete(firstKey);
        }
        pageSearchCache.current.set(cacheKey, bestMatch.page);
        return bestMatch.page;
      } else {
        console.warn('⚠️ 점수/매칭 비율이 너무 낮음, fallback 사용:', {
          score: bestMatch.score,
          wordRatio: bestMatch.wordRatio
        });
        return fallbackPage;
      }
      
    } catch (error) {
      console.error('❌ PDF 페이지 검색 실패:', error);
      return fallbackPage; // 오류 시 fallback 사용
    }
  };
  
  // ✅ 하이브리드 텍스트 추출 함수들
  const getCircleNumber = (num: number): string => {
    // ✅ 개선: 원형 숫자 범위 확대 (35번까지 지원)
    const circleNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', 
                          '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳',
                          '㉑', '㉒', '㉓', '㉔', '㉕', '㉖', '㉗', '㉘', '㉙', '㉚',
                          '㉛', '㉜', '㉝', '㉞', '㉟'];
    return num >= 1 && num <= 35 ? circleNumbers[num - 1] : '';
  };

  // AI 응답에서 참조 번호 주변 문장 추출
  const extractSentenceFromResponse = (responseText: string, referenceNumber: number): string | null => {
    if (!responseText || referenceNumber <= 0) return null;
    
    // ✅ 개선: 더 다양한 참조 번호 패턴 지원
    const boldPattern = new RegExp(`\\*\\*${referenceNumber}\\*\\*`, 'g');
    const circlePattern = getCircleNumber(referenceNumber);
    // ✅ 추가: 숫자만 있는 패턴 (예: " 5 ", "(5)" 등, 단독 숫자는 너무 많아서 제외)
    const numberPattern = new RegExp(`[^0-9]${referenceNumber}[^0-9]`, 'g');
    
    let matchIndex = -1;
    let matchText = '';
    
    // ✅ 우선순위: 원형 숫자 > 볼드 > 일반 숫자
    if (circlePattern) {
      const circleIndex = responseText.indexOf(circlePattern);
      if (circleIndex >= 0) {
        matchIndex = circleIndex;
        matchText = circlePattern;
      }
    }
    
    if (matchIndex < 0) {
      // **12** 형식 찾기
      const boldMatches = responseText.match(boldPattern);
      if (boldMatches && boldMatches.length > 0) {
        matchIndex = responseText.indexOf(boldMatches[0]);
        matchText = boldMatches[0];
      }
    }
    
    if (matchIndex < 0) {
      // 일반 숫자 패턴 찾기 (공백으로 구분된 숫자)
      const numberMatches = responseText.match(numberPattern);
      if (numberMatches && numberMatches.length > 0) {
        // 가장 가까운 매칭 찾기 (참조 번호는 보통 문장 끝에 위치)
        let bestMatch = -1;
        for (const match of numberMatches) {
          const index = responseText.indexOf(match);
          // 문장 끝 근처(마지막 100자 내)에 있으면 우선 선택
          if (index >= responseText.length - 100) {
            bestMatch = index;
            matchText = match.trim();
            break;
          }
          if (bestMatch < 0 || index > bestMatch) {
            bestMatch = index;
            matchText = match.trim();
          }
        }
        if (bestMatch >= 0) {
          matchIndex = bestMatch;
        }
      }
    }
    
    if (matchIndex < 0) {
      console.log(`⚠️ 참조 번호 ${referenceNumber}를 응답에서 찾지 못함`);
      return null;
    }
    
    // ✅ 개선: 참조 번호 앞 문장 우선 추출 (참조 번호는 보통 문장 끝에 위치)
    const start = Math.max(0, matchIndex - 500); // 범위 확대
    const end = Math.min(responseText.length, matchIndex + matchText.length + 200);
    const context = responseText.substring(start, end);
    
    // ✅ 개선: 더 정확한 문장 분할 (마크다운 리스트 고려)
    const sentences = context
      .split(/[.。!！?？\n]/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    const refIndex = sentences.findIndex(s => s.includes(matchText));
    
    if (refIndex >= 0) {
      // ✅ 개선: 참조 번호 앞 문장 우선 (참조 번호는 보통 문장 끝에 위치)
      let targetSentence = '';
      
      if (refIndex > 0) {
        // 앞 문장이 더 길고 의미 있는 경우
        const prevSentence = sentences[refIndex - 1];
        const currentSentence = sentences[refIndex];
        
        if (prevSentence.length >= 20 && prevSentence.length > currentSentence.length) {
          targetSentence = prevSentence;
        } else {
          targetSentence = currentSentence;
        }
      } else {
        targetSentence = sentences[refIndex];
      }
      
      // ✅ 개선: 참조 번호 제거 및 마크다운 특수 문자 제거
      const cleaned = targetSentence
        .replace(/\*\*\d+\*\*/g, '') // **12** 제거
        .replace(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟]/g, '') // 원형 숫자 제거
        .replace(/^[>\s]*/, '') // 마크다운 인용(>) 및 선행 공백 제거
        .replace(/\*\*/g, '') // 남은 ** 제거
        .replace(/^[-•\s]*/, '') // 리스트 마커(-, •) 및 선행 공백 제거
        .replace(/\s+/g, ' ') // 연속 공백 제거
        .trim();
      
      if (cleaned.length >= 15) {
        console.log(`✅ 참조 번호 ${referenceNumber} 문장 추출 성공:`, cleaned.substring(0, 60));
        return cleaned.substring(0, 100); // 최대 100자
      }
    }
    
    console.log(`⚠️ 참조 번호 ${referenceNumber} 주변 문장을 찾지 못함`);
    return null;
  };

  // chunkContent에서 가장 긴/핵심 문장 추출
  const extractBestSentence = (chunkContent: string): string | null => {
    if (!chunkContent) return null;
    
    // 문장 분할 (개선: 더 정확한 문장 분할)
    const sentences = chunkContent
      .split(/[.。!！?？\n]/)
      .map(s => s.trim())
      .filter(s => s.length >= 10); // 최소 10자 이상
    
    if (sentences.length === 0) return null;
    
    // 제목이나 헤더 제외 (■, ●, ▶ 등으로 시작하는 짧은 문장 제외)
    const validSentences = sentences.filter(s => {
      const trimmed = s.trim();
      if (trimmed.length === 0) return false;
      const firstChar = trimmed[0];
      // 특수 문자로 시작하지만 충분히 긴 문장은 포함
      return !['■', '●', '▶', '○', '※'].includes(firstChar) || trimmed.length >= 25;
    });
    
    if (validSentences.length === 0) {
      // 필터링 결과가 없으면 원본에서 가장 긴 문장 사용
      const longest = sentences.reduce((a, b) => a.length > b.length ? a : b);
      return longest.substring(0, 60);
    }
    
    // 가장 긴 문장 선택 (핵심 내용일 가능성 높음)
    const longest = validSentences.reduce((a, b) => a.length > b.length ? a : b);
    return longest.substring(0, 60);
  };

  // 하이브리드 텍스트 추출 (1순위: referencedSentence, 2순위: AI 응답, 3순위: chunkContent, 4순위: 기본값)
  const extractSearchText = (
    chunkContent: string | undefined,
    responseText: string | undefined,
    referenceNumber: number,
    referencedSentence?: string // ✅ AI가 실제로 인용한 문장
  ): string | undefined => {
    console.log('🔍 extractSearchText 호출:', {
      hasReferencedSentence: !!referencedSentence,
      referencedSentenceLength: referencedSentence?.length || 0,
      hasResponseText: !!responseText,
      referenceNumber,
      hasChunkContent: !!chunkContent
    });
    
    // 1순위: referencedSentence 사용 (AI가 실제로 인용한 문장)
    if (referencedSentence && referencedSentence.length >= 15) {
      console.log('✅ [1순위] referencedSentence 사용:', referencedSentence.substring(0, 60));
      return referencedSentence.substring(0, 60); // 최대 60자
    } else if (referencedSentence) {
      console.log('⚠️ referencedSentence가 너무 짧음:', referencedSentence.substring(0, 30));
    } else {
      console.log('⚠️ referencedSentence가 없음, 2순위로 폴백');
    }
    
    // 2순위: AI 응답에서 참조 번호 주변 문장 추출
    if (responseText && referenceNumber > 0) {
      const sentenceFromResponse = extractSentenceFromResponse(responseText, referenceNumber);
      if (sentenceFromResponse) {
        console.log('✅ [2순위] AI 응답에서 문장 추출:', sentenceFromResponse);
        return sentenceFromResponse;
      } else {
        console.log('⚠️ AI 응답에서 문장 추출 실패, 3순위로 폴백');
      }
    }
    
    // 3순위: chunkContent에서 가장 긴/핵심 문장 선택 (AI 응답과 유사한 문장 우선)
    if (chunkContent) {
      // ✅ 개선: AI 응답과 유사한 문장 찾기 시도
      if (responseText && referenceNumber > 0) {
        const refContext = extractSentenceFromResponse(responseText, referenceNumber);
        if (refContext) {
          // 청크 내용을 문장으로 분할
          const sentences = chunkContent
            .split(/[.。!！?？\n]/)
            .map(s => s.trim())
            .filter(s => s.length >= 15);
          
          if (sentences.length > 0) {
            // 유사한 문장 찾기
            const normalizeText = (text: string) => 
              text.replace(/\s+/g, ' ').replace(/[\n\r\t]/g, ' ').trim().toLowerCase();
            
            const normalizedRef = normalizeText(refContext);
            const similarSentence = sentences.find(s => {
              const normalized = normalizeText(s);
              // 부분 매칭 (최소 20자 이상 일치)
              return normalized.includes(normalizedRef.substring(0, Math.min(20, normalizedRef.length))) ||
                     normalizedRef.includes(normalized.substring(0, Math.min(20, normalized.length)));
            });
            
            if (similarSentence) {
              console.log('✅ [3순위-개선] AI 응답과 유사한 청크 문장 찾음:', similarSentence.substring(0, 60));
              return similarSentence.substring(0, 60);
            }
          }
        }
      }
      
      // 폴백: 가장 긴 문장 사용
      const bestSentence = extractBestSentence(chunkContent);
      if (bestSentence) {
        console.log('✅ [3순위] 청크에서 핵심 문장 추출:', bestSentence);
        return bestSentence;
      } else {
        console.log('⚠️ 청크에서 핵심 문장 추출 실패, 4순위로 폴백');
      }
    }
    
    // 4순위: 기본값 (첫 30자)
    const fallback = chunkContent ? chunkContent.substring(0, 30) : undefined;
    console.log('⚠️ [4순위] 기본값 사용:', fallback);
    return fallback;
  };

  // ✅ 참조 클릭 이벤트 리스너 - 새 창에서 PDF 열기 또는 기존 창 페이지 이동
  useEffect(() => {
    const handleReferenceClick = async (event: CustomEvent) => {
      console.log('📥 App.tsx에서 referenceClick 이벤트 수신:', event.detail);
      const { documentId, chunkId, page, logicalPageNumber, filename, title, questionContent, chunkContent, keywords, responseText, referenceNumber, referencedSentence } = event.detail;
      console.log('📝 설정할 값:', { documentId, chunkId, page, logicalPageNumber, filename, title, questionContent, chunkContent, keywords, referencedSentence });
      
      // ✅ 방법 3: sentencePageMap 우선 사용 (하이브리드 접근)
      // 이벤트에서 pageFromSentenceMap 받기 (Message.tsx에서 전달)
      const pageFromSentenceMap = (event.detail as any).pageFromSentenceMap;
      let actualPage = page || logicalPageNumber || 1;
      
      // ✅ 1순위: sentencePageMap에서 찾은 페이지를 fallback으로 사용
      if (pageFromSentenceMap) {
        actualPage = pageFromSentenceMap;
        console.log('✅ sentencePageMap에서 페이지 찾음 (검증 예정):', actualPage);
      }

      // ✅ 개선: pageFromSentenceMap이 있어도 PDF 검색으로 검증/보정
      // ✅ 검색 문장 추출 (pageFromSentenceMap이 있어도 실행)
      let searchSentence = referencedSentence;
      
      // referencedSentence가 없으면 AI 응답에서 추출 시도
      if (!searchSentence || searchSentence.length < 15) {
        if (responseText && referenceNumber > 0) {
          const extractedSentence = extractSentenceFromResponse(responseText, referenceNumber);
          if (extractedSentence && extractedSentence.length >= 15) {
            searchSentence = extractedSentence;
            console.log('✅ AI 응답에서 문장 추출 성공:', extractedSentence.substring(0, 50));
          }
        }
      }
      
      // 여전히 없으면 extractSearchText로 검색 문장 추출
      if (!searchSentence || searchSentence.length < 15) {
        searchSentence = extractSearchText(chunkContent, responseText, referenceNumber || 0, referencedSentence);
        console.log('✅ extractSearchText로 문장 추출:', searchSentence?.substring(0, 50));
      }
      
      // ✅ 개선: searchSentence가 있으면 항상 PDF 검색 실행 (pageFromSentenceMap 검증/보정)
      // ✅ 추가: searchSentence가 없어도 pageFromSentenceMap이 있으면 검증 시도
      if (filename && (searchSentence || pageFromSentenceMap)) {
        // searchSentence가 없으면 pageFromSentenceMap 기반으로 검색 문장 생성 시도
        if (!searchSentence || searchSentence.length < 15) {
          if (pageFromSentenceMap && chunkContent) {
            // pageFromSentenceMap이 있으면 청크 내용에서 핵심 문장 추출 시도
            const bestSentence = extractBestSentence(chunkContent);
            if (bestSentence && bestSentence.length >= 15) {
              searchSentence = bestSentence;
              console.log('✅ pageFromSentenceMap 검증을 위한 문장 추출:', searchSentence.substring(0, 50));
            }
          }
        }
        
        if (filename && searchSentence && searchSentence.length >= 15) {
          try {
            const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const basePath = isDevelopment ? '/pdf' : '/chat7v/pdf';
            const encodedFilename = encodeURIComponent(filename);
            const pdfUrl = `${window.location.origin}${basePath}/${encodedFilename}`;
            
            console.log('🔍 정확한 페이지 검색 시작 (pageFromSentenceMap 검증):', {
              searchSentence: searchSentence.substring(0, 50),
              fallbackPage: actualPage,
              pageFromSentenceMap: pageFromSentenceMap || '없음',
              source: referencedSentence ? 'referencedSentence' : (responseText ? 'extracted' : (chunkContent ? 'chunkContent' : 'extractSearchText'))
            });
            
            // PDF에서 정확한 페이지 검색 (pageFromSentenceMap이 있으면 그것을 fallback으로 사용)
            const foundPage = await findExactPageInPDF(pdfUrl, searchSentence, actualPage);
            
            // ✅ 검색 결과가 pageFromSentenceMap과 다르면 로그 출력
            if (pageFromSentenceMap && foundPage !== pageFromSentenceMap) {
              console.log('✅ 페이지 보정 완료:', {
                pageFromSentenceMap,
                foundPage,
                차이: foundPage - pageFromSentenceMap
              });
            }
            
            actualPage = foundPage;
            
            console.log('✅ 페이지 검색 완료:', {
              originalPage: page,
              pageFromSentenceMap: pageFromSentenceMap || '없음',
              actualPage: actualPage,
              changed: actualPage !== page
            });
          } catch (error) {
            console.warn('⚠️ 페이지 검색 실패, 기본 페이지 사용:', error);
            // 오류 시 원래 페이지 사용
          }
        } else if (pageFromSentenceMap) {
          // searchSentence를 만들 수 없어도 pageFromSentenceMap은 사용 (최소한의 검증)
          console.log('⚠️ 검색 문장을 추출할 수 없어 pageFromSentenceMap 사용 (검증 없음):', pageFromSentenceMap);
        }
      }
      
      // 페이지 정보가 없으면 기본값 사용
      if (!actualPage) {
        actualPage = page || logicalPageNumber || 1;
        console.warn('⚠️ 페이지 정보가 없어 기본값 사용:', actualPage);
      } else {
        console.log('✅ 최종 페이지 결정:', {
          pageFromSentenceMap: pageFromSentenceMap ? '사용' : '없음',
          finalPage: actualPage,
          originalPage: page
        });
      }
      
      // PDF 파일명과 페이지 정보가 있으면 새 창에서 PDF 열기
      // page는 뷰어 인덱스 (PDF.js에서 사용하는 1-based 인덱스)
      if (filename && actualPage && actualPage > 0) {
        try {
          // PDF URL 생성 (개발/프로덕션 환경 자동 감지)
          const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
          const basePath = isDevelopment ? '/pdf' : '/chat7v/pdf';
          const encodedFilename = encodeURIComponent(filename);
          const pdfUrl = `${basePath}/${encodedFilename}`;
          const absolutePdfUrl = window.location.origin + pdfUrl;
          
          // 하이라이트할 키워드 추출 (개선: 정확하고 적은 키워드만 선택)
          const highlightKeywords: string[] = [];
          
          // ✅ 하이브리드 텍스트 추출 (우선순위: referencedSentence > AI 응답 > chunkContent)
          const coreSearchText = extractSearchText(chunkContent, responseText, referenceNumber || 0, referencedSentence);
          
          // ✅ 개선: 키워드는 최대 3개만 (가장 관련성 높은 것만)
          // 1. 청크 키워드에서 최대 2개 (가장 관련성 높은 것, 20자 이하만)
          if (keywords && Array.isArray(keywords) && keywords.length > 0) {
            const validKeywords = keywords
              .filter(k => k && k.trim().length >= 3 && k.trim().length <= 20)
              .slice(0, 2);
            highlightKeywords.push(...validKeywords);
          }
          
          // 2. 질문에서 핵심 단어 최대 2개 (3글자 이상만)
          if (questionContent) {
            const stopWords = ['은', '는', '이', '가', '을', '를', '에', '의', '와', '과', '도', '만', '조차', '마저', '까지', '부터', '에서', '에게', '한테', '께', '로', '으로', '것', '수', '있', '없', '되', '하', '등', '때', '경우', '위해', '때문'];
            
            const questionWords = questionContent
              .replace(/[^\w가-힣\s]/g, ' ')
              .split(/\s+/)
              .filter(w => {
                const word = w.trim();
                return word.length >= 3 && !stopWords.includes(word); // ✅ 3글자 이상으로 변경
              })
              .map(word => {
                // 조사 제거
                for (const particle of ['은', '는', '이', '가', '을', '를', '에', '의', '와', '과', '도', '만', '에서', '에게', '한테', '께', '로', '으로']) {
                  if (word.endsWith(particle) && word.length > particle.length) {
                    return word.slice(0, -particle.length);
                  }
                }
                return word;
              })
              .filter(w => w.length >= 3) // ✅ 3글자 이상만
              .slice(0, 2); // ✅ 최대 2개만
            
            highlightKeywords.push(...questionWords);
          }
          
          // 중복 제거 및 최대 3개로 제한
          const uniqueKeywords = [...new Set(highlightKeywords)]
            .filter(k => k && k.trim().length >= 3 && k.trim().length <= 20) // ✅ 3~20자만
            .slice(0, 3); // ✅ 최대 3개로 제한
          
          // 기존 PDF 창이 열려있고 닫히지 않았는지 확인
          const existingWindow = pdfViewerWindowRef.current;
          console.log('🔍 기존 창 확인:', {
            exists: !!existingWindow,
            closed: existingWindow?.closed,
            ready: existingWindow && !existingWindow.closed
          });
          
          if (existingWindow && !existingWindow.closed) {
            try {
              const message = {
                type: 'changePage',
                page: actualPage, // ✅ 검색된 페이지 사용
                highlight: uniqueKeywords.length > 0 ? uniqueKeywords : undefined,
                searchText: coreSearchText || (chunkContent ? chunkContent.substring(0, 30) : undefined) // ✅ 핵심 문구만 또는 최대 30자
              };
              
              console.log('📤 기존 창에 메시지 전송:', message);
              
              // 기존 창에 페이지 이동 메시지 전송
              existingWindow.postMessage(message, window.location.origin);
              
              // 기존 창을 포커스
              existingWindow.focus();
              
              // 메시지가 제대로 전달되었는지 확인 (간단한 핸들쉐이크)
              setTimeout(() => {
                // 응답 확인을 위해 다시 한 번 포커스 (메시지 처리 확인)
                  if (existingWindow && !existingWindow.closed) {
                  console.log(`✅ 기존 PDF 창으로 페이지 ${actualPage} 이동 메시지 전송 완료`);
                } else {
                  console.warn('⚠️ 기존 창이 닫혔습니다.');
                  pdfViewerWindowRef.current = null;
                }
              }, 100);
              
              return; // 새 창을 열지 않고 종료
            } catch (error) {
              console.error('❌ 기존 창에 메시지 전송 실패:', error);
              // 기존 창 참조 초기화
              pdfViewerWindowRef.current = null;
            }
          }
          
          // 뷰어 URL 생성 (하이라이트 키워드 포함)
          const params = new URLSearchParams({
            url: absolutePdfUrl,
            page: actualPage.toString(), // ✅ 검색된 페이지 사용
            title: title || filename
          });
          
          if (uniqueKeywords.length > 0) {
            params.append('highlight', uniqueKeywords.join(','));
            console.log('📄 하이라이트 키워드:', uniqueKeywords);
          }
          
          // ✅ 개선: 청크 내용도 전달 (핵심 문구만 또는 최대 30자)
          if (coreSearchText) {
            params.append('searchText', coreSearchText);
          } else if (chunkContent) {
            const contentSnippet = chunkContent.substring(0, 30);
            params.append('searchText', contentSnippet);
          }
          
          const viewerUrl = `/chat7v/pdf-viewer.html?${params.toString()}`;
          
          console.log('📄 PDF 뷰어 URL:', viewerUrl);
          console.log('📄 PDF 파일 URL:', absolutePdfUrl);
          
          // 새 창 열기 (사용자 상호작용 직후이므로 팝업 차단되지 않음)
          const newWindow = window.open(
            viewerUrl, 
            'pdfViewer',
            'width=1200,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no'
          );
          
          if (newWindow) {
            // 새 창 참조 저장
            pdfViewerWindowRef.current = newWindow;
            console.log(`✅ 새 창 열기 성공: ${filename}, 페이지 ${actualPage}`);
            
            // 새 창이 닫혔는지 확인
            const checkClosed = setInterval(() => {
              if (newWindow.closed) {
                clearInterval(checkClosed);
                pdfViewerWindowRef.current = null; // 참조 제거
                console.log('📄 PDF 뷰어 창이 닫혔습니다.');
              }
            }, 1000);
          } else {
            console.error('❌ 새 창 열기 실패 - 팝업이 차단되었을 수 있습니다.');
            // 팝업이 차단된 경우 현재 창에서 열기 시도
            const confirmOpen = window.confirm('팝업이 차단되었습니다. 현재 창에서 PDF를 열까요?');
            if (confirmOpen) {
              window.location.href = viewerUrl;
            }
          }
        } catch (error) {
          console.error('❌ PDF 뷰어 열기 오류:', error);
        }
      }
      // ✅ PDF 정보가 있으면 좌측 텍스트 뷰는 변경하지 않음 (PDF 뷰어만 제어)
      // ✅ PDF 정보가 없을 때만 텍스트 뷰로 폴백 (선택적)
      // else if (documentId && chunkId) {
      //   // PDF 정보가 없을 때만 텍스트 뷰 표시 (필요시 주석 해제)
      //   setSelectedDocumentId(documentId);
      //   setHighlightedChunkId(chunkId);
      //   setQuestionContent(questionContent || '');
      //   setPdfViewerMode('text');
      //   console.log('📄 텍스트 뷰로 표시 (PDF 정보 없음)');
      // }
    };

    window.addEventListener('referenceClick', handleReferenceClick as EventListener);
    return () => window.removeEventListener('referenceClick', handleReferenceClick as EventListener);
  }, []);

  const handleSendMessage = useCallback(async (message: string): Promise<string> => {
    // ✅ 질문 내용 저장 (SourceViewer에서 하이라이트용)
    setQuestionContent(message);
    return await geminiService.generateResponse(message);
  }, []);

  const handleStreamingMessage = useCallback(async (message: string): Promise<AsyncGenerator<string, void, unknown>> => {
    // ✅ 질문 내용 저장 (SourceViewer에서 하이라이트용)
    setQuestionContent(message);
    return await geminiService.generateStreamingResponse(message);
  }, []);

  const handleResetMessages = useCallback(() => {
    setMessages([]);
  }, []);


  const handleResetChat = () => {
    setShowResetConfirm(true);
  };

  const confirmReset = async () => {
    try {
      setShowResetConfirm(false);
      
      // 1. 현재 채팅 세션 초기화
      await geminiService.resetChatSession();
      
      // 2. 메시지 목록 초기화 (ChatWindow에서 관리하는 메시지들)
      setMessages([]);
      
      // 3. ChatWindow 강제 리렌더링을 위한 키 변경
      setChatKey(prev => prev + 1);
      
      // 4. 소스 목록을 다시 로드하여 최신 상태 유지
      await geminiService.initializeWithPdfSources();
      setSources(geminiService.getSources());
      
      console.log('새 대화가 시작되었습니다.');
    } catch (error) {
      console.error('Failed to reset chat session:', error);
    }
  };

  // ESC 키로 소스 뷰어 닫기
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedDocumentId) {
        setSelectedDocumentId(undefined);
        setHighlightedChunkId(undefined);
        setQuestionContent(''); // ✅ 질문 내용도 초기화
        console.log('ESC 키로 소스 뷰어 닫기');
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [selectedDocumentId]);

  // ✅ 브라우저 뒤로가기 버튼으로 소스 뷰어 닫기
  useEffect(() => {
    // 문서가 선택될 때마다 히스토리 엔트리 추가
    if (selectedDocumentId) {
      // 이미 추가된 경우 중복 방지
      const currentState = window.history.state;
      if (!currentState || !currentState.hasDocumentViewer) {
        window.history.pushState({ hasDocumentViewer: true }, '', window.location.href);
      }
    }
  }, [selectedDocumentId]);

  // ✅ popstate 이벤트 감지 (브라우저 뒤로가기)
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      // 문서 뷰어가 열려있을 때 뒤로가기를 누르면 문서 선택 해제
      if (selectedDocumentId) {
        // 브라우저 뒤로가기 기본 동작을 막지 않고, 상태만 업데이트
        setSelectedDocumentId(undefined);
        setHighlightedChunkId(undefined);
        setQuestionContent(''); // ✅ 질문 내용도 초기화
        console.log('브라우저 뒤로가기로 소스 뷰어 닫기');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [selectedDocumentId]);

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-brand-bg text-brand-text-primary flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="relative mb-6">
            <div className="w-16 h-16 border-4 border-brand-secondary rounded-full mx-auto"></div>
            <div className="w-16 h-16 border-4 border-brand-primary border-t-transparent rounded-full animate-spin absolute top-0 left-1/2 transform -translate-x-1/2"></div>
          </div>
          <h2 className="text-2xl font-bold text-brand-text-primary mb-3">AI 사업문의 지원 Chatbot6v</h2>
          <p className="text-brand-text-secondary mb-4">문서를 준비하고 있습니다...</p>
          <div className="space-y-2 text-sm text-brand-text-secondary">
            <div className="flex items-center justify-center space-x-2">
              <div className="w-2 h-2 bg-brand-primary rounded-full animate-pulse"></div>
              <span>사전 처리된 데이터 로딩 중...</span>
            </div>
            <div className="flex items-center justify-center space-x-2">
              <div className="w-2 h-2 bg-brand-primary rounded-full animate-pulse" style={{animationDelay: '0.2s'}}></div>
              <span>PDF 문서 파싱 중 (폴백 모드)</span>
            </div>
            <div className="flex items-center justify-center space-x-2">
              <div className="w-2 h-2 bg-brand-primary rounded-full animate-pulse" style={{animationDelay: '0.4s'}}></div>
              <span>AI 모델 준비 중...</span>
            </div>
          </div>
          <div className="mt-6 text-xs text-brand-text-secondary">
            잠시만 기다려주세요. 첫 로딩은 시간이 걸릴 수 있습니다.
          </div>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-brand-bg text-brand-text-primary">
      <div className="h-screen flex flex-col">
        <header className="bg-brand-surface border-b border-brand-secondary p-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              {/* 모바일 메뉴 버튼 */}
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="md:hidden p-2 rounded-lg bg-brand-secondary hover:bg-opacity-80 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-brand-primary">
                  AI 사업문의 지원 Chatbot 6V
                </h1>
                <p className="text-brand-text-secondary text-xs md:text-sm mt-1">
                  금연사업 관련 문의사항을 AI가 도와드립니다
                </p>
              </div>
            </div>
            
            <div className="flex gap-2 mr-16">
              {/* 고급 검색 테스트 버튼 숨김 */}
              {false && (
                <button
                  onClick={() => setShowAdvancedSearchTest(true)}
                  className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                >
                  🧪 고급 검색 테스트
                </button>
              )}
              <button
                onClick={() => setShowCompressionStats(true)}
                className="px-3 py-2 bg-brand-secondary text-brand-text-primary rounded-lg hover:bg-opacity-80 transition-colors text-xs md:text-sm"
              >
                사용량 통계
              </button>
              <button
                onClick={handleResetChat}
                className="px-3 py-2 bg-brand-secondary text-brand-text-primary rounded-lg hover:bg-opacity-80 transition-colors text-xs md:text-sm"
              >
                새 대화 시작
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 flex relative overflow-hidden">
          {/* 모바일 오버레이 */}
          {isSidebarOpen && (
            <div 
              className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
              onClick={() => setIsSidebarOpen(false)}
            />
          )}

          {/* 사이드바 - 소스 관리 */}
          <div 
            className={`
              fixed md:relative z-50 md:z-auto
              bg-brand-surface border-r border-brand-secondary overflow-hidden
              transform transition-transform duration-300 ease-in-out
              ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
              md:translate-x-0 md:block md:flex-shrink md:flex-grow-0
              flex flex-col
              h-full
            `}
            style={{ 
              width: `${sidebarWidth}px`, 
              minWidth: '250px',
              maxWidth: '800px'
            }}
          >
            {/* 사이드바 헤더 (고정) - SourceViewer가 있을 때는 제목 없이 뒤로가기 버튼만 */}
            {selectedDocumentId && (
              <div className="p-4 pb-2 flex-shrink-0">
                <div className="flex justify-between items-center">
                  <button
                    onClick={() => {
                      setSelectedDocumentId(undefined);
                      setHighlightedChunkId(undefined);
                    }}
                    className="p-1 rounded-lg hover:bg-brand-secondary transition-colors"
                    title="돌아가기"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setIsSidebarOpen(false)}
                    className="md:hidden p-1 rounded-lg hover:bg-brand-secondary"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
            
            {/* 자료 출처 모드일 때만 제목 표시 */}
            {!selectedDocumentId && (
              <div className="p-4 pb-2 border-b border-brand-secondary flex-shrink-0">
                <div className="flex justify-between items-center">
                  <h2 className="text-lg font-semibold text-brand-text-primary">
                    자료 출처
                  </h2>
                  <button
                    onClick={() => setIsSidebarOpen(false)}
                    className="md:hidden p-1 rounded-lg hover:bg-brand-secondary"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            )}

            {/* 사이드바 내용 (스크롤은 각 컴포넌트가 담당) */}
            <div className="flex-1">
              {selectedDocumentId ? (
                <SourceViewer
                  selectedDocumentId={selectedDocumentId}
                  highlightedChunkId={highlightedChunkId}
                  questionContent={questionContent}
                  onChunkSelect={(chunkId) => {
                    if (chunkId === '') {
                      setHighlightedChunkId(undefined);
                      setQuestionContent(''); // ✅ 질문 내용 초기화
                    } else {
                      setHighlightedChunkId(chunkId);
                    }
                  }}
                  pdfViewerMode={pdfViewerMode}
                  pdfCurrentPage={pdfCurrentPage}
                  pdfFilename={pdfFilename}
                  onPdfPageChange={(page) => {
                    setPdfCurrentPage(page);
                    
                    // ✅ 좌측 텍스트 뷰 스크롤 시 PDF 창도 실시간 동기화
                    const existingWindow = pdfViewerWindowRef.current;
                    if (existingWindow && !existingWindow.closed) {
                      try {
                        console.log(`🔄 텍스트 뷰 페이지 변경 → PDF 창 동기화: ${page}`);
                        existingWindow.postMessage({
                          type: 'changePage',
                          page: page
                        }, window.location.origin);
                      } catch (error) {
                        console.warn('⚠️ PDF 창 동기화 실패:', error);
                      }
                    }
                  }}
                  onViewModeChange={(mode) => setPdfViewerMode(mode)}
                />
              ) : (
                <div className="p-4 space-y-2 h-full overflow-y-auto sidebar-scroll">
                  <h3 className="text-md font-medium text-brand-text-primary">현재 자료</h3>
                  <SourceInfo sources={sources} onSourceClick={handleSourceClick} />
                </div>
              )}
            </div>
            
            {/* 리사이즈 핸들 */}
            <div
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize bg-transparent hover:bg-blue-500 transition-colors z-10 md:block hidden"
              onMouseDown={handleResizeStart}
              style={{
                transition: isResizing ? 'none' : 'background-color 0.2s'
              }}
            >
              {/* 핸들 시각적 표시 */}
              <div className="absolute top-1/2 right-0 transform -translate-y-1/2 w-1 h-16 bg-gray-400 rounded-r opacity-0 hover:opacity-100 transition-opacity" />
            </div>
          </div>

          {/* ✅ 채팅 화면 (전체 너비) - 사이드바 확장 시에도 보이도록 수정 */}
          <div className={`flex-1 min-w-[300px] max-w-full ${isResizing ? 'opacity-90' : 'opacity-100'} transition-opacity duration-200`} style={{ flexShrink: 1 }}>
            <div className="flex-1 flex flex-col min-w-0 h-full">
              <ChatWindow
                key="chat-window" // ✅ 고정 키 사용 (리사이즈나 SourceViewer 변경 시에도 유지)
                onSendMessage={handleSendMessage}
                onStreamingMessage={handleStreamingMessage}
                onResetMessages={handleResetMessages} // ✅ 메모이제이션된 함수 사용
                resetTrigger={chatKey} // 이 값이 변경될 때만 리셋
                placeholder="금연사업 관련 문의사항을 입력하세요..."
              />
            </div>
          </div>
        </div>
      </div>

      {/* 압축 통계 모달 */}
      <CompressionStats
        compressionResult={geminiService.getCompressionStats()}
        isVisible={showCompressionStats}
        onClose={() => setShowCompressionStats(false)}
      />

      {/* 새 대화 시작 확인 다이얼로그 */}
      <ConfirmDialog
        isOpen={showResetConfirm}
        title="새 대화 시작"
        message="현재 대화 내용이 모두 삭제됩니다. 계속하시겠습니까?"
        confirmText="새 대화 시작"
        cancelText="취소"
        onConfirm={confirmReset}
        onCancel={() => setShowResetConfirm(false)}
        isDestructive={true}
      />

      {/* Firestore 캐시 관리자 */}
      <FirestoreCacheManager />

      {/* 고급 검색 테스트 모달 */}
      {showAdvancedSearchTest && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-6xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">🚀 고급 검색 품질 테스트</h2>
              <button
                onClick={() => setShowAdvancedSearchTest(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>
            <AdvancedSearchTest />
          </div>
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}

export default App;